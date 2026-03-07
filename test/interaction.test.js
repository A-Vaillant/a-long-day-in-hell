import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, PLAYER, AI,
    getOrCreateBond,
} from "../lib/social.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { STATS } from "../lib/stats.core.ts";
import { KNOWLEDGE } from "../lib/knowledge.core.ts";
import {
    talkTo, spendTime, recruit,
    DEFAULT_TALK, DEFAULT_SPEND_TIME, DEFAULT_RECRUIT,
} from "../lib/interaction.core.ts";

// --- Helpers ---

function makeWorld() {
    return createWorld();
}

function makeEntity(world, opts = {}) {
    const {
        name = "Test", alive = true, lucidity = 100, hope = 100,
        side = 0, position = 0, floor = 0, player = false,
        influence = undefined,
    } = opts;
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive, free: false });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, HABITUATION, { exposures: new Map() });
    if (influence !== undefined) {
        addComponent(world, e, STATS, { endurance: 10, influence, quickness: 10 });
    }
    if (player) addComponent(world, e, PLAYER, {});
    else addComponent(world, e, AI, {});
    return e;
}

// --- talkTo ---

describe("talkTo", () => {
    it("succeeds with co-located alive entities", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Alice" });
        const result = talkTo(w, p, n, "kind", 100);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.disposition, "calm");
    });

    it("fails when NPC is dead", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Dead", alive: false });
        const result = talkTo(w, p, n, "neutral", 100);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.reason, "dead");
    });

    it("fails when not co-located", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true, position: 0 });
        const n = makeEntity(w, { name: "Far", position: 5 });
        const result = talkTo(w, p, n, "neutral", 100);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.reason, "not_here");
    });

    it("kind approach increases NPC affinity and hope", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Bob", hope: 50 });
        const result = talkTo(w, p, n, "kind", 100);
        assert.ok(result.affinityDelta > 0, "NPC affinity increased");
        assert.ok(result.npcHopeDelta > 0, "NPC hope increased");
        const npcPsych = getComponent(w, n, PSYCHOLOGY);
        assert.ok(npcPsych.hope > 50, "hope mutated upward");
    });

    it("dismissive approach decreases NPC affinity", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Carol" });
        const result = talkTo(w, p, n, "dismissive", 100);
        assert.ok(result.affinityDelta < 0, "NPC affinity decreased");
    });

    it("dismissive triggers beingDismissed shock", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Dave", hope: 80 });
        talkTo(w, p, n, "dismissive", 100);
        const habit = getComponent(w, n, HABITUATION);
        assert.strictEqual(habit.exposures.get("beingDismissed"), 1, "shock applied");
    });

    it("boosts familiarity on both sides", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Eve" });
        talkTo(w, p, n, "neutral", 100);
        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        const pBond = pRels.bonds.get(n);
        const nBond = nRels.bonds.get(p);
        assert.ok(pBond.familiarity > 0, "player familiarity increased");
        assert.ok(nBond.familiarity > 0, "NPC familiarity increased");
    });

    it("mad NPC disposition is detected and scales effects", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Mad", lucidity: 20, hope: 60 });
        const result = talkTo(w, p, n, "kind", 100);
        assert.strictEqual(result.disposition, "mad");
        // Effect is scaled down (0.4x for mad)
        assert.ok(result.affinityDelta < DEFAULT_TALK.affinityGain.kind,
            "affinity gain is less than full");
    });

    it("catatonic NPC barely responds", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Cat", lucidity: 50, hope: 10 });
        const result = talkTo(w, p, n, "kind", 100);
        assert.strictEqual(result.disposition, "catatonic");
        assert.ok(result.affinityDelta < 1, "minimal affinity gain");
    });

    it("player hope also changes", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true, hope: 50 });
        const n = makeEntity(w, { name: "Frank" });
        const result = talkTo(w, p, n, "kind", 100);
        assert.ok(result.playerHopeDelta > 0);
        const pPsych = getComponent(w, p, PSYCHOLOGY);
        assert.ok(pPsych.hope > 50);
    });

    it("shares search knowledge between entities", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Gina" });
        const pKnow = { lifeStory: {}, bookVision: null, visionAccurate: true, hasBook: false, searchedSegments: new Set(["0:0:0", "0:1:0"]) };
        const nKnow = { lifeStory: {}, bookVision: null, visionAccurate: true, hasBook: false, searchedSegments: new Set(["0:2:0", "0:3:0"]) };
        addComponent(w, p, KNOWLEDGE, pKnow);
        addComponent(w, n, KNOWLEDGE, nKnow);
        const result = talkTo(w, p, n, "kind", 100);
        assert.strictEqual(result.segmentsLearned, 2);
        assert.strictEqual(result.segmentsShared, 2);
        assert.strictEqual(pKnow.searchedSegments.size, 4);
        assert.strictEqual(nKnow.searchedSegments.size, 4);
    });

    it("dismissive talk does not share knowledge", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Hank" });
        const pKnow = { lifeStory: {}, bookVision: null, visionAccurate: true, hasBook: false, searchedSegments: new Set(["0:0:0"]) };
        const nKnow = { lifeStory: {}, bookVision: null, visionAccurate: true, hasBook: false, searchedSegments: new Set(["0:1:0"]) };
        addComponent(w, p, KNOWLEDGE, pKnow);
        addComponent(w, n, KNOWLEDGE, nKnow);
        const result = talkTo(w, p, n, "dismissive", 100);
        assert.strictEqual(result.segmentsLearned, 0);
        assert.strictEqual(result.segmentsShared, 0);
        assert.strictEqual(pKnow.searchedSegments.size, 1);
        assert.strictEqual(nKnow.searchedSegments.size, 1);
    });
});

// --- spendTime ---

describe("spendTime", () => {
    it("succeeds with co-located alive entities", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Grace" });
        const result = spendTime(w, p, n, 100);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.ticksSpent, DEFAULT_SPEND_TIME.duration);
    });

    it("fails when not co-located", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true, position: 0 });
        const n = makeEntity(w, { name: "Hank", position: 3 });
        const result = spendTime(w, p, n, 100);
        assert.strictEqual(result.success, false);
    });

    it("fails when NPC is dead", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Ida", alive: false });
        const result = spendTime(w, p, n, 100);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.reason, "dead");
    });

    it("increases familiarity significantly", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Jack" });
        const result = spendTime(w, p, n, 100);
        assert.ok(result.familiarityGained > 1, "substantial familiarity gain");
    });

    it("increases affinity on both sides", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Kate" });
        spendTime(w, p, n, 100);
        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        assert.ok(pRels.bonds.get(n).affinity > 0);
        assert.ok(nRels.bonds.get(p).affinity > 0);
    });

    it("restores hope on both entities", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true, hope: 40 });
        const n = makeEntity(w, { name: "Liam", hope: 40 });
        spendTime(w, p, n, 100);
        const pPsych = getComponent(w, p, PSYCHOLOGY);
        const nPsych = getComponent(w, n, PSYCHOLOGY);
        assert.ok(pPsych.hope > 40, "player hope restored");
        assert.ok(nPsych.hope > 40, "NPC hope restored");
    });

    it("bond multiplier makes accumulation faster than passive", () => {
        const w1 = makeWorld();
        const p1 = makeEntity(w1, { player: true });
        const n1 = makeEntity(w1, { name: "Active" });
        const activeResult = spendTime(w1, p1, n1, 100);

        // Compare with manual passive accumulation
        const w2 = makeWorld();
        const p2 = makeEntity(w2, { player: true });
        const n2 = makeEntity(w2, { name: "Passive" });
        const pRels = getComponent(w2, p2, RELATIONSHIPS);
        const bond = getOrCreateBond(pRels, n2, 100);
        // 10 ticks of passive accumulation (0.15/tick)
        for (let i = 0; i < DEFAULT_SPEND_TIME.duration; i++) {
            bond.familiarity += 0.15; // DEFAULT_BOND.familiarityPerTick
        }

        assert.ok(activeResult.familiarityGained > bond.familiarity,
            "spend time gains more than passive");
    });
});

// --- recruit ---

describe("recruit", () => {
    it("succeeds when bond thresholds are met", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Mark" });

        // Set up sufficient bonds
        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.joined, true);
    });

    it("fails when player familiarity is too low", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Nancy" });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 5, affinity: 15, firstContact: 0, lastContact: 100, encounters: 1 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 1 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, false);
        assert.strictEqual(result.reason, "unfamiliar");
    });

    it("fails when NPC affinity toward player is too low", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Oscar" });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 2, firstContact: 0, lastContact: 100, encounters: 3 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, false);
        assert.strictEqual(result.reason, "low_affinity");
    });

    it("fails for mad NPCs", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Pete", lucidity: 20, hope: 60 });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, false);
        assert.strictEqual(result.reason, "disposition");
    });

    it("fails for catatonic NPCs", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Quinn", lucidity: 50, hope: 10 });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, false);
        assert.strictEqual(result.reason, "disposition");
    });

    it("fails when not co-located", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true, position: 0 });
        const n = makeEntity(w, { name: "Rose", position: 5 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, false);
    });

    it("on success, boosts bonds above grouping threshold", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Sam" });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 16, affinity: 9, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 16, affinity: 9, firstContact: 0, lastContact: 100, encounters: 3 });

        recruit(w, p, n, 100);

        // Bonds should be boosted above group thresholds (fam 10, aff 5)
        const pBond = pRels.bonds.get(n);
        const nBond = nRels.bonds.get(p);
        assert.ok(pBond.familiarity >= 11);
        assert.ok(pBond.affinity >= 6);
        assert.ok(nBond.familiarity >= 11);
        assert.ok(nBond.affinity >= 6);
    });

    it("anxious NPCs can be recruited", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Tina", lucidity: 55, hope: 50 });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, true, "anxious NPCs can be recruited");
    });
});

// --- Simulation: talk → spend time → recruit pipeline ---

describe("social action pipeline", () => {
    it("repeated talking builds enough bond to recruit", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Uma" });

        // Talk 10 times kindly
        for (let i = 0; i < 10; i++) {
            talkTo(w, p, n, "kind", 100 + i);
        }

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const pBond = pRels.bonds.get(n);
        assert.ok(pBond.familiarity >= 15, "enough talks build familiarity for recruit");

        // Spend time to build affinity further
        spendTime(w, p, n, 200);

        const nRels = getComponent(w, n, RELATIONSHIPS);
        const nBond = nRels.bonds.get(p);
        assert.ok(nBond.affinity >= 8, "spend time builds enough affinity");

        // Now recruit
        const result = recruit(w, p, n, 300);
        assert.strictEqual(result.joined, true, "pipeline: talk → spend → recruit works");
    });

    it("high influence entity builds bonds faster via talk", () => {
        const w = makeWorld();
        const highInf = makeEntity(w, { player: true, influence: 18 });
        const lowInf = makeEntity(w, { influence: 3 });
        const target1 = makeEntity(w, { name: "T1" });
        const target2 = makeEntity(w, { name: "T2" });

        const r1 = talkTo(w, highInf, target1, "kind", 100);
        const r2 = talkTo(w, lowInf, target2, "kind", 100);

        assert.ok(r1.affinityDelta > r2.affinityDelta,
            "high influence yields greater affinity delta");
        assert.ok(r1.npcHopeDelta > r2.npcHopeDelta,
            "high influence yields greater hope delta");
    });

    it("high influence lowers recruit thresholds", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true, influence: 18 });
        const n = makeEntity(w, { name: "Recruit" });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        // Below default thresholds (fam 15, aff 8) but above scaled thresholds
        pRels.bonds.set(n, { familiarity: 11, affinity: 10, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 6, firstContact: 0, lastContact: 100, encounters: 3 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, true,
            "high influence recruits below normal thresholds");
    });

    it("low influence cannot recruit at normal thresholds", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true, influence: 3 });
        const n = makeEntity(w, { name: "Hard" });

        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        // At default thresholds exactly
        pRels.bonds.set(n, { familiarity: 15, affinity: 10, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 8, firstContact: 0, lastContact: 100, encounters: 3 });

        const result = recruit(w, p, n, 100);
        assert.strictEqual(result.joined, false,
            "low influence raises effective thresholds");
    });

    it("influence scales spend time bond accumulation", () => {
        const w = makeWorld();
        const highP = makeEntity(w, { player: true, influence: 18 });
        const lowP = makeEntity(w, { influence: 3, position: 10 });
        const n1 = makeEntity(w, { name: "N1" });
        const n2 = makeEntity(w, { name: "N2", position: 10 });

        const r1 = spendTime(w, highP, n1, 100);
        const r2 = spendTime(w, lowP, n2, 100);

        // n1 should gain more from high-influence source
        const n1Rels = getComponent(w, n1, RELATIONSHIPS);
        const n2Rels = getComponent(w, n2, RELATIONSHIPS);
        const n1Bond = n1Rels.bonds.get(highP);
        const n2Bond = n2Rels.bonds.get(lowP);
        assert.ok(n1Bond.familiarity > n2Bond.familiarity,
            "target gains more familiarity from high-influence source");
    });

    it("hostile pipeline: dismissive talk prevents recruitment", () => {
        const w = makeWorld();
        const p = makeEntity(w, { player: true });
        const n = makeEntity(w, { name: "Vic" });

        // Set up minimal bonds
        const pRels = getComponent(w, p, RELATIONSHIPS);
        const nRels = getComponent(w, n, RELATIONSHIPS);
        pRels.bonds.set(n, { familiarity: 20, affinity: 15, firstContact: 0, lastContact: 100, encounters: 3 });
        nRels.bonds.set(p, { familiarity: 20, affinity: 10, firstContact: 0, lastContact: 100, encounters: 3 });

        // Talk dismissively several times — erode NPC affinity
        for (let i = 0; i < 5; i++) {
            talkTo(w, p, n, "dismissive", 100 + i);
        }

        const nBond = nRels.bonds.get(p);
        assert.ok(nBond.affinity < 8, "dismissive talk eroded affinity");

        // Recruit should fail
        const result = recruit(w, p, n, 200);
        assert.strictEqual(result.joined, false);
    });
});
