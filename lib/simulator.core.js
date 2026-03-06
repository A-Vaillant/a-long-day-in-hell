/** Headless game simulator — wires all core modules into a runnable game loop.
 *
 * Supports pluggable "strategy" objects that make player decisions each tick.
 * No DOM, no window, no browser — pure logic for testing all game paths.
 *
 * Usage:
 *   import { createSimulation, strategies } from "./simulator.core.js";
 *   const sim = createSimulation({ seed: "test", days: 30, strategy: strategies.systematic() });
 *   const result = sim.run();
 *
 * @module simulator.core
 */

import { seedFromString } from "./prng.core.js";
import * as Surv from "./survival.core.js";
import * as Tick from "./tick.core.js";
import * as Lib from "./library.core.js";
import * as BookCore from "./book.core.js";
import * as LifeStoryCore from "./lifestory.core.js";
import * as EventsCore from "./events.core.js";
import * as NpcCore from "./npc.core.js";
import { applyAmbientDrain, modifySleepRecovery, shouldClearDespairing, isReadingBlocked, CONFIG as DespairConfig } from "./despairing.core.js";


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
 *   { type: "read", bookIndex: number }
 *   { type: "take", bookIndex: number }
 *   { type: "submit" }
 *
 * gameState exposes everything the strategy needs to make decisions.
 * Strategies can return arrays for multi-step sequences within a tick.
 */

/** @typedef {"move"|"wait"|"sleep"|"eat"|"drink"|"alcohol"|"read"|"take"|"submit"} ActionType */

/**
 * Create a simulation instance.
 *
 * @param {object} opts
 * @param {string} [opts.seed] - game seed (random if omitted)
 * @param {number} [opts.maxDays=100] - safety cap on simulation length
 * @param {number} [opts.maxDeaths=50] - safety cap on death count
 * @param {string} [opts.placement="gaussian"] - "gaussian" or "random"
 * @param {object} opts.strategy - strategy object with decide(gameState) method
 * @param {function} [opts.onTick] - callback per tick: (gameState) => void
 * @param {function} [opts.onDay] - callback per dawn: (gameState) => void
 * @param {function} [opts.onDeath] - callback on death: (gameState) => void
 * @param {function} [opts.onEvent] - callback on event draw: (event, gameState) => void
 * @param {object[]} [opts.eventCards] - event card array (default: empty)
 * @param {string[]} [opts.npcNames] - NPC name pool (default: generic names)
 * @param {object} [opts.npcDialogue] - dialogue table for NPC interaction
 * @param {number} [opts.npcCount=8] - number of NPCs to spawn
 * @param {object[]} [opts.stories] - story corpus for book generation
 * @param {string[]} [opts.dictionary] - word dictionary for book generation
 * @returns {{ run: () => SimResult, state: () => GameState }}
 */
export function createSimulation(opts) {
    const seed = opts.seed || String(Math.floor(Math.random() * 0xFFFFFFFF));
    const maxDays = opts.maxDays || 100;
    const maxDeaths = opts.maxDeaths || 50;
    const placement = opts.placement || "gaussian";
    const strategy = opts.strategy;
    const eventCards = opts.eventCards || [];
    const npcNames = opts.npcNames || ["Alma","Cedric","Dolores","Edmund","Fatima","Gordon","Helena","Ivan"];
    const npcDialogue = opts.npcDialogue || { calm: ["..."], anxious: ["..."], mad: ["..."], catatonic: ["..."], dead: ["..."] };
    const npcCount = opts.npcCount ?? 8;
    const stories = opts.stories || [{ id: 0, text: "The quick brown fox jumps over the lazy dog in the morning sun." }];
    const dictionary = opts.dictionary || ["word", "test", "placeholder", "filler", "text"];

    // Initialize PRNG
    const rng = seedFromString(seed);

    // Initialize life story + target book
    const startLoc = { side: 0, position: 0, floor: 10 };
    const lifeStory = LifeStoryCore.generateLifeStory(seed, { placement, startLoc });
    const targetBook = lifeStory.bookCoords;

    // Initialize game state
    const gs = {
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
        stats: Surv.defaultStats(),
        eventDeck: [],
        lastEvent: null,
        npcs: [],
        nonsensePagesRead: 0,
        // Tracking
        totalMoves: 0,
        segmentsVisited: new Set(),
        booksRead: new Set(),
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
    gs.segmentsVisited.add(Lib.locationKey({ side: gs.side, position: gs.position, floor: gs.floor }));

    /** Expose a read-only snapshot for strategies. */
    function gameState() {
        return {
            seed: gs.seed,
            side: gs.side,
            position: gs.position,
            floor: gs.floor,
            tick: gs.tick,
            day: gs.day,
            lightsOn: gs.lightsOn,
            heldBook: gs.heldBook,
            dead: gs.dead,
            despairing: gs.despairing,
            deaths: gs.deaths,
            won: gs.won,
            stats: { ...gs.stats },
            targetBook: gs.targetBook,
            totalMoves: gs.totalMoves,
            segmentsVisited: gs.segmentsVisited.size,
            booksRead: gs.booksRead.size,
            submissionsAttempted: gs.submissionsAttempted,
            npcs: gs.npcs.map(n => ({ ...n })),
            lastEvent: gs.lastEvent,
            availableMoves: Lib.availableMoves({ side: gs.side, position: gs.position, floor: gs.floor }),
            isRestArea: Lib.isRestArea(gs.position),
            timeString: Tick.tickToTimeString(gs.tick),
        };
    }

    /** Apply a single action. Returns true if action consumed a tick. */
    function applyAction(action) {
        if (gs.dead || gs.won) return false;

        switch (action.type) {
            case "move": {
                const loc = { side: gs.side, position: gs.position, floor: gs.floor };
                const available = Lib.availableMoves(loc);
                if (available.indexOf(action.dir) === -1) return false;
                const dest = Lib.applyMove(loc, action.dir);
                gs.side = dest.side;
                gs.position = dest.position;
                gs.floor = dest.floor;
                gs.totalMoves++;
                gs.segmentsVisited.add(Lib.locationKey(dest));

                // Movement tick
                advanceOneTick();

                // Event draw
                if (eventCards.length > 0) {
                    const evRng = seedFromString(seed + ":ev:" + gs.totalMoves);
                    const draw = EventsCore.drawEvent(gs.eventDeck, eventCards, evRng);
                    gs.eventDeck = draw.deck;
                    gs.lastEvent = draw.event;
                    if (draw.event && draw.event.morale) {
                        gs.stats = { ...gs.stats, morale: Math.max(0, Math.min(100, gs.stats.morale + draw.event.morale)) };
                    }
                    if (opts.onEvent && draw.event) opts.onEvent(draw.event, gameState());
                }
                return true;
            }

            case "wait":
                advanceOneTick();
                return true;

            case "sleep": {
                // Sleep advances time by rest-of-night or a few hours
                const sleepTicks = gs.lightsOn ? Tick.TICKS_PER_HOUR * 2 : Tick.ticksUntilDawn(gs.tick);
                for (let i = 0; i < sleepTicks; i++) {
                    if (i % Tick.TICKS_PER_HOUR === 0) {
                        applySleepHour();
                    }
                    advanceTime(1);
                }
                return true;
            }

            case "eat":
                if (!Lib.isRestArea(gs.position)) return false;
                if (!gs.lightsOn) return false;
                gs.stats = Surv.applyEat(gs.stats);
                advanceOneTick();
                return true;

            case "drink":
                if (!Lib.isRestArea(gs.position)) return false;
                if (!gs.lightsOn) return false;
                gs.stats = Surv.applyDrink(gs.stats);
                advanceOneTick();
                return true;

            case "alcohol":
                if (!Lib.isRestArea(gs.position)) return false;
                if (!gs.lightsOn) return false;
                gs.stats = Surv.applyAlcohol(gs.stats);
                if (gs.stats.despairing && shouldClearDespairing(gs.stats.morale)) {
                    gs.stats = { ...gs.stats, despairing: false };
                }
                gs.despairing = gs.stats.despairing;
                advanceOneTick();
                return true;

            case "read": {
                if (!gs.lightsOn) return false;
                if (Lib.isRestArea(gs.position)) return false;
                const bi = action.bookIndex;
                if (bi < 0 || bi >= Lib.BOOKS_PER_GALLERY) return false;

                // Despairing read block
                const readRng = seedFromString(seed + ":read:" + gs.totalMoves + ":" + bi);
                if (isReadingBlocked(gs.despairing, readRng.next())) return false;

                const bookKey = `${gs.side}:${gs.position}:${gs.floor}:${bi}`;
                gs.booksRead.add(bookKey);

                // Score page for morale effect
                const pageResult = BookCore.generateBookPage(gs.side, gs.position, gs.floor, bi, 0, seed, stories, dictionary);
                const totalWords = BookCore.tokenize(stories[pageResult.storyId].text).length;
                const dwellResult = BookCore.dwellMoraleDelta(pageResult.editDistance, totalWords, gs.nonsensePagesRead);
                gs.stats = { ...gs.stats, morale: Math.max(0, Math.min(100, gs.stats.morale + dwellResult.delta)) };
                if (dwellResult.isNonsense) gs.nonsensePagesRead++;
                if (gs.stats.morale <= 0) gs.stats = { ...gs.stats, despairing: true };
                gs.despairing = gs.stats.despairing;

                advanceOneTick();
                return true;
            }

            case "take": {
                if (!gs.lightsOn) return false;
                const bi2 = action.bookIndex;
                if (bi2 < 0 || bi2 >= Lib.BOOKS_PER_GALLERY) return false;
                gs.heldBook = { side: gs.side, position: gs.position, floor: gs.floor, bookIndex: bi2 };
                return true; // no tick cost
            }

            case "submit": {
                if (!Lib.isRestArea(gs.position)) return false;
                if (!gs.heldBook) return false;
                gs.submissionsAttempted++;
                const hb = gs.heldBook;
                const tb = gs.targetBook;
                if (hb.side === tb.side && hb.position === tb.position &&
                    hb.floor === tb.floor && hb.bookIndex === tb.bookIndex) {
                    gs.won = true;
                }
                if (!gs.won) gs.heldBook = null; // wrong book consumed
                advanceOneTick();
                return true;
            }

            default:
                return false;
        }
    }

    function advanceOneTick() {
        // Apply survival depletion
        gs.stats = Surv.applyMoveTick(gs.stats);

        // Ambient morale drain
        gs.stats = { ...gs.stats, morale: applyAmbientDrain(gs.stats.morale) };
        if (gs.stats.morale <= 0) gs.stats = { ...gs.stats, despairing: true };
        gs.despairing = gs.stats.despairing;

        // Death check
        if (gs.stats.dead) {
            gs.dead = true;
            gs.deathCause = gs.stats.mortality <= 0 ? "mortality" : "unknown";
            if (gs.stats.thirst >= 100 && gs.stats.hunger >= 100) gs.deathCause = "starvation_dehydration";
            else if (gs.stats.thirst >= 100) gs.deathCause = "dehydration";
            else if (gs.stats.hunger >= 100) gs.deathCause = "starvation";
        }

        advanceTime(1);
    }

    function advanceTime(n) {
        const result = Tick.advanceTick({ tick: gs.tick, day: gs.day }, n);
        gs.tick = result.state.tick;
        gs.day = result.state.day;
        gs.lightsOn = Tick.isLightsOn(gs.tick);

        for (const ev of result.events) {
            if (ev === "dawn") {
                onDawn();
            }
        }
    }

    function onDawn() {
        // Resurrection
        if (gs.dead) {
            gs.stats = Surv.applyResurrection(gs.stats);
            gs.dead = false;
            gs.deathCause = null;
            gs.deaths++;
            gs.despairing = gs.stats.despairing;
            if (opts.onDeath) opts.onDeath(gameState());
        }

        // NPC daily cycle
        const npcMoveRng = seedFromString(seed + ":npc-move:" + gs.day);
        gs.npcs = NpcCore.moveNPCs(gs.npcs, npcMoveRng);
        const npcDetRng = seedFromString(seed + ":npc-det:" + gs.day);
        gs.npcs = gs.npcs.map(n => NpcCore.deteriorate(n, gs.day, npcDetRng));

        // Nonsense fatigue halves at dawn
        gs.nonsensePagesRead = Math.floor(gs.nonsensePagesRead / 2);

        // Nightly book return: held book stays (possession rule)
        // but other books reset (we don't track that at sim level)

        if (opts.onDay) opts.onDay(gameState());
    }

    function applySleepHour() {
        const baseDelta = 5;
        const effectiveDelta = modifySleepRecovery(baseDelta, gs.despairing);
        gs.stats = Surv.applySleep(gs.stats);
        if (gs.despairing) {
            const excess = baseDelta - effectiveDelta;
            gs.stats = { ...gs.stats, morale: Math.max(0, gs.stats.morale - excess) };
        }
        if (gs.despairing && shouldClearDespairing(gs.stats.morale)) {
            gs.stats = { ...gs.stats, despairing: false };
        }
        gs.despairing = gs.stats.despairing;
        gs.dead = gs.stats.dead;
    }

    /** Run the simulation to completion. */
    function run() {
        const dayLog = [];
        let tickCount = 0;
        const MAX_TICKS = maxDays * Tick.TICKS_PER_DAY;

        while (!gs.won && gs.day <= maxDays && gs.deaths < maxDeaths && tickCount < MAX_TICKS) {
            tickCount++;

            // If dead, just advance time until dawn
            if (gs.dead) {
                advanceTime(1);
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
            segmentsVisited: gs.segmentsVisited.size,
            booksRead: gs.booksRead.size,
            submissionsAttempted: gs.submissionsAttempted,
            finalStats: { ...gs.stats },
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
    systematic(opts) {
        const cfg = Object.assign({ eatAt: 60, drinkAt: 60, sleepAt: 75, pattern: "expanding" }, opts);
        let searchDir = "right";
        let currentBookIndex = 0;
        let needsSubmit = false;

        return {
            name: "systematic",
            decide(gs) {
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
                    // Head toward nearest rest area (position % 10 === 0)
                    const distRight = (10 - (gs.position % 10)) % 10 || 10;
                    const distLeft = gs.position % 10 || 10;
                    return { type: "move", dir: distLeft <= distRight ? "left" : "right" };
                }

                // At a gallery (not rest area): read books systematically
                if (!gs.isRestArea && gs.lightsOn) {
                    if (currentBookIndex < 192) {
                        // Check if this is the target book
                        const tb = gs.targetBook;
                        if (gs.side === tb.side && gs.position === tb.position &&
                            gs.floor === tb.floor && currentBookIndex === tb.bookIndex) {
                            currentBookIndex++;
                            needsSubmit = true;
                            return { type: "take", bookIndex: tb.bookIndex };
                        }
                        const bi = currentBookIndex;
                        currentBookIndex++;
                        return { type: "read", bookIndex: bi };
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
    randomWalk(opts) {
        const cfg = Object.assign({ eatAt: 70, drinkAt: 70, sleepAt: 80, readChance: 0.1 }, opts);
        let walkRng = null;

        return {
            name: "randomWalk",
            decide(gs) {
                if (!walkRng) walkRng = seedFromString(gs.seed + ":walk-strategy");

                if (!gs.lightsOn || gs.stats.exhaustion >= cfg.sleepAt) return { type: "sleep" };

                if (gs.isRestArea) {
                    if (gs.stats.hunger >= cfg.eatAt) return { type: "eat" };
                    if (gs.stats.thirst >= cfg.drinkAt) return { type: "drink" };
                }

                // Occasionally read
                if (!gs.isRestArea && gs.lightsOn && walkRng.next() < cfg.readChance) {
                    return { type: "read", bookIndex: walkRng.nextInt(192) };
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
    survivalOnly(opts) {
        const cfg = Object.assign({ eatAt: 50, drinkAt: 50, sleepAt: 60 }, opts);

        return {
            name: "survivalOnly",
            decide(gs) {
                if (!gs.lightsOn || gs.stats.exhaustion >= cfg.sleepAt) return { type: "sleep" };

                if (gs.isRestArea) {
                    if (gs.stats.hunger >= cfg.eatAt) return { type: "eat" };
                    if (gs.stats.thirst >= cfg.drinkAt) return { type: "drink" };
                    return { type: "wait" };
                }

                // Walk to nearest rest area
                const distRight = (10 - (gs.position % 10)) % 10 || 10;
                const distLeft = gs.position % 10 || 10;
                return { type: "move", dir: distLeft <= distRight ? "left" : "right" };
            }
        };
    },

    /**
     * Neglectful: never eats or drinks. Tests death timeline.
     */
    neglectful() {
        return {
            name: "neglectful",
            decide(gs) {
                if (!gs.lightsOn || gs.stats.exhaustion >= 80) return { type: "sleep" };
                return { type: "wait" };
            }
        };
    },

    /**
     * Targeted: knows exact target book location, walks directly to it.
     * Tests the win path end-to-end.
     */
    targeted() {
        let phase = "navigate"; // "navigate" | "take" | "toSubmit" | "submit" | "done"

        /** Navigate to a rest area from current position. */
        function moveToRestArea(pos) {
            // Rest areas are at positions divisible by 10.
            // Handle negative positions: need modular arithmetic.
            const mod = ((pos % 10) + 10) % 10;
            if (mod === 0) return null; // already at rest area
            const distRight = 10 - mod;
            const distLeft = mod;
            return { type: "move", dir: distLeft <= distRight ? "left" : "right" };
        }

        return {
            name: "targeted",
            decide(gs) {
                const tb = gs.targetBook;

                // Survival basics
                if (!gs.lightsOn || gs.stats.exhaustion >= 80) return { type: "sleep" };
                if (gs.isRestArea && gs.stats.hunger >= 60) return { type: "eat" };
                if (gs.isRestArea && gs.stats.thirst >= 60) return { type: "drink" };

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
                    return { type: "take", bookIndex: tb.bookIndex };
                }

                // --- Navigation phase ---

                // 1. Handle side crossing (only at floor 0 rest areas)
                if (gs.side !== tb.side) {
                    if (gs.floor > 0) {
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
                return { type: "take", bookIndex: tb.bookIndex };
            }
        };
    },

    /**
     * Custom strategy from a decide function.
     *
     * @param {string} name
     * @param {function} decideFn - (gameState) => Action
     */
    custom(name, decideFn) {
        return { name, decide: decideFn };
    },
};

/* ==== Scenario runners ==== */

/**
 * Run a scenario N times with different seeds, collect aggregate stats.
 *
 * @param {object} opts
 * @param {number} opts.runs - number of runs
 * @param {function} opts.strategyFactory - () => strategy object (fresh per run)
 * @param {number} [opts.maxDays=100]
 * @param {string} [opts.placement="gaussian"]
 * @param {string} [opts.seedPrefix="scenario"]
 * @param {object} [opts.simOpts] - additional createSimulation options
 * @returns {{ results: SimResult[], summary: object }}
 */
export function runScenario(opts) {
    const results = [];
    for (let i = 0; i < opts.runs; i++) {
        const runSeed = (opts.seedPrefix || "scenario") + ":" + i;
        const sim = createSimulation({
            seed: runSeed,
            maxDays: opts.maxDays || 100,
            strategy: opts.strategyFactory(),
            placement: opts.placement || "gaussian",
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

function sorted(arr) {
    return [...arr].sort((a, b) => a - b);
}
