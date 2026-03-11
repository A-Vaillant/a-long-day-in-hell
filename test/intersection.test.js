/**
 * Entity intersection tests.
 *
 * Tests lib/intersection.core.ts spatial hash and intersection detection.
 * Also validates that existing ECS systems produce expected cross-entity
 * effects as reference for the coroutine intersection handler.
 *
 * Run: node --test test/intersection.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import {
    spatialKey, buildSpatialHash, findIntersections,
    findNearby, hasNearby, couldIntersect, processIntersections,
} from "../lib/intersection.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, AI, GROUP,
    psychologyDecaySystem, relationshipSystem, groupFormationSystem,
    socialPressureSystem, buildLocationIndex, deriveDisposition,
    getOrCreateBond, hasMutualBond, segmentDistance,
    DEFAULT_THRESHOLDS, DEFAULT_BOND, DEFAULT_DECAY,
} from "../lib/social.core.ts";
import { PERSONALITY, generatePersonality } from "../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../lib/belief.core.ts";
import { STATS, generateStats, influenceMod } from "../lib/stats.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

const SEED = "intersection-test";

// --- Helpers ---

function makeNpc(world, opts = {}) {
    const {
        name = "NPC", side = 0, position = 5n, floor = 10n,
        lucidity = 80, hope = 70,
    } = opts;
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive: true });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, AI, {});
    addComponent(world, e, HABITUATION, { exposures: new Map() });

    const persRng = seedFromString(SEED + ":pers:" + name);
    addComponent(world, e, PERSONALITY, generatePersonality(persRng));
    const beliefRng = seedFromString(SEED + ":belief:" + name);
    addComponent(world, e, BELIEF, generateBelief(beliefRng));
    const statsRng = seedFromString(SEED + ":stats:" + name);
    addComponent(world, e, STATS, generateStats(statsRng));

    return e;
}

// ============================================================
// Spatial proximity — when entities share a segment
// ============================================================

describe("intersection: spatial proximity", () => {
    it("co-located entities (same side/floor/segment) should interact", () => {
        const w = createWorld();
        const a = makeNpc(w, { name: "A", position: 5n, floor: 10n });
        const b = makeNpc(w, { name: "B", position: 5n, floor: 10n });

        // Run relationship system — co-located, bonds should form
        relationshipSystem(w, 100, undefined, undefined, 50);

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const bondToB = relsA.bonds.get(b);
        assert.ok(bondToB, "co-located entities should form bond");
        assert.ok(bondToB.familiarity > 0, "familiarity should accumulate");
    });

    it("entities on different floors do NOT interact", () => {
        const w = createWorld();
        const a = makeNpc(w, { name: "A", position: 5n, floor: 10n });
        const b = makeNpc(w, { name: "B", position: 5n, floor: 11n });

        relationshipSystem(w, 100, undefined, undefined, 50);

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const bondToB = relsA.bonds.get(b);
        // Different floors — should NOT accumulate (may exist but zero)
        if (bondToB) {
            assert.ok(bondToB.familiarity < 0.01,
                "entities on different floors should not accumulate bonds");
        }
    });

    it("entities on different sides do NOT interact", () => {
        const w = createWorld();
        const a = makeNpc(w, { name: "A", side: 0, position: 5n, floor: 10n });
        const b = makeNpc(w, { name: "B", side: 1, position: 5n, floor: 10n });

        relationshipSystem(w, 100, undefined, undefined, 50);

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const bondToB = relsA.bonds.get(b);
        if (bondToB) {
            assert.ok(bondToB.familiarity < 0.01,
                "entities on different sides should not accumulate bonds");
        }
    });

    it("entities several segments apart do NOT accumulate bonds", () => {
        const w = createWorld();
        const a = makeNpc(w, { name: "A", position: 5n, floor: 10n });
        const b = makeNpc(w, { name: "B", position: 50n, floor: 10n });

        relationshipSystem(w, 100, undefined, undefined, 50);

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const bondToB = relsA.bonds.get(b);
        if (bondToB) {
            assert.ok(bondToB.familiarity < 0.01,
                "distant entities should not accumulate bonds");
        }
    });
});

// ============================================================
// Group formation from intersection
// ============================================================

describe("intersection: group formation", () => {
    it("two NPCs with sufficient mutual bonds form a group", () => {
        const w = createWorld();
        const a = makeNpc(w, { name: "A", position: 5n, floor: 10n });
        const b = makeNpc(w, { name: "B", position: 5n, floor: 10n });

        // Build bonds over time
        for (let i = 0; i < 200; i++) {
            relationshipSystem(w, 100 + i, undefined, undefined, 1);
            groupFormationSystem(w);
        }

        const gA = getComponent(w, a, GROUP);
        const gB = getComponent(w, b, GROUP);
        // At least one should have a group after 200 ticks of co-location
        const eitherGrouped = (gA && gA.groupId !== undefined) || (gB && gB.groupId !== undefined);
        assert.ok(eitherGrouped, "co-located NPCs should eventually form a group");

        if (gA && gB) {
            assert.strictEqual(gA.groupId, gB.groupId, "both should be in same group");
        }
    });

    it("group does NOT form between distant NPCs", () => {
        const w = createWorld();
        const a = makeNpc(w, { name: "A", position: 5n, floor: 10n });
        const b = makeNpc(w, { name: "B", position: 500n, floor: 10n });

        for (let i = 0; i < 200; i++) {
            relationshipSystem(w, 100 + i, undefined, undefined, 1);
            groupFormationSystem(w);
        }

        const gA = getComponent(w, a, GROUP);
        const gB = getComponent(w, b, GROUP);
        // Distant NPCs should NOT form a group
        if (gA && gB) {
            assert.notStrictEqual(gA.groupId, gB.groupId,
                "distant NPCs should not share a group");
        }
    });
});

// ============================================================
// Social pressure at intersection
// ============================================================

describe("intersection: social pressure", () => {
    it("mad NPC applies lucidity pressure to co-located non-mad NPC", () => {
        const w = createWorld();
        // lucidity < 40 = mad, but hope must be > 15 to avoid catatonic (which doesn't exert pressure)
        const mad = makeNpc(w, { name: "Mad", position: 5n, floor: 10n, lucidity: 10, hope: 30 });
        const sane = makeNpc(w, { name: "Sane", position: 5n, floor: 10n, lucidity: 80, hope: 70 });

        const psychBefore = getComponent(w, sane, PSYCHOLOGY).lucidity;

        socialPressureSystem(w, undefined, undefined, undefined, 100);

        const psychAfter = getComponent(w, sane, PSYCHOLOGY).lucidity;
        assert.ok(psychAfter < psychBefore,
            `sane NPC lucidity should decrease: ${psychBefore} → ${psychAfter}`);
    });

    it("mad NPC does NOT affect distant NPCs", () => {
        const w = createWorld();
        const mad = makeNpc(w, { name: "Mad", position: 5n, floor: 10n, lucidity: 10, hope: 10 });
        const sane = makeNpc(w, { name: "Sane", position: 500n, floor: 10n, lucidity: 80, hope: 70 });

        const psychBefore = getComponent(w, sane, PSYCHOLOGY).lucidity;

        socialPressureSystem(w, undefined, undefined, undefined, 100);

        const psychAfter = getComponent(w, sane, PSYCHOLOGY).lucidity;
        assert.strictEqual(psychAfter, psychBefore,
            "distant sane NPC should be unaffected by mad NPC");
    });

    it("catatonic NPCs are immune to social pressure", () => {
        const w = createWorld();
        const mad = makeNpc(w, { name: "Mad", position: 5n, floor: 10n, lucidity: 10, hope: 10 });
        const catatonic = makeNpc(w, { name: "Cat", position: 5n, floor: 10n, lucidity: 5, hope: 5 });

        const psychBefore = getComponent(w, catatonic, PSYCHOLOGY).lucidity;

        socialPressureSystem(w, undefined, undefined, undefined, 100);

        const psychAfter = getComponent(w, catatonic, PSYCHOLOGY).lucidity;
        assert.strictEqual(psychAfter, psychBefore,
            "catatonic NPCs should not be affected by pressure");
    });
});

// ============================================================
// Intersection rarity at cosmic distances
// ============================================================

describe("intersection: cosmic distances", () => {
    it("NPCs spawned far apart have zero interaction over 10k ticks", () => {
        const w = createWorld();
        const a = makeNpc(w, { name: "A", position: 0n, floor: 100n });
        const b = makeNpc(w, { name: "B", position: 10000n, floor: 200n });

        const psychA_before = { ...getComponent(w, a, PSYCHOLOGY) };
        const psychB_before = { ...getComponent(w, b, PSYCHOLOGY) };

        for (let i = 0; i < 100; i++) {
            relationshipSystem(w, i, undefined, undefined, 100);
            socialPressureSystem(w, undefined, undefined, undefined, 100);
        }

        // No bonds, no pressure effects
        const relsA = getComponent(w, a, RELATIONSHIPS);
        const bondToB = relsA.bonds.get(b);
        assert.ok(!bondToB || bondToB.familiarity < 0.01,
            "cosmically distant NPCs should have no bond");
    });

    it("segment distance calculation works for BigInt positions", () => {
        const d1 = segmentDistance(
            { side: 0, position: 0n, floor: 0n },
            { side: 0, position: 100n, floor: 0n },
        );
        assert.strictEqual(d1, 100);

        const d2 = segmentDistance(
            { side: 0, position: 0n, floor: 0n },
            { side: 1, position: 0n, floor: 0n },
        );
        // Different sides — should be a large distance
        assert.ok(d2 > 100, "cross-chasm distance should be large");
    });
});

// ============================================================
// Two entities passing through same segment during movement
// ============================================================

describe("intersection: passing entities", () => {
    it("entities moving toward each other will share a segment", () => {
        // This test validates the concept, not the coroutine implementation.
        // Two NPCs start 10 segments apart. One walks right, one walks left.
        // After 5 ticks, they should be at the same segment.
        const startA = 0n;
        const startB = 10n;

        // Simulate: A moves right (+1/tick), B moves left (-1/tick)
        let posA = startA;
        let posB = startB;
        let intersected = false;

        for (let t = 0; t < 10; t++) {
            posA += 1n;
            posB -= 1n;
            if (posA === posB) {
                intersected = true;
                break;
            }
        }

        assert.ok(intersected, "approaching entities should intersect");
        assert.strictEqual(posA, 5n, "intersection at midpoint");
    });

    it("maxSkip=1 catches all intersections (reference)", () => {
        // With maxSkip=1, the scheduler advances entities one tick at a time.
        // This is equivalent to per-tick simulation and catches every co-location.
        // This is the baseline that larger maxSkip values must approximate.
        let posA = 0n;
        let posB = 20n;
        let headingA = 1;
        let headingB = -1;
        let intersections = 0;

        for (let t = 0; t < 20; t++) {
            posA += BigInt(headingA);
            posB += BigInt(headingB);
            if (posA === posB) intersections++;
        }

        assert.strictEqual(intersections, 1, "exactly one intersection point");
    });

    it("maxSkip=10 may miss intersection of fast-approaching entities", () => {
        // With maxSkip=10, entities jump 10 segments per step.
        // Two entities 5 apart, moving toward each other, could skip past.
        let posA = 0n;
        let posB = 5n;
        const maxSkip = 10;

        // Batch: A jumps to 10, B jumps to -5. They never share a position.
        posA += BigInt(maxSkip);
        posB -= BigInt(maxSkip);

        const missed = posA !== posB;
        assert.ok(missed, "large maxSkip can miss close intersections");
        // This demonstrates why maxSkip must be tuned based on approach speed.
    });
});

// ============================================================
// Intersection module: spatial hash
// ============================================================

describe("intersection: spatialKey", () => {
    it("produces identical keys for same position", () => {
        const a = spatialKey({ side: 0, position: 5n, floor: 10n });
        const b = spatialKey({ side: 0, position: 5n, floor: 10n });
        assert.strictEqual(a, b);
    });

    it("produces different keys for different positions", () => {
        const a = spatialKey({ side: 0, position: 5n, floor: 10n });
        const b = spatialKey({ side: 0, position: 6n, floor: 10n });
        assert.notStrictEqual(a, b);
    });

    it("distinguishes side", () => {
        const a = spatialKey({ side: 0, position: 5n, floor: 10n });
        const b = spatialKey({ side: 1, position: 5n, floor: 10n });
        assert.notStrictEqual(a, b);
    });

    it("distinguishes floor", () => {
        const a = spatialKey({ side: 0, position: 5n, floor: 10n });
        const b = spatialKey({ side: 0, position: 5n, floor: 11n });
        assert.notStrictEqual(a, b);
    });
});

describe("intersection: buildSpatialHash + findIntersections", () => {
    it("finds co-located entity pairs", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 5n, floor: 10n } },
        ];
        const hash = buildSpatialHash(entities);
        const pairs = findIntersections(hash);
        assert.strictEqual(pairs.length, 1);
        assert.strictEqual(pairs[0].a.id, "a");
        assert.strictEqual(pairs[0].b.id, "b");
    });

    it("no intersections when entities are apart", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 6n, floor: 10n } },
        ];
        const hash = buildSpatialHash(entities);
        const pairs = findIntersections(hash);
        assert.strictEqual(pairs.length, 0);
    });

    it("finds all pairs for 3 co-located entities", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "c", pos: { side: 0, position: 5n, floor: 10n } },
        ];
        const hash = buildSpatialHash(entities);
        const pairs = findIntersections(hash);
        // 3 choose 2 = 3 pairs
        assert.strictEqual(pairs.length, 3);
    });

    it("handles multiple buckets independently", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "c", pos: { side: 0, position: 100n, floor: 20n } },
            { id: "d", pos: { side: 0, position: 100n, floor: 20n } },
        ];
        const hash = buildSpatialHash(entities);
        const pairs = findIntersections(hash);
        assert.strictEqual(pairs.length, 2, "two separate pairs");
    });

    it("empty entities list produces no intersections", () => {
        const hash = buildSpatialHash([]);
        assert.strictEqual(findIntersections(hash).length, 0);
    });
});

describe("intersection: findNearby", () => {
    it("finds entities within range", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 7n, floor: 10n } },
            { id: "c", pos: { side: 0, position: 50n, floor: 10n } },
        ];
        const hash = buildSpatialHash(entities);
        const nearby = findNearby(hash, { side: 0, position: 5n, floor: 10n }, 3);
        const ids = nearby.map(e => e.id);
        assert.ok(ids.includes("a"), "self included");
        assert.ok(ids.includes("b"), "b within range");
        assert.ok(!ids.includes("c"), "c too far");
    });

    it("does not find entities on different floor", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 5n, floor: 11n } },
        ];
        const hash = buildSpatialHash(entities);
        const nearby = findNearby(hash, { side: 0, position: 5n, floor: 10n }, 3);
        assert.strictEqual(nearby.length, 1, "only self on this floor");
    });
});

describe("intersection: hasNearby", () => {
    it("returns true when entity is nearby", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 7n, floor: 10n } },
        ];
        const hash = buildSpatialHash(entities);
        assert.ok(hasNearby(hash, { side: 0, position: 5n, floor: 10n }, 3, "a"));
    });

    it("returns false when no entity is nearby (excluding self)", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
        ];
        const hash = buildSpatialHash(entities);
        assert.ok(!hasNearby(hash, { side: 0, position: 5n, floor: 10n }, 3, "a"));
    });
});

describe("intersection: couldIntersect (sweep)", () => {
    it("detects head-on approach", () => {
        const result = couldIntersect(
            { side: 0, position: 0n, floor: 10n },   // a: was at 0
            { side: 0, position: 10n, floor: 10n },  // a: now at 10
            { side: 0, position: 15n, floor: 10n },  // b: was at 15
            { side: 0, position: 5n, floor: 10n },   // b: now at 5
        );
        assert.ok(result, "ranges [0,10] and [5,15] overlap");
    });

    it("rejects non-overlapping ranges", () => {
        const result = couldIntersect(
            { side: 0, position: 0n, floor: 10n },
            { side: 0, position: 5n, floor: 10n },
            { side: 0, position: 10n, floor: 10n },
            { side: 0, position: 15n, floor: 10n },
        );
        assert.ok(!result, "ranges [0,5] and [10,15] do not overlap");
    });

    it("rejects different floors", () => {
        const result = couldIntersect(
            { side: 0, position: 0n, floor: 10n },
            { side: 0, position: 10n, floor: 10n },
            { side: 0, position: 5n, floor: 11n },
            { side: 0, position: 5n, floor: 11n },
        );
        assert.ok(!result, "different floors cannot intersect");
    });

    it("rejects different sides", () => {
        const result = couldIntersect(
            { side: 0, position: 0n, floor: 10n },
            { side: 0, position: 10n, floor: 10n },
            { side: 1, position: 5n, floor: 10n },
            { side: 1, position: 5n, floor: 10n },
        );
        assert.ok(!result, "different sides cannot intersect");
    });

    it("detects touching ranges", () => {
        const result = couldIntersect(
            { side: 0, position: 0n, floor: 10n },
            { side: 0, position: 5n, floor: 10n },
            { side: 0, position: 5n, floor: 10n },
            { side: 0, position: 10n, floor: 10n },
        );
        assert.ok(result, "ranges [0,5] and [5,10] touch at 5");
    });

    it("rejects entity that changed floor during interval", () => {
        const result = couldIntersect(
            { side: 0, position: 0n, floor: 10n },
            { side: 0, position: 5n, floor: 11n },  // changed floor
            { side: 0, position: 3n, floor: 10n },
            { side: 0, position: 3n, floor: 10n },
        );
        assert.ok(!result, "floor change during interval → skip");
    });
});

describe("intersection: processIntersections", () => {
    it("calls handler for each intersection pair", () => {
        const entities = [
            { id: "a", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "b", pos: { side: 0, position: 5n, floor: 10n } },
            { id: "c", pos: { side: 0, position: 5n, floor: 10n } },
        ];
        const hash = buildSpatialHash(entities);
        const pairs = findIntersections(hash);

        const called = [];
        processIntersections(pairs, (ix, ticks) => {
            called.push({ a: ix.a.id, b: ix.b.id, ticks });
        }, 5);

        assert.strictEqual(called.length, 3);
        assert.strictEqual(called[0].ticks, 5);
    });
});
