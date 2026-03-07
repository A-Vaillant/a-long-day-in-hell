/** Performance benchmarks for simulation tick rate.
 *
 * Measures:
 *   1. Headless simulator (no ECS) — baseline tick throughput
 *   2. Full ECS social pipeline — what godmode actually runs
 *   3. Individual ECS system costs — identify bottlenecks
 *
 * Run: node --test test/perf.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSimulation, strategies } from "../lib/simulator.core.ts";
import { seedFromString } from "../lib/prng.core.ts";
import { createWorld, spawn, addComponent, getComponent, entitiesWith } from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, AI, GROUP,
    psychologyDecaySystem, relationshipSystem,
    groupFormationSystem, socialPressureSystem, buildLocationIndex,
} from "../lib/social.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { PERSONALITY, generatePersonality } from "../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../lib/belief.core.ts";
import { NEEDS, needsSystem } from "../lib/needs.core.ts";
import { MOVEMENT, movementSystem } from "../lib/movement.core.ts";
import { SEARCHING, searchSystem, scoreBigram, scoreFromSeed } from "../lib/search.core.ts";
import { INTENT, intentSystem } from "../lib/intent.core.ts";
import { SLEEP, nearestRestArea } from "../lib/sleep.core.ts";
import { generateBookPage } from "../lib/book.core.ts";
import * as NpcCore from "../lib/npc.core.ts";

const SEED = "perf-bench-42";

/** Create a full ECS world with N NPCs for benchmarking. */
function createBenchWorld(npcCount) {
    const world = createWorld();
    const rng = seedFromString(SEED + ":spawn");
    const startLoc = { side: 0, position: 0, floor: 100 };
    const names = [];
    for (let i = 0; i < npcCount; i++) names.push("NPC_" + i);
    const npcs = NpcCore.spawnNPCs(startLoc, npcCount, names, rng);

    // Player entity
    const player = spawn(world);
    addComponent(world, player, POSITION, { side: 0, position: 0, floor: 100 });
    addComponent(world, player, IDENTITY, { name: "Player", alive: true });
    addComponent(world, player, PSYCHOLOGY, { lucidity: 100, hope: 100 });
    addComponent(world, player, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, player, HABITUATION, { exposures: new Map() });

    const playerPersRng = seedFromString(SEED + ":player:pers");
    addComponent(world, player, PERSONALITY, generatePersonality(playerPersRng));
    const playerBeliefRng = seedFromString(SEED + ":player:belief");
    addComponent(world, player, BELIEF, generateBelief(playerBeliefRng));

    // NPC entities
    const entities = [];
    for (const npc of npcs) {
        const ent = spawn(world);
        entities.push({ ent, npc });

        addComponent(world, ent, POSITION, {
            side: npc.side, position: npc.position, floor: npc.floor,
        });
        addComponent(world, ent, IDENTITY, { name: npc.name, alive: true });
        addComponent(world, ent, PSYCHOLOGY, { lucidity: 80, hope: 70 });
        addComponent(world, ent, RELATIONSHIPS, { bonds: new Map() });
        addComponent(world, ent, HABITUATION, { exposures: new Map() });
        addComponent(world, ent, NEEDS, { hunger: 0, thirst: 0, exhaustion: 0 });
        addComponent(world, ent, MOVEMENT, { targetPosition: null, moveAccum: 0 });
        addComponent(world, ent, SEARCHING, { bookIndex: 0, ticksSearched: 0, patience: 10, active: false, bestScore: 0 });
        addComponent(world, ent, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, ent, SLEEP, {
            homeRestArea: nearestRestArea(npc.position),
            bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false,
        });
        addComponent(world, ent, AI, {});

        const npcPersRng = seedFromString(SEED + ":npc:pers:" + npc.id);
        addComponent(world, ent, PERSONALITY, generatePersonality(npcPersRng));
        const npcBeliefRng = seedFromString(SEED + ":npc:belief:" + npc.id);
        addComponent(world, ent, BELIEF, generateBelief(npcBeliefRng));
    }

    return { world, npcs, entities };
}

/** Run a full ECS tick (mirrors Social.onTick). */
function ecsTick(world, tick, day) {
    const currentTick = (day - 1) * 240 + tick;
    const prebuilt = buildLocationIndex(world);

    relationshipSystem(world, currentTick, undefined, prebuilt, 1);
    psychologyDecaySystem(world, undefined, 1);
    groupFormationSystem(world, undefined, prebuilt);
    socialPressureSystem(world, undefined, undefined, undefined, 1);
    needsSystem(world, true, undefined, 1);

    const intentRng = seedFromString(SEED + ":intent:" + currentTick);
    intentSystem(world, intentRng, undefined, tick);

    const moveRng = seedFromString(SEED + ":move:" + currentTick);
    movementSystem(world, moveRng, undefined, 1);

    const searchRng = seedFromString(SEED + ":search:" + currentTick);
    const pageSampler = (side, position, floor, bookIndex, pageIndex) =>
        generateBookPage(side, position, floor, bookIndex, pageIndex, SEED, 400);
    const fastScorer = (side, position, floor, bookIndex, pageIndex) =>
        scoreFromSeed(SEED, side, position, floor, bookIndex, pageIndex);
    searchSystem(world, searchRng, pageSampler, undefined, fastScorer);
}

function bench(fn, warmup = 50, iterations = 500) {
    // Warmup
    for (let i = 0; i < warmup; i++) fn(i);

    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn(warmup + i);
    const elapsed = performance.now() - start;

    return {
        totalMs: elapsed,
        avgMs: elapsed / iterations,
        ticksPerSec: Math.round(iterations / (elapsed / 1000)),
    };
}

describe("perf: headless simulator (no ECS)", () => {
    it("random walk — 100 days", () => {
        const start = performance.now();
        const sim = createSimulation({
            seed: SEED,
            maxDays: 100,
            strategy: strategies.randomWalk(),
        });
        const result = sim.run();
        const elapsed = performance.now() - start;
        const totalTicks = result.day * 240;

        console.log(`  Headless sim: ${totalTicks} ticks in ${elapsed.toFixed(0)}ms`);
        console.log(`  → ${Math.round(totalTicks / (elapsed / 1000))} ticks/sec`);
        console.log(`  → ${result.day} days, ${result.deaths} deaths, ${result.totalMoves} moves`);

        assert.ok(elapsed < 10000, "100-day sim should complete in <10s");
    });

    it("survival only — 365 days", () => {
        const start = performance.now();
        const sim = createSimulation({
            seed: SEED,
            maxDays: 365,
            strategy: strategies.survivalOnly(),
        });
        const result = sim.run();
        const elapsed = performance.now() - start;
        const totalTicks = result.day * 240;

        console.log(`  Headless sim (365d): ${totalTicks} ticks in ${elapsed.toFixed(0)}ms`);
        console.log(`  → ${Math.round(totalTicks / (elapsed / 1000))} ticks/sec`);

        assert.ok(elapsed < 30000, "365-day sim should complete in <30s");
    });
});

describe("perf: full ECS tick pipeline", () => {
    it("16 NPCs — single tick throughput", () => {
        const { world } = createBenchWorld(16);
        const result = bench((i) => ecsTick(world, i % 240, Math.floor(i / 240) + 1));

        console.log(`  ECS tick (16 NPCs): ${result.avgMs.toFixed(3)}ms/tick`);
        console.log(`  → ${result.ticksPerSec} ticks/sec`);

        assert.ok(result.avgMs < 50, "single tick should be <50ms with 16 NPCs");
    });

    it("32 NPCs — single tick throughput", () => {
        const { world } = createBenchWorld(32);
        const result = bench((i) => ecsTick(world, i % 240, Math.floor(i / 240) + 1));

        console.log(`  ECS tick (32 NPCs): ${result.avgMs.toFixed(3)}ms/tick`);
        console.log(`  → ${result.ticksPerSec} ticks/sec`);

        assert.ok(result.avgMs < 100, "single tick should be <100ms with 32 NPCs");
    });

    it("64 NPCs — single tick throughput", () => {
        const { world } = createBenchWorld(64);
        const result = bench((i) => ecsTick(world, i % 240, Math.floor(i / 240) + 1));

        console.log(`  ECS tick (64 NPCs): ${result.avgMs.toFixed(3)}ms/tick`);
        console.log(`  → ${result.ticksPerSec} ticks/sec`);
    });

    it("16 NPCs — sustained 1-day simulation", () => {
        const { world } = createBenchWorld(16);
        const TICKS_PER_DAY = 240;

        const start = performance.now();
        for (let t = 0; t < TICKS_PER_DAY; t++) {
            ecsTick(world, t, 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  1 day (240 ticks, 16 NPCs): ${elapsed.toFixed(0)}ms`);
        console.log(`  → ${Math.round(TICKS_PER_DAY / (elapsed / 1000))} ticks/sec`);
        console.log(`  → ${(elapsed / 1000).toFixed(2)}s per in-game day`);

        assert.ok(elapsed < 30000, "1-day ECS sim should complete in <30s");
    });
});

describe("perf: individual ECS systems (16 NPCs)", () => {
    it("breakdown by system", () => {
        const { world } = createBenchWorld(16);
        const N = 200;

        // Warmup
        for (let i = 0; i < 20; i++) ecsTick(world, i % 240, 1);

        const systems = {
            buildLocationIndex: () => buildLocationIndex(world),
            relationshipSystem: () => {
                const idx = buildLocationIndex(world);
                relationshipSystem(world, 100, undefined, idx, 1);
            },
            psychologyDecaySystem: () => psychologyDecaySystem(world, undefined, 1),
            groupFormationSystem: () => {
                const idx = buildLocationIndex(world);
                groupFormationSystem(world, undefined, idx);
            },
            socialPressureSystem: () => socialPressureSystem(world, undefined, undefined, undefined, 1),
            needsSystem: () => needsSystem(world, true, undefined, 1),
            intentSystem: () => {
                const rng = seedFromString(SEED + ":intent:bench");
                intentSystem(world, rng, undefined, 100);
            },
            movementSystem: () => {
                const rng = seedFromString(SEED + ":move:bench");
                movementSystem(world, rng, undefined, 1);
            },
            searchSystem: () => {
                const rng = seedFromString(SEED + ":search:bench");
                const sampler = (s, p, f, b, pg) => generateBookPage(s, p, f, b, pg, SEED, 400);
                const scorer = (s, p, f, b, pg) => scoreFromSeed(SEED, s, p, f, b, pg);
                searchSystem(world, rng, sampler, undefined, scorer);
            },
        };

        for (const npcCount of [16, 128, 512]) {
            const { world: w } = createBenchWorld(npcCount);
            // warmup
            for (let i = 0; i < 10; i++) ecsTick(w, i % 240, 1);

            console.log(`  System breakdown (${N} iters, ${npcCount} NPCs):`);
            const localSystems = {
                buildLocationIndex: () => buildLocationIndex(w),
                relationshipSystem: () => {
                    const idx = buildLocationIndex(w);
                    relationshipSystem(w, 100, undefined, idx, 1);
                },
                psychologyDecaySystem: () => psychologyDecaySystem(w, undefined, 1),
                groupFormationSystem: () => {
                    const idx = buildLocationIndex(w);
                    groupFormationSystem(w, undefined, idx);
                },
                socialPressureSystem: () => socialPressureSystem(w, undefined, undefined, undefined, 1),
                needsSystem: () => needsSystem(w, true, undefined, 1),
                intentSystem: () => {
                    const rng = seedFromString(SEED + ":intent:bench");
                    intentSystem(w, rng, undefined, 100);
                },
                movementSystem: () => {
                    const rng = seedFromString(SEED + ":move:bench");
                    movementSystem(w, rng, undefined, 1);
                },
                searchSystem: () => {
                    const rng = seedFromString(SEED + ":search:bench");
                    const sampler = (s, p, f, b, pg) => generateBookPage(s, p, f, b, pg, SEED, 400);
                    const scorer = (s, p, f, b, pg) => scoreFromSeed(SEED, s, p, f, b, pg);
                    searchSystem(w, rng, sampler, undefined, scorer);
                },
            };
            const totals = {};
            for (const [name, fn] of Object.entries(localSystems)) {
                const start = performance.now();
                for (let i = 0; i < N; i++) fn();
                const elapsed = performance.now() - start;
                totals[name] = elapsed / N;
                console.log(`    ${name.padEnd(30)} ${(elapsed / N).toFixed(3)}ms`);
            }
            const total = Object.values(totals).reduce((a, b) => a + b, 0);
            console.log(`    ${"TOTAL".padEnd(30)} ${total.toFixed(3)}ms`);
        }

        assert.ok(true);
    });
});

describe("perf: scoreFromSeed correctness", () => {
    it("matches scoreBigram(generateBookPage(...)) exactly", () => {
        // Test across multiple coordinates
        const coords = [
            [0, 0, 100, 5, 0],
            [1, 42, 200, 191, 0],
            [0, -3, 0, 0, 0],
            [1, 100, 50000, 100, 0],
        ];
        for (const [side, pos, floor, book, page] of coords) {
            const text = generateBookPage(side, pos, floor, book, page, SEED, 400);
            const expected = scoreBigram(text);
            const fast = scoreFromSeed(SEED, side, pos, floor, book, page);
            assert.ok(
                Math.abs(expected - fast) < 1e-6,
                `Mismatch at ${side}:${pos}:${floor}:${book}: expected ${expected}, got ${fast}`,
            );
        }
    });
});

describe("perf: scoreFromSeed vs generateBookPage+scoreBigram", () => {
    it("fast path is significantly faster", () => {
        const N = 1000;

        // Slow path: generate 400-char page + score
        const start1 = performance.now();
        for (let i = 0; i < N; i++) {
            const text = generateBookPage(0, i, 100, i % 192, 0, SEED, 400);
            scoreBigram(text);
        }
        const slow = performance.now() - start1;

        // Fast path: scoreFromSeed
        const start2 = performance.now();
        for (let i = 0; i < N; i++) {
            scoreFromSeed(SEED, 0, i, 100, i % 192, 0);
        }
        const fast = performance.now() - start2;

        const speedup = slow / fast;
        console.log(`  Slow (generate+score): ${(slow / N).toFixed(3)}ms/call`);
        console.log(`  Fast (scoreFromSeed):  ${(fast / N).toFixed(3)}ms/call`);
        console.log(`  → ${speedup.toFixed(1)}x speedup`);

        assert.ok(speedup > 1.5, `Expected speedup > 1.5x, got ${speedup.toFixed(1)}x`);
    });
});

describe("perf: scaling", () => {
    it("NPC count vs tick time", () => {
        const counts = [4, 8, 16, 32, 64, 128, 256, 512];
        console.log("  NPC scaling:");

        for (const n of counts) {
            const { world } = createBenchWorld(n);
            const result = bench(
                (i) => ecsTick(world, i % 240, Math.floor(i / 240) + 1),
                20, 100,
            );
            console.log(`    ${String(n).padStart(3)} NPCs: ${result.avgMs.toFixed(3)}ms/tick (${result.ticksPerSec} t/s)`);
        }
    });
});
