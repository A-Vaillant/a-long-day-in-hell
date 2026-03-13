#!/usr/bin/env node
/**
 * Generate a complete playthrough action log for video recording.
 *
 * Runs the headless simulator from real spawn distance to win, recording
 * keyframes at variable density:
 *   - Navigation phase: one keyframe per day (position, stats, events)
 *   - Search phase: one keyframe per book read
 *   - Endgame: one keyframe per action
 *
 * Output: JSON log to stdout (pipe to file).
 *
 * Usage:
 *   node scripts/generate-playthrough.ts [--seed S] [--out FILE]
 *
 * The log is the ground truth for replay-video.ts.
 */

import { createSimulation, strategies, type GameState, type Action, type Strategy } from "../lib/simulator.core.ts";
import { generatePlayerWorld } from "../lib/lifestory.core.ts";
import { BOOKS_PER_GALLERY, GALLERIES_PER_SEGMENT, isRestArea } from "../lib/library.core.ts";
import * as fs from "node:fs";

// --- CLI ---

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const SEED = arg("seed", "666");
const OUT_FILE = arg("out", "");

// --- Keyframe types ---

interface Keyframe {
    type: "day" | "phase" | "action" | "book" | "death" | "event" | "win";
    day: number;
    tick: number;
    position: string;   // bigint as string
    floor: string;
    side: number;
    stats?: {
        hunger: number;
        thirst: number;
        exhaustion: number;
        morale: number;
        mortality: number;
    };
    phase?: string;
    action?: string;
    actionDetail?: unknown;
    deaths?: number;
    totalMoves?: number;
    booksRead?: number;
    eventText?: string;
    bookIndex?: number;
    isTarget?: boolean;
    won?: boolean;
    heldBook?: unknown;
    despairing?: boolean;
}

// --- Playthrough strategy ---
// Combines targeted navigation → systematic search → submit.

function playthroughStrategy(): { strategy: Strategy; getPhase: () => string } {
    let phase: "descend" | "navigate" | "walkToEnd" | "sweep" | "take" | "toSubmit" | "submit" | "done" = "descend";

    // Search state
    let currentBookIndex = 0;
    // First gallery in the target segment (segStart is a rest area, +1 is first gallery)
    let searchFrom: bigint = 0n;
    let searchTo: bigint = 0n;

    const G = BigInt(GALLERIES_PER_SEGMENT);

    const strategy: Strategy = {
        name: "playthrough",
        decide(gs: GameState): Action {
            const tb = gs.targetBook;

            // Survival basics (always)
            if (!gs.lightsOn || gs.stats.exhaustion >= 80) return { type: "sleep" };
            if (gs.isRestArea && gs.stats.hunger >= 60) return { type: "eat" };
            if (gs.isRestArea && gs.stats.thirst >= 60) return { type: "drink" };

            if (phase === "done") return { type: "wait" };

            // --- Submit phase ---
            if (phase === "submit") {
                if (gs.isRestArea) {
                    phase = "done";
                    return { type: "submit" };
                }
                return moveToRestArea(gs.position);
            }

            if (phase === "toSubmit") {
                const toRest = moveToRestArea(gs.position);
                if (isRestArea(gs.position)) { phase = "submit"; return { type: "submit" }; }
                return toRest;
            }

            if (phase === "take") {
                phase = "toSubmit";
                return { type: "take", bookIndex: tb.bookIndex };
            }

            // --- Walk to far end of segment ---
            if (phase === "walkToEnd") {
                if (gs.position < searchTo) {
                    return { type: "move", dir: "right" };
                }
                // Arrived at far end — start sweeping left
                phase = "sweep";
                currentBookIndex = 0;
            }

            // --- Sweep left through segment, reading every book ---
            if (phase === "sweep") {
                // Skip rest areas (no books)
                if (gs.isRestArea) {
                    if (gs.position <= searchFrom) {
                        // Passed the first gallery — segment fully searched (shouldn't happen)
                        return { type: "wait" };
                    }
                    return { type: "move", dir: "left" };
                }

                // At a gallery: read books one by one
                if (gs.lightsOn && currentBookIndex < BOOKS_PER_GALLERY) {
                    // Check if this is the target
                    if (gs.side === tb.side && gs.position === tb.position &&
                        gs.floor === tb.floor && currentBookIndex === tb.bookIndex) {
                        phase = "take";
                        return { type: "take", bookIndex: tb.bookIndex };
                    }
                    const bi = currentBookIndex;
                    currentBookIndex++;
                    return { type: "read", bookIndex: bi };
                }

                // Done with this gallery — move left to next
                currentBookIndex = 0;
                if (gs.position > searchFrom) {
                    return { type: "move", dir: "left" };
                }

                // Fully searched — shouldn't reach here if target is in segment
                return { type: "wait" };
            }

            // --- Descend phase: get to the right floor ---
            if (phase === "descend") {
                if (gs.floor !== tb.floor) {
                    if (!gs.isRestArea) return moveToRestArea(gs.position);
                    return { type: "move", dir: gs.floor < tb.floor ? "up" : "down" };
                }
                phase = "navigate";
            }

            // --- Navigate phase: walk to target segment ---
            if (phase === "navigate") {
                // Same side? (should be, spawn is same side)
                if (gs.side !== tb.side) {
                    if (gs.floor > 0n) {
                        if (!gs.isRestArea) return moveToRestArea(gs.position);
                        return { type: "move", dir: "down" };
                    }
                    if (!gs.isRestArea) return moveToRestArea(gs.position);
                    return { type: "move", dir: "cross" };
                }

                // Check if we're in the target segment
                const tbSegStart = (tb.position / G) * G;
                const tbSegEnd = tbSegStart + G - 1n;
                if (gs.position >= tbSegStart && gs.position <= tbSegEnd) {
                    // We're in the target segment! Walk to far end, then sweep
                    // left so the target (usually at offset 1) is found last.
                    searchFrom = tbSegStart + 1n;    // first gallery
                    searchTo = tbSegEnd;              // last gallery
                    currentBookIndex = 0;
                    if (gs.position < searchTo) {
                        phase = "walkToEnd";
                        return { type: "move", dir: "right" };
                    }
                    // Already at far end
                    phase = "sweep";
                    return { type: "read", bookIndex: 0 };
                }

                // Walk toward target
                return { type: "move", dir: gs.position < tb.position ? "right" : "left" };
            }

            return { type: "wait" };
        },
    };

    function moveToRestArea(pos: bigint): Action {
        const mod = ((pos % G) + G) % G;
        if (mod === 0n) return { type: "wait" }; // already at rest area
        const distRight = G - mod;
        const distLeft = mod;
        return { type: "move", dir: distLeft <= distRight ? "left" : "right" };
    }

    return { strategy, getPhase: () => phase };
}

// --- Main ---

function main() {
    const { randomOrigin, story: ls } = generatePlayerWorld(SEED);
    const tb = ls.bookCoords;
    const ps = ls.playerStart;
    const dPos = ps.position > tb.position ? ps.position - tb.position : tb.position - ps.position;

    console.error(`Seed: ${SEED}`);
    console.error(`Target: side=${tb.side} pos=${tb.position} floor=${tb.floor} book=${tb.bookIndex}`);
    console.error(`Start:  side=${ps.side} pos=${ps.position} floor=${ps.floor}`);
    console.error(`Distance: ${dPos} galleries (~${Math.round(Number(dPos) / 960).toLocaleString()} days)`);

    const keyframes: Keyframe[] = [];
    const { strategy, getPhase } = playthroughStrategy();

    function snap(gs: GameState): Omit<Keyframe, "type"> {
        return {
            day: gs.day,
            tick: gs.tick,
            position: gs.position.toString(),
            floor: gs.floor.toString(),
            side: gs.side,
            stats: {
                hunger: Math.round(gs.stats.hunger * 10) / 10,
                thirst: Math.round(gs.stats.thirst * 10) / 10,
                exhaustion: Math.round(gs.stats.exhaustion * 10) / 10,
                morale: Math.round(gs.stats.morale * 10) / 10,
                mortality: Math.round(gs.stats.mortality * 10) / 10,
            },
            deaths: gs.deaths,
            totalMoves: gs.totalMoves,
            booksRead: gs.booksRead,
            despairing: gs.despairing,
        };
    }

    let lastPhase = "";
    let lastDay = 0;
    let lastBooksRead = 0;
    const t0 = Date.now();
    let lastLog = t0;

    // Phase change marker
    keyframes.push({ type: "phase", phase: "descend", ...snap({ ...nullGs(), position: ps.position, floor: ps.floor, side: ps.side, day: 1, tick: 0 } as any) });

    const sim = createSimulation({
        seed: SEED,
        maxDays: 3_000_000,
        maxDeaths: 999_999,
        strategy,
        onDay: (gs: GameState) => {
            const phase = getPhase();

            // Phase transitions
            if (phase !== lastPhase) {
                keyframes.push({ type: "phase", phase, ...snap(gs) });
                lastPhase = phase;
                console.error(`  Phase: ${phase} (day ${gs.day.toLocaleString()})`);
            }

            // During navigation: log every Nth day (sparse)
            // Logarithmic spacing: more frequent early, less frequent later
            if (phase === "navigate" || phase === "descend") {
                const daysSinceLog = gs.day - lastDay;
                // Log at days 1-10 (every day), 10-100 (every 10), 100-1000 (every 100), etc.
                const baseInterval = Math.max(1, Math.pow(10, Math.floor(Math.log10(Math.max(1, gs.day))) - 1));
                // Jitter: 70-130% of base interval so day numbers aren't all round
                const jitterHash = ((gs.day * 2654435761) >>> 0) / 0x100000000;
                const logInterval = Math.max(1, Math.round(baseInterval * (0.7 + 0.6 * jitterHash)));
                if (daysSinceLog >= logInterval || gs.day <= 10) {
                    keyframes.push({ type: "day", ...snap(gs) });
                    lastDay = gs.day;
                }
            }

            // During sweep/search: log every day
            if (phase === "walkToEnd" || phase === "sweep" || phase === "take" || phase === "toSubmit" || phase === "submit") {
                keyframes.push({ type: "day", ...snap(gs) });
                lastDay = gs.day;
            }

            // Progress logging to stderr
            const now = Date.now();
            if (now - lastLog > 15000) {
                const elapsed = (now - t0) / 1000;
                const rate = gs.totalMoves / elapsed;
                const remaining = Number(dPos) - gs.totalMoves;
                const eta = remaining > 0 ? Math.round(remaining / rate) : 0;
                console.error(`  Day ${gs.day.toLocaleString()} | moves: ${gs.totalMoves.toLocaleString()} | deaths: ${gs.deaths} | ${Math.round(elapsed)}s elapsed | ETA: ${eta}s`);
                lastLog = now;
            }
        },
        onTick: (gs: GameState) => {
            const phase = getPhase();
            // During sweep: log each book read
            if (phase === "sweep" && gs.booksRead > lastBooksRead) {
                keyframes.push({
                    type: "book",
                    ...snap(gs),
                    bookIndex: Number(gs.booksRead - 1) % BOOKS_PER_GALLERY,
                    isTarget: false,
                });
                lastBooksRead = gs.booksRead;
            }
        },
        onDeath: (gs: GameState) => {
            keyframes.push({ type: "death", ...snap(gs) });
        },
        onEvent: (event, gs: GameState) => {
            // Only log events during sweep (too many during navigation)
            if (getPhase() === "sweep") {
                keyframes.push({ type: "event", eventText: event.text, ...snap(gs) });
            }
        },
    });

    const result = sim.run();
    const elapsed = (Date.now() - t0) / 1000;

    // Final keyframe
    const finalGs = sim.state();
    if (result.won) {
        keyframes.push({ type: "win", won: true, ...snap(finalGs) });
    }

    console.error(`\nDone in ${Math.round(elapsed)}s (${(elapsed / 60).toFixed(1)} min)`);
    console.error(`Won: ${result.won} | Days: ${result.day.toLocaleString()} | Moves: ${result.totalMoves.toLocaleString()} | Deaths: ${result.deaths}`);
    console.error(`Keyframes: ${keyframes.length}`);

    // Build output
    const output = {
        seed: SEED,
        targetBook: {
            side: tb.side,
            position: tb.position.toString(),
            floor: tb.floor.toString(),
            bookIndex: tb.bookIndex,
        },
        playerStart: {
            side: ps.side,
            position: ps.position.toString(),
            floor: ps.floor.toString(),
        },
        lifeStory: {
            name: ls.name,
            occupation: ls.occupation,
            hometown: ls.hometown,
            causeOfDeath: ls.causeOfDeath,
            storyText: ls.storyText,
        },
        result: {
            won: result.won,
            days: result.day,
            deaths: result.deaths,
            totalMoves: result.totalMoves,
            booksRead: result.booksRead,
        },
        keyframes,
    };

    const json = JSON.stringify(output, null, 2);
    if (OUT_FILE) {
        fs.writeFileSync(OUT_FILE, json);
        console.error(`Written to ${OUT_FILE}`);
    } else {
        process.stdout.write(json);
    }
}

// Minimal stub for snap() before sim starts
function nullGs(): Partial<GameState> {
    return {
        day: 0, tick: 0, side: 0, position: 0n, floor: 0n,
        deaths: 0, totalMoves: 0, booksRead: 0,
        stats: { hunger: 0, thirst: 0, exhaustion: 0, morale: 100, mortality: 100, dead: false, despairing: false },
    } as any;
}

main();
