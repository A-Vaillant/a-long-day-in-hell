/**
 * Group leadership, movement bias, and dismiss system tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP,
    groupFormationSystem, electGroupLeaders, npcDismissSystem,
    buildLocationIndex, hasMutualBond,
} from "../lib/social.core.ts";
import { PERSONALITY, generatePersonality } from "../lib/personality.core.ts";
import { STATS, generateStats } from "../lib/stats.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { NEEDS } from "../lib/needs.core.ts";
import { MOVEMENT, movementSystem } from "../lib/movement.core.ts";
import { INTENT } from "../lib/intent.core.ts";
import { SLEEP } from "../lib/sleep.core.ts";
import { KNOWLEDGE } from "../lib/knowledge.core.ts";
import { dismiss } from "../lib/actions.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

// --- Helpers ---

function makeEntity(world, opts = {}) {
    const {
        name = "Npc",
        side = 0, position = 0, floor = 0,
        influence = 10,
        temperament = 0.5, pace = 0.5, openness = 0.5, outlook = 0.5,
        lucidity = 100, hope = 100,
    } = opts;
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive: true, free: false });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, HABITUATION, { exposures: new Map() });
    addComponent(world, e, NEEDS, { hunger: 0, thirst: 0, exhaustion: 0 });
    addComponent(world, e, PERSONALITY, { temperament, pace, openness, outlook });
    addComponent(world, e, STATS, { endurance: 10, influence, quickness: 10 });
    return e;
}

function addMovement(world, entity, heading = 1) {
    addComponent(world, entity, MOVEMENT, { targetPosition: null, heading });
    addComponent(world, entity, INTENT, { behavior: "explore", cooldown: 0 });
    addComponent(world, entity, SLEEP, {
        home: { side: 0, position: 0, floor: 0 },
        bedIndex: null, asleep: false, coSleepers: [],
        awayStreak: 0, nomadic: false,
    });
    addComponent(world, entity, KNOWLEDGE, {
        lifeStory: {}, bookVision: null, visionAccurate: true,
        hasBook: false, searchedSegments: new Set(),
    });
}

/** Set SYMMETRIC bond (same values both directions). */
function makeBond(world, a, b, fam, aff) {
    const relsA = getComponent(world, a, RELATIONSHIPS);
    const relsB = getComponent(world, b, RELATIONSHIPS);
    relsA.bonds.set(b, { familiarity: fam, affinity: aff, lastContact: 0, encounters: 1 });
    relsB.bonds.set(a, { familiarity: fam, affinity: aff, lastContact: 0, encounters: 1 });
}

/** Set DIRECTED bond (a→b only). */
function setDirectedBond(world, from, to, fam, aff) {
    const rels = getComponent(world, from, RELATIONSHIPS);
    rels.bonds.set(to, { familiarity: fam, affinity: aff, lastContact: 0, encounters: 1 });
}

function putInGroup(world, entities, groupId = 1) {
    for (const e of entities) {
        addComponent(world, e, GROUP, { groupId, separatedTicks: 0, leaderId: null });
    }
}

// --- Leader election ---

describe("Group leader election", () => {
    it("highest influence becomes leader", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "Low", influence: 5 });
        const b = makeEntity(world, { name: "High", influence: 18 });
        const c = makeEntity(world, { name: "Mid", influence: 10 });
        putInGroup(world, [a, b, c]);

        electGroupLeaders(world);

        assert.strictEqual(getComponent(world, a, GROUP).leaderId, b);
        assert.strictEqual(getComponent(world, b, GROUP).leaderId, b);
        assert.strictEqual(getComponent(world, c, GROUP).leaderId, b);
    });

    it("ties broken by entity id (lower wins)", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "A", influence: 10 });
        const b = makeEntity(world, { name: "B", influence: 10 });
        putInGroup(world, [a, b]);

        electGroupLeaders(world);

        const leader = getComponent(world, a, GROUP).leaderId;
        // Lower entity id should win
        assert.strictEqual(leader, Math.min(a, b));
    });

    it("dead members are not eligible for leadership", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "Dead", influence: 18 });
        const b = makeEntity(world, { name: "Alive", influence: 5 });
        putInGroup(world, [a, b]);
        getComponent(world, a, IDENTITY).alive = false;

        electGroupLeaders(world);

        assert.strictEqual(getComponent(world, b, GROUP).leaderId, b);
    });

    it("groupFormationSystem sets leaders on new groups", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "A", influence: 15 });
        const b = makeEntity(world, { name: "B", influence: 8 });
        makeBond(world, a, b, 20, 10);

        const prebuilt = buildLocationIndex(world);
        groupFormationSystem(world, undefined, prebuilt);

        const gA = getComponent(world, a, GROUP);
        const gB = getComponent(world, b, GROUP);
        assert.ok(gA, "A should be in a group");
        assert.ok(gB, "B should be in a group");
        assert.strictEqual(gA.groupId, gB.groupId, "same group");
        assert.strictEqual(gA.leaderId, a, "higher influence should lead");
        assert.strictEqual(gB.leaderId, a, "follower sees same leader");
    });

    it("separate groups have separate leaders", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "A", influence: 18 });
        const b = makeEntity(world, { name: "B", influence: 5 });
        const c = makeEntity(world, { name: "C", influence: 3 });
        const d = makeEntity(world, { name: "D", influence: 15 });
        putInGroup(world, [a, b], 1);
        putInGroup(world, [c, d], 2);

        electGroupLeaders(world);

        assert.strictEqual(getComponent(world, a, GROUP).leaderId, a);
        assert.strictEqual(getComponent(world, c, GROUP).leaderId, d);
    });
});

// --- Group movement bias ---

describe("Group movement bias", () => {
    it("follower moves toward leader instead of own heading", () => {
        const world = createWorld();
        const leader = makeEntity(world, { name: "Leader", position: 50, influence: 18 });
        const follower = makeEntity(world, { name: "Follower", position: 40, influence: 5, pace: 0.0 });
        addMovement(world, leader, 1);
        addMovement(world, follower, -1); // heading AWAY from leader
        putInGroup(world, [leader, follower]);
        electGroupLeaders(world);

        // Run single tick — patient follower (pace=0) should follow leader with high probability
        const rng = seedFromString("follow-test");
        // Run many ticks and check net direction
        const startPos = 40;
        let moved = 0;
        for (let i = 0; i < 100; i++) {
            getComponent(world, leader, POSITION).position = 50;
            const pos = getComponent(world, follower, POSITION);
            pos.position = startPos;
            const tickRng = seedFromString("follow:" + i);
            movementSystem(world, tickRng);
            moved += pos.position - startPos;
        }

        // Patient follower should move toward leader (positive direction) more often than away
        assert.ok(moved > 0,
            `patient follower should drift toward leader, net movement: ${moved}`);
    });

    it("restless follower follows less consistently", () => {
        const world = createWorld();
        const leader = makeEntity(world, { name: "Leader", position: 50, influence: 18 });
        const patient = makeEntity(world, { name: "Patient", position: 40, influence: 5, pace: 0.0 });
        const restless = makeEntity(world, { name: "Restless", position: 40, influence: 5, pace: 1.0 });
        addMovement(world, leader, 1);
        addMovement(world, patient, -1);
        addMovement(world, restless, -1);
        putInGroup(world, [leader, patient, restless]);
        electGroupLeaders(world);

        let patientToward = 0;
        let restlessToward = 0;
        for (let i = 0; i < 200; i++) {
            getComponent(world, patient, POSITION).position = 40;
            getComponent(world, restless, POSITION).position = 40;
            movementSystem(world, seedFromString("pace:" + i));
            patientToward += getComponent(world, patient, POSITION).position - 40;
            restlessToward += getComponent(world, restless, POSITION).position - 40;
        }

        assert.ok(patientToward > restlessToward,
            `patient (${patientToward}) should follow more than restless (${restlessToward})`);
    });

    it("leader moves independently (not biased)", () => {
        const world = createWorld();
        const leader = makeEntity(world, { name: "Leader", position: 50, influence: 18 });
        const follower = makeEntity(world, { name: "Follower", position: 50, influence: 5 });
        addMovement(world, leader, -1); // heading left
        addMovement(world, follower, 1);
        putInGroup(world, [leader, follower]);
        electGroupLeaders(world);

        movementSystem(world, seedFromString("leader-test"));

        // Leader should move in their own heading
        assert.strictEqual(getComponent(world, leader, POSITION).position, 49,
            "leader moves in own heading direction");
    });

    it("follower on different floor is not biased", () => {
        const world = createWorld();
        const leader = makeEntity(world, { name: "Leader", position: 50, floor: 5, influence: 18 });
        const follower = makeEntity(world, { name: "Follower", position: 40, floor: 3, influence: 5 });
        addMovement(world, leader, 1);
        addMovement(world, follower, -1);
        putInGroup(world, [leader, follower]);
        electGroupLeaders(world);

        movementSystem(world, seedFromString("floor-test"));

        // Different floor — follower uses own heading
        assert.strictEqual(getComponent(world, follower, POSITION).position, 39,
            "follower on different floor moves independently");
    });

    it("ungrouped NPC is not biased", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "Solo", position: 40 });
        addMovement(world, a, -1);
        // No group component

        movementSystem(world, seedFromString("solo-test"));

        assert.strictEqual(getComponent(world, a, POSITION).position, 39,
            "ungrouped NPC moves in own heading");
    });
});

// --- Personality-scaled dismiss ---

describe("Dismiss action (personality-scaled)", () => {
    it("high-openness target takes more affinity damage", () => {
        const world = createWorld();
        const src = makeEntity(world, { name: "Src", openness: 0.5 });
        const tgtOpen = makeEntity(world, { name: "Open", openness: 1.0 });
        const tgtGuarded = makeEntity(world, { name: "Guarded", openness: 0.0 });

        makeBond(world, src, tgtOpen, 50, 20);
        makeBond(world, src, tgtGuarded, 50, 20);

        dismiss(world, src, tgtOpen);
        dismiss(world, src, tgtGuarded);

        const openAff = getComponent(world, tgtOpen, RELATIONSHIPS).bonds.get(src).affinity;
        const guardedAff = getComponent(world, tgtGuarded, RELATIONSHIPS).bonds.get(src).affinity;

        assert.ok(openAff < guardedAff,
            `open target (${openAff}) should take more damage than guarded (${guardedAff})`);
    });

    it("high-openness source feels more guilt", () => {
        const world = createWorld();
        const srcOpen = makeEntity(world, { name: "OpenSrc", openness: 1.0 });
        const srcGuarded = makeEntity(world, { name: "GuardedSrc", openness: 0.0 });
        const tgt1 = makeEntity(world, { name: "T1" });
        const tgt2 = makeEntity(world, { name: "T2" });

        makeBond(world, srcOpen, tgt1, 30, 20);
        makeBond(world, srcGuarded, tgt2, 30, 20);

        dismiss(world, srcOpen, tgt1);
        dismiss(world, srcGuarded, tgt2);

        const openGuilt = getComponent(world, srcOpen, RELATIONSHIPS).bonds.get(tgt1).affinity;
        const guardedGuilt = getComponent(world, srcGuarded, RELATIONSHIPS).bonds.get(tgt2).affinity;

        assert.ok(openGuilt < guardedGuilt,
            `open source (${openGuilt}) should feel more guilt than guarded (${guardedGuilt})`);
    });

    it("high familiarity increases dismiss damage", () => {
        const world = createWorld();
        const src = makeEntity(world, { name: "Src" });
        const tgtHigh = makeEntity(world, { name: "HighFam" });
        const tgtLow = makeEntity(world, { name: "LowFam" });

        makeBond(world, src, tgtHigh, 80, 20);
        makeBond(world, src, tgtLow, 5, 20);

        dismiss(world, src, tgtHigh);
        dismiss(world, src, tgtLow);

        const highAff = getComponent(world, tgtHigh, RELATIONSHIPS).bonds.get(src).affinity;
        const lowAff = getComponent(world, tgtLow, RELATIONSHIPS).bonds.get(src).affinity;

        assert.ok(highAff < lowAff,
            `high familiarity target (${highAff}) should hurt more than low (${lowAff})`);
    });

    it("removes target from shared group", () => {
        const world = createWorld();
        const src = makeEntity(world, { name: "Src" });
        const tgt = makeEntity(world, { name: "Tgt" });
        makeBond(world, src, tgt, 30, 10);
        putInGroup(world, [src, tgt], 7);

        dismiss(world, src, tgt);

        assert.ok(getComponent(world, src, GROUP), "source stays in group");
        assert.strictEqual(getComponent(world, tgt, GROUP), undefined, "target removed from group");
    });

    it("does not remove from different group", () => {
        const world = createWorld();
        const src = makeEntity(world, { name: "Src" });
        const tgt = makeEntity(world, { name: "Tgt" });
        makeBond(world, src, tgt, 30, 10);
        putInGroup(world, [src], 7);
        putInGroup(world, [tgt], 8);

        dismiss(world, src, tgt);

        assert.ok(getComponent(world, tgt, GROUP), "target stays in own group");
    });
});

// --- NPC-initiated dismiss ---

describe("NPC dismiss system", () => {
    it("NPC with negative affinity eventually dismisses groupmate", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "Dismisser", openness: 0.0, pace: 1.0, temperament: 1.0 });
        const b = makeEntity(world, { name: "Victim", openness: 1.0 });
        setDirectedBond(world, a, b, 50, -5); // dismisser dislikes victim
        setDirectedBond(world, b, a, 50, 10); // victim still likes dismisser
        putInGroup(world, [a, b]);

        let dismissed = false;
        for (let i = 0; i < 2000; i++) {
            const rng = seedFromString("dismiss-test:" + i);
            npcDismissSystem(world, rng);
            if (!getComponent(world, b, GROUP)) {
                dismissed = true;
                break;
            }
        }

        assert.ok(dismissed, "NPC with negative affinity should eventually dismiss groupmate");
    });

    it("NPC with high affinity does not dismiss", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "Happy", openness: 0.5 });
        const b = makeEntity(world, { name: "Friend", openness: 0.5 });
        makeBond(world, a, b, 50, 20);
        makeBond(world, b, a, 50, 20);
        putInGroup(world, [a, b]);

        for (let i = 0; i < 1000; i++) {
            npcDismissSystem(world, seedFromString("no-dismiss:" + i));
        }

        assert.ok(getComponent(world, a, GROUP), "A stays grouped");
        assert.ok(getComponent(world, b, GROUP), "B stays grouped");
    });

    it("guarded NPCs dismiss faster than open NPCs", () => {
        // Two separate worlds to isolate
        const w1 = createWorld();
        const guarded = makeEntity(w1, { name: "Guarded", openness: 0.0, pace: 0.8 });
        const t1 = makeEntity(w1, { name: "T1" });
        setDirectedBond(w1, guarded, t1, 50, -2);
        setDirectedBond(w1, t1, guarded, 50, 5);
        putInGroup(w1, [guarded, t1]);

        const w2 = createWorld();
        const open = makeEntity(w2, { name: "Open", openness: 1.0, pace: 0.2 });
        const t2 = makeEntity(w2, { name: "T2" });
        setDirectedBond(w2, open, t2, 50, -2);
        setDirectedBond(w2, t2, open, 50, 5);
        putInGroup(w2, [open, t2]);

        let guardedTick = -1, openTick = -1;
        for (let i = 0; i < 5000; i++) {
            if (guardedTick < 0) {
                npcDismissSystem(w1, seedFromString("guarded:" + i));
                if (!getComponent(w1, t1, GROUP)) guardedTick = i;
            }
            if (openTick < 0) {
                npcDismissSystem(w2, seedFromString("open:" + i));
                if (!getComponent(w2, t2, GROUP)) openTick = i;
            }
            if (guardedTick >= 0 && openTick >= 0) break;
        }

        assert.ok(guardedTick >= 0, "guarded should eventually dismiss");
        assert.ok(openTick >= 0, "open should eventually dismiss");
        assert.ok(guardedTick < openTick,
            `guarded (${guardedTick}) should dismiss before open (${openTick})`);
    });

    it("dismissed NPC receives hope shock", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "Dismisser", openness: 0.0, pace: 1.0, temperament: 1.0 });
        const b = makeEntity(world, { name: "Victim", hope: 80 });
        setDirectedBond(world, a, b, 50, -10);
        setDirectedBond(world, b, a, 50, 10);
        putInGroup(world, [a, b]);

        for (let i = 0; i < 5000; i++) {
            npcDismissSystem(world, seedFromString("shock:" + i));
            if (!getComponent(world, b, GROUP)) break;
        }

        const hope = getComponent(world, b, PSYCHOLOGY).hope;
        assert.ok(hope < 80, `victim should lose hope from dismissal, got ${hope}`);
    });

    it("group dissolves when dismiss reduces to 1 member", () => {
        const world = createWorld();
        const a = makeEntity(world, { name: "A", openness: 0.0, pace: 1.0, temperament: 1.0 });
        const b = makeEntity(world, { name: "B" });
        setDirectedBond(world, a, b, 50, -10);
        setDirectedBond(world, b, a, 50, 10);
        putInGroup(world, [a, b]);

        for (let i = 0; i < 5000; i++) {
            npcDismissSystem(world, seedFromString("dissolve:" + i));
            if (!getComponent(world, b, GROUP)) break;
        }

        // Both should be ungrouped (group < 2 members → dissolved)
        assert.strictEqual(getComponent(world, a, GROUP), undefined, "A ungrouped after group dissolved");
        assert.strictEqual(getComponent(world, b, GROUP), undefined, "B ungrouped after dismissal");
    });
});

// --- Sim: group cohesion with leadership ---

describe("Sim: groups travel together", () => {
    it("grouped NPCs converge toward leader over time", () => {
        const world = createWorld();
        const leader = makeEntity(world, { name: "Leader", position: 50, influence: 18 });
        const f1 = makeEntity(world, { name: "F1", position: 30, influence: 5, pace: 0.2 });
        const f2 = makeEntity(world, { name: "F2", position: 70, influence: 5, pace: 0.2 });
        addMovement(world, leader, 1);
        addMovement(world, f1, -1);
        addMovement(world, f2, 1);
        putInGroup(world, [leader, f1, f2]);
        electGroupLeaders(world);

        const initialSpread = Math.abs(getComponent(world, f1, POSITION).position - getComponent(world, leader, POSITION).position)
            + Math.abs(getComponent(world, f2, POSITION).position - getComponent(world, leader, POSITION).position);

        for (let i = 0; i < 100; i++) {
            movementSystem(world, seedFromString("converge:" + i));
        }

        const finalSpread = Math.abs(getComponent(world, f1, POSITION).position - getComponent(world, leader, POSITION).position)
            + Math.abs(getComponent(world, f2, POSITION).position - getComponent(world, leader, POSITION).position);

        assert.ok(finalSpread < initialSpread,
            `group should converge: initial spread ${initialSpread}, final ${finalSpread}`);
    });
});
