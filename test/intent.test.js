import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    evaluateIntent, intentSystem, DEFAULT_SCORERS,
    INTENT, DEFAULT_INTENT,
} from "../lib/intent.core.ts";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { IDENTITY, PSYCHOLOGY } from "../lib/social.core.ts";
import { PERSONALITY } from "../lib/personality.core.ts";
import { NEEDS } from "../lib/needs.core.ts";

function makeRng(val = 0.5) {
    return { next() { return val; } };
}

function makeIntent(overrides = {}) {
    return { behavior: "idle", cooldown: 0, elapsed: 0, ...overrides };
}

// --- Scorer unit tests ---

describe("DEFAULT_SCORERS", () => {
    function makeCtx(overrides = {}) {
        return {
            psych: { lucidity: 80, hope: 80 },
            alive: true,
            disposition: "calm",
            needs: { hunger: 10, thirst: 10, exhaustion: 10 },
            personality: { temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5 },
            intent: makeIntent(),
            rng: makeRng(0.5),
            position: { side: 0, position: 5, floor: 0 },
            sleep: { home: { side: 0, position: 10, floor: 0 }, bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false },
            tick: 0,
            ...overrides,
        };
    }

    it("idle returns low constant", () => {
        const s = DEFAULT_SCORERS.idle(makeCtx(), DEFAULT_INTENT);
        assert.ok(s > 0 && s < 0.3);
    });

    it("explore scores higher for restless NPCs", () => {
        const restless = makeCtx({ personality: { temperament: 0.5, pace: 1.0, openness: 0.5, outlook: 0.5 } });
        const patient = makeCtx({ personality: { temperament: 0.5, pace: 0.0, openness: 0.5, outlook: 0.5 } });
        assert.ok(DEFAULT_SCORERS.explore(restless, DEFAULT_INTENT) >
                  DEFAULT_SCORERS.explore(patient, DEFAULT_INTENT));
    });

    it("seek_rest returns -Infinity when needs are fine", () => {
        const s = DEFAULT_SCORERS.seek_rest(makeCtx(), DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("seek_rest scales with hunger", () => {
        const mild = makeCtx({ needs: { hunger: 60, thirst: 10, exhaustion: 10 } });
        const severe = makeCtx({ needs: { hunger: 95, thirst: 10, exhaustion: 10 } });
        const sMild = DEFAULT_SCORERS.seek_rest(mild, DEFAULT_INTENT);
        const sSevere = DEFAULT_SCORERS.seek_rest(severe, DEFAULT_INTENT);
        assert.ok(sMild > 0, "mild hunger should score positive");
        assert.ok(sSevere > sMild, "severe hunger should score higher");
    });

    it("seek_rest scales with thirst", () => {
        const ctx = makeCtx({ needs: { hunger: 10, thirst: 90, exhaustion: 10 } });
        const s = DEFAULT_SCORERS.seek_rest(ctx, DEFAULT_INTENT);
        assert.ok(s > 1.0, "critical thirst should score high");
    });

    it("seek_rest scales with exhaustion", () => {
        const ctx = makeCtx({ needs: { hunger: 10, thirst: 10, exhaustion: 80 } });
        const s = DEFAULT_SCORERS.seek_rest(ctx, DEFAULT_INTENT);
        assert.ok(s > 0);
    });

    it("seek_rest returns -Infinity with no needs component", () => {
        const s = DEFAULT_SCORERS.seek_rest(makeCtx({ needs: null }), DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("search scores higher for open NPCs", () => {
        const rng = makeRng(0.5); // fixed jitter
        const open = makeCtx({ personality: { temperament: 0.5, pace: 0.5, openness: 1.0, outlook: 0.5 }, rng });
        const closed = makeCtx({ personality: { temperament: 0.5, pace: 0.5, openness: 0.0, outlook: 0.5 }, rng });
        assert.ok(DEFAULT_SCORERS.search(open, DEFAULT_INTENT) >
                  DEFAULT_SCORERS.search(closed, DEFAULT_INTENT));
    });

    it("search scores higher for patient NPCs", () => {
        const rng = makeRng(0.5);
        const patient = makeCtx({ personality: { temperament: 0.5, pace: 0.0, openness: 0.5, outlook: 0.5 }, rng });
        const restless = makeCtx({ personality: { temperament: 0.5, pace: 1.0, openness: 0.5, outlook: 0.5 }, rng });
        assert.ok(DEFAULT_SCORERS.search(patient, DEFAULT_INTENT) >
                  DEFAULT_SCORERS.search(restless, DEFAULT_INTENT));
    });

    it("return_home returns -Infinity before evening", () => {
        const s = DEFAULT_SCORERS.return_home(makeCtx({ tick: 100 }), DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("return_home scores positively in the evening when away from home", () => {
        const ctx = makeCtx({
            position: { side: 0, position: 5, floor: 0 },
            sleep: { home: { side: 0, position: 10, floor: 0 }, bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false },
            tick: 150, // near lights-out
        });
        const s = DEFAULT_SCORERS.return_home(ctx, DEFAULT_INTENT);
        assert.ok(s > 0.5, `return_home score ${s} should be > 0.5 near lights-out`);
    });

    it("return_home returns -Infinity when already at home", () => {
        const ctx = makeCtx({
            position: { side: 0, position: 10, floor: 0 },
            sleep: { home: { side: 0, position: 10, floor: 0 }, bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false },
            tick: 150,
        });
        const s = DEFAULT_SCORERS.return_home(ctx, DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("return_home returns -Infinity when too far from home", () => {
        const ctx = makeCtx({
            position: { side: 0, position: 100, floor: 0 },
            sleep: { home: { side: 0, position: 10, floor: 0 }, bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false },
            tick: 150,
        });
        const s = DEFAULT_SCORERS.return_home(ctx, DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("return_home returns -Infinity without sleep component", () => {
        const s = DEFAULT_SCORERS.return_home(makeCtx({ sleep: null, tick: 150 }), DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("return_home returns -Infinity for nomadic NPCs", () => {
        const ctx = makeCtx({
            sleep: { home: { side: 0, position: 10, floor: 0 }, bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: true },
            tick: 150,
        });
        const s = DEFAULT_SCORERS.return_home(ctx, DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("return_home urgency increases toward lights-out", () => {
        const early = makeCtx({ tick: 125 });
        const late = makeCtx({ tick: 155 });
        assert.ok(
            DEFAULT_SCORERS.return_home(late, DEFAULT_INTENT) >
            DEFAULT_SCORERS.return_home(early, DEFAULT_INTENT),
        );
    });

    it("wander_mad returns -Infinity for non-mad", () => {
        const s = DEFAULT_SCORERS.wander_mad(makeCtx(), DEFAULT_INTENT);
        assert.strictEqual(s, -Infinity);
    });

    it("wander_mad returns high score for mad disposition", () => {
        const s = DEFAULT_SCORERS.wander_mad(makeCtx({ disposition: "mad" }), DEFAULT_INTENT);
        assert.ok(s > 2.0);
    });
});

// --- evaluateIntent ---

describe("evaluateIntent", () => {
    it("dead entity → idle", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "explore" }),
            { lucidity: 80, hope: 80 },
            false, null, null, makeRng(),
        );
        assert.deepStrictEqual(r, { behavior: "idle", cooldown: 0 });
    });

    it("stays idle if already idle and dead", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "idle" }),
            { lucidity: 80, hope: 80 },
            false, null, null, makeRng(),
        );
        assert.strictEqual(r, null);
    });

    it("catatonic → idle", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "explore" }),
            { lucidity: 50, hope: 5 },
            true, null, null, makeRng(),
        );
        assert.deepStrictEqual(r, { behavior: "idle", cooldown: 0 });
    });

    it("mad → wander_mad", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "explore" }),
            { lucidity: 10, hope: 80 },
            true, null, null, makeRng(),
        );
        assert.strictEqual(r.behavior, "wander_mad");
    });

    it("respects cooldown — no switch while cooling", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "search", cooldown: 3 }),
            { lucidity: 80, hope: 80 },
            true, null, null, makeRng(),
        );
        assert.strictEqual(r, null);
    });

    it("forced states override cooldown", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "search", cooldown: 3 }),
            { lucidity: 10, hope: 80 },
            true, null, null, makeRng(),
        );
        assert.strictEqual(r.behavior, "wander_mad");
    });

    it("critical hunger → seek_rest wins over explore", () => {
        const r = evaluateIntent(
            makeIntent(),
            { lucidity: 80, hope: 80 },
            true,
            { hunger: 90, thirst: 10, exhaustion: 10 },
            null, makeRng(),
        );
        assert.strictEqual(r.behavior, "seek_rest");
    });

    it("stickiness keeps current behavior when scores are close", () => {
        // NPC currently exploring. Scores should be close for explore vs search.
        // Stickiness bonus should keep them exploring.
        const r = evaluateIntent(
            makeIntent({ behavior: "explore" }),
            { lucidity: 80, hope: 80 },
            true,
            { hunger: 10, thirst: 10, exhaustion: 10 },
            { temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5 },
            makeRng(0.5), // jitter = 0 → search score ~0.5, explore score ~0.65
        );
        // With stickiness bonus on explore, it should stay
        assert.strictEqual(r, null);
    });

    it("strong drive overcomes stickiness", () => {
        // NPC currently exploring but starving
        const r = evaluateIntent(
            makeIntent({ behavior: "explore" }),
            { lucidity: 80, hope: 80 },
            true,
            { hunger: 95, thirst: 10, exhaustion: 10 },
            null, makeRng(),
        );
        assert.strictEqual(r.behavior, "seek_rest");
    });

    it("lights off → idle (can't act in the dark)", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "explore" }),
            { lucidity: 80, hope: 80 },
            true, null, null, makeRng(),
            undefined, undefined, undefined, undefined,
            160, // tick 160 = lights off
        );
        assert.deepStrictEqual(r, { behavior: "idle", cooldown: 0 });
    });

    it("lights off overrides even starving NPC", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "seek_rest" }),
            { lucidity: 80, hope: 80 },
            true,
            { hunger: 99, thirst: 99, exhaustion: 99 },
            null, makeRng(),
            undefined, undefined, undefined, undefined,
            170,
        );
        assert.deepStrictEqual(r, { behavior: "idle", cooldown: 0 });
    });

    it("already idle during lights off → no change", () => {
        const r = evaluateIntent(
            makeIntent({ behavior: "idle" }),
            { lucidity: 80, hope: 80 },
            true, null, null, makeRng(),
            undefined, undefined, undefined, undefined,
            200,
        );
        assert.strictEqual(r, null);
    });
});

// --- intentSystem ---

function spawnEntity(world, overrides = {}) {
    const ent = spawn(world);
    addComponent(world, ent, INTENT, makeIntent(overrides.intent));
    addComponent(world, ent, IDENTITY, { name: "Test", alive: true, ...overrides.identity });
    addComponent(world, ent, PSYCHOLOGY, { lucidity: 80, hope: 80, ...overrides.psychology });
    if (overrides.needs) addComponent(world, ent, NEEDS, overrides.needs);
    if (overrides.personality) addComponent(world, ent, PERSONALITY, overrides.personality);
    return ent;
}

describe("intentSystem", () => {
    it("decrements cooldown each tick", () => {
        const world = createWorld();
        const ent = spawnEntity(world, { intent: { behavior: "search", cooldown: 5, elapsed: 0 } });
        intentSystem(world, makeRng());
        const intent = getComponent(world, ent, INTENT);
        assert.strictEqual(intent.cooldown, 4);
    });

    it("increments elapsed each tick", () => {
        const world = createWorld();
        const ent = spawnEntity(world, { intent: { behavior: "explore", cooldown: 10, elapsed: 3 } });
        intentSystem(world, makeRng());
        const intent = getComponent(world, ent, INTENT);
        assert.strictEqual(intent.elapsed, 4);
    });

    it("transitions when cooldown expires and better option exists", () => {
        const world = createWorld();
        const ent = spawnEntity(world, {
            intent: { behavior: "idle", cooldown: 0, elapsed: 0 },
            needs: { hunger: 90, thirst: 10, exhaustion: 10 },
        });
        intentSystem(world, makeRng());
        const intent = getComponent(world, ent, INTENT);
        assert.strictEqual(intent.behavior, "seek_rest");
        assert.strictEqual(intent.elapsed, 0);
    });

    it("mad entity forced to wander_mad even during cooldown", () => {
        const world = createWorld();
        const ent = spawnEntity(world, {
            intent: { behavior: "search", cooldown: 10, elapsed: 5 },
            psychology: { lucidity: 10, hope: 80 },
        });
        intentSystem(world, makeRng());
        const intent = getComponent(world, ent, INTENT);
        assert.strictEqual(intent.behavior, "wander_mad");
    });

    it("multiple entities evaluate independently", () => {
        const world = createWorld();
        const hungry = spawnEntity(world, {
            identity: { name: "Hungry" },
            needs: { hunger: 90, thirst: 10, exhaustion: 10 },
        });
        const calm = spawnEntity(world, {
            identity: { name: "Calm" },
            needs: { hunger: 10, thirst: 10, exhaustion: 10 },
        });
        intentSystem(world, makeRng(0.99));
        assert.strictEqual(getComponent(world, hungry, INTENT).behavior, "seek_rest");
        // Calm entity should pick explore (high rng → low search jitter → explore wins)
        assert.strictEqual(getComponent(world, calm, INTENT).behavior, "explore");
    });
});
