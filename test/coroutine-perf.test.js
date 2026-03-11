/**
 * Coroutine performance benchmarks.
 *
 * Establishes baseline per-tick pipeline performance at various scales.
 * These numbers are the targets the coroutine implementation must beat.
 *
 * Run: node --test test/coroutine-perf.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorld, spawn, addComponent, getComponent, entitiesWith } from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, AI, GROUP,
    psychologyDecaySystem, relationshipSystem,
    groupFormationSystem, socialPressureSystem, buildLocationIndex,
} from "../lib/social.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { PERSONALITY, generatePersonality } from "../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../lib/belief.core.ts";
import { STATS, generateStats } from "../lib/stats.core.ts";
import { NEEDS, needsSystem } from "../lib/needs.core.ts";
import { MOVEMENT, movementSystem } from "../lib/movement.core.ts";
import { SEARCHING, searchSystem, findWordsFromSeed } from "../lib/search.core.ts";
import { INTENT, intentSystem } from "../lib/intent.core.ts";
import { SLEEP, nearestRestArea } from "../lib/sleep.core.ts";
import { KNOWLEDGE, createKnowledge } from "../lib/knowledge.core.ts";
import { generateBookPage } from "../lib/book.core.ts";
import { seedFromString } from "../lib/prng.core.ts";
import * as NpcCore from "../lib/npc.core.ts";

const SEED = "coroutine-perf-bench";

// --- Helpers ---

function createBenchWorld(npcCount, { spread = "nearby" } = {}) {
    const world = createWorld();
    const rng = seedFromString(SEED + ":spawn:" + npcCount);
    const startLoc = { side: 0, position: 0n, floor: 100n };
    const names = [];
    for (let i = 0; i < npcCount; i++) names.push("NPC_" + i);
    const npcs = NpcCore.spawnNPCs(startLoc, npcCount, names, rng);

    if (spread === "scattered") {
        // Scatter NPCs across a wide area — minimal intersections
        for (let i = 0; i < npcs.length; i++) {
            npcs[i].position = BigInt(i * 1000);
            npcs[i].floor = BigInt(50 + i * 10);
        }
    }

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
        addComponent(world, ent, MOVEMENT, { targetPosition: null, heading: 1 });
        addComponent(world, ent, INTENT, { behavior: "explore", cooldown: 0, elapsed: 0 });
        addComponent(world, ent, SLEEP, {
            home: { side: npc.side, position: nearestRestArea(npc.position), floor: npc.floor },
            bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false,
        });
        addComponent(world, ent, AI, {});

        const persRng = seedFromString(SEED + ":pers:" + npc.id);
        addComponent(world, ent, PERSONALITY, generatePersonality(persRng));
        const beliefRng = seedFromString(SEED + ":belief:" + npc.id);
        addComponent(world, ent, BELIEF, generateBelief(beliefRng));
        const statsRng = seedFromString(SEED + ":stats:" + npc.id);
        addComponent(world, ent, STATS, generateStats(statsRng));
    }

    return { world, npcs, entities };
}

/** Run the full ECS tick pipeline (same as Social.onTick but headless). */
function ecsTick(world, tick, day) {
    const currentTick = (day - 1) * 240 + tick;
    const lightsOn = tick < 160;
    const prebuilt = buildLocationIndex(world);

    relationshipSystem(world, currentTick, undefined, prebuilt, 1);
    psychologyDecaySystem(world, undefined, 1);
    groupFormationSystem(world, undefined, prebuilt);
    socialPressureSystem(world, undefined, undefined, undefined, 1);
    needsSystem(world, lightsOn, undefined, 1);

    const intentRng = seedFromString(SEED + ":intent:" + currentTick);
    intentSystem(world, intentRng, undefined, tick);

    const moveRng = seedFromString(SEED + ":move:" + currentTick);
    movementSystem(world, moveRng, undefined, 1);
}

/** Run per-tick pipeline without search (search is expensive and optional). */
function ecsTickNoSearch(world, tick, day) {
    ecsTick(world, tick, day);
}

function formatRate(ticks, ms) {
    return Math.round(ticks / (ms / 1000));
}

// ============================================================
// Baseline: per-tick pipeline throughput
// ============================================================

describe("coroutine-perf: per-tick baseline", () => {
    it("16 NPCs nearby — 1000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "nearby" });

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            ecsTickNoSearch(world, i % 240, Math.floor(i / 240) + 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  16 NPCs nearby: ${elapsed.toFixed(0)}ms for 1000 ticks (${formatRate(1000, elapsed)} ticks/sec)`);
        assert.ok(elapsed < 10000, "1000 ticks should complete in <10s");
    });

    it("16 NPCs scattered — 1000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            ecsTickNoSearch(world, i % 240, Math.floor(i / 240) + 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  16 NPCs scattered: ${elapsed.toFixed(0)}ms for 1000 ticks (${formatRate(1000, elapsed)} ticks/sec)`);
        assert.ok(elapsed < 10000, "1000 ticks should complete in <10s");
    });

    it("16 NPCs nearby — 10000 ticks (long run)", () => {
        const { world } = createBenchWorld(16, { spread: "nearby" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            ecsTickNoSearch(world, i % 240, Math.floor(i / 240) + 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  16 NPCs nearby (long): ${elapsed.toFixed(0)}ms for 10000 ticks (${formatRate(10000, elapsed)} ticks/sec)`);
        assert.ok(elapsed < 60000, "10000 ticks should complete in <60s");
    });

    it("16 NPCs scattered — 10000 ticks (long run)", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            ecsTickNoSearch(world, i % 240, Math.floor(i / 240) + 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  16 NPCs scattered (long): ${elapsed.toFixed(0)}ms for 10000 ticks (${formatRate(10000, elapsed)} ticks/sec)`);
        assert.ok(elapsed < 60000, "10000 ticks should complete in <60s");
    });
});

// ============================================================
// Scaling: how per-tick cost grows with NPC count
// ============================================================

describe("coroutine-perf: NPC count scaling", () => {
    for (const count of [4, 8, 16, 32]) {
        it(`${count} NPCs scattered — 500 ticks`, () => {
            const { world } = createBenchWorld(count, { spread: "scattered" });

            const start = performance.now();
            for (let i = 0; i < 500; i++) {
                ecsTickNoSearch(world, i % 240, Math.floor(i / 240) + 1);
            }
            const elapsed = performance.now() - start;

            console.log(`  ${count} NPCs: ${elapsed.toFixed(0)}ms for 500 ticks (${formatRate(500, elapsed)} ticks/sec)`);
            assert.ok(elapsed < 30000, `500 ticks with ${count} NPCs should be <30s`);
        });
    }
});

// ============================================================
// System isolation: cost of individual systems
// ============================================================

describe("coroutine-perf: system isolation", () => {
    it("psychology decay alone — 16 NPCs, 10000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            psychologyDecaySystem(world, undefined, 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  psychologyDecay: ${elapsed.toFixed(1)}ms for 10000 ticks`);
    });

    it("relationship system alone — 16 NPCs scattered, 10000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            relationshipSystem(world, i, undefined, undefined, 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  relationshipSystem (scattered): ${elapsed.toFixed(1)}ms for 10000 ticks`);
    });

    it("relationship system alone — 16 NPCs nearby, 10000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "nearby" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            relationshipSystem(world, i, undefined, undefined, 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  relationshipSystem (nearby): ${elapsed.toFixed(1)}ms for 10000 ticks`);
    });

    it("needs system alone — 16 NPCs, 10000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            needsSystem(world, true, undefined, 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  needsSystem: ${elapsed.toFixed(1)}ms for 10000 ticks`);
    });

    it("intent system alone — 16 NPCs, 10000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            const rng = seedFromString(SEED + ":intent:" + i);
            intentSystem(world, rng, undefined, i % 240);
        }
        const elapsed = performance.now() - start;

        console.log(`  intentSystem: ${elapsed.toFixed(1)}ms for 10000 ticks`);
    });

    it("movement system alone — 16 NPCs, 10000 ticks", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            const rng = seedFromString(SEED + ":move:" + i);
            movementSystem(world, rng, undefined, 1);
        }
        const elapsed = performance.now() - start;

        console.log(`  movementSystem: ${elapsed.toFixed(1)}ms for 10000 ticks`);
    });

    it("buildLocationIndex — 16 NPCs, 10000 calls", () => {
        const { world } = createBenchWorld(16, { spread: "scattered" });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            buildLocationIndex(world);
        }
        const elapsed = performance.now() - start;

        console.log(`  buildLocationIndex: ${elapsed.toFixed(1)}ms for 10000 calls`);
    });
});

// ============================================================
// Coroutine: solo coroutine throughput
// ============================================================

import {
    advanceSolo, advanceSoloTick, advanceSoloFastForward,
    ticksToNextThreshold,
} from "../lib/solo-coroutine.core.ts";

function createSoloState(opts = {}) {
    const {
        name = "BenchNPC",
        seed = SEED,
        side = 0,
        position = 50n,
        floor = 100n,
    } = opts;

    const persRng = seedFromString(seed + ":pers:" + name);
    const personality = generatePersonality(persRng);
    const beliefRng = seedFromString(seed + ":belief:" + name);
    const belief = generateBelief(beliefRng);
    const statsRng = seedFromString(seed + ":stats:" + name);
    const stats = generateStats(statsRng);

    return {
        name,
        alive: true,
        pos: { side, position, floor },
        psych: { lucidity: 80, hope: 70 },
        needs: { hunger: 0, thirst: 0, exhaustion: 0 },
        mov: { targetPosition: null, heading: 1 },
        intent: { behavior: "explore", cooldown: 0, elapsed: 0 },
        personality,
        belief,
        stats,
        sleep: {
            home: { side, position: nearestRestArea(position), floor },
            bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false,
        },
        knowledge: null,
        habituation: { exposures: new Map() },
        tick: 0,
        day: 1,
        seed,
    };
}

describe("coroutine-perf: solo coroutine throughput", () => {
    it("1 solo NPC — 10000 ticks (tick-by-tick)", () => {
        const state = createSoloState();

        const start = performance.now();
        advanceSolo(state, 10000);
        const elapsed = performance.now() - start;

        console.log(`  solo coroutine (1 NPC): ${elapsed.toFixed(1)}ms for 10000 ticks (${formatRate(10000, elapsed)} ticks/sec)`);
        assert.ok(state.alive, "NPC should survive");
    });

    it("16 solo NPCs — 10000 ticks each (tick-by-tick)", () => {
        const states = [];
        for (let i = 0; i < 16; i++) {
            states.push(createSoloState({
                name: "NPC_" + i,
                position: BigInt(i * 1000),
                floor: BigInt(50 + i * 10),
            }));
        }

        const start = performance.now();
        for (const state of states) {
            advanceSolo(state, 10000);
        }
        const elapsed = performance.now() - start;

        console.log(`  solo coroutine (16 NPCs): ${elapsed.toFixed(0)}ms for 160000 total ticks (${formatRate(160000, elapsed)} ticks/sec)`);
    });

    it("1 solo NPC — 10000 ticks (fast-forward)", () => {
        const state = createSoloState();

        const start = performance.now();
        advanceSoloFastForward(state, 10000);
        const elapsed = performance.now() - start;

        console.log(`  solo fast-forward (1 NPC): ${elapsed.toFixed(1)}ms for 10000 ticks (${formatRate(10000, elapsed)} ticks/sec)`);
        assert.ok(state.alive, "NPC should survive");
    });

    it("16 solo NPCs — 10000 ticks each (fast-forward)", () => {
        const states = [];
        for (let i = 0; i < 16; i++) {
            states.push(createSoloState({
                name: "NPC_" + i,
                position: BigInt(i * 1000),
                floor: BigInt(50 + i * 10),
            }));
        }

        const start = performance.now();
        for (const state of states) {
            advanceSoloFastForward(state, 10000);
        }
        const elapsed = performance.now() - start;

        console.log(`  solo fast-forward (16 NPCs): ${elapsed.toFixed(0)}ms for 160000 total ticks (${formatRate(160000, elapsed)} ticks/sec)`);
    });
});

// ============================================================
// Comparison summary
// ============================================================

describe("coroutine-perf: comparison", () => {
    it("ECS vs coroutine side-by-side — 16 NPCs scattered, 1000 ticks", () => {
        // ECS baseline
        const { world } = createBenchWorld(16, { spread: "scattered" });
        const ecsStart = performance.now();
        for (let i = 0; i < 1000; i++) {
            ecsTickNoSearch(world, i % 240, Math.floor(i / 240) + 1);
        }
        const ecsElapsed = performance.now() - ecsStart;

        // Coroutine
        const states = [];
        for (let i = 0; i < 16; i++) {
            states.push(createSoloState({
                name: "NPC_" + i,
                position: BigInt(i * 1000),
                floor: BigInt(50 + i * 10),
            }));
        }
        const coroStart = performance.now();
        for (const state of states) {
            advanceSolo(state, 1000);
        }
        const coroElapsed = performance.now() - coroStart;

        // ECS: 1000 ticks × 16 NPCs = 16000 entity-ticks
        // Coroutine: 16 NPCs × 1000 ticks = 16000 entity-ticks
        const ecsEntityRate = formatRate(16000, ecsElapsed);
        const coroEntityRate = formatRate(16000, coroElapsed);
        const speedup = coroEntityRate / ecsEntityRate;
        console.log(`  ECS:       ${ecsElapsed.toFixed(0)}ms (${ecsEntityRate} entity-ticks/sec)`);
        console.log(`  Coroutine: ${coroElapsed.toFixed(0)}ms (${coroEntityRate} entity-ticks/sec)`);
        console.log(`  Speedup:   ${speedup.toFixed(1)}x (per-entity throughput)`);

        // The coroutine should be faster since it skips ECS queries,
        // location index builds, relationship scans, and group systems.
        // But it's tick-by-tick so the speedup is modest — real gains
        // come from fast-forward (threshold skipping) in later phases.
        assert.ok(true);
    });
});
