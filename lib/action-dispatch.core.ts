/**
 * Unified action dispatch — the single source of truth for game mechanics.
 *
 * Both the browser (src/js/actions.js) and the headless simulator
 * (lib/simulator.core.ts) call applyAction(). Screen transitions and
 * boundary event dispatch are caller concerns.
 *
 * @module action-dispatch.core
 */

import type { Action } from "./action.core.ts";
import type { TickEvent } from "./tick.core.ts";
import type { FallingState } from "./chasm.core.ts";
import { defaultFallingState, fallTick, attemptGrab } from "./chasm.core.ts";
import type { EventCard } from "./events.core.ts";
import type { Entity, World } from "./ecs.core.ts";

import { seedFromString } from "./prng.core.ts";
import type { SurvivalStats } from "./survival.core.ts";
import { applyMoveTick, applyDrink, applyMercyKiosk, applyEat, applyAlcohol, applyReadNonsense, applySleep } from "./survival.core.ts";
import { isReadingBlocked } from "./despairing.core.ts";
import { BOOKS_PER_GALLERY } from "./library.core.ts";
import { applyAmbientDrain, shouldClearDespairing, modifySleepRecovery } from "./despairing.core.ts";
import { availableMovesMask, moveAllowed, applyMoveInPlace, isRestArea, type Location, type Direction } from "./library.core.ts";
import { mercyKiosk } from "./library.core.ts";
import { advanceTick, isLightsOn, TICKS_PER_HOUR } from "./tick.core.ts";
import * as EventsCore from "./events.core.ts";
import { talkTo, spendTime as spendTimeCore, recruit as recruitCore } from "./interaction.core.ts";
import { dismiss as dismissCore } from "./actions.core.ts";

// --- Interfaces ---

export interface BookCoords {
    side: number;
    position: bigint;
    floor: bigint;
    bookIndex: number;
}

export interface GameState {
    side: number;
    position: bigint;
    floor: bigint;
    tick: number;
    day: number;
    lightsOn: boolean;
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;
    despairing: boolean;
    dead: boolean;
    heldBook: BookCoords | null;
    openBook: BookCoords | null;
    openPage: number;
    dwellHistory: Record<string, boolean>;
    targetBook: BookCoords;
    submissionsAttempted: number;
    nonsensePagesRead: number;
    totalMoves: number;
    deaths: number;
    deathCause: string | null;
    _mercyKiosks: Record<string, boolean>;
    _mercyKioskDone: boolean;
    _mercyArrival: string | null;
    _despairDays: number;
    falling: FallingState | null;
    eventDeck: number[];
    lastEvent: EventCard | null;
    won: boolean;
    _readBlocked: boolean;
    _submissionWon: boolean;
    _lastMove: string | null;
    npcs?: any[];
}

export interface ActionContext {
    seed: string;
    eventCards: EventCard[];
    world?: World;
    resolveEntity?: (npcId: number) => Entity | undefined;
    playerEntity?: Entity;
    quicknessBonus?: number;
}

export interface DispatchResult {
    resolved: boolean;
    screen?: string;
    tickEvents: TickEvent[];
    ticksConsumed: number;
    data?: any;
}

// --- Helpers ---

function unresolved(): DispatchResult {
    return { resolved: false, tickEvents: [], ticksConsumed: 0 };
}

const AUTO_DRINK_THRESHOLD = 50;

function statsFromState(s: GameState): SurvivalStats {
    return {
        hunger: s.hunger, thirst: s.thirst, exhaustion: s.exhaustion,
        morale: s.morale, mortality: s.mortality,
        despairing: s.despairing, dead: s.dead,
    };
}

function applyStats(s: GameState, stats: SurvivalStats): void {
    s.hunger = stats.hunger; s.thirst = stats.thirst; s.exhaustion = stats.exhaustion;
    s.morale = stats.morale; s.mortality = stats.mortality;
    s.despairing = stats.despairing; s.dead = stats.dead;
}

interface TickResult {
    events: TickEvent[];
    ticksConsumed: number;
}

function advanceOneTick(s: GameState): TickResult {
    // Survival depletion
    applyStats(s, applyMoveTick(statsFromState(s)));
    // Ambient morale drain
    s.morale = applyAmbientDrain(s.morale);
    if (s.morale <= 0) s.despairing = true;
    // Death check
    if (s.mortality <= 0 || s.hunger >= 100 || s.thirst >= 100) {
        s.dead = true;
        if (s.mortality <= 0) s.deathCause = "mortality";
        else if (s.thirst >= 100 && s.hunger >= 100) s.deathCause = "starvation_dehydration";
        else if (s.thirst >= 100) s.deathCause = "dehydration";
        else if (s.hunger >= 100) s.deathCause = "starvation";
    }
    // Advance time
    const result = advanceTick({ tick: s.tick, day: s.day }, 1);
    s.tick = result.state.tick;
    s.day = result.state.day;
    s.lightsOn = isLightsOn(s.tick);

    // resetHour: force sleep through to dawn (everyone passes out)
    if (result.events.includes("resetHour") && !s.dead) {
        const sleepResult = applyAction(s, { type: "sleep", inBedroom: isRestArea(s.position) }, {} as ActionContext);
        const allEvents = [...result.events, ...sleepResult.tickEvents];
        return { events: allEvents, ticksConsumed: 1 + sleepResult.ticksConsumed };
    }

    return { events: result.events, ticksConsumed: 1 };
}

// --- Resolve action (state mutations only, no time advance) ---

/**
 * Resolve an action's state mutations without advancing time.
 *
 * Used by NPC tick loop (time advances once globally) and internally
 * by applyAction (which adds time advance for the player).
 *
 * Move: validates + applies position change, directional exhaustion,
 *   auto-drink, mercy kiosk, event draw.
 * Eat/drink/alcohol: validates + applies stat changes.
 * Read/take/drop/submit: validates + applies book state changes.
 * Chasm/social: validates + applies.
 * Sleep: NOT handled here — sleep is multi-tick (use applyAction).
 * Wait: no state mutation needed (just time advance).
 *
 * Returns resolved:true if the action was valid and applied.
 */
export function resolveAction(
    state: GameState,
    action: Action | { type: string; [k: string]: any },
    ctx: ActionContext,
): DispatchResult {
    switch (action.type) {
        case "move": {
            if (state.dead || state.won) return unresolved();
            const dir = (action as any).dir as Direction;
            const mask = availableMovesMask(state.position, state.floor);
            if (!moveAllowed(mask, dir)) return unresolved();

            const loc: Location = { side: state.side, position: state.position, floor: state.floor };
            applyMoveInPlace(loc, dir);
            state.side = loc.side;
            state.position = loc.position;
            state.floor = loc.floor;
            state._lastMove = dir;
            state.totalMoves++;

            // Directional exhaustion
            if (dir === "up") state.exhaustion = Math.min(100, state.exhaustion + 1.5);
            else if (dir === "down") state.exhaustion = Math.min(100, state.exhaustion + 0.75);

            // Auto-drink at rest area kiosks
            if (isRestArea(state.position) && state.lightsOn) {
                if (state.thirst >= AUTO_DRINK_THRESHOLD) {
                    applyStats(state, applyDrink(statsFromState(state)));
                }
            }

            // Mercy kiosk (one-shot)
            state._mercyArrival = null;
            if (!state._mercyKioskDone && isRestArea(state.position)) {
                const mercy = mercyKiosk(
                    { side: state.side, position: state.position, floor: state.floor },
                    state.targetBook,
                );
                if (mercy) {
                    state._mercyKiosks[mercy] = true;
                    state._mercyKioskDone = true;
                    applyStats(state, applyMercyKiosk(statsFromState(state)));
                    state._mercyArrival = mercy;
                    state._despairDays = 0;
                }
            }

            // Event draw
            if (ctx.eventCards && ctx.eventCards.length > 0) {
                const evRng = seedFromString(ctx.seed + ":ev:" + state.totalMoves);
                const draw = EventsCore.drawEvent(state.eventDeck, ctx.eventCards, evRng);
                state.eventDeck = draw.deck;
                state.lastEvent = draw.event;
                if (draw.event && draw.event.morale) {
                    state.morale = Math.max(0, Math.min(100, state.morale + draw.event.morale));
                }
            }

            return { resolved: true, screen: "Corridor", tickEvents: [], ticksConsumed: 0 };
        }

        case "wait": {
            if (state.dead || state.won) return unresolved();
            // No state mutation — just validated. Time advance is caller's job.
            return { resolved: true, screen: "Wait", tickEvents: [], ticksConsumed: 0 };
        }

        case "eat": {
            if (state.dead || state.won) return unresolved();
            if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
            applyStats(state, applyEat(statsFromState(state)));
            return { resolved: true, screen: "Kiosk Get Food", tickEvents: [], ticksConsumed: 0 };
        }

        case "drink": {
            if (state.dead || state.won) return unresolved();
            if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
            applyStats(state, applyDrink(statsFromState(state)));
            return { resolved: true, screen: "Kiosk Get Drink", tickEvents: [], ticksConsumed: 0 };
        }

        case "alcohol": {
            if (state.dead || state.won) return unresolved();
            if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
            applyStats(state, applyAlcohol(statsFromState(state)));
            if (state.despairing && shouldClearDespairing(state.morale)) {
                state.despairing = false;
            }
            return { resolved: true, screen: "Kiosk Get Alcohol", tickEvents: [], ticksConsumed: 0 };
        }

        case "read_book": {
            if (state.dead || state.won) return unresolved();
            if (!state.lightsOn) return unresolved();
            if (isRestArea(state.position)) return unresolved();
            const bookIndex = (action as any).bookIndex as number;
            if (bookIndex < 0 || bookIndex >= BOOKS_PER_GALLERY) return unresolved();

            // Despairing read block
            const readRng = seedFromString(ctx.seed + ":read:" + state.totalMoves + ":" + bookIndex);
            if (isReadingBlocked(state.despairing, readRng.next())) {
                state._readBlocked = true;
                return { resolved: true, screen: "Corridor", tickEvents: [], ticksConsumed: 0 };
            }

            state.openBook = { side: state.side, position: state.position, floor: state.floor, bookIndex };
            state.openPage = 1;
            const dwellKey = state.side + ":" + state.position + ":" + state.floor + ":" + bookIndex;
            state.dwellHistory[dwellKey] = true;
            const readResult = applyReadNonsense(statsFromState(state), state.nonsensePagesRead);
            applyStats(state, readResult.stats);
            state.nonsensePagesRead = readResult.nonsensePagesRead;

            return { resolved: true, screen: "Shelf Open Book", tickEvents: [], ticksConsumed: 0 };
        }

        case "take_book": {
            if (state.dead || state.won) return unresolved();
            if (!state.lightsOn) return unresolved();
            const bi = (action as any).bookIndex as number;
            if (bi < 0 || bi >= BOOKS_PER_GALLERY) return unresolved();
            state.heldBook = { side: state.side, position: state.position, floor: state.floor, bookIndex: bi };
            return { resolved: true, tickEvents: [], ticksConsumed: 0 };
        }

        case "drop_book": {
            state.heldBook = null;
            return { resolved: true, tickEvents: [], ticksConsumed: 0 };
        }

        case "submit": {
            if (state.dead || state.won) return unresolved();
            if (!isRestArea(state.position) || !state.heldBook) return unresolved();
            state.submissionsAttempted++;
            state._submissionWon = false;
            const hb = state.heldBook;
            const tb = state.targetBook;
            if (hb.side === tb.side && hb.position === tb.position &&
                hb.floor === tb.floor && hb.bookIndex === tb.bookIndex) {
                state.won = true;
                state._submissionWon = true;
            }
            if (!state.won) state.heldBook = null;
            return { resolved: true, screen: "Submission Attempt", tickEvents: [], ticksConsumed: 0 };
        }

        case "chasm_jump": {
            if (state.dead || state.won) return unresolved();
            if (state.floor <= 0n) return unresolved();
            state.falling = defaultFallingState(state.side);
            return { resolved: true, screen: "Falling", tickEvents: [], ticksConsumed: 0 };
        }

        case "grab_railing": {
            if (!state.falling) return unresolved();
            const grabRng = seedFromString(ctx.seed + ":grab:" + state.floor + ":" + state.tick);
            const bonus = ctx.quicknessBonus ?? 0;
            const result = attemptGrab(state.falling.speed, grabRng, bonus);
            if (result.success) {
                state.falling = null;
                return { resolved: true, screen: "Corridor", tickEvents: [], ticksConsumed: 0, data: { success: true, mortalityHit: 0 } };
            }
            state.falling.speed = result.speedAfter;
            state.mortality = Math.max(0, state.mortality - result.mortalityHit);
            if (state.mortality <= 0) {
                state.dead = true;
                state.deaths++;
                state.deathCause = "trauma";
            }
            return { resolved: true, tickEvents: [], ticksConsumed: 0, data: { success: false, mortalityHit: result.mortalityHit } };
        }

        case "throw_book": {
            state.heldBook = null;
            return { resolved: true, tickEvents: [], ticksConsumed: 0 };
        }

        case "fall_wait": {
            if (state.dead) return unresolved();
            if (!state.falling) return unresolved();
            // Fall physics (time advance happens separately)
            const fallResult = fallTick(state.falling, Number(state.floor));
            state.floor = BigInt(fallResult.newFloor);
            state.falling.speed = fallResult.newSpeed;
            if (fallResult.landed) {
                state.falling = null;
                if (fallResult.fatal) {
                    state.dead = true;
                    state.deaths = (state.deaths || 0) + 1;
                    state.deathCause = "gravity";
                }
            }
            if (state.dead) return { resolved: true, screen: "Death", tickEvents: [], ticksConsumed: 0 };
            if (!state.falling) return { resolved: true, screen: "Corridor", tickEvents: [], ticksConsumed: 0 };
            return { resolved: true, screen: "Falling", tickEvents: [], ticksConsumed: 0 };
        }

        case "talk": {
            if (state.dead) return unresolved();
            if (!ctx.world || !ctx.resolveEntity || ctx.playerEntity == null) return unresolved();
            const npcId = (action as any).npcId as number;
            const approach = (action as any).approach as string;
            const npcEnt = ctx.resolveEntity(npcId);
            if (npcEnt === undefined) return unresolved();
            const result = talkTo(ctx.world, ctx.playerEntity, npcEnt, approach as any, state.tick);
            if (!result.success) return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
            return { resolved: true, tickEvents: [], ticksConsumed: 2, data: result };
        }

        case "spend_time": {
            if (state.dead) return unresolved();
            if (!ctx.world || !ctx.resolveEntity || ctx.playerEntity == null) return unresolved();
            const npcId = (action as any).npcId as number;
            const npcEnt = ctx.resolveEntity(npcId);
            if (npcEnt === undefined) return unresolved();
            const result = spendTimeCore(ctx.world, ctx.playerEntity, npcEnt, state.tick);
            if (!result.success) return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
            return { resolved: true, tickEvents: [], ticksConsumed: result.ticksSpent, data: result };
        }

        case "recruit": {
            if (state.dead) return unresolved();
            if (!ctx.world || !ctx.resolveEntity || ctx.playerEntity == null) return unresolved();
            const npcId = (action as any).npcId as number;
            const npcEnt = ctx.resolveEntity(npcId);
            if (npcEnt === undefined) return unresolved();
            const result = recruitCore(ctx.world, ctx.playerEntity, npcEnt, state.tick);
            if (!result.success) return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
            return { resolved: true, tickEvents: [], ticksConsumed: 1, data: result };
        }

        case "dismiss": {
            if (state.dead) return unresolved();
            if (!ctx.world || !ctx.resolveEntity || ctx.playerEntity == null) return unresolved();
            const npcId = (action as any).npcId as number;
            const npcEnt = ctx.resolveEntity(npcId);
            if (npcEnt === undefined) return unresolved();
            const result = dismissCore(ctx.world, ctx.playerEntity, npcEnt);
            if (result.type !== "ok") return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
            return { resolved: true, tickEvents: [], ticksConsumed: 1, data: result };
        }

        default:
            return unresolved();
    }
}

// --- Combined dispatch (resolve + time advance) ---

/**
 * Apply an action AND advance time. This is the player-facing API.
 * Combines resolveAction (state mutations) with advanceOneTick
 * (survival depletion, ambient drain, death check, time advance).
 *
 * Sleep is handled specially — loops internally until dawn.
 *
 * For NPC bulk processing, use resolveAction directly and advance
 * time once globally.
 */
export function applyAction(
    state: GameState,
    action: Action | { type: string; [k: string]: any },
    ctx: ActionContext,
): DispatchResult {
    // Sleep: multi-tick, handled as a self-contained loop
    if (action.type === "sleep") {
        if (state.dead || state.won) return unresolved();
        const inBedroom = (action as any).inBedroom ?? false;
        const startDay = state.day;
        const allEvents: TickEvent[] = [];
        let totalTicks = 0;

        while (!state.dead && !state.won && state.day === startDay) {
            const moraleBefore = state.morale;
            applyStats(state, applySleep(statsFromState(state), inBedroom));
            if (state.despairing) {
                const baseDelta = state.morale - moraleBefore;
                if (baseDelta > 0) {
                    const effective = modifySleepRecovery(baseDelta, state.despairing);
                    state.morale = Math.max(0, moraleBefore + effective);
                }
            }
            if (state.despairing && shouldClearDespairing(state.morale)) {
                state.despairing = false;
            }
            const result = advanceTick({ tick: state.tick, day: state.day }, TICKS_PER_HOUR);
            state.tick = result.state.tick;
            state.day = result.state.day;
            state.lightsOn = isLightsOn(state.tick);
            totalTicks += TICKS_PER_HOUR;
            for (const ev of result.events) allEvents.push(ev);
        }

        return { resolved: true, screen: "Sleep", tickEvents: allEvents, ticksConsumed: totalTicks };
    }

    // All other actions: resolve state mutations, then advance time
    const result = resolveAction(state, action, ctx);
    if (!result.resolved) return result;

    // Tick-consuming actions advance time
    const tickCost = result.ticksConsumed || (action.type === "wait" || action.type === "move" ||
        action.type === "eat" || action.type === "drink" || action.type === "alcohol" ||
        action.type === "submit" || action.type === "fall_wait" ? 1 :
        action.type === "talk" ? 2 : 0);

    if (tickCost > 0) {
        const tick = advanceOneTick(state);
        // For multi-tick actions (talk, spend_time), advance remaining ticks
        if (tickCost > 1) {
            const extra = advanceTick({ tick: state.tick, day: state.day }, tickCost - 1);
            state.tick = extra.state.tick;
            state.day = extra.state.day;
            state.lightsOn = isLightsOn(state.tick);
            for (const ev of extra.events) tick.events.push(ev);
            tick.ticksConsumed += tickCost - 1;
        }

        // Preserve mortality during fall ticks
        if (action.type === "fall_wait") {
            // mortality already handled in resolveAction's fall physics
        }

        result.tickEvents = tick.events;
        result.ticksConsumed = tick.ticksConsumed;
    }

    return result;
}
