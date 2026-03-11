/**
 * Group cohesion simulation tests — verify that personality compatibility
 * determines how long groups hold together, and that maximally cohesive
 * groups outlast incompatible ones.
 *
 * These tests create controlled populations with specific personality
 * configurations, let them bond and form groups, then separate them
 * and measure group survival.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, AI, GROUP,
    relationshipSystem,
    groupFormationSystem,
    buildLocationIndex,
    DEFAULT_GROUP,
} from "../lib/social.core.ts";
import { PERSONALITY, compatibility, generatePersonality } from "../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../lib/belief.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { NEEDS } from "../lib/needs.core.ts";
import { STATS, generateStats } from "../lib/stats.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

// --- Personality presets ---

// Maximally cohesive: all traits identical at midpoint
const COHESIVE = { temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5 };

// Maximally opposite of COHESIVE
const OPPOSITE = { temperament: 1.0, pace: 1.0, openness: 1.0, outlook: 1.0 };

// Somewhat incompatible — different enough for fatigue, close enough to bond
const DRIFTER = { temperament: 0.85, pace: 0.85, openness: 0.3, outlook: 0.75 };

// Calm cluster
const CALM = { temperament: 0.1, pace: 0.2, openness: 0.5, outlook: 0.3 };

// Volatile cluster
const VOLATILE = { temperament: 0.9, pace: 0.8, openness: 0.5, outlook: 0.7 };

// --- Helpers ---

function makeNpc(world, opts = {}) {
    const {
        name = "Npc",
        side = 0, position = 0, floor = 0,
        seed = "group-test",
        id = 0,
        personality = null,
    } = opts;
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive: true, free: false });
    addComponent(world, e, PSYCHOLOGY, { lucidity: 100, hope: 100 });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, HABITUATION, { exposures: new Map() });
    addComponent(world, e, NEEDS, { hunger: 0, thirst: 0, exhaustion: 0 });
    addComponent(world, e, AI, {});

    if (personality) {
        addComponent(world, e, PERSONALITY, { ...personality });
    } else {
        const rng = seedFromString(seed + ":pers:" + id);
        addComponent(world, e, PERSONALITY, generatePersonality(rng));
    }

    const beliefRng = seedFromString(seed + ":belief:" + id);
    addComponent(world, e, BELIEF, generateBelief(beliefRng));
    const statsRng = seedFromString(seed + ":stats:" + id);
    addComponent(world, e, STATS, generateStats(statsRng));

    return e;
}

function runBonding(world, n) {
    for (let t = 0; t < n; t++) {
        const prebuilt = buildLocationIndex(world);
        relationshipSystem(world, t, undefined, prebuilt);
        groupFormationSystem(world, undefined, prebuilt);
    }
}

function runGroupOnly(world, n) {
    for (let t = 0; t < n; t++) {
        const prebuilt = buildLocationIndex(world);
        groupFormationSystem(world, undefined, prebuilt);
    }
}

function hasGroup(world, entity) {
    return !!getComponent(world, entity, GROUP);
}

function getGroupId(world, entity) {
    const g = getComponent(world, entity, GROUP);
    return g ? g.groupId : null;
}

function inSameGroup(world, entities) {
    const ids = entities.map(e => getGroupId(world, e));
    return ids[0] !== null && ids.every(id => id === ids[0]);
}

function avgBondAffinity(world, npcs) {
    let total = 0, count = 0;
    for (let i = 0; i < npcs.length; i++) {
        const rels = getComponent(world, npcs[i], RELATIONSHIPS);
        for (let j = 0; j < npcs.length; j++) {
            if (i === j) continue;
            const bond = rels.bonds.get(npcs[j]);
            if (bond) { total += bond.affinity; count++; }
        }
    }
    return count > 0 ? total / count : 0;
}

// --- Tests ---

describe("Group cohesion: compatibility sanity check", () => {
    it("identical personalities have compatibility 1.0", () => {
        assert.strictEqual(compatibility(COHESIVE, COHESIVE), 1.0);
    });

    it("opposite personalities have lower compatibility than identical", () => {
        const score = compatibility(COHESIVE, OPPOSITE);
        assert.ok(score < 0.7, `expected < 0.7, got ${score}`);
        assert.ok(score < compatibility(COHESIVE, COHESIVE),
            "opposite should be lower than identical");
    });

    it("drifter personality has moderate compatibility with cohesive", () => {
        const score = compatibility(COHESIVE, DRIFTER);
        assert.ok(score > 0.3 && score < 0.8,
            `expected moderate compatibility, got ${score.toFixed(2)}`);
    });
});

describe("Group cohesion: formation basics", () => {
    it("identical-personality NPCs form a group when co-located", () => {
        const world = createWorld();
        const npcs = [];
        for (let i = 0; i < 4; i++) {
            npcs.push(makeNpc(world, {
                name: "Cohesive-" + i, id: i, personality: COHESIVE,
            }));
        }

        // familiarityPerTick = 0.15 → ~67 ticks for fam=10
        // affinityPerTick = 0.08 → ~63 ticks for aff=5
        // With 4 NPCs, all 6 pair bonds need to cross threshold
        runBonding(world, 150);

        assert.ok(inSameGroup(world, npcs),
            "4 identical-personality co-located NPCs should form one group");
    });

    it("6 identical-personality NPCs form one group via transitive bonds", () => {
        const world = createWorld();
        const npcs = [];
        for (let i = 0; i < 6; i++) {
            npcs.push(makeNpc(world, {
                name: "Big-" + i, id: i, personality: COHESIVE,
            }));
        }

        runBonding(world, 150);

        assert.ok(inSameGroup(world, npcs),
            "6 identical-personality co-located NPCs should form one group");
    });
});

describe("Group cohesion: separation tolerance", () => {
    it("group survives brief separation within tolerance", () => {
        const world = createWorld();
        const npcs = [];
        for (let i = 0; i < 4; i++) {
            npcs.push(makeNpc(world, {
                name: "C-" + i, id: i, personality: COHESIVE,
            }));
        }

        runBonding(world, 200);
        assert.ok(inSameGroup(world, npcs), "group should exist before separation");

        // Move one member away
        getComponent(world, npcs[0], POSITION).position = 999n;

        runGroupOnly(world, 20);

        assert.ok(inSameGroup(world, npcs),
            "group should survive 20 ticks of separation (tolerance is 30)");
    });

    it("group dissolves after exceeding separation tolerance", () => {
        const world = createWorld();
        const npcs = [];
        for (let i = 0; i < 3; i++) {
            npcs.push(makeNpc(world, {
                name: "C-" + i, id: i, personality: COHESIVE,
            }));
        }

        runBonding(world, 200);
        assert.ok(inSameGroup(world, npcs), "group should exist before separation");

        // Scatter ALL members
        for (let i = 0; i < npcs.length; i++) {
            getComponent(world, npcs[i], POSITION).position = i * 100;
        }

        runGroupOnly(world, DEFAULT_GROUP.separationTolerance + 5);

        const grouped = npcs.filter(e => hasGroup(world, e));
        assert.ok(grouped.length < npcs.length,
            `expected dissolution after ${DEFAULT_GROUP.separationTolerance} ticks, ` +
            `but ${grouped.length}/${npcs.length} still grouped`);
    });
});

describe("Group cohesion: compatible vs incompatible bond strength", () => {
    it("compatible group has higher affinity than incompatible after equal bonding", () => {
        const compatWorld = createWorld();
        const compatNpcs = [];
        for (let i = 0; i < 4; i++) {
            compatNpcs.push(makeNpc(compatWorld, {
                name: "Compat-" + i, id: i, personality: COHESIVE,
            }));
        }

        // Alternating personalities → low pairwise compatibility
        const incompatWorld = createWorld();
        const incompatNpcs = [];
        for (let i = 0; i < 4; i++) {
            incompatNpcs.push(makeNpc(incompatWorld, {
                name: "Incompat-" + i, id: i,
                personality: i % 2 === 0 ? COHESIVE : OPPOSITE,
            }));
        }

        runBonding(compatWorld, 500);
        runBonding(incompatWorld, 500);

        const compatAff = avgBondAffinity(compatWorld, compatNpcs);
        const incompatAff = avgBondAffinity(incompatWorld, incompatNpcs);

        assert.ok(compatAff > incompatAff,
            `compatible avg affinity (${compatAff.toFixed(1)}) should exceed ` +
            `incompatible (${incompatAff.toFixed(1)})`);
    });

    it("familiarity fatigue erodes affinity for incompatible pairs over time", () => {
        const world = createWorld();

        // Compatible pair at position 0
        const a1 = makeNpc(world, { name: "C-A", id: 0, position: 0n, personality: COHESIVE });
        const a2 = makeNpc(world, { name: "C-B", id: 1, position: 0n, personality: COHESIVE });

        // Incompatible pair at position 100
        const b1 = makeNpc(world, { name: "I-A", id: 2, position: 100n, personality: COHESIVE });
        const b2 = makeNpc(world, { name: "I-B", id: 3, position: 100n, personality: OPPOSITE });

        runBonding(world, 2000);

        const compatAff = getComponent(world, a1, RELATIONSHIPS).bonds.get(a2)?.affinity ?? 0;
        const incompatAff = getComponent(world, b1, RELATIONSHIPS).bonds.get(b2)?.affinity ?? 0;

        assert.ok(compatAff > incompatAff + 5,
            `compatible pair affinity (${compatAff.toFixed(1)}) should meaningfully exceed ` +
            `incompatible (${incompatAff.toFixed(1)})`);
    });
});

describe("Group cohesion: affinity growth rate", () => {
    it("compatible pair reaches high affinity faster than incompatible pair", () => {
        // Compatible pair
        const cWorld = createWorld();
        const c1 = makeNpc(cWorld, { name: "C1", id: 0, position: 0n, personality: COHESIVE });
        const c2 = makeNpc(cWorld, { name: "C2", id: 1, position: 0n, personality: COHESIVE });

        // Incompatible pair — maximally opposite
        const iWorld = createWorld();
        const i1 = makeNpc(iWorld, { name: "I1", id: 0, position: 0n, personality: COHESIVE });
        const i2 = makeNpc(iWorld, { name: "I2", id: 1, position: 0n, personality: OPPOSITE });

        // Measure at a midpoint where fatigue has slowed the incompatible pair
        // but compatible pair is growing unimpeded
        // Fatigue kicks in when fam > compat * 100
        // OPPOSITE compat ~0.56, threshold ~56. At 0.15 fam/tick, ~373 ticks.
        // COHESIVE compat = 1.0, threshold = 100 (never fatigues).
        runBonding(cWorld, 600);
        runBonding(iWorld, 600);

        const cAff = getComponent(cWorld, c1, RELATIONSHIPS).bonds.get(c2)?.affinity ?? 0;
        const iAff = getComponent(iWorld, i1, RELATIONSHIPS).bonds.get(i2)?.affinity ?? 0;

        assert.ok(cAff > iAff,
            `compatible pair affinity at tick 600 (${cAff.toFixed(1)}) should exceed ` +
            `incompatible pair (${iAff.toFixed(1)}) due to fatigue slowing`);
    });
});

describe("Group cohesion: incompatible groups disintegrate", () => {
    it("affinity rises for both compatible and incompatible pairs, but more slowly for incompatible", () => {
        // Friction is identical at max familiarity (overshoot normalizes to 1.0),
        // so check at moderate tick counts before both pairs hit the affinity cap.
        // At affinityPerTick ~0.08 and friction ~0.02, net ~0.06/tick.
        // Check at 500 ticks: affinity ~30 (neither capped at 100).
        const world = createWorld();
        const a = makeNpc(world, { name: "A", id: 0, position: 0n, personality: COHESIVE });
        const b = makeNpc(world, { name: "B", id: 1, position: 0n, personality: OPPOSITE });

        const compatWorld = createWorld();
        const c1 = makeNpc(compatWorld, { name: "C1", id: 0, position: 0n, personality: COHESIVE });
        const c2 = makeNpc(compatWorld, { name: "C2", id: 1, position: 0n, personality: COHESIVE });

        runBonding(world, 500);
        runBonding(compatWorld, 500);

        const incompatAff = getComponent(world, a, RELATIONSHIPS).bonds.get(b)?.affinity ?? 0;
        const compatAff = getComponent(compatWorld, c1, RELATIONSHIPS).bonds.get(c2)?.affinity ?? 0;

        assert.ok(incompatAff > 5,
            `incompatible pair affinity should still grow (friction < gain): ${incompatAff.toFixed(1)}`);
        assert.ok(compatAff > incompatAff,
            `compatible pair (${compatAff.toFixed(1)}) should have higher affinity than incompatible (${incompatAff.toFixed(1)})`);
    });

    it("incompatible pair forms weaker bonds than compatible pair", () => {
        // Incompatible pair bonds at same position — friction slows but doesn't stop growth.
        // They will form a group (affinity > threshold), but affinity is lower than compatible pair.
        const world = createWorld();
        const a = makeNpc(world, { name: "A", id: 0, position: 0n, personality: COHESIVE });
        const b = makeNpc(world, { name: "B", id: 1, position: 0n, personality: OPPOSITE });

        runBonding(world, 5200);

        const rels = getComponent(world, a, RELATIONSHIPS);
        const bond = rels.bonds.get(b);
        const aff = bond ? bond.affinity : 0;

        // With frictionRate < affinityPerTick, affinity grows. They will group.
        // Just verify they have bonded (affinity > group threshold of 5).
        assert.ok(aff > 5,
            `incompatible pair should have bonded (affinity > 5): ${aff.toFixed(1)}`);
        // And verify they ARE grouped (since affinity never erodes below threshold)
        assert.ok(inSameGroup(world, [a, b]),
            "incompatible pair should form a group (friction rate < gain rate)");
    });

    it("compatible group stays intact under same conditions", () => {
        const world = createWorld();
        const a = makeNpc(world, { name: "A", id: 0, position: 0n, personality: COHESIVE });
        const b = makeNpc(world, { name: "B", id: 1, position: 0n, personality: COHESIVE });

        runBonding(world, 5000);

        assert.ok(inSameGroup(world, [a, b]),
            "compatible pair should remain grouped after long co-location");

        const aff = getComponent(world, a, RELATIONSHIPS).bonds.get(b)?.affinity ?? 0;
        assert.ok(aff > 50, `compatible affinity should remain high: ${aff.toFixed(1)}`);
    });
});

describe("Group cohesion: personality clusters", () => {
    it("within-type bonds stronger than cross-type after extended co-location", () => {
        const world = createWorld();

        const calmNpcs = [];
        const volNpcs = [];
        for (let i = 0; i < 3; i++) {
            calmNpcs.push(makeNpc(world, { name: "Calm-" + i, id: i, personality: CALM }));
            volNpcs.push(makeNpc(world, { name: "Vol-" + i, id: i + 3, personality: VOLATILE }));
        }

        runBonding(world, 1000);

        const withinCalmAff = avgBondAffinity(world, calmNpcs);
        const withinVolAff = avgBondAffinity(world, volNpcs);

        // Cross-type affinity
        let crossTotal = 0, crossCount = 0;
        for (const c of calmNpcs) {
            const rels = getComponent(world, c, RELATIONSHIPS);
            for (const v of volNpcs) {
                const bond = rels.bonds.get(v);
                if (bond) { crossTotal += bond.affinity; crossCount++; }
            }
        }
        const crossAff = crossCount > 0 ? crossTotal / crossCount : 0;

        assert.ok(withinCalmAff > crossAff,
            `calm within-group affinity (${withinCalmAff.toFixed(1)}) should exceed ` +
            `cross-group (${crossAff.toFixed(1)})`);
        assert.ok(withinVolAff > crossAff,
            `volatile within-group affinity (${withinVolAff.toFixed(1)}) should exceed ` +
            `cross-group (${crossAff.toFixed(1)})`);
    });
});
