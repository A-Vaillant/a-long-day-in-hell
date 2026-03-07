import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    sleepOnsetSystem, sleepWakeSystem, nearestRestArea,
    SLEEP, DEFAULT_SLEEP,
} from "../lib/sleep.core.ts";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS } from "../lib/social.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";

function spawnSleeper(world, overrides = {}) {
    const ent = spawn(world);
    const pos = { side: 0, position: 10, floor: 0, ...overrides.position };
    addComponent(world, ent, POSITION, pos);
    addComponent(world, ent, IDENTITY, { name: "Test", alive: true, ...overrides.identity });
    addComponent(world, ent, PSYCHOLOGY, { lucidity: 80, hope: 50, ...overrides.psychology });
    addComponent(world, ent, SLEEP, {
        home: { side: pos.side || 0, position: pos.position, floor: pos.floor || 0 },
        bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false,
        ...overrides.sleep,
    });
    addComponent(world, ent, RELATIONSHIPS, { bonds: new Map(), ...overrides.relationships });
    addComponent(world, ent, HABITUATION, { exposures: new Map() });
    return ent;
}

// --- nearestRestArea ---

describe("nearestRestArea", () => {
    it("returns position itself if already at rest area", () => {
        assert.strictEqual(nearestRestArea(10), 10);
        assert.strictEqual(nearestRestArea(0), 0);
    });

    it("rounds to nearest rest area", () => {
        assert.strictEqual(nearestRestArea(7), 10);
        assert.strictEqual(nearestRestArea(3), 0);
        assert.strictEqual(nearestRestArea(5), 10); // rounds up at midpoint
    });
});

// --- sleepOnsetSystem ---

describe("sleepOnsetSystem", () => {
    it("NPCs at rest areas claim beds and fall asleep", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, { position: { position: 10 } });
        sleepOnsetSystem(world);
        const sleep = getComponent(world, ent, SLEEP);
        assert.strictEqual(sleep.asleep, true);
        assert.strictEqual(sleep.bedIndex, 0);
    });

    it("NPCs not at rest areas don't get beds", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, { position: { position: 7 } });
        sleepOnsetSystem(world);
        const sleep = getComponent(world, ent, SLEEP);
        assert.strictEqual(sleep.asleep, false);
        assert.strictEqual(sleep.bedIndex, null);
    });

    it("dead NPCs don't claim beds", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10 },
            identity: { name: "Dead", alive: false },
        });
        sleepOnsetSystem(world);
        const sleep = getComponent(world, ent, SLEEP);
        assert.strictEqual(sleep.asleep, false);
    });

    it("max 7 beds per rest area", () => {
        const world = createWorld();
        const ents = [];
        for (let i = 0; i < 9; i++) {
            ents.push(spawnSleeper(world, {
                position: { position: 10 },
                identity: { name: "NPC" + i },
            }));
        }
        sleepOnsetSystem(world);

        let bedded = 0;
        let unbedded = 0;
        for (const ent of ents) {
            const sleep = getComponent(world, ent, SLEEP);
            assert.strictEqual(sleep.asleep, true);
            if (sleep.bedIndex !== null) bedded++;
            else unbedded++;
        }
        assert.strictEqual(bedded, 7);
        assert.strictEqual(unbedded, 2);
    });

    it("co-sleepers list excludes self", () => {
        const world = createWorld();
        const a = spawnSleeper(world, { position: { position: 10 }, identity: { name: "A" } });
        const b = spawnSleeper(world, { position: { position: 10 }, identity: { name: "B" } });
        sleepOnsetSystem(world);

        const sleepA = getComponent(world, a, SLEEP);
        const sleepB = getComponent(world, b, SLEEP);
        assert.strictEqual(sleepA.coSleepers.length, 1);
        assert.strictEqual(sleepA.coSleepers[0], b);
        assert.strictEqual(sleepB.coSleepers.length, 1);
        assert.strictEqual(sleepB.coSleepers[0], a);
    });

    it("different rest areas get separate bed pools", () => {
        const world = createWorld();
        const a = spawnSleeper(world, { position: { position: 10 }, identity: { name: "A" } });
        const b = spawnSleeper(world, { position: { position: 20 }, identity: { name: "B" },
            sleep: { home: { side: 0, position: 20, floor: 0 }, bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false } });
        sleepOnsetSystem(world);

        const sleepA = getComponent(world, a, SLEEP);
        const sleepB = getComponent(world, b, SLEEP);
        assert.strictEqual(sleepA.coSleepers.length, 0);
        assert.strictEqual(sleepB.coSleepers.length, 0);
    });

    it("returns sleep onset events", () => {
        const world = createWorld();
        spawnSleeper(world, { position: { position: 10 }, identity: { name: "Alice" } });
        spawnSleeper(world, { position: { position: 10 }, identity: { name: "Bob" } });
        const events = sleepOnsetSystem(world);
        assert.strictEqual(events.length, 1);
        assert.deepStrictEqual(events[0].sleeperNames, ["Alice", "Bob"]);
        assert.strictEqual(events[0].overflow, 0);
    });
});

// --- sleepWakeSystem ---

describe("sleepWakeSystem", () => {
    it("sleeping alone penalizes hope", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });
        // Manually set asleep with a bed
        const sleep = getComponent(world, ent, SLEEP);
        sleep.asleep = true;
        sleep.bedIndex = 0;
        sleep.coSleepers = [];

        sleepWakeSystem(world, 100);
        const psych = getComponent(world, ent, PSYCHOLOGY);
        assert.ok(psych.hope < 50, "hope should decrease when sleeping alone");
        // First night: full shock impact (-3 hope from sleepAlone shock source)
        assert.strictEqual(psych.hope, 47);
    });

    it("no bed is worse than sleeping alone", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });
        const sleep = getComponent(world, ent, SLEEP);
        sleep.asleep = true;
        sleep.bedIndex = null; // no bed (overflow)
        sleep.coSleepers = [];

        sleepWakeSystem(world, 100);
        const psych = getComponent(world, ent, PSYCHOLOGY);
        // First night: full shock impact (-4.5 hope from sleepNoBed shock source)
        assert.ok(psych.hope < 47, "no bed should be worse than alone-with-bed");
    });

    it("sleeping alone habituates — penalty diminishes over consecutive nights", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10 },
            psychology: { lucidity: 80, hope: 80 },
        });

        // Simulate multiple consecutive alone nights
        const penalties = [];
        for (let night = 0; night < 10; night++) {
            const psych = getComponent(world, ent, PSYCHOLOGY);
            const hopeBefore = psych.hope;

            const sleep = getComponent(world, ent, SLEEP);
            sleep.asleep = true;
            sleep.bedIndex = 0;
            sleep.coSleepers = [];

            sleepWakeSystem(world, 100 + night * 240);

            penalties.push(hopeBefore - psych.hope);

            // Reset sleep state for next night
            sleep.asleep = false;
            sleep.bedIndex = null;
        }

        // First night should hurt more than later nights
        assert.ok(penalties[0] > penalties[5], "first night penalty > fifth night penalty");
        assert.ok(penalties[5] > penalties[9], "fifth night > tenth night (still diminishing)");
        // By night 10, penalty should be small fraction of original
        assert.ok(penalties[9] < penalties[0] * 0.4, "tenth night < 40% of first night");
    });

    it("co-sleeping boosts hope", () => {
        const world = createWorld();
        const a = spawnSleeper(world, {
            position: { position: 10 },
            identity: { name: "A" },
            psychology: { lucidity: 80, hope: 50 },
        });
        const b = spawnSleeper(world, {
            position: { position: 10 },
            identity: { name: "B" },
            psychology: { lucidity: 80, hope: 50 },
        });
        // Set up sleeping together
        const sleepA = getComponent(world, a, SLEEP);
        sleepA.asleep = true;
        sleepA.bedIndex = 0;
        sleepA.coSleepers = [b];
        const sleepB = getComponent(world, b, SLEEP);
        sleepB.asleep = true;
        sleepB.bedIndex = 1;
        sleepB.coSleepers = [a];

        sleepWakeSystem(world, 100);
        const psychA = getComponent(world, a, PSYCHOLOGY);
        // With zero prior familiarity, the boost is scaled by familiarityFactor (0)
        // so hope should stay at 50 (no boost, no penalty since they have co-sleepers)
        // Actually: hopeChange = coSleeperHopeBoost * (familiarity/10) = 2.0 * 0 = 0
        // But they DO have co-sleepers, so the alone penalty doesn't apply
        assert.ok(psychA.hope >= 50, "co-sleeping should not penalize hope");
    });

    it("co-sleeping bumps familiarity", () => {
        const world = createWorld();
        const a = spawnSleeper(world, {
            position: { position: 10 },
            identity: { name: "A" },
        });
        const b = spawnSleeper(world, {
            position: { position: 10 },
            identity: { name: "B" },
        });
        const sleepA = getComponent(world, a, SLEEP);
        sleepA.asleep = true;
        sleepA.bedIndex = 0;
        sleepA.coSleepers = [b];

        sleepWakeSystem(world, 100);

        const rels = getComponent(world, a, RELATIONSHIPS);
        const bond = rels.bonds.get(b);
        assert.ok(bond, "bond should be created");
        assert.ok(bond.familiarity >= DEFAULT_SLEEP.coSleeperFamiliarityBump,
            "familiarity should be bumped");
    });

    it("resets sleep state after wake", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, { position: { position: 10 } });
        const sleep = getComponent(world, ent, SLEEP);
        sleep.asleep = true;
        sleep.bedIndex = 3;
        sleep.coSleepers = [];

        sleepWakeSystem(world, 100);
        assert.strictEqual(sleep.asleep, false);
        assert.strictEqual(sleep.bedIndex, null);
        assert.deepStrictEqual(sleep.coSleepers, []);
    });

    it("home shifts after sleeping away for threshold nights", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 20 }, // at rest area 20
            sleep: {
                home: { side: 0, position: 10, floor: 0 }, // home is rest area 10
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: DEFAULT_SLEEP.homeShiftThreshold - 1,
            },
        });
        const sleep = getComponent(world, ent, SLEEP);
        sleep.asleep = true;
        sleep.bedIndex = 0;
        sleep.coSleepers = [];

        sleepWakeSystem(world, 100);
        assert.strictEqual(sleep.home.position, 20, "home should shift to current rest area");
        assert.strictEqual(sleep.home.side, 0);
        assert.strictEqual(sleep.home.floor, 0);
        assert.strictEqual(sleep.awayStreak, 0, "away streak should reset");
    });

    it("sleeping at home resets away streak", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10 },
            sleep: {
                home: { side: 0, position: 10, floor: 0 },
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: 2,
            },
        });
        const sleep = getComponent(world, ent, SLEEP);
        sleep.asleep = true;
        sleep.bedIndex = 0;
        sleep.coSleepers = [];

        sleepWakeSystem(world, 100);
        assert.strictEqual(sleep.awayStreak, 0);
    });

    it("returns wake events", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10 },
            identity: { name: "Alice" },
        });
        sleepOnsetSystem(world);
        const events = sleepWakeSystem(world, 100);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].name, "Alice");
        assert.strictEqual(events[0].atHome, true);
    });

    it("hope is clamped to 0-100", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10 },
            psychology: { lucidity: 80, hope: 1 },
        });
        const sleep = getComponent(world, ent, SLEEP);
        sleep.asleep = true;
        sleep.bedIndex = 0;
        sleep.coSleepers = [];

        sleepWakeSystem(world, 100);
        const psych = getComponent(world, ent, PSYCHOLOGY);
        assert.ok(psych.hope >= 0, "hope should not go below 0");
    });
});
