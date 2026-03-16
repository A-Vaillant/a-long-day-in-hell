/** Headless game simulator — wires all core modules into a runnable game loop.
 *
 * Supports pluggable "strategy" objects that make player decisions each tick.
 * No DOM, no window, no browser — pure logic for testing all game paths.
 *
 * Usage:
 *   import { createSimulation, strategies } from "./simulator.core.ts";
 *   const sim = createSimulation({ seed: "test", days: 30, strategy: strategies.systematic() });
 *   const result = sim.run();
 *
 * @module simulator.core
 */

import { seedFromString } from "./prng.core.ts";
import type { Xoshiro128ss } from "./prng.core.ts";
import * as Surv from "./survival.core.ts";
import type { SurvivalStats } from "./survival.core.ts";
import * as Tick from "./tick.core.ts";
import { isResetHour } from "./tick.core.ts";
import * as Lib from "./library.core.ts";
import type { Location, Direction } from "./library.core.ts";
import * as LifeStoryCore from "./lifestory.core.ts";
import * as EventsCore from "./events.core.ts";
import type { EventCard } from "./events.core.ts";
import * as NpcCore from "./npc.core.ts";
import type { NPC, DialogueTable } from "./npc.core.ts";
import type { Action } from "./action.core.ts";
import { applyAction as dispatchAction, type ActionContext } from "./action-dispatch.core.ts";

/* ---- Strategy interface ----
 *
 * A strategy is an object with:
 *   decide(gameState) → Action
 *
 * Action is one of:
 *   { type: "move", dir: "left"|"right"|"up"|"down"|"cross" }
 *   { type: "wait" }
 *   { type: "sleep" }
 *   { type: "eat" }
 *   { type: "drink" }
 *   { type: "alcohol" }
 *   { type: "read_book", bookIndex: number }
 *   { type: "take_book", bookIndex: number }
 *   { type: "submit" }
 *
 * gameState exposes everything the strategy needs to make decisions.
 * Strategies can return arrays for multi-step sequences within a tick.
 */

// Action type is imported from action.core.ts above — re-exported for consumers.
export type { Action } from "./action.core.ts";

export interface BookCoords {
    side: number;
    position: bigint;
    floor: bigint;
    bookIndex: number;
}

export interface LifeStory {
    name: string;
    occupation: string;
    hometown: string;
    causeOfDeath: string;
    storyText: string;
    targetPage: number;
    bookCoords: BookCoords;
    playerStart: { side: number; position: bigint; floor: bigint };
}

/** Read-only snapshot exposed to strategies. */
export interface GameState {
    seed: string;
    side: number;
    position: bigint;
    floor: bigint;
    tick: number;
    day: number;
    lightsOn: boolean;
    heldBook: BookCoords | null;
    dead: boolean;
    despairing: boolean;
    despairDays: number;
    deaths: number;
    won: boolean;
    stats: SurvivalStats;
    targetBook: BookCoords;
    totalMoves: number;
    segmentsVisited: number;
    booksRead: number;
    submissionsAttempted: number;
    npcs: NPC[];
    lastEvent: EventCard | null;
    availableMoves: Direction[];
    isRestArea: boolean;
    timeString: string;
    _mercyKiosks: Record<string, boolean>;
}

/** Strategy object that makes player decisions each tick. */
export interface Strategy {
    name: string;
    decide(gs: GameState): Action | Action[];
}

/** Result returned by sim.run(). */
export interface SimResult {
    won: boolean;
    day: number;
    deaths: number;
    totalMoves: number;
    segmentsVisited: number;
    booksRead: number;
    submissionsAttempted: number;
    finalStats: SurvivalStats;
    despairing: boolean;
    npcsAlive: number;
    npcsTotal: number;
    targetBook: BookCoords;
    heldBook: BookCoords | null;
}

/** Internal mutable game state. */
interface InternalState {
    seed: string;
    side: number;
    position: bigint;
    floor: bigint;
    tick: number;
    day: number;
    lightsOn: boolean;
    heldBook: BookCoords | null;
    dead: boolean;
    despairing: boolean;
    despairDays: number;
    deathCause: string | null;
    deaths: number;
    won: boolean;
    submissionsAttempted: number;
    lifeStory: LifeStory;
    targetBook: BookCoords;
    // Flat survival stats (previously nested as stats: SurvivalStats)
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;
    eventDeck: number[];
    lastEvent: EventCard | null;
    npcs: NPC[];
    nonsensePagesRead: number;
    totalMoves: number;
    segmentsVisited: number;
    booksRead: Set<string>;
    _mercyKiosks: Record<string, boolean>;
    _mercyKioskDone: boolean;
    // GameState-compat fields
    openBook: BookCoords | null;
    openPage: number;
    dwellHistory: Record<string, boolean>;
    _mercyArrival: string | null;
    _despairDays: number;
    falling: null;
    _readBlocked: boolean;
    _submissionWon: boolean;
    _lastMove: string | null;
}

export interface SimulationOpts {
    seed?: string;
    maxDays?: number;
    maxDeaths?: number;
    strategy: Strategy;
    /** Override player start location (default: lifeStory.playerStart). */
    startLoc?: { side: number; position: bigint; floor: bigint };
    /** Start player ~50 segments from book (tests win path, not the journey). */
    startNearBook?: boolean;
    onTick?: (gs: GameState) => void;
    onDay?: (gs: GameState) => void;
    onDeath?: (gs: GameState) => void;
    onEvent?: (event: EventCard, gs: GameState) => void;
    eventCards?: EventCard[];
    npcNames?: string[];
    npcDialogue?: DialogueTable;
    npcCount?: number;
    /** Test-only: override target book coordinates. */
    targetBookOverride?: BookCoords;
    /** Test-only: override starting morale (default: 100). */
    startMorale?: number;
}

export interface Simulation {
    run: () => SimResult;
    state: () => GameState;
}

/**
 * Create a simulation instance.
 *
 * @param {object} opts
 * @param {string} [opts.seed] - game seed (random if omitted)
 * @param {number} [opts.maxDays=100] - safety cap on simulation length
 * @param {number} [opts.maxDeaths=50] - safety cap on death count
 * @param {object} opts.strategy - strategy object with decide(gameState) method
 * @param {function} [opts.onTick] - callback per tick: (gameState) => void
 * @param {function} [opts.onDay] - callback per dawn: (gameState) => void
 * @param {function} [opts.onDeath] - callback on death: (gameState) => void
 * @param {function} [opts.onEvent] - callback on event draw: (event, gameState) => void
 * @param {object[]} [opts.eventCards] - event card array (default: empty)
 * @param {string[]} [opts.npcNames] - NPC name pool (default: generic names)
 * @param {object} [opts.npcDialogue] - dialogue table for NPC interaction
 * @param {number} [opts.npcCount=8] - number of NPCs to spawn
 * @returns {{ run: () => SimResult, state: () => GameState }}
 */
export function createSimulation(opts: SimulationOpts): Simulation {
    const seed = opts.seed || String(Math.floor(Math.random() * 0xFFFFFFFF));
    const maxDays = opts.maxDays || 100;
    const maxDeaths = opts.maxDeaths || 50;
    const strategy = opts.strategy;
    const eventCards = opts.eventCards || [];
    const npcNames = opts.npcNames || ["Alma","Cedric","Dolores","Edmund","Fatima","Gordon","Helena","Ivan"];
    const npcDialogue = opts.npcDialogue || { calm: ["..."], anxious: ["..."], mad: ["..."], catatonic: ["..."], dead: ["..."] };
    const npcCount = opts.npcCount ?? 8;
    // Initialize PRNG
    const rng = seedFromString(seed);

    // Initialize life story + target book
    const { story: lifeStory } = LifeStoryCore.generatePlayerWorld(seed);
    const targetBook: BookCoords = opts.targetBookOverride ?? lifeStory.bookCoords;
    let startLoc: Location;
    if (opts.startLoc) {
        startLoc = opts.startLoc;
    } else if (opts.startNearBook) {
        // ~50 segments from book, same side, ~25 floors above
        startLoc = { side: targetBook.side, position: targetBook.position + 50n, floor: targetBook.floor + 25n };
    } else {
        startLoc = lifeStory.playerStart;
    }

    // Initialize game state
    const _defaults = Surv.defaultStats();
    const gs: InternalState = {
        seed,
        side: startLoc.side,
        position: startLoc.position,
        floor: startLoc.floor,
        tick: 0,
        day: 1,
        lightsOn: true,
        heldBook: null,
        dead: false,
        despairing: false,
        deathCause: null,
        deaths: 0,
        won: false,
        submissionsAttempted: 0,
        lifeStory,
        targetBook,
        // Flat survival stats
        hunger: _defaults.hunger,
        thirst: _defaults.thirst,
        exhaustion: _defaults.exhaustion,
        morale: opts.startMorale ?? 100,
        mortality: _defaults.mortality,
        eventDeck: [],
        lastEvent: null,
        npcs: [],
        nonsensePagesRead: 0,
        despairDays: 0,
        // Tracking
        totalMoves: 0,
        segmentsVisited: 0,
        booksRead: new Set(),
        _mercyKiosks: {},
        _mercyKioskDone: false,
        // GameState-compat fields
        openBook: null,
        openPage: 0,
        dwellHistory: {},
        _mercyArrival: null,
        _despairDays: 0,
        falling: null,
        _readBlocked: false,
        _submissionWon: false,
        _lastMove: null,
    };

    // Spawn NPCs
    const npcRng = seedFromString(seed + ":npc-spawn");
    gs.npcs = NpcCore.spawnNPCs(startLoc, npcCount, npcNames, npcRng);

    // Event deck
    if (eventCards.length > 0) {
        const deckRng = seedFromString(seed + ":deck");
        gs.eventDeck = EventsCore.createDeck(eventCards.length, deckRng);
    }

    // Mark start segment
    gs.segmentsVisited = 1;

    // Action context for shared dispatch
    const simCtx: ActionContext = { seed, eventCards };

    /** Convert flat gs stats to SurvivalStats for survival core functions. */
    function statsFromState(): SurvivalStats {
        return {
            hunger: gs.hunger, thirst: gs.thirst, exhaustion: gs.exhaustion,
            morale: gs.morale, mortality: gs.mortality,
            despairing: gs.despairing, dead: gs.dead,
        };
    }
    /** Write SurvivalStats result back to flat gs fields. */
    function applyStats(s: SurvivalStats): void {
        gs.hunger = s.hunger; gs.thirst = s.thirst; gs.exhaustion = s.exhaustion;
        gs.morale = s.morale; gs.mortality = s.mortality;
        gs.despairing = s.despairing; gs.dead = s.dead;
    }

    /** Lightweight view of internal state for strategies.
     *  Exposes gs fields directly — no cloning. Computed fields are lazy getters. */
    const _loc: Location = { side: 0, position: 0n, floor: 0n };
    const gsView: GameState = {
        get seed() { return gs.seed; },
        get side() { return gs.side; },
        get position() { return gs.position; },
        get floor() { return gs.floor; },
        get tick() { return gs.tick; },
        get day() { return gs.day; },
        get lightsOn() { return gs.lightsOn; },
        get heldBook() { return gs.heldBook; },
        get dead() { return gs.dead; },
        get despairing() { return gs.despairing; },
        get despairDays() { return gs.despairDays || 0; },
        get deaths() { return gs.deaths; },
        get won() { return gs.won; },
        get stats() { return statsFromState(); },
        get targetBook() { return gs.targetBook; },
        get totalMoves() { return gs.totalMoves; },
        get segmentsVisited() { return gs.segmentsVisited; },
        get booksRead() { return gs.booksRead.size; },
        get submissionsAttempted() { return gs.submissionsAttempted; },
        get npcs() { return gs.npcs; },
        get lastEvent() { return gs.lastEvent; },
        get availableMoves() { _loc.side = gs.side; _loc.position = gs.position; _loc.floor = gs.floor; return Lib.availableMoves(_loc); },
        get isRestArea() { return Lib.isRestArea(gs.position); },
        get timeString() { return Tick.tickToTimeString(gs.tick); },
        get _mercyKiosks() { return gs._mercyKiosks; },
    };

    function gameState(): GameState {
        return gsView;
    }

    /** Apply a single action. Returns true if action was resolved. */
    function applyAction(action: Action): boolean {
        // Sleep: loop one-hour calls until done (shared dispatch does one hour at a time)
        if (action.type === "sleep") {
            const inBedroom = Lib.isRestArea(gs.position);
            const startDay = gs.day;
            let slept = false;
            while (!isResetHour(gs.tick) && !gs.dead && !gs.won && gs.day === startDay) {
                const result = dispatchAction(gs as any, { type: "sleep", inBedroom }, simCtx);
                if (!result.resolved) break;
                slept = true;
                for (const ev of result.tickEvents) {
                    if (ev === "dawn") onDawn();
                }
            }
            return slept;
        }

        const result = dispatchAction(gs as any, action, simCtx);
        if (!result.resolved) return false;

        // Track booksRead in simulator (shared dispatch opens the book but doesn't track Set)
        if (action.type === "read_book" && result.resolved && !gs._readBlocked) {
            const bookKey = `${gs.side}:${gs.position}:${gs.floor}:${(action as any).bookIndex}`;
            gs.booksRead.add(bookKey);
        }

        // segmentsVisited tracks unique gallery visits (increment on move)
        if (action.type === "move" && result.resolved) {
            gs.segmentsVisited++;
        }

        // Fire onEvent callback (shared dispatch updates state.lastEvent but not the callback)
        if (action.type === "move" && opts.onEvent && gs.lastEvent) {
            opts.onEvent(gs.lastEvent, gameState());
        }

        for (const ev of result.tickEvents) {
            if (ev === "dawn") onDawn();
        }

        return true;
    }

    /** Advance time by one tick while dead (waiting for resurrection at dawn). */
    function advanceDeadTick(): void {
        const result = Tick.advanceTick({ tick: gs.tick, day: gs.day }, 1);
        gs.tick = result.state.tick;
        gs.day = result.state.day;
        gs.lightsOn = Tick.isLightsOn(gs.tick);
        for (const ev of result.events) {
            if (ev === "dawn") onDawn();
        }
    }

    function onDawn(): void {
        // Resurrection
        if (gs.dead) {
            applyStats(Surv.applyResurrection(statsFromState()));
            gs.dead = false;
            gs.deathCause = null;
            gs.deaths++;
            if (opts.onDeath) opts.onDeath(gameState());
        }

        // NPC daily cycle
        const npcMoveRng = seedFromString(seed + ":npc-move:" + gs.day);
        gs.npcs = NpcCore.moveNPCs(gs.npcs, npcMoveRng);
        const npcDetRng = seedFromString(seed + ":npc-det:" + gs.day);
        gs.npcs = gs.npcs.map(n => NpcCore.deteriorate(n, gs.day, npcDetRng));

        const dawnReset = Surv.applyDawnReset(gs.nonsensePagesRead, gs.despairing, gs.despairDays);
        gs.nonsensePagesRead = dawnReset.nonsensePagesRead;
        gs.despairDays = dawnReset.despairDays;

        // Nightly book return: held book stays (possession rule)
        // but other books reset (we don't track that at sim level)

        if (opts.onDay) opts.onDay(gameState());
    }

    /** Run the simulation to completion. */
    function run(): SimResult {
        const dayLog: unknown[] = [];
        let tickCount = 0;
        const MAX_TICKS = maxDays * Tick.TICKS_PER_DAY;

        while (!gs.won && gs.day <= maxDays && gs.deaths < maxDeaths && tickCount < MAX_TICKS) {
            tickCount++;

            // If dead, just advance time until dawn
            if (gs.dead) {
                advanceDeadTick();
                continue;
            }

            // If lights off and not at rest area, auto-wait (or sleep if strategy wants)
            const action = strategy.decide(gameState());

            if (Array.isArray(action)) {
                for (const a of action) applyAction(a);
            } else {
                applyAction(action);
            }

            if (opts.onTick) opts.onTick(gameState());
        }

        return {
            won: gs.won,
            day: gs.day,
            deaths: gs.deaths,
            totalMoves: gs.totalMoves,
            segmentsVisited: gs.segmentsVisited,
            booksRead: gs.booksRead.size,
            submissionsAttempted: gs.submissionsAttempted,
            finalStats: statsFromState(),
            despairing: gs.despairing,
            npcsAlive: gs.npcs.filter(n => n.alive).length,
            npcsTotal: gs.npcs.length,
            targetBook: gs.targetBook,
            heldBook: gs.heldBook,
        };
    }

    return { run, state: gameState };
}

/* ==== Built-in strategies ==== */

export interface SystematicOpts {
    eatAt?: number;
    drinkAt?: number;
    sleepAt?: number;
    pattern?: "expanding" | "linear";
}

export interface RandomWalkOpts {
    eatAt?: number;
    drinkAt?: number;
    sleepAt?: number;
    readChance?: number;
}

export interface SurvivalOnlyOpts {
    eatAt?: number;
    drinkAt?: number;
    sleepAt?: number;
}

export const strategies = {

    /**
     * Systematic searcher: walks segments in order, reads every book,
     * takes + submits target when found. Eats/drinks/sleeps to survive.
     *
     * @param {object} [opts]
     * @param {number} [opts.eatAt=60] - hunger threshold to seek food
     * @param {number} [opts.drinkAt=60] - thirst threshold to seek water
     * @param {number} [opts.sleepAt=75] - exhaustion threshold to sleep
     * @param {"expanding"|"linear"} [opts.pattern="expanding"] - search pattern
     */
    systematic(opts?: SystematicOpts): Strategy {
        const cfg = Object.assign({ eatAt: 60, drinkAt: 60, sleepAt: 75, pattern: "expanding" as const }, opts);
        let searchDir: Direction = "right";
        let currentBookIndex = 0;
        let needsSubmit = false;

        return {
            name: "systematic",
            decide(gs: GameState): Action {
                // Submit if holding target
                if (needsSubmit && gs.isRestArea) {
                    needsSubmit = false;
                    return { type: "submit" };
                }
                if (needsSubmit) {
                    // Walk to nearest rest area to submit
                    return { type: "move", dir: searchDir };
                }

                // Sleep when exhausted or lights off
                if (!gs.lightsOn || gs.stats.exhaustion >= cfg.sleepAt) {
                    return { type: "sleep" };
                }

                // Eat/drink at rest areas when needed
                if (gs.isRestArea) {
                    if (gs.stats.hunger >= cfg.eatAt) return { type: "eat" };
                    if (gs.stats.thirst >= cfg.drinkAt) return { type: "drink" };
                }

                // Walk to rest area if starving/parched
                if ((gs.stats.hunger >= 90 || gs.stats.thirst >= 90) && !gs.isRestArea) {
                    const G = Lib.GALLERIES_PER_SEGMENT;
                    const mod = ((gs.position % G) + G) % G;
                    const distRight = (G - mod) % G || G;
                    const distLeft = mod || G;
                    return { type: "move", dir: distLeft <= distRight ? "left" : "right" };
                }

                // At a gallery (not rest area): read books systematically
                if (!gs.isRestArea && gs.lightsOn) {
                    if (currentBookIndex < Lib.BOOKS_PER_GALLERY) {
                        // Check if this is the target book
                        const tb = gs.targetBook;
                        if (gs.side === tb.side && gs.position === tb.position &&
                            gs.floor === tb.floor && currentBookIndex === tb.bookIndex) {
                            currentBookIndex++;
                            needsSubmit = true;
                            return { type: "take_book", bookIndex: tb.bookIndex };
                        }
                        const bi = currentBookIndex;
                        currentBookIndex++;
                        return { type: "read_book", bookIndex: bi };
                    }
                    // Done reading this segment, move on
                    currentBookIndex = 0;
                }

                // Move to next segment
                if (cfg.pattern === "expanding") {
                    return { type: "move", dir: searchDir };
                }
                // Linear: always go right
                return { type: "move", dir: "right" };
            }
        };
    },

    /**
     * Random walker: wanders aimlessly, occasionally reads books.
     * Eats/drinks/sleeps to survive. Never submits.
     */
    randomWalk(opts?: RandomWalkOpts): Strategy {
        const cfg = Object.assign({ eatAt: 70, drinkAt: 70, sleepAt: 80, readChance: 0.1 }, opts);
        let walkRng: Xoshiro128ss | null = null;

        return {
            name: "randomWalk",
            decide(gs: GameState): Action {
                if (!walkRng) walkRng = seedFromString(gs.seed + ":walk-strategy");

                if (!gs.lightsOn || gs.stats.exhaustion >= cfg.sleepAt) return { type: "sleep" };

                if (gs.isRestArea) {
                    if (gs.stats.hunger >= cfg.eatAt) return { type: "eat" };
                    if (gs.stats.thirst >= cfg.drinkAt) return { type: "drink" };
                }

                // Occasionally read
                if (!gs.isRestArea && gs.lightsOn && walkRng.next() < cfg.readChance) {
                    return { type: "read_book", bookIndex: walkRng.nextInt(Lib.BOOKS_PER_GALLERY) };
                }

                // Random move
                const moves = gs.availableMoves;
                return { type: "move", dir: moves[walkRng.nextInt(moves.length)] };
            }
        };
    },

    /**
     * Survival-focused: stays at rest areas, eats/drinks/sleeps.
     * Never searches, never reads. Tests pure survival mechanics.
     */
    survivalOnly(opts?: SurvivalOnlyOpts): Strategy {
        const cfg = Object.assign({ eatAt: 50, drinkAt: 50, sleepAt: 60 }, opts);

        return {
            name: "survivalOnly",
            decide(gs: GameState): Action {
                if (!gs.lightsOn || gs.stats.exhaustion >= cfg.sleepAt) return { type: "sleep" };

                if (gs.isRestArea) {
                    if (gs.stats.hunger >= cfg.eatAt) return { type: "eat" };
                    if (gs.stats.thirst >= cfg.drinkAt) return { type: "drink" };
                    return { type: "wait" as const };
                }

                // Walk to nearest rest area
                const G = Lib.GALLERIES_PER_SEGMENT;
                const mod = ((gs.position % G) + G) % G;
                const distRight = (G - mod) % G || G;
                const distLeft = mod || G;
                return { type: "move", dir: distLeft <= distRight ? "left" : "right" };
            }
        };
    },

    /**
     * Neglectful: never eats or drinks. Tests death timeline.
     */
    neglectful(): Strategy {
        return {
            name: "neglectful",
            decide(gs: GameState): Action {
                if (!gs.lightsOn || gs.stats.exhaustion >= 80) return { type: "sleep" };
                return { type: "wait" as const };
            }
        };
    },

    /**
     * Targeted: knows exact target book location, walks directly to it.
     * Tests the win path end-to-end.
     */
    targeted(): Strategy {
        let phase: "navigate" | "take" | "toSubmit" | "submit" | "done" = "navigate";

        /** Navigate to a rest area from current position. */
        function moveToRestArea(pos: bigint): { type: "move"; dir: Direction } | null {
            const G = Lib.GALLERIES_PER_SEGMENT;
            const mod = ((pos % G) + G) % G;
            if (mod === 0n) return null; // already at rest area
            const distRight = G - mod;
            const distLeft = mod;
            return { type: "move", dir: distLeft <= distRight ? "left" : "right" };
        }

        return {
            name: "targeted",
            decide(gs: GameState): Action {
                const tb = gs.targetBook;

                // Survival basics
                if (!gs.lightsOn || gs.stats.exhaustion >= 80) return { type: "sleep" as const };
                if (gs.isRestArea && gs.stats.hunger >= 60) return { type: "eat" as const };
                if (gs.isRestArea && gs.stats.thirst >= 60) return { type: "drink" as const };

                if (phase === "done") return { type: "wait" };

                if (phase === "submit") {
                    if (gs.isRestArea) {
                        phase = "done";
                        return { type: "submit" };
                    }
                    // Walk to nearest rest area
                    return moveToRestArea(gs.position) || { type: "move", dir: "right" };
                }

                if (phase === "toSubmit") {
                    // Navigate to a rest area to submit
                    const toRest = moveToRestArea(gs.position);
                    if (!toRest) { phase = "submit"; return { type: "submit" }; }
                    return toRest;
                }

                if (phase === "take") {
                    // At target location, take the book
                    phase = "toSubmit";
                    return { type: "take_book", bookIndex: tb.bookIndex };
                }

                // --- Navigation phase ---

                // 1. Handle side crossing (only at floor 0 rest areas)
                if (gs.side !== tb.side) {
                    if (gs.floor > 0n) {
                        // Need to go down to floor 0 — requires rest area
                        if (!gs.isRestArea) {
                            return moveToRestArea(gs.position) || { type: "move", dir: "right" };
                        }
                        return { type: "move", dir: "down" };
                    }
                    // At floor 0 — need rest area to cross
                    if (!gs.isRestArea) {
                        return moveToRestArea(gs.position) || { type: "move", dir: "right" };
                    }
                    return { type: "move", dir: "cross" };
                }

                // 2. Navigate to correct floor (requires rest area for stairs)
                if (gs.floor !== tb.floor) {
                    if (!gs.isRestArea) {
                        return moveToRestArea(gs.position) || { type: "move", dir: "right" };
                    }
                    return { type: "move", dir: gs.floor < tb.floor ? "up" : "down" };
                }

                // 3. Navigate to correct position
                if (gs.position !== tb.position) {
                    return { type: "move", dir: gs.position < tb.position ? "right" : "left" };
                }

                // 4. At target location
                phase = "take";
                return { type: "take_book", bookIndex: tb.bookIndex };
            }
        };
    },

    /**
     * Custom strategy from a decide function.
     *
     * @param {string} name
     * @param {function} decideFn - (gameState) => Action
     */
    custom(name: string, decideFn: (gs: GameState) => Action | Action[]): Strategy {
        return { name, decide: decideFn };
    },
};

/* ==== Scenario runners ==== */

export interface ScenarioOpts {
    runs: number;
    strategyFactory: () => Strategy;
    maxDays?: number;
    seedPrefix?: string;
    simOpts?: Partial<SimulationOpts>;
}

export interface ScenarioSummary {
    runs: number;
    wins: number;
    winRate: number;
    avgDays: number;
    avgDeaths: number;
    avgSegmentsVisited: number;
    avgBooksRead: number;
    avgNpcsAlive: number;
    medianDays: number;
    minDays: number;
    maxDays: number;
}

export interface ScenarioResult {
    results: SimResult[];
    summary: ScenarioSummary;
}

/**
 * Run a scenario N times with different seeds, collect aggregate stats.
 *
 * @param {object} opts
 * @param {number} opts.runs - number of runs
 * @param {function} opts.strategyFactory - () => strategy object (fresh per run)
 * @param {number} [opts.maxDays=100]
 * @param {string} [opts.seedPrefix="scenario"]
 * @param {object} [opts.simOpts] - additional createSimulation options
 * @returns {{ results: SimResult[], summary: object }}
 */
export function runScenario(opts: ScenarioOpts): ScenarioResult {
    const results: SimResult[] = [];
    for (let i = 0; i < opts.runs; i++) {
        const runSeed = (opts.seedPrefix || "scenario") + ":" + i;
        const sim = createSimulation({
            seed: runSeed,
            maxDays: opts.maxDays || 100,
            strategy: opts.strategyFactory(),
            ...(opts.simOpts || {}),
        });
        results.push(sim.run());
    }

    const wins = results.filter(r => r.won);
    const deaths = results.map(r => r.deaths);
    const days = results.map(r => r.day);

    return {
        results,
        summary: {
            runs: results.length,
            wins: wins.length,
            winRate: wins.length / results.length,
            avgDays: days.reduce((a, b) => a + b, 0) / days.length,
            avgDeaths: deaths.reduce((a, b) => a + b, 0) / deaths.length,
            avgSegmentsVisited: results.reduce((a, r) => a + r.segmentsVisited, 0) / results.length,
            avgBooksRead: results.reduce((a, r) => a + r.booksRead, 0) / results.length,
            avgNpcsAlive: results.reduce((a, r) => a + r.npcsAlive, 0) / results.length,
            medianDays: sorted(days)[Math.floor(days.length / 2)],
            minDays: Math.min(...days),
            maxDays: Math.max(...days),
        },
    };
}

function sorted(arr: number[]): number[] {
    return [...arr].sort((a, b) => a - b);
}
