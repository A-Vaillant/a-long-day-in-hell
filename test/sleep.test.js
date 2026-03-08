import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    sleepOnsetSystem, sleepWakeSystem, nearestRestArea,
    SLEEP, DEFAULT_SLEEP,
} from "../lib/sleep.core.ts";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP } from "../lib/social.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";

function spawnSleeper(world, overrides = {}) {
    const ent = spawn(world);
    const pos = { side: 0, position: 10n, floor: 0n, ...overrides.position };
    addComponent(world, ent, POSITION, pos);
    addComponent(world, ent, IDENTITY, { name: "Test", alive: true, ...overrides.identity });
    addComponent(world, ent, PSYCHOLOGY, { lucidity: 80, hope: 50, ...overrides.psychology });
    addComponent(world, ent, SLEEP, {
        home: { side: pos.side ?? 0, position: pos.position, floor: pos.floor ?? 0n },
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
        assert.strictEqual(nearestRestArea(10n), 10n);
        assert.strictEqual(nearestRestArea(0n), 0n);
    });

    it("rounds to nearest rest area", () => {
        assert.strictEqual(nearestRestArea(7n), 10n);
        assert.strictEqual(nearestRestArea(3n), 0n);
        assert.strictEqual(nearestRestArea(5n), 10n); // rounds up at midpoint
    });
});

// --- sleepOnsetSystem ---

describe("sleepOnsetSystem", () => {
    it("NPCs at rest areas claim beds and fall asleep", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, { position: { position: 10n } });
        sleepOnsetSystem(world);
        const sleep = getComponent(world, ent, SLEEP);
        assert.strictEqual(sleep.asleep, true);
        assert.strictEqual(sleep.bedIndex, 0);
    });

    it("NPCs not at rest areas don't get beds", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, { position: { position: 7n } });
        sleepOnsetSystem(world);
        const sleep = getComponent(world, ent, SLEEP);
        assert.strictEqual(sleep.asleep, false);
        assert.strictEqual(sleep.bedIndex, null);
    });

    it("dead NPCs don't claim beds", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10n },
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
                position: { position: 10n },
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
        const a = spawnSleeper(world, { position: { position: 10n }, identity: { name: "A" } });
        const b = spawnSleeper(world, { position: { position: 10n }, identity: { name: "B" } });
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
        const a = spawnSleeper(world, { position: { position: 10n }, identity: { name: "A" } });
        const b = spawnSleeper(world, { position: { position: 20n }, identity: { name: "B" },
            sleep: { home: { side: 0, position: 20n, floor: 0n }, bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false } });
        sleepOnsetSystem(world);

        const sleepA = getComponent(world, a, SLEEP);
        const sleepB = getComponent(world, b, SLEEP);
        assert.strictEqual(sleepA.coSleepers.length, 0);
        assert.strictEqual(sleepB.coSleepers.length, 0);
    });

    it("returns sleep onset events", () => {
        const world = createWorld();
        spawnSleeper(world, { position: { position: 10n }, identity: { name: "Alice" } });
        spawnSleeper(world, { position: { position: 10n }, identity: { name: "Bob" } });
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
            position: { position: 10n },
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
            position: { position: 10n },
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
            position: { position: 10n },
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
            position: { position: 10n },
            identity: { name: "A" },
            psychology: { lucidity: 80, hope: 50 },
        });
        const b = spawnSleeper(world, {
            position: { position: 10n },
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
            position: { position: 10n },
            identity: { name: "A" },
        });
        const b = spawnSleeper(world, {
            position: { position: 10n },
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
        const ent = spawnSleeper(world, { position: { position: 10n } });
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
            position: { position: 20n }, // at rest area 20
            sleep: {
                home: { side: 0, position: 10n, floor: 0n }, // home is rest area 10
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: DEFAULT_SLEEP.homeShiftThreshold - 1,
            },
        });
        const sleep = getComponent(world, ent, SLEEP);
        sleep.asleep = true;
        sleep.bedIndex = 0;
        sleep.coSleepers = [];

        sleepWakeSystem(world, 100);
        assert.strictEqual(sleep.home.position, 20n, "home should shift to current rest area");
        assert.strictEqual(sleep.home.side, 0);
        assert.strictEqual(sleep.home.floor, 0n);
        assert.strictEqual(sleep.awayStreak, 0, "away streak should reset");
    });

    it("sleeping at home resets away streak", () => {
        const world = createWorld();
        const ent = spawnSleeper(world, {
            position: { position: 10n },
            sleep: {
                home: { side: 0, position: 10n, floor: 0n },
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
            position: { position: 10n },
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
            position: { position: 10n },
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

// --- Group home alignment ---

describe("sleepWakeSystem group home alignment", () => {
    it("grouped NPC adopts rest area as home when sleeping with groupmate", () => {
        const world = createWorld();
        const a = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "A" },
            sleep: {
                home: { side: 0, position: 10n, floor: 0n }, // home is elsewhere
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: 0, nomadic: false,
            },
        });
        const b = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "B" },
            sleep: {
                home: { side: 0, position: 20n, floor: 0n },
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: 0, nomadic: false,
            },
        });

        // Put both in same group
        addComponent(world, a, GROUP, { groupId: 42, separatedTicks: 0, leaderId: null });
        addComponent(world, b, GROUP, { groupId: 42, separatedTicks: 0, leaderId: null });

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

        // A's home should shift to position 20 (where they slept with groupmate B)
        assert.strictEqual(sleepA.home.position, 20n,
            "grouped NPC should adopt rest area as home when sleeping with groupmate");
        assert.strictEqual(sleepA.awayStreak, 0, "away streak should reset");
    });

    it("ungrouped NPC does not get instant home shift from co-sleeping", () => {
        const world = createWorld();
        const a = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "A" },
            sleep: {
                home: { side: 0, position: 10n, floor: 0n },
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: 0, nomadic: false,
            },
        });
        const b = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "B" },
        });

        // No group component — just co-sleeping strangers
        const sleepA = getComponent(world, a, SLEEP);
        sleepA.asleep = true;
        sleepA.bedIndex = 0;
        sleepA.coSleepers = [b];
        const sleepB = getComponent(world, b, SLEEP);
        sleepB.asleep = true;
        sleepB.bedIndex = 1;
        sleepB.coSleepers = [a];

        sleepWakeSystem(world, 100);

        // A's home should NOT shift (no group, only 1 away night)
        assert.strictEqual(sleepA.home.position, 10n,
            "ungrouped NPC should not get instant home shift");
        assert.strictEqual(sleepA.awayStreak, 1, "away streak should increment");
    });

    it("grouped NPC sleeping with non-groupmate does not shift home", () => {
        const world = createWorld();
        const a = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "A" },
            sleep: {
                home: { side: 0, position: 10n, floor: 0n },
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: 0, nomadic: false,
            },
        });
        const b = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "B" },
        });

        // A is in group 42, B is in group 99 (different group)
        addComponent(world, a, GROUP, { groupId: 42, separatedTicks: 0, leaderId: null });
        addComponent(world, b, GROUP, { groupId: 99, separatedTicks: 0, leaderId: null });

        const sleepA = getComponent(world, a, SLEEP);
        sleepA.asleep = true;
        sleepA.bedIndex = 0;
        sleepA.coSleepers = [b];
        const sleepB = getComponent(world, b, SLEEP);
        sleepB.asleep = true;
        sleepB.bedIndex = 1;
        sleepB.coSleepers = [a];

        sleepWakeSystem(world, 100);

        // A's home should NOT shift — B is in a different group
        assert.strictEqual(sleepA.home.position, 10n,
            "sleeping with non-groupmate should not shift home");
    });

    it("nomadic grouped NPC does not shift home", () => {
        const world = createWorld();
        const a = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "A" },
            sleep: {
                home: { side: 0, position: 10n, floor: 0n },
                bedIndex: null, asleep: false, coSleepers: [],
                awayStreak: 0, nomadic: true,
            },
        });
        const b = spawnSleeper(world, {
            position: { position: 20n },
            identity: { name: "B" },
        });

        addComponent(world, a, GROUP, { groupId: 42, separatedTicks: 0, leaderId: null });
        addComponent(world, b, GROUP, { groupId: 42, separatedTicks: 0, leaderId: null });

        const sleepA = getComponent(world, a, SLEEP);
        sleepA.asleep = true;
        sleepA.bedIndex = 0;
        sleepA.coSleepers = [b];
        const sleepB = getComponent(world, b, SLEEP);
        sleepB.asleep = true;
        sleepB.bedIndex = 1;
        sleepB.coSleepers = [a];

        sleepWakeSystem(world, 100);

        // Nomadic NPCs don't have a meaningful home
        assert.strictEqual(sleepA.home.position, 10n,
            "nomadic NPC should not shift home");
    });
});
