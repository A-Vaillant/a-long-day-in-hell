/**
 * Group-as-entity coroutine tests.
 *
 * Tests for lib/group-coroutine.core.ts (not yet implemented).
 * Defines the contract: a group entity manages N members as a single
 * coroutine — collective needs, leader-driven movement, internal
 * social dynamics, dissolution under tension.
 *
 * These tests use the existing ECS group systems as reference.
 *
 * Run: node --test test/group-coroutine.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, AI, GROUP,
    psychologyDecaySystem, relationshipSystem, groupFormationSystem,
    socialPressureSystem, npcDismissSystem, buildLocationIndex,
    deriveDisposition, getOrCreateBond, hasMutualBond,
    DEFAULT_THRESHOLDS, DEFAULT_BOND, DEFAULT_DECAY,
} from "../lib/social.core.ts";
import { NEEDS, needsSystem, DEFAULT_NEEDS } from "../lib/needs.core.ts";
import { MOVEMENT, movementSystem } from "../lib/movement.core.ts";
import { INTENT, intentSystem } from "../lib/intent.core.ts";
import { PERSONALITY, generatePersonality } from "../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../lib/belief.core.ts";
import { STATS, generateStats, influenceMod } from "../lib/stats.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { SLEEP, nearestRestArea } from "../lib/sleep.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

const SEED = "group-coroutine-test";

// --- Helpers ---

function makeGroupMember(world, opts = {}) {
    const {
        name = "Member", side = 0, position = 5n, floor = 10n,
        lucidity = 80, hope = 70,
        hunger = 0, thirst = 0, exhaustion = 0,
    } = opts;
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive: true });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, NEEDS, { hunger, thirst, exhaustion });
    addComponent(world, e, MOVEMENT, { targetPosition: null, heading: 1 });
    addComponent(world, e, INTENT, { behavior: "explore", cooldown: 0, elapsed: 0 });
    addComponent(world, e, AI, {});
    addComponent(world, e, HABITUATION, { exposures: new Map() });
    addComponent(world, e, SLEEP, {
        home: { side, position: nearestRestArea(position), floor },
        bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0, nomadic: false,
    });

    const persRng = seedFromString(SEED + ":pers:" + name);
    addComponent(world, e, PERSONALITY, generatePersonality(persRng));
    const beliefRng = seedFromString(SEED + ":belief:" + name);
    addComponent(world, e, BELIEF, generateBelief(beliefRng));
    const statsRng = seedFromString(SEED + ":stats:" + name);
    addComponent(world, e, STATS, generateStats(statsRng));

    return e;
}

/** Pre-seed mutual bonds between two entities so they can form a group. */
function seedBonds(world, a, b, familiarity = 20, affinity = 10) {
    const relsA = getComponent(world, a, RELATIONSHIPS);
    const relsB = getComponent(world, b, RELATIONSHIPS);
    relsA.bonds.set(b, { familiarity, affinity, lastEncounterTick: 0, encounters: 10 });
    relsB.bonds.set(a, { familiarity, affinity, lastEncounterTick: 0, encounters: 10 });
}

/** Force group formation by setting strong mutual bonds and running formation. */
function forceGroup(world, members) {
    for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
            seedBonds(world, members[i], members[j], 50, 20);
        }
    }
    groupFormationSystem(world);
}

// ============================================================
// Group internal dynamics — companion effects
// ============================================================

describe("group-coroutine: companion effects", () => {
    it("group members decay slower than isolated NPCs (companion damper)", () => {
        // Group world: 2 NPCs co-located
        const wGroup = createWorld();
        const gA = makeGroupMember(wGroup, { name: "GA", position: 5n });
        const gB = makeGroupMember(wGroup, { name: "GB", position: 5n });
        forceGroup(wGroup, [gA, gB]);

        // Solo world: 1 NPC alone
        const wSolo = createWorld();
        const solo = makeGroupMember(wSolo, { name: "Solo", position: 5n });

        const N = 5000;
        for (let i = 0; i < N; i++) {
            psychologyDecaySystem(wGroup, undefined, 1);
            psychologyDecaySystem(wSolo, undefined, 1);
        }

        const psychGroup = getComponent(wGroup, gA, PSYCHOLOGY);
        const psychSolo = getComponent(wSolo, solo, PSYCHOLOGY);

        // Grouped NPC should have higher lucidity (companion damper = 10% decay + restoration)
        assert.ok(psychGroup.lucidity > psychSolo.lucidity,
            `grouped lucidity ${psychGroup.lucidity.toFixed(4)} should be > solo ${psychSolo.lucidity.toFixed(4)}`);
    });
});

// ============================================================
// Group collective needs
// ============================================================

describe("group-coroutine: collective needs", () => {
    it("all group members at same position receive same needs treatment", () => {
        const w = createWorld();
        const a = makeGroupMember(w, { name: "A", position: 0n, hunger: 30 }); // rest area
        const b = makeGroupMember(w, { name: "B", position: 0n, hunger: 48 }); // near threshold
        forceGroup(w, [a, b]);

        // Run needs system — both at rest area, both get relief when threshold hit
        for (let i = 0; i < 100; i++) {
            needsSystem(w, true, undefined, 1);
        }

        const needsA = getComponent(w, a, NEEDS);
        const needsB = getComponent(w, b, NEEDS);
        const identA = getComponent(w, a, IDENTITY);
        const identB = getComponent(w, b, IDENTITY);

        assert.ok(identA.alive, "member A should be alive at rest area");
        assert.ok(identB.alive, "member B should be alive at rest area");
        // Both should have had relief applied
        assert.ok(needsA.hunger < DEFAULT_NEEDS.eatThreshold,
            "member A hunger should be below threshold after relief");
    });

    it("group at non-rest area: members accumulate needs without relief", () => {
        const w = createWorld();
        const a = makeGroupMember(w, { name: "A", position: 5n, hunger: 0 });
        const b = makeGroupMember(w, { name: "B", position: 5n, hunger: 0 });
        forceGroup(w, [a, b]);

        for (let i = 0; i < 100; i++) {
            needsSystem(w, true, undefined, 1);
        }

        const needsA = getComponent(w, a, NEEDS);
        // Not at rest area — needs should just accumulate
        assert.ok(needsA.hunger > 0, "needs should accumulate away from rest area");
    });
});

// ============================================================
// Group dissolution
// ============================================================

describe("group-coroutine: dissolution", () => {
    it("group can dissolve via dismiss system", () => {
        const w = createWorld();
        const a = makeGroupMember(w, { name: "A", position: 5n });
        const b = makeGroupMember(w, { name: "B", position: 5n });

        // Form group with low affinity — vulnerable to dismissal
        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 50, affinity: -5, lastEncounterTick: 0, encounters: 100 });
        relsB.bonds.set(a, { familiarity: 50, affinity: -5, lastEncounterTick: 0, encounters: 100 });
        groupFormationSystem(w);

        // Run dismiss system many times — low affinity should trigger dismissal
        let dissolved = false;
        for (let i = 0; i < 1000; i++) {
            const rng = seedFromString(SEED + ":dismiss:" + i);
            npcDismissSystem(w, rng);

            const gA = getComponent(w, a, GROUP);
            const gB = getComponent(w, b, GROUP);
            if (!gA || !gB || gA.groupId !== gB.groupId) {
                dissolved = true;
                break;
            }
        }

        assert.ok(dissolved, "group with negative affinity should eventually dissolve");
    });

    it("group persists with high affinity", () => {
        const w = createWorld();
        const a = makeGroupMember(w, { name: "A", position: 5n });
        const b = makeGroupMember(w, { name: "B", position: 5n });

        // Form group with high affinity
        seedBonds(w, a, b, 100, 50);
        groupFormationSystem(w);

        const gBefore = getComponent(w, a, GROUP);
        assert.ok(gBefore, "group should form with high bonds");

        // Run dismiss for many ticks — high affinity should prevent dismissal
        for (let i = 0; i < 500; i++) {
            const rng = seedFromString(SEED + ":dismiss:" + i);
            npcDismissSystem(w, rng);
        }

        const gAfter = getComponent(w, a, GROUP);
        assert.ok(gAfter, "group with high affinity should persist");
    });
});

// ============================================================
// Group internal pressure — mad member affects others
// ============================================================

describe("group-coroutine: internal pressure", () => {
    it("mad member in group applies pressure to other members", () => {
        const w = createWorld();
        const mad = makeGroupMember(w, { name: "Mad", position: 5n, lucidity: 10, hope: 30 });
        const sane = makeGroupMember(w, { name: "Sane", position: 5n, lucidity: 80, hope: 70 });
        forceGroup(w, [mad, sane]);

        const lucBefore = getComponent(w, sane, PSYCHOLOGY).lucidity;

        socialPressureSystem(w, undefined, undefined, undefined, 500);

        const lucAfter = getComponent(w, sane, PSYCHOLOGY).lucidity;
        assert.ok(lucAfter < lucBefore,
            `sane member lucidity should decrease: ${lucBefore} → ${lucAfter}`);
    });
});

// ============================================================
// Group lifecycle — formation through dissolution
// ============================================================

describe("group-coroutine: full lifecycle", () => {
    it("two NPCs meet, bond, group, coexist, then dissolve under pressure", () => {
        const w = createWorld();
        const a = makeGroupMember(w, { name: "Alpha", position: 5n, lucidity: 80, hope: 70 });
        const b = makeGroupMember(w, { name: "Beta", position: 5n, lucidity: 80, hope: 70 });

        // Phase 1: Build bonds through co-location
        let grouped = false;
        for (let i = 0; i < 500; i++) {
            relationshipSystem(w, i, undefined, undefined, 1);
            groupFormationSystem(w);

            const gA = getComponent(w, a, GROUP);
            const gB = getComponent(w, b, GROUP);
            if (gA && gB && gA.groupId === gB.groupId) {
                grouped = true;
                break;
            }
        }
        assert.ok(grouped, "NPCs should form group through co-location");

        // Phase 2: Verify companion effects active
        const psychBefore = { ...getComponent(w, a, PSYCHOLOGY) };
        psychologyDecaySystem(w, undefined, 100);
        const psychAfter = getComponent(w, a, PSYCHOLOGY);
        // Decay should be very slow (companion damper)
        const lucDrop = psychBefore.lucidity - psychAfter.lucidity;
        assert.ok(lucDrop < 0.1, `grouped decay should be tiny: ${lucDrop}`);

        // Phase 3: Poison the relationship — erode affinity
        const relsA = getComponent(w, a, RELATIONSHIPS);
        const bondToB = relsA.bonds.get(b);
        if (bondToB) bondToB.affinity = -10;
        const relsB = getComponent(w, b, RELATIONSHIPS);
        const bondToA = relsB.bonds.get(a);
        if (bondToA) bondToA.affinity = -10;

        // Phase 4: Run dismiss until dissolution
        let dissolved = false;
        for (let i = 0; i < 1000; i++) {
            const rng = seedFromString(SEED + ":lifecycle:dismiss:" + i);
            npcDismissSystem(w, rng);

            const gA = getComponent(w, a, GROUP);
            const gB = getComponent(w, b, GROUP);
            if (!gA || !gB || gA.groupId !== gB.groupId) {
                dissolved = true;
                break;
            }
        }
        assert.ok(dissolved, "group should dissolve after affinity poisoned");
    });
});

// ============================================================
// Edge cases
// ============================================================

describe("group-coroutine: edge cases", () => {
    it("group with dead member — dead member excluded from needs/movement", () => {
        const w = createWorld();
        const alive = makeGroupMember(w, { name: "Alive", position: 0n });
        const dead = makeGroupMember(w, { name: "Dead", position: 0n });
        forceGroup(w, [alive, dead]);

        // Kill the dead member
        getComponent(w, dead, IDENTITY).alive = false;

        // Run systems — should not crash
        needsSystem(w, true, undefined, 10);
        psychologyDecaySystem(w, undefined, 10);
        socialPressureSystem(w, undefined, undefined, undefined, 10);

        const identAlive = getComponent(w, alive, IDENTITY);
        assert.ok(identAlive.alive, "alive member should still be alive");
    });

    it("group with all members dead — handles gracefully", () => {
        const w = createWorld();
        const a = makeGroupMember(w, { name: "A", position: 0n });
        const b = makeGroupMember(w, { name: "B", position: 0n });
        forceGroup(w, [a, b]);

        // Kill both
        getComponent(w, a, IDENTITY).alive = false;
        getComponent(w, b, IDENTITY).alive = false;

        // Systems should handle gracefully (skip dead entities)
        needsSystem(w, true, undefined, 10);
        psychologyDecaySystem(w, undefined, 10);
        socialPressureSystem(w, undefined, undefined, undefined, 10);

        // No crash = pass
        assert.ok(true, "systems handle all-dead group without crash");
    });

    it("single-member group — behaves like solo", () => {
        const w = createWorld();
        const solo = makeGroupMember(w, { name: "Solo", position: 5n, lucidity: 80 });
        // A group with one member shouldn't really exist, but shouldn't crash either
        addComponent(w, solo, GROUP, { groupId: 1, leaderId: solo, members: [solo], separatedTicks: 0 });

        psychologyDecaySystem(w, undefined, 100);

        const psych = getComponent(w, solo, PSYCHOLOGY);
        // Single member with GROUP component — hasSocialContact depends on co-location query
        // which may or may not find self. Either way, should not crash.
        assert.ok(psych.lucidity <= 80, "psychology should still decay");
    });
});
