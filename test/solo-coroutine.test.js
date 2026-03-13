/**
 * Solo coroutine behavior tests.
 *
 * Tests parity between lib/solo-coroutine.core.ts and the per-tick ECS
 * pipeline for isolated NPCs (no cross-entity interactions).
 *
 * Run: node --test test/solo-coroutine.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, AI,
    psychologyDecaySystem, deriveDisposition,
    DEFAULT_DECAY, DEFAULT_THRESHOLDS,
} from "../lib/social.core.ts";
import { NEEDS, needsSystem, DEFAULT_NEEDS } from "../lib/needs.core.ts";
import { MOVEMENT, movementSystem } from "../lib/movement.core.ts";
import { INTENT, intentSystem, evaluateIntent, DEFAULT_INTENT } from "../lib/intent.core.ts";
import { PERSONALITY, generatePersonality } from "../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../lib/belief.core.ts";
import { STATS, generateStats, enduranceMod } from "../lib/stats.core.ts";
import { SLEEP, nearestRestArea } from "../lib/sleep.core.ts";
import { SEARCHING, searchSystem, findWordsFromSeed } from "../lib/search.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { KNOWLEDGE, createKnowledge } from "../lib/knowledge.core.ts";
import { seedFromString } from "../lib/prng.core.ts";
import { isRestArea } from "../lib/library.core.ts";
import { generateBookPage } from "../lib/book.core.ts";
import {
    advanceSoloTick, advanceSolo, ticksToNextThreshold,
    DEFAULT_SOLO_CONFIG,
} from "../lib/solo-coroutine.core.ts";
import { TICKS_PER_DAY, WAKING_TICKS } from "../lib/scale.core.ts";

const SEED = "solo-coroutine-test";

// --- Helpers ---

/**
 * Create a fully-componented solo NPC in an ECS world.
 * This is the "reference" entity that the per-tick pipeline operates on.
 */
function createSoloNpc(world, opts = {}) {
    const {
        name = "Pilgrim",
        seed = SEED,
        side = 0,
        position = 5n,
        floor = 100n,
        lucidity = 80,
        hope = 70,
        hunger = 0,
        thirst = 0,
        exhaustion = 0,
        behavior = "explore",
        heading = 1,
        cooldown = 0,
    } = opts;

    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive: true });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, NEEDS, { hunger, thirst, exhaustion });
    addComponent(world, e, MOVEMENT, { targetPosition: null, heading });
    addComponent(world, e, INTENT, { behavior, cooldown, elapsed: 0 });
    addComponent(world, e, AI, {});
    addComponent(world, e, HABITUATION, { exposures: new Map() });
    addComponent(world, e, SLEEP, {
        home: { side, position: nearestRestArea(position), floor },
        bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false,
    });

    const persRng = seedFromString(seed + ":pers:" + name);
    addComponent(world, e, PERSONALITY, generatePersonality(persRng));
    const beliefRng = seedFromString(seed + ":belief:" + name);
    addComponent(world, e, BELIEF, generateBelief(beliefRng));
    const statsRng = seedFromString(seed + ":stats:" + name);
    addComponent(world, e, STATS, generateStats(statsRng));

    return e;
}

/**
 * Run the per-tick ECS pipeline for a solo NPC (no cross-entity systems).
 * This is the reference behavior that coroutines must match.
 */
function runPerTickPipeline(world, entity, ticks, { seed = SEED, startTick = 0, startDay = 1 } = {}) {
    let tick = startTick;
    let day = startDay;

    for (let i = 0; i < ticks; i++) {
        const currentTick = (day - 1) * TICKS_PER_DAY + tick;
        const lightsOn = tick < WAKING_TICKS;

        // Per-tick systems in order (mirrors Social.onTick for single entity)
        psychologyDecaySystem(world, undefined, 1);
        needsSystem(world, lightsOn, undefined, 1);

        const intentRng = seedFromString(seed + ":intent:" + currentTick);
        intentSystem(world, intentRng, undefined, tick);

        const moveRng = seedFromString(seed + ":move:" + currentTick);
        movementSystem(world, moveRng, undefined, 1);

        // Advance time
        tick++;
        if (tick >= TICKS_PER_DAY) { tick = 0; day++; }
    }

    return { tick, day };
}

function approxEqual(a, b, tol, msg = "") {
    assert.ok(Math.abs(a - b) < tol,
        `${msg}: expected ≈${b.toFixed(6)}, got ${a.toFixed(6)} (diff=${Math.abs(a - b).toFixed(9)})`);
}

// ============================================================
// Needs accumulation — the coroutine's internal needs loop
// ============================================================

describe("solo-coroutine: needs lifecycle", () => {
    it("needs accumulate linearly over n ticks", () => {
        const w = createWorld();
        const e = createSoloNpc(w, { position: 5n }); // not at rest area
        const stats = getComponent(w, e, STATS);
        const eMod = stats ? enduranceMod(stats) : 1.0;

        const N = 100;
        runPerTickPipeline(w, e, N);

        const needs = getComponent(w, e, NEEDS);
        // Needs should have accumulated ~N * rate * eMod (minus any relief if we crossed a rest area)
        // At position 5, no relief available
        assert.ok(needs.hunger > 0, "hunger should accumulate");
        assert.ok(needs.thirst > 0, "thirst should accumulate");
        assert.ok(needs.exhaustion > 0, "exhaustion should accumulate");

        // Verify roughly linear (within movement-induced position changes)
        const expectedHunger = DEFAULT_NEEDS.hungerRate * eMod * N;
        // Allow generous tolerance — NPC may have moved to rest area
        assert.ok(needs.hunger <= expectedHunger + 1,
            `hunger ${needs.hunger} should be ≤ ${expectedHunger + 1}`);
    });

    it("NPC auto-eats at rest area when hunger >= threshold", () => {
        const w = createWorld();
        const e = createSoloNpc(w, { position: 0n, hunger: 49 }); // at rest area

        // Run enough ticks to cross eat threshold (50)
        runPerTickPipeline(w, e, 200);

        const needs = getComponent(w, e, NEEDS);
        // Should have eaten — hunger should be well below threshold
        assert.ok(needs.hunger < DEFAULT_NEEDS.eatThreshold,
            `hunger ${needs.hunger} should be below eat threshold after auto-eat`);
    });

    it("NPC dies from thirst when away from rest area long enough", () => {
        const w = createWorld();
        // Start with high thirst, position away from rest area, intent=idle to prevent movement
        // position 7n: not a rest area (not a multiple of GALLERIES_PER_SEGMENT)
        const e = createSoloNpc(w, { position: 7n, thirst: 95, behavior: "idle", cooldown: 99999 });

        // thirstRate ≈ 0.0174/tick: 5/0.0174 ≈ 288 ticks to reach 100 + 720 ticks mortality = ~1008
        runPerTickPipeline(w, e, 1200);

        const ident = getComponent(w, e, IDENTITY);
        assert.ok(!ident.alive, "NPC should die from thirst");
    });

    it("NPC survives indefinitely at rest area with auto-relief", () => {
        const w = createWorld();
        // Pin to rest area (position 0, idle intent)
        const e = createSoloNpc(w, { position: 0n, behavior: "idle", cooldown: 99999 });

        runPerTickPipeline(w, e, 5000);

        const ident = getComponent(w, e, IDENTITY);
        assert.ok(ident.alive, "NPC at rest area should survive indefinitely");
    });
});

// ============================================================
// Psychology decay — coroutine must match per-tick decay
// ============================================================

describe("solo-coroutine: psychology decay", () => {
    it("lucidity and hope decay over time (isolated, no companion)", () => {
        const w = createWorld();
        const e = createSoloNpc(w, { lucidity: 80, hope: 70 });

        runPerTickPipeline(w, e, 1000);

        const psych = getComponent(w, e, PSYCHOLOGY);
        assert.ok(psych.lucidity < 80, "lucidity should decay");
        assert.ok(psych.hope < 70, "hope should decay");
    });

    it("decay is extremely slow at high stats", () => {
        const w = createWorld();
        const e = createSoloNpc(w, { lucidity: 90, hope: 90 });

        runPerTickPipeline(w, e, 10000);

        const psych = getComponent(w, e, PSYCHOLOGY);
        // At high stats, decay rate is near base (0.00003 lucidity, 0.00004 hope)
        // Over 10000 ticks: ~0.3 lucidity, ~0.4 hope
        assert.ok(psych.lucidity > 85, `lucidity ${psych.lucidity} should barely decay at high stats`);
        assert.ok(psych.hope > 85, `hope ${psych.hope} should barely decay at high stats`);
    });

    it("decay accelerates at low stats", () => {
        const w = createWorld();
        const e = createSoloNpc(w, { lucidity: 30, hope: 20 });

        const psychBefore = { ...getComponent(w, e, PSYCHOLOGY) };
        runPerTickPipeline(w, e, 1000);
        const psychAfter = getComponent(w, e, PSYCHOLOGY);

        const lucDrop = psychBefore.lucidity - psychAfter.lucidity;
        // At low stats, acceleration kicks in: rate = base * (1 + 12 * (1 - stat/100)^2)
        // lucidityBase = perDay(0.0072) ≈ 0.000005/tick; at lucidity=30: ~0.0000344/tick
        // Over 1000 ticks: ~0.034 (significantly above base of 0.005)
        assert.ok(lucDrop > 0.02, `lucidity drop ${lucDrop} should be measurable at low stats`);
    });
});

// ============================================================
// Intent transitions — coroutine must evaluate intent correctly
// ============================================================

describe("solo-coroutine: intent transitions", () => {
    it("switches to seek_rest when needs are critical", () => {
        const w = createWorld();
        const e = createSoloNpc(w, {
            position: 5n, hunger: 79, thirst: 79, behavior: "explore", cooldown: 0,
        });

        // Run a few ticks — needs should cross 80 (critical threshold) and trigger seek_rest
        runPerTickPipeline(w, e, 50);

        const intent = getComponent(w, e, INTENT);
        // Should have switched away from explore (exact behavior depends on scoring)
        const needs = getComponent(w, e, NEEDS);
        if (needs.hunger >= 80 || needs.thirst >= 80) {
            assert.ok(intent.behavior === "seek_rest" || intent.behavior === "idle",
                `intent should be seek_rest or idle when needs critical, got ${intent.behavior}`);
        }
    });

    it("switches to wander_mad when lucidity drops below threshold", () => {
        const w = createWorld();
        const e = createSoloNpc(w, {
            lucidity: 35, hope: 50, behavior: "explore", cooldown: 0,
        });

        // Lucidity at 35 is below mad threshold (40 default)
        // Intent system should force wander_mad
        runPerTickPipeline(w, e, 5);

        const intent = getComponent(w, e, INTENT);
        assert.strictEqual(intent.behavior, "wander_mad",
            "should switch to wander_mad when lucidity < mad threshold");
    });

    it("cooldown prevents re-evaluation", () => {
        const w = createWorld();
        const e = createSoloNpc(w, {
            behavior: "explore", cooldown: 100,
        });

        runPerTickPipeline(w, e, 50);

        const intent = getComponent(w, e, INTENT);
        // Cooldown started at 100, decremented 50 times → 50 remaining
        assert.strictEqual(intent.cooldown, 50, "cooldown should decrement per tick");
        assert.strictEqual(intent.behavior, "explore", "behavior locked during cooldown");
    });
});

// ============================================================
// Movement — coroutine must move NPCs correctly
// ============================================================

describe("solo-coroutine: movement", () => {
    it("explore moves in heading direction", () => {
        const w = createWorld();
        const e = createSoloNpc(w, {
            position: 50n, heading: 1, behavior: "explore", cooldown: 999,
        });

        runPerTickPipeline(w, e, 20);

        const pos = getComponent(w, e, POSITION);
        // Should have moved rightward (heading=1) by roughly 20 segments
        // May deviate at rest areas (chance of reversal/floor change)
        assert.ok(pos.position !== 50n, "should have moved from starting position");
    });

    it("seek_rest moves toward nearest rest area", () => {
        const w = createWorld();
        const e = createSoloNpc(w, {
            position: 7n, behavior: "seek_rest", cooldown: 999,
        });

        runPerTickPipeline(w, e, 5);

        const pos = getComponent(w, e, POSITION);
        // Nearest rest area from 7 is 0 (dist 7) — moves left toward it
        assert.ok(pos.position <= 7n, "should move toward nearest rest area");
    });
});

// ============================================================
// Threshold computation — for fast-forward skip logic
// ============================================================

describe("solo-coroutine: threshold computation", () => {
    it("can compute ticks until eat threshold", () => {
        const hunger = 20;
        const rate = DEFAULT_NEEDS.hungerRate;
        const threshold = DEFAULT_NEEDS.eatThreshold;
        const ticksUntil = Math.ceil((threshold - hunger) / rate);

        // hungerRate = perDay(100/8) ≈ 0.00868/tick; from 20 to 50 = 30/0.00868 ≈ 10800 ticks
        assert.ok(ticksUntil > 10000 && ticksUntil < 11000,
            `ticksUntil eat: ${ticksUntil}`);
    });

    it("can compute ticks until psychology transition", () => {
        const lucidity = 80;
        const madThreshold = DEFAULT_THRESHOLDS.madLucidity; // 40
        const baseRate = DEFAULT_DECAY.lucidityBase; // 0.00003

        // At high lucidity, rate ≈ base (acceleration near zero)
        // Conservative estimate: (80-40) / 0.00003 ≈ 1,333,333 ticks ≈ 5,556 days
        const conservativeEstimate = Math.ceil((lucidity - madThreshold) / baseRate);
        assert.ok(conservativeEstimate > 1_000_000,
            `conservative ticks until mad: ${conservativeEstimate}`);
    });

    it("threshold computation is conservative (never overshoots)", () => {
        // The coroutine should never skip past a state transition.
        // Verify: compute threshold, advance that many ticks, check state hasn't
        // already transitioned.
        const w = createWorld();
        const e = createSoloNpc(w, { hunger: 45, position: 5n, behavior: "idle", cooldown: 99999 });

        const needs = getComponent(w, e, NEEDS);
        const stats = getComponent(w, e, STATS);
        const eMod = stats ? enduranceMod(stats) : 1.0;
        const ticksToEat = Math.ceil((DEFAULT_NEEDS.eatThreshold - needs.hunger) / (DEFAULT_NEEDS.hungerRate * eMod));

        // Advance exactly that many ticks minus 1 — should NOT have crossed threshold
        runPerTickPipeline(w, e, Math.max(0, ticksToEat - 1));
        // Note: the NPC is at position 5 with idle intent, so position doesn't change.
        // Needs accumulate without relief (not at rest area).
        const needsAfter = getComponent(w, e, NEEDS);
        assert.ok(needsAfter.hunger < DEFAULT_NEEDS.eatThreshold,
            `hunger ${needsAfter.hunger} should be below threshold at ticksToEat-1`);
    });
});

// ============================================================
// Day boundary handling
// ============================================================

describe("solo-coroutine: day boundaries", () => {
    it("NPC survives across multiple days", () => {
        const w = createWorld();
        const e = createSoloNpc(w, { position: 0n }); // at rest area for survival

        // Run for 3 full days (3 * 1440 = 4320 ticks)
        const result = runPerTickPipeline(w, e, 3 * TICKS_PER_DAY);

        const ident = getComponent(w, e, IDENTITY);
        assert.ok(ident.alive, "NPC should survive 3 days at rest area");
        assert.strictEqual(result.day, 4, "should be on day 4 after 3 days");
    });
});

// ============================================================
// Reference data for parity testing
// These capture the per-tick pipeline's output at specific checkpoints
// for comparison against future coroutine implementation.
// ============================================================

describe("solo-coroutine: reference snapshots", () => {
    it("captures 1000-tick reference state for parity comparison", () => {
        const w = createWorld();
        const e = createSoloNpc(w, {
            name: "RefNPC",
            seed: "parity-ref-seed",
            position: 50n,
            floor: 100n,
            lucidity: 75,
            hope: 65,
            hunger: 10,
            thirst: 15,
            exhaustion: 5,
            behavior: "explore",
            heading: 1,
        });

        runPerTickPipeline(w, e, 1000, { seed: "parity-ref-seed" });

        const pos = getComponent(w, e, POSITION);
        const psych = getComponent(w, e, PSYCHOLOGY);
        const needs = getComponent(w, e, NEEDS);
        const intent = getComponent(w, e, INTENT);
        const ident = getComponent(w, e, IDENTITY);

        // Log reference values — these become the parity targets
        console.log("  Reference state after 1000 ticks:");
        console.log(`    alive: ${ident.alive}`);
        console.log(`    position: side=${pos.side} pos=${pos.position} floor=${pos.floor}`);
        console.log(`    psychology: luc=${psych.lucidity.toFixed(6)} hope=${psych.hope.toFixed(6)}`);
        console.log(`    needs: h=${needs.hunger.toFixed(4)} t=${needs.thirst.toFixed(4)} e=${needs.exhaustion.toFixed(4)}`);
        console.log(`    intent: ${intent.behavior} (cd=${intent.cooldown}, elapsed=${intent.elapsed})`);

        // Just verify it ran without crashing
        assert.ok(typeof pos.position === "bigint", "position should be bigint");
        assert.ok(typeof psych.lucidity === "number", "lucidity should be number");
    });

    it("captures 10000-tick reference state for long-run parity", () => {
        const w = createWorld();
        const e = createSoloNpc(w, {
            name: "LongRefNPC",
            seed: "parity-ref-long",
            position: 50n,
            floor: 100n,
            lucidity: 80,
            hope: 70,
        });

        const result = runPerTickPipeline(w, e, 10000, { seed: "parity-ref-long" });

        const pos = getComponent(w, e, POSITION);
        const psych = getComponent(w, e, PSYCHOLOGY);
        const needs = getComponent(w, e, NEEDS);
        const ident = getComponent(w, e, IDENTITY);

        console.log("  Reference state after 10000 ticks:");
        console.log(`    alive: ${ident.alive}, day: ${result.day}`);
        console.log(`    position: side=${pos.side} pos=${pos.position} floor=${pos.floor}`);
        console.log(`    psychology: luc=${psych.lucidity.toFixed(6)} hope=${psych.hope.toFixed(6)}`);
        console.log(`    needs: h=${needs.hunger.toFixed(4)} t=${needs.thirst.toFixed(4)} e=${needs.exhaustion.toFixed(4)}`);

        assert.ok(ident.alive, "NPC should survive 10000 ticks (explores, finds rest areas)");
    });
});

// ============================================================
// Coroutine parity tests — compare coroutine output vs ECS pipeline
// ============================================================

/**
 * Create a SoloState matching the ECS entity created by createSoloNpc.
 * Must produce identical initial conditions.
 */
function createSoloState(opts = {}) {
    const {
        name = "Pilgrim",
        seed = SEED,
        side = 0,
        position = 5n,
        floor = 100n,
        lucidity = 80,
        hope = 70,
        hunger = 0,
        thirst = 0,
        exhaustion = 0,
        behavior = "explore",
        heading = 1,
        cooldown = 0,
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
        psych: { lucidity, hope },
        needs: { hunger, thirst, exhaustion },
        mov: { targetPosition: null, heading },
        intent: { behavior, cooldown, elapsed: 0 },
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

describe("solo-coroutine: parity with ECS pipeline", () => {
    it("1000-tick parity: coroutine matches ECS reference exactly", () => {
        const N = 1000;
        const parityOpts = {
            name: "RefNPC",
            seed: "parity-ref-seed",
            position: 50n,
            floor: 100n,
            lucidity: 75,
            hope: 65,
            hunger: 10,
            thirst: 15,
            exhaustion: 5,
            behavior: "explore",
            heading: 1,
        };

        // ECS reference
        const w = createWorld();
        const e = createSoloNpc(w, parityOpts);
        runPerTickPipeline(w, e, N, { seed: parityOpts.seed });
        const refPos = getComponent(w, e, POSITION);
        const refPsych = getComponent(w, e, PSYCHOLOGY);
        const refNeeds = getComponent(w, e, NEEDS);
        const refIntent = getComponent(w, e, INTENT);
        const refIdent = getComponent(w, e, IDENTITY);

        // Coroutine
        const state = createSoloState(parityOpts);
        advanceSolo(state, N);

        // Assert exact parity
        assert.equal(state.alive, refIdent.alive, "alive mismatch");
        assert.equal(state.pos.side, refPos.side, "side mismatch");
        assert.equal(state.pos.position, refPos.position,
            `position mismatch: coroutine=${state.pos.position} ecs=${refPos.position}`);
        assert.equal(state.pos.floor, refPos.floor,
            `floor mismatch: coroutine=${state.pos.floor} ecs=${refPos.floor}`);
        assert.equal(state.psych.lucidity, refPsych.lucidity,
            `lucidity mismatch: coroutine=${state.psych.lucidity} ecs=${refPsych.lucidity}`);
        assert.equal(state.psych.hope, refPsych.hope,
            `hope mismatch: coroutine=${state.psych.hope} ecs=${refPsych.hope}`);
        assert.equal(state.needs.hunger, refNeeds.hunger,
            `hunger mismatch: coroutine=${state.needs.hunger} ecs=${refNeeds.hunger}`);
        assert.equal(state.needs.thirst, refNeeds.thirst,
            `thirst mismatch: coroutine=${state.needs.thirst} ecs=${refNeeds.thirst}`);
        assert.equal(state.needs.exhaustion, refNeeds.exhaustion,
            `exhaustion mismatch: coroutine=${state.needs.exhaustion} ecs=${refNeeds.exhaustion}`);
        assert.equal(state.intent.behavior, refIntent.behavior,
            `intent mismatch: coroutine=${state.intent.behavior} ecs=${refIntent.behavior}`);
        assert.equal(state.intent.cooldown, refIntent.cooldown, "cooldown mismatch");
        assert.equal(state.intent.elapsed, refIntent.elapsed, "elapsed mismatch");
    });

    it("10000-tick parity: coroutine matches ECS long-run reference", () => {
        const N = 10000;
        const parityOpts = {
            name: "LongRefNPC",
            seed: "parity-ref-long",
            position: 50n,
            floor: 100n,
            lucidity: 80,
            hope: 70,
        };

        // ECS reference
        const w = createWorld();
        const e = createSoloNpc(w, parityOpts);
        const ecsResult = runPerTickPipeline(w, e, N, { seed: parityOpts.seed });
        const refPos = getComponent(w, e, POSITION);
        const refPsych = getComponent(w, e, PSYCHOLOGY);
        const refNeeds = getComponent(w, e, NEEDS);
        const refIdent = getComponent(w, e, IDENTITY);

        // Coroutine
        const state = createSoloState(parityOpts);
        advanceSolo(state, N);

        assert.equal(state.alive, refIdent.alive, "alive mismatch");
        assert.equal(state.pos.side, refPos.side, "side mismatch");
        assert.equal(state.pos.position, refPos.position,
            `position mismatch: coroutine=${state.pos.position} ecs=${refPos.position}`);
        assert.equal(state.pos.floor, refPos.floor,
            `floor mismatch: coroutine=${state.pos.floor} ecs=${refPos.floor}`);
        assert.equal(state.psych.lucidity, refPsych.lucidity,
            `lucidity mismatch: coroutine=${state.psych.lucidity} ecs=${refPsych.lucidity}`);
        assert.equal(state.psych.hope, refPsych.hope,
            `hope mismatch: coroutine=${state.psych.hope} ecs=${refPsych.hope}`);
        assert.equal(state.needs.hunger, refNeeds.hunger, "hunger mismatch");
        assert.equal(state.needs.thirst, refNeeds.thirst, "thirst mismatch");
        assert.equal(state.needs.exhaustion, refNeeds.exhaustion, "exhaustion mismatch");
        assert.equal(state.day, ecsResult.day, "day mismatch");
    });

    it("single-tick parity: each tick matches individually", () => {
        const parityOpts = {
            name: "TickNPC",
            seed: "tick-parity-seed",
            position: 7n,
            floor: 50n,
            lucidity: 60,
            hope: 55,
            hunger: 40,
            thirst: 35,
            behavior: "explore",
            heading: -1,
        };

        const w = createWorld();
        const e = createSoloNpc(w, parityOpts);
        const state = createSoloState(parityOpts);

        // Track ECS time separately (matches runPerTickPipeline logic)
        let ecsTick = 0;
        let ecsDay = 1;

        // Run 100 ticks, checking each one
        for (let i = 0; i < 100; i++) {
            const currentTick = (ecsDay - 1) * TICKS_PER_DAY + ecsTick;
            const lightsOn = ecsTick < WAKING_TICKS;

            // ECS pipeline (same order as runPerTickPipeline)
            psychologyDecaySystem(w, undefined, 1);
            needsSystem(w, lightsOn, undefined, 1);
            const intentRng = seedFromString(parityOpts.seed + ":intent:" + currentTick);
            intentSystem(w, intentRng, undefined, ecsTick);
            const moveRng = seedFromString(parityOpts.seed + ":move:" + currentTick);
            movementSystem(w, moveRng, undefined, 1);

            // Advance ECS time
            ecsTick++;
            if (ecsTick >= TICKS_PER_DAY) { ecsTick = 0; ecsDay++; }

            // Coroutine
            advanceSoloTick(state);

            // Compare after each tick
            const refPos = getComponent(w, e, POSITION);
            const refPsych = getComponent(w, e, PSYCHOLOGY);
            const refNeeds = getComponent(w, e, NEEDS);
            const refIntent = getComponent(w, e, INTENT);

            assert.equal(state.pos.position, refPos.position,
                `tick ${i}: position mismatch: coroutine=${state.pos.position} ecs=${refPos.position}`);
            assert.equal(state.psych.lucidity, refPsych.lucidity,
                `tick ${i}: lucidity mismatch`);
            assert.equal(state.needs.hunger, refNeeds.hunger,
                `tick ${i}: hunger mismatch`);
            assert.equal(state.intent.behavior, refIntent.behavior,
                `tick ${i}: intent mismatch: coroutine=${state.intent.behavior} ecs=${refIntent.behavior}`);
        }
    });
});

describe("solo-coroutine: threshold computation", () => {
    it("ticksToNextThreshold returns positive value", () => {
        const state = createSoloState({ position: 5n });
        const t = ticksToNextThreshold(state);
        assert.ok(t > 0, `threshold should be positive, got ${t}`);
    });

    it("threshold is conservative: no transition missed", () => {
        const state = createSoloState({
            position: 5n,
            hunger: 45,
            behavior: "idle",
            cooldown: 99999,
        });

        const t = ticksToNextThreshold(state);
        // Advance t-1 ticks — hunger should not have crossed eatThreshold
        const hungerBefore = state.needs.hunger;
        advanceSolo(state, Math.max(0, t - 1));

        assert.ok(state.needs.hunger < DEFAULT_NEEDS.eatThreshold,
            `hunger ${state.needs.hunger} should be below threshold at t-1 (threshold ticks=${t})`);
    });
});
