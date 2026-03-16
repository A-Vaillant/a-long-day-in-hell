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
import type { EventCard } from "./events.core.ts";
import type { Entity, World } from "./ecs.core.ts";

import { seedFromString } from "./prng.core.ts";
import type { SurvivalStats } from "./survival.core.ts";
import { applyMoveTick, applyDrink, applyMercyKiosk, applyEat, applyAlcohol, applyReadNonsense } from "./survival.core.ts";
import { isReadingBlocked } from "./despairing.core.ts";
import { BOOKS_PER_GALLERY } from "./library.core.ts";
import { applyAmbientDrain, shouldClearDespairing } from "./despairing.core.ts";
import { availableMovesMask, moveAllowed, applyMoveInPlace, isRestArea, type Location, type Direction } from "./library.core.ts";
import { mercyKiosk } from "./library.core.ts";
import { advanceTick, isLightsOn } from "./tick.core.ts";
import * as EventsCore from "./events.core.ts";

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

function advanceOneTick(s: GameState): TickEvent[] {
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
    return result.events;
}

// --- Main dispatch ---

export function applyAction(
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

            // Advance one tick (depletion + time)
            const tickEvents = advanceOneTick(state);

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
            if (ctx.eventCards.length > 0) {
                const evRng = seedFromString(ctx.seed + ":ev:" + state.totalMoves);
                const draw = EventsCore.drawEvent(state.eventDeck, ctx.eventCards, evRng);
                state.eventDeck = draw.deck;
                state.lastEvent = draw.event;
                if (draw.event && draw.event.morale) {
                    state.morale = Math.max(0, Math.min(100, state.morale + draw.event.morale));
                }
            }

            return { resolved: true, screen: "Corridor", tickEvents, ticksConsumed: 1 };
        }

        case "wait": {
            if (state.dead || state.won) return unresolved();
            const tickEvents = advanceOneTick(state);
            return { resolved: true, screen: "Wait", tickEvents, ticksConsumed: 1 };
        }

        case "eat": {
            if (state.dead || state.won) return unresolved();
            if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
            applyStats(state, applyEat(statsFromState(state)));
            const tickEvents = advanceOneTick(state);
            return { resolved: true, screen: "Kiosk Get Food", tickEvents, ticksConsumed: 1 };
        }

        case "drink": {
            if (state.dead || state.won) return unresolved();
            if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
            applyStats(state, applyDrink(statsFromState(state)));
            const tickEvents = advanceOneTick(state);
            return { resolved: true, screen: "Kiosk Get Drink", tickEvents, ticksConsumed: 1 };
        }

        case "alcohol": {
            if (state.dead || state.won) return unresolved();
            if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
            applyStats(state, applyAlcohol(statsFromState(state)));
            if (state.despairing && shouldClearDespairing(state.morale)) {
                state.despairing = false;
            }
            const tickEvents = advanceOneTick(state);
            return { resolved: true, screen: "Kiosk Get Alcohol", tickEvents, ticksConsumed: 1 };
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

            // Open book
            state.openBook = { side: state.side, position: state.position, floor: state.floor, bookIndex };
            state.openPage = 1;

            // Track dwell history
            const dwellKey = state.side + ":" + state.position + ":" + state.floor + ":" + bookIndex;
            state.dwellHistory[dwellKey] = true;

            // Apply nonsense reading morale penalty
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
            const tickEvents = advanceOneTick(state);
            return { resolved: true, screen: "Submission Attempt", tickEvents, ticksConsumed: 1 };
        }

        default:
            return unresolved();
    }
}
