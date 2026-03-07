import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP, PLAYER, AI,
    DEFAULT_THRESHOLDS, DEFAULT_DECAY, DEFAULT_BOND, DEFAULT_GROUP, DEFAULT_AWARENESS,
    deriveDisposition,
    decayPsychology,
    hasSocialContact,
    psychologyDecaySystem,
    coLocated,
    segmentDistance,
    canSeeAcrossChasm,
    canHear,
    canSee,
    getVisibleEntities,
    getNearbyEntities,
    getOrCreateBond,
    accumulateBond,
    decayBond,
    relationshipSystem,
    hasMutualBond,
    groupFormationSystem,
    getCompanion,
    modifyAffinity,
    applyShock,
    socialPressureSystem,
} from "../lib/social.core.ts";

// --- Helpers ---

function makeEntity(world, { name = "Test", alive = true, lucidity = 100, hope = 100,
                              side = 0, position = 0, floor = 0, player = false } = {}) {
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    if (player) addComponent(world, e, PLAYER, {});
    else addComponent(world, e, AI, {});
    return e;
}

// --- deriveDisposition ---

describe("deriveDisposition", () => {
    it("returns 'dead' when not alive", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 100, hope: 100 }, false), "dead");
    });

    it("returns 'calm' when both stats are high", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 100, hope: 100 }, true), "calm");
    });

    it("returns 'calm' at exact boundary (lucidity=61, hope=41)", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 61, hope: 41 }, true), "calm");
    });

    it("returns 'anxious' when lucidity is below anxious threshold", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 55, hope: 80 }, true), "anxious");
    });

    it("returns 'anxious' when hope is below anxious threshold", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 80, hope: 35 }, true), "anxious");
    });

    it("returns 'anxious' at exact anxious boundary (lucidity=60)", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 60, hope: 80 }, true), "anxious");
    });

    it("returns 'anxious' at exact anxious boundary (hope=40)", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 80, hope: 40 }, true), "anxious");
    });

    it("returns 'mad' when lucidity drops below mad threshold", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 30, hope: 80 }, true), "mad");
    });

    it("returns 'mad' at exact mad boundary (lucidity=40)", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 40, hope: 80 }, true), "mad");
    });

    it("returns 'catatonic' when hope is very low", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 80, hope: 10 }, true), "catatonic");
    });

    it("returns 'catatonic' at exact boundary (hope=15)", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 80, hope: 15 }, true), "catatonic");
    });

    it("catatonic takes priority over mad (both low)", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 10, hope: 5 }, true), "catatonic");
    });

    it("returns 'mad' when lucidity low but hope above catatonic threshold", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 10, hope: 20 }, true), "mad");
    });

    it("custom thresholds override defaults", () => {
        const t = { catatonicHope: 30, madLucidity: 50, anxiousLucidity: 70, anxiousHope: 50 };
        assert.strictEqual(deriveDisposition({ lucidity: 60, hope: 80 }, true, t), "anxious");
        assert.strictEqual(deriveDisposition({ lucidity: 45, hope: 80 }, true, t), "mad");
        assert.strictEqual(deriveDisposition({ lucidity: 80, hope: 25 }, true, t), "catatonic");
        assert.strictEqual(deriveDisposition({ lucidity: 80, hope: 60 }, true, t), "calm");
    });

    it("lucidity=0, hope=0 → catatonic (not mad)", () => {
        assert.strictEqual(deriveDisposition({ lucidity: 0, hope: 0 }, true), "catatonic");
    });
});

// --- decayPsychology ---

describe("decayPsychology", () => {
    it("decays both stats when isolated", () => {
        const psych = { lucidity: 100, hope: 100 };
        decayPsychology(psych, false);
        assert.ok(psych.lucidity < 100);
        assert.ok(psych.hope < 100);
    });

    it("decays slower with social contact", () => {
        const isolated = { lucidity: 100, hope: 100 };
        const social = { lucidity: 100, hope: 100 };
        decayPsychology(isolated, false);
        decayPsychology(social, true);
        assert.ok(social.lucidity > isolated.lucidity, "social lucidity should be higher");
        assert.ok(social.hope > isolated.hope, "social hope should be higher");
    });

    it("respects floor values", () => {
        const psych = { lucidity: 0.001, hope: 0.001 };
        decayPsychology(psych, false);
        assert.ok(psych.lucidity >= 0);
        assert.ok(psych.hope >= 0);
    });

    it("already at zero stays at zero", () => {
        const psych = { lucidity: 0, hope: 0 };
        decayPsychology(psych, false);
        assert.strictEqual(psych.lucidity, 0);
        assert.strictEqual(psych.hope, 0);
    });

    it("uses custom config", () => {
        const config = { ...DEFAULT_DECAY, lucidityBase: 10, hopeBase: 10,
                         isolationMultiplier: 1, companionDamper: 1,
                         lucidityFloor: 50, hopeFloor: 50 };
        const psych = { lucidity: 55, hope: 55 };
        decayPsychology(psych, false, config);
        assert.strictEqual(psych.lucidity, 50); // clamped to floor
        assert.strictEqual(psych.hope, 50);
    });

    it("mutates in place and returns same reference", () => {
        const psych = { lucidity: 100, hope: 100 };
        const result = decayPsychology(psych, false);
        assert.strictEqual(result, psych);
    });
});

// --- hasSocialContact ---

describe("hasSocialContact", () => {
    it("returns false for entity with no bonds", () => {
        const w = createWorld();
        const e = makeEntity(w);
        assert.strictEqual(hasSocialContact(w, e), false);
    });

    it("returns false for entity with no relationships component", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, POSITION, { side: 0, position: 0, floor: 0 });
        assert.strictEqual(hasSocialContact(w, e), false);
    });

    it("returns false for entity with no position component", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, RELATIONSHIPS, { bonds: new Map() });
        assert.strictEqual(hasSocialContact(w, e), false);
    });

    it("returns true when co-located with bonded alive entity", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        // Create bond A→B
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: 3, lastContact: 0 });
        assert.strictEqual(hasSocialContact(w, a), true);
    });

    it("returns false when bond exists but other entity is dead", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B", alive: false });
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: 3, lastContact: 0 });
        assert.strictEqual(hasSocialContact(w, a), false);
    });

    it("returns true when bond exists and within hearing range", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 2 }); // within default hear range (3)
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: 3, lastContact: 0 });
        assert.strictEqual(hasSocialContact(w, a), true);
    });

    it("returns false when bond exists but beyond hearing range", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 5 }); // beyond default hear range (3)
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: 3, lastContact: 0 });
        assert.strictEqual(hasSocialContact(w, a), false);
    });

    it("returns false when bond has zero familiarity", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 0, affinity: 3, lastContact: 0 });
        assert.strictEqual(hasSocialContact(w, a), false);
    });

    it("returns false when bond has zero affinity", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: 0, lastContact: 0 });
        assert.strictEqual(hasSocialContact(w, a), false);
    });

    it("returns false when bond has negative affinity", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: -10, lastContact: 0 });
        assert.strictEqual(hasSocialContact(w, a), false);
    });
});

// --- psychologyDecaySystem ---

describe("psychologyDecaySystem", () => {
    it("decays all alive entities", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        psychologyDecaySystem(w);
        const pA = getComponent(w, a, PSYCHOLOGY);
        const pB = getComponent(w, b, PSYCHOLOGY);
        assert.ok(pA.lucidity < 100);
        assert.ok(pB.lucidity < 100);
    });

    it("skips dead entities", () => {
        const w = createWorld();
        const dead = makeEntity(w, { name: "Dead", alive: false, lucidity: 50 });
        psychologyDecaySystem(w);
        const p = getComponent(w, dead, PSYCHOLOGY);
        assert.strictEqual(p.lucidity, 50); // unchanged
    });

    it("co-located bonded entities decay slower", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        // Bond A→B with positive familiarity and affinity, co-located
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: 3, lastContact: 0 });

        const alone = makeEntity(w, { name: "Alone", position: 999 });

        psychologyDecaySystem(w);

        const pA = getComponent(w, a, PSYCHOLOGY);
        const pAlone = getComponent(w, alone, PSYCHOLOGY);
        assert.ok(pA.lucidity > pAlone.lucidity, "bonded entity should decay slower");
    });
});

// --- coLocated ---

describe("coLocated", () => {
    it("returns true for identical positions", () => {
        assert.strictEqual(coLocated(
            { side: 0, position: 5, floor: 3 },
            { side: 0, position: 5, floor: 3 },
        ), true);
    });

    it("returns false when side differs", () => {
        assert.strictEqual(coLocated(
            { side: 0, position: 5, floor: 3 },
            { side: 1, position: 5, floor: 3 },
        ), false);
    });

    it("returns false when position differs", () => {
        assert.strictEqual(coLocated(
            { side: 0, position: 5, floor: 3 },
            { side: 0, position: 6, floor: 3 },
        ), false);
    });

    it("returns false when floor differs", () => {
        assert.strictEqual(coLocated(
            { side: 0, position: 5, floor: 3 },
            { side: 0, position: 5, floor: 4 },
        ), false);
    });
});

// --- segmentDistance ---

describe("segmentDistance", () => {
    it("returns 0 for same position", () => {
        assert.strictEqual(segmentDistance(
            { side: 0, position: 5, floor: 3 },
            { side: 0, position: 5, floor: 3 },
        ), 0);
    });

    it("returns absolute difference on same side/floor", () => {
        assert.strictEqual(segmentDistance(
            { side: 0, position: 5, floor: 3 },
            { side: 0, position: 8, floor: 3 },
        ), 3);
    });

    it("returns Infinity for different floors", () => {
        assert.strictEqual(segmentDistance(
            { side: 0, position: 5, floor: 3 },
            { side: 0, position: 5, floor: 4 },
        ), Infinity);
    });

    it("returns Infinity for different sides", () => {
        assert.strictEqual(segmentDistance(
            { side: 0, position: 5, floor: 3 },
            { side: 1, position: 5, floor: 3 },
        ), Infinity);
    });
});

// --- canSeeAcrossChasm ---

describe("canSeeAcrossChasm", () => {
    it("true for same floor different side", () => {
        assert.strictEqual(canSeeAcrossChasm(
            { side: 0, position: 5, floor: 3 },
            { side: 1, position: 5, floor: 3 },
        ), true);
    });

    it("false for same side", () => {
        assert.strictEqual(canSeeAcrossChasm(
            { side: 0, position: 5, floor: 3 },
            { side: 0, position: 10, floor: 3 },
        ), false);
    });

    it("false for different floor", () => {
        assert.strictEqual(canSeeAcrossChasm(
            { side: 0, position: 5, floor: 3 },
            { side: 1, position: 5, floor: 4 },
        ), false);
    });
});

// --- canHear / canSee ---

describe("canHear", () => {
    it("true within hearing range", () => {
        assert.strictEqual(canHear(
            { side: 0, position: 0, floor: 0 },
            { side: 0, position: 3, floor: 0 },
        ), true);
    });

    it("false beyond hearing range", () => {
        assert.strictEqual(canHear(
            { side: 0, position: 0, floor: 0 },
            { side: 0, position: 4, floor: 0 },
        ), false);
    });

    it("false across chasm", () => {
        assert.strictEqual(canHear(
            { side: 0, position: 0, floor: 0 },
            { side: 1, position: 0, floor: 0 },
        ), false);
    });
});

describe("canSee", () => {
    it("true within sight range", () => {
        assert.strictEqual(canSee(
            { side: 0, position: 0, floor: 0 },
            { side: 0, position: 10, floor: 0 },
        ), true);
    });

    it("false beyond sight range", () => {
        assert.strictEqual(canSee(
            { side: 0, position: 0, floor: 0 },
            { side: 0, position: 11, floor: 0 },
        ), false);
    });
});

// --- getVisibleEntities / getNearbyEntities ---

describe("getVisibleEntities", () => {
    it("returns entities within sight range with distance", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 5 });
        const c = makeEntity(w, { name: "C", position: 20 }); // out of range
        const result = getVisibleEntities(w, a);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0][0], b);
        assert.strictEqual(result[0][1], 5);
    });

    it("includes cross-chasm entities with Infinity distance", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", side: 0 });
        const b = makeEntity(w, { name: "B", side: 1 });
        const result = getVisibleEntities(w, a);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0][1], Infinity);
    });

    it("excludes dead entities", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        makeEntity(w, { name: "B", alive: false });
        assert.strictEqual(getVisibleEntities(w, a).length, 0);
    });
});

describe("getNearbyEntities", () => {
    it("returns entities within hearing range", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 2 });
        const c = makeEntity(w, { name: "C", position: 5 }); // out of hear range
        const result = getNearbyEntities(w, a);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0], b);
    });
});

// --- Bond accumulation/decay ---

describe("getOrCreateBond", () => {
    it("creates a new bond with zero stats", () => {
        const rels = { bonds: new Map() };
        const bond = getOrCreateBond(rels, 5, 100);
        assert.strictEqual(bond.familiarity, 0);
        assert.strictEqual(bond.affinity, 0);
        assert.strictEqual(bond.lastContact, 100);
        assert.strictEqual(rels.bonds.size, 1);
    });

    it("returns existing bond without overwriting", () => {
        const rels = { bonds: new Map() };
        rels.bonds.set(5, { familiarity: 20, affinity: 10, lastContact: 50 });
        const bond = getOrCreateBond(rels, 5, 200);
        assert.strictEqual(bond.familiarity, 20);
        assert.strictEqual(bond.lastContact, 50); // not overwritten
    });
});

describe("accumulateBond", () => {
    it("increases familiarity and affinity", () => {
        const bond = { familiarity: 0, affinity: 0, lastContact: 0 };
        accumulateBond(bond, 10);
        assert.ok(bond.familiarity > 0);
        assert.ok(bond.affinity > 0);
        assert.strictEqual(bond.lastContact, 10);
    });

    it("caps at max values", () => {
        const bond = { familiarity: 99.99, affinity: 99.99, lastContact: 0 };
        accumulateBond(bond, 10);
        assert.ok(bond.familiarity <= DEFAULT_BOND.maxFamiliarity);
        assert.ok(bond.affinity <= DEFAULT_BOND.maxAffinity);
    });
});

describe("decayBond", () => {
    it("reduces familiarity slowly", () => {
        const bond = { familiarity: 50, affinity: 20, lastContact: 0 };
        decayBond(bond);
        assert.ok(bond.familiarity < 50);
    });

    it("drifts positive affinity toward zero", () => {
        const bond = { familiarity: 50, affinity: 20, lastContact: 0 };
        decayBond(bond);
        assert.ok(bond.affinity < 20);
        assert.ok(bond.affinity >= 0);
    });

    it("drifts negative affinity toward zero", () => {
        const bond = { familiarity: 50, affinity: -20, lastContact: 0 };
        decayBond(bond);
        assert.ok(bond.affinity > -20);
        assert.ok(bond.affinity <= 0);
    });

    it("zero affinity stays at zero", () => {
        const bond = { familiarity: 50, affinity: 0, lastContact: 0 };
        decayBond(bond);
        assert.strictEqual(bond.affinity, 0);
    });

    it("familiarity floors at zero", () => {
        const bond = { familiarity: 0.0001, affinity: 0, lastContact: 0 };
        decayBond(bond);
        assert.ok(bond.familiarity >= 0);
    });
});

// --- relationshipSystem ---

describe("relationshipSystem", () => {
    it("co-located entities build bonds with each other", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        relationshipSystem(w, 0);

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        assert.ok(relsA.bonds.has(b), "A should have bond to B");
        assert.ok(relsB.bonds.has(a), "B should have bond to A");
        assert.ok(relsA.bonds.get(b).familiarity > 0);
        assert.ok(relsB.bonds.get(a).familiarity > 0);
    });

    it("non-co-located entities do not build bonds", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 10 });

        relationshipSystem(w, 0);

        const relsA = getComponent(w, a, RELATIONSHIPS);
        assert.strictEqual(relsA.bonds.has(b), false);
    });

    it("dead entities are excluded", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B", alive: false });

        relationshipSystem(w, 0);

        const relsA = getComponent(w, a, RELATIONSHIPS);
        assert.strictEqual(relsA.bonds.has(b), false);
    });

    it("decays bonds for absent entities", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 10 });

        // Pre-seed a bond
        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 50, affinity: 20, lastContact: 0 });

        relationshipSystem(w, 100);

        const bond = relsA.bonds.get(b);
        assert.ok(bond.familiarity < 50, "familiarity should decay");
        assert.ok(bond.affinity < 20, "affinity should decay");
    });

    it("does not decay bonds with dead entities", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B", alive: false });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 50, affinity: 20, lastContact: 0 });

        relationshipSystem(w, 100);

        const bond = relsA.bonds.get(b);
        assert.strictEqual(bond.familiarity, 50);
        assert.strictEqual(bond.affinity, 20);
    });

    it("three entities at same location all bond with each other", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        const c = makeEntity(w, { name: "C" });

        relationshipSystem(w, 0);

        for (const [self, others] of [[a, [b, c]], [b, [a, c]], [c, [a, b]]]) {
            const rels = getComponent(w, self, RELATIONSHIPS);
            for (const other of others) {
                assert.ok(rels.bonds.has(other), `${self} should bond with ${other}`);
            }
        }
    });

    it("repeated ticks accumulate bonds", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        relationshipSystem(w, 0);
        const fam1 = getComponent(w, a, RELATIONSHIPS).bonds.get(b).familiarity;

        relationshipSystem(w, 1);
        const fam2 = getComponent(w, a, RELATIONSHIPS).bonds.get(b).familiarity;

        assert.ok(fam2 > fam1, "familiarity should increase over time");
    });
});

// --- hasMutualBond ---

describe("hasMutualBond", () => {
    it("returns true when both entities have bonds above threshold", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });

        assert.strictEqual(hasMutualBond(w, a, b), true);
    });

    it("returns false when one-sided", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        // B has no bond to A

        assert.strictEqual(hasMutualBond(w, a, b), false);
    });

    it("returns false when bond below threshold", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 5, affinity: 2, lastContact: 0 }); // below default thresholds
        relsB.bonds.set(a, { familiarity: 5, affinity: 2, lastContact: 0 });

        assert.strictEqual(hasMutualBond(w, a, b), false);
    });

    it("returns false when entity has no relationships", () => {
        const w = createWorld();
        const a = spawn(w);
        const b = spawn(w);
        assert.strictEqual(hasMutualBond(w, a, b), false);
    });

    it("asymmetric affinity: A likes B, B dislikes A", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: -5, lastContact: 0 });

        assert.strictEqual(hasMutualBond(w, a, b), false);
    });
});

// --- groupFormationSystem ---

describe("groupFormationSystem", () => {
    it("forms a group from co-located mutually bonded entities", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });

        groupFormationSystem(w);

        const gA = getComponent(w, a, GROUP);
        const gB = getComponent(w, b, GROUP);
        assert.ok(gA, "A should be in a group");
        assert.ok(gB, "B should be in a group");
        assert.strictEqual(gA.groupId, gB.groupId, "same group");
    });

    it("does not form group without mutual bonds", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        groupFormationSystem(w);

        assert.strictEqual(getComponent(w, a, GROUP), undefined);
        assert.strictEqual(getComponent(w, b, GROUP), undefined);
    });

    it("does not form group for non-co-located entities", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 10 });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });

        groupFormationSystem(w);

        assert.strictEqual(getComponent(w, a, GROUP), undefined);
        assert.strictEqual(getComponent(w, b, GROUP), undefined);
    });

    it("transitive grouping: A-B bonded, B-C bonded → A,B,C in same group", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        const c = makeEntity(w, { name: "C" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        const relsC = getComponent(w, c, RELATIONSHIPS);

        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(c, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsC.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        // A and C not directly bonded

        groupFormationSystem(w);

        const gA = getComponent(w, a, GROUP);
        const gB = getComponent(w, b, GROUP);
        const gC = getComponent(w, c, GROUP);
        assert.ok(gA && gB && gC);
        assert.strictEqual(gA.groupId, gB.groupId);
        assert.strictEqual(gB.groupId, gC.groupId);
    });

    it("separate locations form separate groups", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 0 });
        const c = makeEntity(w, { name: "C", position: 10 });
        const d = makeEntity(w, { name: "D", position: 10 });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        const relsC = getComponent(w, c, RELATIONSHIPS);
        const relsD = getComponent(w, d, RELATIONSHIPS);

        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsC.bonds.set(d, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsD.bonds.set(c, { familiarity: 20, affinity: 10, lastContact: 0 });

        groupFormationSystem(w);

        const gA = getComponent(w, a, GROUP);
        const gC = getComponent(w, c, GROUP);
        assert.notStrictEqual(gA.groupId, gC.groupId);
    });

    it("dead entities excluded from groups", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B", alive: false });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });

        groupFormationSystem(w);

        assert.strictEqual(getComponent(w, a, GROUP), undefined);
        assert.strictEqual(getComponent(w, b, GROUP), undefined);
    });

    it("clears previous group assignments on re-run", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });

        groupFormationSystem(w);
        assert.ok(getComponent(w, a, GROUP));

        // Move B away and re-run
        getComponent(w, b, POSITION).position = 999;
        groupFormationSystem(w);
        assert.strictEqual(getComponent(w, a, GROUP), undefined);
        assert.strictEqual(getComponent(w, b, GROUP), undefined);
    });
});

// --- getCompanion ---

describe("getCompanion", () => {
    it("returns undefined when entity has no group", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        assert.strictEqual(getCompanion(w, a), undefined);
    });

    it("returns the highest-affinity co-located group member", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        const c = makeEntity(w, { name: "C" });

        // All co-located, all mutually bonded
        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        const relsC = getComponent(w, c, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsA.bonds.set(c, { familiarity: 20, affinity: 30, lastContact: 0 }); // higher affinity
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsC.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(c, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsC.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });

        groupFormationSystem(w);
        assert.strictEqual(getCompanion(w, a), c);
    });

    it("returns undefined when group member is dead", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        const relsA = getComponent(w, a, RELATIONSHIPS);
        const relsB = getComponent(w, b, RELATIONSHIPS);
        relsA.bonds.set(b, { familiarity: 20, affinity: 10, lastContact: 0 });
        relsB.bonds.set(a, { familiarity: 20, affinity: 10, lastContact: 0 });

        groupFormationSystem(w);

        // Kill B
        getComponent(w, b, IDENTITY).alive = false;
        assert.strictEqual(getCompanion(w, a), undefined);
    });

    it("returns undefined for entity with no relationships", () => {
        const w = createWorld();
        const a = spawn(w);
        addComponent(w, a, GROUP, { groupId: 0 });
        assert.strictEqual(getCompanion(w, a), undefined);
    });

    it("returns undefined for entity with no position", () => {
        const w = createWorld();
        const a = spawn(w);
        addComponent(w, a, GROUP, { groupId: 0 });
        addComponent(w, a, RELATIONSHIPS, { bonds: new Map() });
        assert.strictEqual(getCompanion(w, a), undefined);
    });
});

// --- modifyAffinity ---

describe("modifyAffinity", () => {
    it("increases affinity on positive delta", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        modifyAffinity(w, a, b, 15, 0);

        const bond = getComponent(w, a, RELATIONSHIPS).bonds.get(b);
        assert.strictEqual(bond.affinity, 15);
    });

    it("decreases affinity on negative delta", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        modifyAffinity(w, a, b, -30, 0);

        const bond = getComponent(w, a, RELATIONSHIPS).bonds.get(b);
        assert.strictEqual(bond.affinity, -30);
    });

    it("clamps to max/min affinity", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        modifyAffinity(w, a, b, 999, 0);
        assert.strictEqual(getComponent(w, a, RELATIONSHIPS).bonds.get(b).affinity,
                           DEFAULT_BOND.maxAffinity);

        modifyAffinity(w, a, b, -9999, 0);
        assert.strictEqual(getComponent(w, a, RELATIONSHIPS).bonds.get(b).affinity,
                           DEFAULT_BOND.minAffinity);
    });

    it("no-op when entity has no relationships component", () => {
        const w = createWorld();
        const a = spawn(w);
        const b = spawn(w);
        modifyAffinity(w, a, b, 10, 0); // should not throw
    });

    it("creates bond if none exists", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });

        modifyAffinity(w, a, b, 5, 42);

        const bond = getComponent(w, a, RELATIONSHIPS).bonds.get(b);
        assert.ok(bond);
        assert.strictEqual(bond.affinity, 5);
        assert.strictEqual(bond.familiarity, 0);
    });
});

// --- applyShock ---

describe("applyShock", () => {
    it("reduces lucidity and hope", () => {
        const psych = { lucidity: 80, hope: 70 };
        applyShock(psych, -20, -15);
        assert.strictEqual(psych.lucidity, 60);
        assert.strictEqual(psych.hope, 55);
    });

    it("can increase values (positive shock — e.g. hope from companion)", () => {
        const psych = { lucidity: 50, hope: 50 };
        applyShock(psych, 10, 20);
        assert.strictEqual(psych.lucidity, 60);
        assert.strictEqual(psych.hope, 70);
    });

    it("clamps to 0-100", () => {
        const psych = { lucidity: 10, hope: 10 };
        applyShock(psych, -50, -50);
        assert.strictEqual(psych.lucidity, 0);
        assert.strictEqual(psych.hope, 0);

        applyShock(psych, 200, 200);
        assert.strictEqual(psych.lucidity, 100);
        assert.strictEqual(psych.hope, 100);
    });
});

// --- socialPressureSystem ---

describe("socialPressureSystem", () => {
    it("does nothing with fewer than 2 mad entities at a location", () => {
        const w = createWorld();
        const sane = makeEntity(w, { name: "Sane", lucidity: 80, hope: 80 });
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });

        socialPressureSystem(w);

        const p = getComponent(w, sane, PSYCHOLOGY);
        assert.strictEqual(p.lucidity, 80); // unchanged
    });

    it("reduces lucidity of non-mad entities when 2+ mad at location", () => {
        const w = createWorld();
        const sane = makeEntity(w, { name: "Sane", lucidity: 80, hope: 80 });
        makeEntity(w, { name: "Mad1", lucidity: 20, hope: 50 });
        makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50 });

        socialPressureSystem(w);

        const p = getComponent(w, sane, PSYCHOLOGY);
        assert.ok(p.lucidity < 80, "sane entity should lose lucidity");
    });

    it("pressure scales with number of mad entities", () => {
        const w1 = createWorld();
        const sane1 = makeEntity(w1, { name: "Sane", lucidity: 80, hope: 80 });
        makeEntity(w1, { name: "Mad1", lucidity: 20, hope: 50 });
        makeEntity(w1, { name: "Mad2", lucidity: 20, hope: 50 });

        const w2 = createWorld();
        const sane2 = makeEntity(w2, { name: "Sane", lucidity: 80, hope: 80 });
        makeEntity(w2, { name: "Mad1", lucidity: 20, hope: 50 });
        makeEntity(w2, { name: "Mad2", lucidity: 20, hope: 50 });
        makeEntity(w2, { name: "Mad3", lucidity: 20, hope: 50 });
        makeEntity(w2, { name: "Mad4", lucidity: 20, hope: 50 });

        socialPressureSystem(w1);
        socialPressureSystem(w2);

        const l1 = getComponent(w1, sane1, PSYCHOLOGY).lucidity;
        const l2 = getComponent(w2, sane2, PSYCHOLOGY).lucidity;
        assert.ok(l2 < l1, "more mad entities = more pressure");
    });

    it("does not affect mad entities", () => {
        const w = createWorld();
        const mad1 = makeEntity(w, { name: "Mad1", lucidity: 30, hope: 50 });
        makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50 });
        makeEntity(w, { name: "Mad3", lucidity: 25, hope: 50 });

        socialPressureSystem(w);

        const p = getComponent(w, mad1, PSYCHOLOGY);
        assert.strictEqual(p.lucidity, 30); // unchanged
    });

    it("does not affect catatonic entities", () => {
        const w = createWorld();
        const cat = makeEntity(w, { name: "Cat", lucidity: 80, hope: 5 });
        makeEntity(w, { name: "Mad1", lucidity: 20, hope: 50 });
        makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50 });

        socialPressureSystem(w);

        const p = getComponent(w, cat, PSYCHOLOGY);
        assert.strictEqual(p.lucidity, 80); // unchanged
    });

    it("does not affect entities at different locations", () => {
        const w = createWorld();
        const sane = makeEntity(w, { name: "Sane", lucidity: 80, hope: 80, position: 999 });
        makeEntity(w, { name: "Mad1", lucidity: 20, hope: 50, position: 0 });
        makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50, position: 0 });

        socialPressureSystem(w);

        const p = getComponent(w, sane, PSYCHOLOGY);
        assert.strictEqual(p.lucidity, 80);
    });

    it("dead entities excluded", () => {
        const w = createWorld();
        const sane = makeEntity(w, { name: "Sane", lucidity: 80, hope: 80 });
        makeEntity(w, { name: "Mad1", lucidity: 20, hope: 50, alive: false });
        makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50, alive: false });

        socialPressureSystem(w);

        const p = getComponent(w, sane, PSYCHOLOGY);
        assert.strictEqual(p.lucidity, 80);
    });

    it("lucidity floors at 0", () => {
        const w = createWorld();
        const sane = makeEntity(w, { name: "Sane", lucidity: 0.05, hope: 80 });
        makeEntity(w, { name: "Mad1", lucidity: 20, hope: 50 });
        makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50 });

        socialPressureSystem(w);

        const p = getComponent(w, sane, PSYCHOLOGY);
        assert.ok(p.lucidity >= 0);
    });
});
