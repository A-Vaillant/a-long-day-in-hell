import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP,
    DEFAULT_THRESHOLDS, DEFAULT_BOND,
} from "../lib/social.core.ts";
import {
    inviteAcceptance, invite, dismiss, attack, decideAction, buildAwareness,
} from "../lib/actions.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";

// --- Helpers ---

function stubRng(values) {
    let i = 0;
    return { next() { return values[i++ % values.length]; } };
}

function makeEntity(world, { name = "Test", alive = true, lucidity = 100, hope = 100,
                              side = 0, position = 0, floor = 0 } = {}) {
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    return e;
}

function setBond(world, source, target, fam, aff) {
    const rels = getComponent(world, source, RELATIONSHIPS);
    rels.bonds.set(target, { familiarity: fam, affinity: aff, lastContact: 0 });
}

// Build awareness with all entities at same position (co-located = nearby = visible)
function awareness(coLocated = [], nearby = [], visible = []) {
    return {
        coLocated,
        nearby: [...coLocated, ...nearby],
        visible: [...coLocated, ...nearby, ...visible],
    };
}

// --- inviteAcceptance ---

describe("inviteAcceptance", () => {
    it("returns ~0.7 for calm target with no bond", () => {
        const p = inviteAcceptance({ lucidity: 100, hope: 100 }, true, undefined);
        assert.ok(Math.abs(p - 0.7) < 0.01);
    });

    it("returns ~0.4 for anxious target (low hope)", () => {
        const p = inviteAcceptance({ lucidity: 80, hope: 30 }, true, undefined);
        assert.ok(Math.abs(p - 0.4) < 0.01);
    });

    it("returns ~0.4 for anxious target (low lucidity)", () => {
        const p = inviteAcceptance({ lucidity: 55, hope: 80 }, true, undefined);
        assert.ok(Math.abs(p - 0.4) < 0.01);
    });

    it("returns 0 for mad target", () => {
        assert.strictEqual(inviteAcceptance({ lucidity: 30, hope: 50 }, true, undefined), 0);
    });

    it("returns 0 for catatonic target", () => {
        assert.strictEqual(inviteAcceptance({ lucidity: 80, hope: 10 }, true, undefined), 0);
    });

    it("returns 0 for dead target", () => {
        assert.strictEqual(inviteAcceptance({ lucidity: 100, hope: 100 }, false, undefined), 0);
    });

    it("high affinity bond increases acceptance", () => {
        const noBond = inviteAcceptance({ lucidity: 100, hope: 100 }, true, undefined);
        const withBond = inviteAcceptance({ lucidity: 100, hope: 100 }, true,
            { familiarity: 50, affinity: 80, lastContact: 0 });
        assert.ok(withBond > noBond);
    });

    it("negative affinity bond decreases acceptance", () => {
        const noBond = inviteAcceptance({ lucidity: 100, hope: 100 }, true, undefined);
        const withBond = inviteAcceptance({ lucidity: 100, hope: 100 }, true,
            { familiarity: 50, affinity: -80, lastContact: 0 });
        assert.ok(withBond < noBond);
    });

    it("high familiarity increases acceptance", () => {
        const lowFam = inviteAcceptance({ lucidity: 100, hope: 100 }, true,
            { familiarity: 0, affinity: 0, lastContact: 0 });
        const highFam = inviteAcceptance({ lucidity: 100, hope: 100 }, true,
            { familiarity: 100, affinity: 0, lastContact: 0 });
        assert.ok(highFam > lowFam);
    });

    it("result clamps to 0-1", () => {
        // Very negative bond on anxious target
        const p = inviteAcceptance({ lucidity: 55, hope: 80 }, true,
            { familiarity: 0, affinity: -100, lastContact: 0 });
        assert.ok(p >= 0);
        assert.ok(p <= 1);

        // Very positive bond on calm target
        const p2 = inviteAcceptance({ lucidity: 100, hope: 100 }, true,
            { familiarity: 100, affinity: 100, lastContact: 0 });
        assert.ok(p2 >= 0);
        assert.ok(p2 <= 1);
    });
});

// --- invite action ---

describe("invite", () => {
    it("succeeds when roll < acceptance", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });

        // Roll 0 = always succeeds against calm NPC (acceptance ~0.7)
        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "ok");
    });

    it("boosts mutual affinity on success", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });

        invite(w, src, tgt, stubRng([0]));

        const srcBond = getComponent(w, src, RELATIONSHIPS).bonds.get(tgt);
        const tgtBond = getComponent(w, tgt, RELATIONSHIPS).bonds.get(src);
        assert.ok(srcBond.affinity > 0, "source should gain affinity");
        assert.ok(tgtBond.affinity > 0, "target should gain affinity");
    });

    it("rejected when roll >= acceptance", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });

        // Roll 0.99 = always rejected against calm NPC
        const result = invite(w, src, tgt, stubRng([0.99]));
        assert.strictEqual(result.type, "rejected");
        assert.strictEqual(result.reason, "declined");
    });

    it("rejection gives source small affinity loss", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });
        setBond(w, src, tgt, 10, 10);

        invite(w, src, tgt, stubRng([0.99]));

        const srcBond = getComponent(w, src, RELATIONSHIPS).bonds.get(tgt);
        assert.ok(srcBond.affinity < 10, "affinity should decrease on rejection");
    });

    it("mad target gives 'hostile' rejection reason", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "MadNPC", lucidity: 20, hope: 50 });

        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "rejected");
        assert.strictEqual(result.reason, "hostile");
    });

    it("catatonic target gives 'unresponsive' rejection reason", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "CatNPC", lucidity: 80, hope: 5 });

        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "rejected");
        assert.strictEqual(result.reason, "unresponsive");
    });

    it("impossible when not co-located", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player", position: 0 });
        const tgt = makeEntity(w, { name: "NPC", position: 10 });

        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "impossible");
    });

    it("impossible when source is dead", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player", alive: false });
        const tgt = makeEntity(w, { name: "NPC" });

        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "impossible");
    });

    it("impossible when target is dead", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC", alive: false });

        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "impossible");
    });

    it("impossible when source has no position", () => {
        const w = createWorld();
        const src = spawn(w);
        addComponent(w, src, IDENTITY, { name: "X", alive: true });
        const tgt = makeEntity(w, { name: "NPC" });

        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "impossible");
    });

    it("impossible when target has no psychology", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = spawn(w);
        addComponent(w, tgt, IDENTITY, { name: "NPC", alive: true });
        addComponent(w, tgt, POSITION, { side: 0, position: 0, floor: 0 });
        addComponent(w, tgt, RELATIONSHIPS, { bonds: new Map() });

        const result = invite(w, src, tgt, stubRng([0]));
        assert.strictEqual(result.type, "impossible");
    });
});

// --- dismiss ---

describe("dismiss", () => {
    it("returns ok for alive entities", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });
        setBond(w, src, tgt, 20, 10);
        setBond(w, tgt, src, 20, 10);

        const result = dismiss(w, src, tgt);
        assert.strictEqual(result.type, "ok");
    });

    it("source loses small affinity (guilt)", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });
        setBond(w, src, tgt, 20, 10);

        dismiss(w, src, tgt);

        const bond = getComponent(w, src, RELATIONSHIPS).bonds.get(tgt);
        assert.ok(bond.affinity < 10);
    });

    it("target loses more affinity (being left hurts)", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });
        setBond(w, src, tgt, 50, 20);
        setBond(w, tgt, src, 50, 20);

        dismiss(w, src, tgt);

        const srcBond = getComponent(w, src, RELATIONSHIPS).bonds.get(tgt);
        const tgtBond = getComponent(w, tgt, RELATIONSHIPS).bonds.get(src);
        assert.ok(tgtBond.affinity < srcBond.affinity,
            "target should lose more affinity than source");
    });

    it("target's affinity loss scales with familiarity", () => {
        const w1 = createWorld();
        const s1 = makeEntity(w1, { name: "Player" });
        const t1 = makeEntity(w1, { name: "NPC" });
        setBond(w1, t1, s1, 10, 30); // low familiarity

        const w2 = createWorld();
        const s2 = makeEntity(w2, { name: "Player" });
        const t2 = makeEntity(w2, { name: "NPC" });
        setBond(w2, t2, s2, 80, 30); // high familiarity

        dismiss(w1, s1, t1);
        dismiss(w2, s2, t2);

        const aff1 = getComponent(w1, t1, RELATIONSHIPS).bonds.get(s1).affinity;
        const aff2 = getComponent(w2, t2, RELATIONSHIPS).bonds.get(s2).affinity;
        assert.ok(aff2 < aff1, "higher familiarity = bigger loss");
    });

    it("target loses hope", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });
        setBond(w, tgt, src, 50, 20);

        dismiss(w, src, tgt);

        const p = getComponent(w, tgt, PSYCHOLOGY);
        assert.ok(p.hope < 100, "target should lose hope");
    });

    it("impossible when source is dead", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player", alive: false });
        const tgt = makeEntity(w, { name: "NPC" });

        const result = dismiss(w, src, tgt);
        assert.strictEqual(result.type, "impossible");
    });

    it("impossible when target is dead", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC", alive: false });

        const result = dismiss(w, src, tgt);
        assert.strictEqual(result.type, "impossible");
    });

    it("works when source has no bond to target", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });
        // No bonds set — dismissing a stranger

        const result = dismiss(w, src, tgt);
        assert.strictEqual(result.type, "ok");
    });

    it("works when target has no relationships component", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = spawn(w);
        addComponent(w, tgt, IDENTITY, { name: "NPC", alive: true });
        addComponent(w, tgt, PSYCHOLOGY, { lucidity: 100, hope: 100 });

        const result = dismiss(w, src, tgt);
        assert.strictEqual(result.type, "ok");
    });
});

// --- attack ---

describe("attack", () => {
    it("kills the target", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });

        const result = attack(w, src, tgt);
        assert.strictEqual(result.type, "ok");
        assert.strictEqual(getComponent(w, tgt, IDENTITY).alive, false);
    });

    it("costs attacker hope and lucidity", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });

        attack(w, src, tgt);

        const p = getComponent(w, src, PSYCHOLOGY);
        assert.ok(p.hope < 100, "should lose hope");
        assert.ok(p.lucidity < 100, "should lose lucidity");
    });

    it("attacker cost habituates with repeated kills", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        addComponent(w, src, HABITUATION, { exposures: new Map() });

        // First kill: full committingViolence shock
        const t1 = makeEntity(w, { name: "NPC1" });
        const hopeBefore1 = getComponent(w, src, PSYCHOLOGY).hope;
        attack(w, src, t1);
        const loss1 = hopeBefore1 - getComponent(w, src, PSYCHOLOGY).hope;

        // Second kill: attenuated
        const t2 = makeEntity(w, { name: "NPC2" });
        const hopeBefore2 = getComponent(w, src, PSYCHOLOGY).hope;
        attack(w, src, t2);
        const loss2 = hopeBefore2 - getComponent(w, src, PSYCHOLOGY).hope;

        assert.ok(loss2 < loss1, "second kill should cost less hope than first");
    });

    it("target remembers (strong negative affinity to attacker)", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });

        attack(w, src, tgt);

        const tgtBond = getComponent(w, tgt, RELATIONSHIPS).bonds.get(src);
        assert.ok(tgtBond, "target should have bond to attacker");
        assert.ok(tgtBond.affinity < -20, "target should deeply dislike attacker");
    });

    it("attacker's positive affinity to target decreases", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC" });
        setBond(w, src, tgt, 50, 40);

        attack(w, src, tgt);

        const srcBond = getComponent(w, src, RELATIONSHIPS).bonds.get(tgt);
        assert.ok(srcBond.affinity < 40, "should lose affinity to victim");
    });

    it("impossible when not co-located", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player", position: 0 });
        const tgt = makeEntity(w, { name: "NPC", position: 10 });

        assert.strictEqual(attack(w, src, tgt).type, "impossible");
    });

    it("impossible when target already dead", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = makeEntity(w, { name: "NPC", alive: false });

        assert.strictEqual(attack(w, src, tgt).type, "impossible");
    });

    it("impossible when source is dead", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player", alive: false });
        const tgt = makeEntity(w, { name: "NPC" });

        assert.strictEqual(attack(w, src, tgt).type, "impossible");
    });

    it("impossible when source has no position", () => {
        const w = createWorld();
        const src = spawn(w);
        addComponent(w, src, IDENTITY, { name: "X", alive: true });
        addComponent(w, src, PSYCHOLOGY, { lucidity: 100, hope: 100 });
        const tgt = makeEntity(w, { name: "NPC" });

        assert.strictEqual(attack(w, src, tgt).type, "impossible");
    });

    it("works when attacker has no psychology (no self-damage)", () => {
        const w = createWorld();
        const src = spawn(w);
        addComponent(w, src, IDENTITY, { name: "Robot", alive: true });
        addComponent(w, src, POSITION, { side: 0, position: 0, floor: 0 });
        addComponent(w, src, RELATIONSHIPS, { bonds: new Map() });
        const tgt = makeEntity(w, { name: "NPC" });

        const result = attack(w, src, tgt);
        assert.strictEqual(result.type, "ok");
        assert.strictEqual(getComponent(w, tgt, IDENTITY).alive, false);
    });

    it("works when target has no relationships (no memory)", () => {
        const w = createWorld();
        const src = makeEntity(w, { name: "Player" });
        const tgt = spawn(w);
        addComponent(w, tgt, IDENTITY, { name: "NPC", alive: true });
        addComponent(w, tgt, POSITION, { side: 0, position: 0, floor: 0 });

        const result = attack(w, src, tgt);
        assert.strictEqual(result.type, "ok");
    });
});

// --- decideAction ---

describe("decideAction", () => {
    const empty = awareness();

    it("catatonic entities always idle", () => {
        const w = createWorld();
        const e = makeEntity(w, { name: "Cat", lucidity: 80, hope: 5 });
        assert.strictEqual(decideAction(w, e, empty, stubRng([0.5])).action, "idle");
    });

    it("catatonic idles even with co-located entities", () => {
        const w = createWorld();
        const e = makeEntity(w, { name: "Cat", lucidity: 80, hope: 5 });
        const other = makeEntity(w, { name: "Other" });
        assert.strictEqual(decideAction(w, e, awareness([other]), stubRng([0.5])).action, "idle");
    });

    it("mad entity may attack non-mad co-located entity", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const sane = makeEntity(w, { name: "Sane" });
        const action = decideAction(w, mad, awareness([sane]), stubRng([0.1]));
        assert.strictEqual(action.action, "attack");
        assert.strictEqual(action.target, sane);
    });

    it("mad entity idles when no targets", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        assert.strictEqual(decideAction(w, mad, empty, stubRng([0.5])).action, "idle");
    });

    it("mad entity idles when only other mad entities present", () => {
        const w = createWorld();
        const mad1 = makeEntity(w, { name: "Mad1", lucidity: 20, hope: 50 });
        const mad2 = makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50 });
        assert.strictEqual(decideAction(w, mad1, awareness([mad2]), stubRng([0.1])).action, "idle");
    });

    it("mad entity idles when roll >= 0.3", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const sane = makeEntity(w, { name: "Sane" });
        assert.strictEqual(decideAction(w, mad, awareness([sane]), stubRng([0.5])).action, "idle");
    });

    it("anxious entity flees from visible mad (not just co-located)", () => {
        const w = createWorld();
        const anxious = makeEntity(w, { name: "Anx", lucidity: 55, hope: 80 });
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50, position: 5 });
        // Mad is visible but not co-located
        const action = decideAction(w, anxious, awareness([], [], [mad]), stubRng([0.5]));
        assert.strictEqual(action.action, "flee");
        assert.strictEqual(action.from, mad);
    });

    it("anxious entity may invite co-located bonded entity", () => {
        const w = createWorld();
        const anx = makeEntity(w, { name: "Anx", lucidity: 55, hope: 80 });
        const friend = makeEntity(w, { name: "Friend" });
        setBond(w, anx, friend, 10, 10);
        const action = decideAction(w, anx, awareness([friend]), stubRng([0.1]));
        assert.strictEqual(action.action, "invite");
    });

    it("anxious entity may approach visible bonded entity", () => {
        const w = createWorld();
        const anx = makeEntity(w, { name: "Anx", lucidity: 55, hope: 80 });
        const friend = makeEntity(w, { name: "Friend", position: 5 });
        setBond(w, anx, friend, 10, 10);
        // friend is visible but not co-located
        const action = decideAction(w, anx, awareness([], [], [friend]), stubRng([0.1]));
        assert.strictEqual(action.action, "approach");
        assert.strictEqual(action.target, friend);
    });

    it("anxious entity may wander", () => {
        const w = createWorld();
        const anx = makeEntity(w, { name: "Anx", lucidity: 55, hope: 80 });
        const action = decideAction(w, anx, empty, stubRng([0.1, 0.3]));
        assert.strictEqual(action.action, "wander");
    });

    it("calm entity flees from visible mad with probability", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const action = decideAction(w, calm, awareness([mad]), stubRng([0.3]));
        assert.strictEqual(action.action, "flee");
    });

    it("calm entity does not flee mad when roll >= 0.5", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const action = decideAction(w, calm, awareness([], [], [mad]), stubRng([0.6, 0.9, 0.9, 0.9, 0.9]));
        assert.notStrictEqual(action.action, "flee");
    });

    it("calm entity may approach visible stranger", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const stranger = makeEntity(w, { name: "Stranger", position: 5 });
        // stranger visible, not co-located, rng 0.05 < 0.2 = approach
        const action = decideAction(w, calm, awareness([], [], [stranger]), stubRng([0.05]));
        assert.strictEqual(action.action, "approach");
    });

    it("calm entity may invite co-located stranger", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const stranger = makeEntity(w, { name: "Stranger" });
        const action = decideAction(w, calm, awareness([stranger]), stubRng([0.05]));
        assert.strictEqual(action.action, "invite");
    });

    it("dead entity returns idle", () => {
        const w = createWorld();
        const dead = makeEntity(w, { name: "Dead", alive: false });
        assert.strictEqual(decideAction(w, dead, empty, stubRng([0.5])).action, "idle");
    });

    it("entity with no psychology returns idle", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, IDENTITY, { name: "X", alive: true });
        assert.strictEqual(decideAction(w, e, empty, stubRng([0.5])).action, "idle");
    });

    it("mad entity skips dead co-located entities as targets", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const dead = makeEntity(w, { name: "Dead", alive: false });
        assert.strictEqual(decideAction(w, mad, awareness([dead]), stubRng([0.1])).action, "idle");
    });

    it("calm entity skips catatonic for invites", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const cat = makeEntity(w, { name: "Cat", lucidity: 80, hope: 5 });
        const action = decideAction(w, calm, awareness([cat]), stubRng([0.01, 0.01, 0.01, 0.3, 0.5]));
        assert.notStrictEqual(action.action, "invite");
    });

    it("wander direction can be positive or negative", () => {
        const w = createWorld();
        makeEntity(w, { name: "C1" });
        makeEntity(w, { name: "C2", position: 99 });
        const a1 = decideAction(w, 0, empty, stubRng([0.1, 0.2]));
        const a2 = decideAction(w, 1, empty, stubRng([0.1, 0.8]));
        if (a1.action === "wander") assert.strictEqual(a1.direction, -1);
        if (a2.action === "wander") assert.strictEqual(a2.direction, 1);
    });
});

// --- buildAwareness ---

describe("buildAwareness", () => {
    it("co-locates entities at same position", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B" });
        const result = buildAwareness(w, a, [a, b]);
        assert.deepStrictEqual(result.coLocated, [b]);
        assert.deepStrictEqual(result.nearby, [b]);
        assert.deepStrictEqual(result.visible, [b]);
    });

    it("nearby but not co-located (within hearing range)", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 2 });
        const result = buildAwareness(w, a, [a, b]);
        assert.deepStrictEqual(result.coLocated, []);
        assert.deepStrictEqual(result.nearby, [b]);
        assert.deepStrictEqual(result.visible, [b]);
    });

    it("visible but not nearby (beyond hearing, within sight)", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 7 });
        const result = buildAwareness(w, a, [a, b]);
        assert.deepStrictEqual(result.coLocated, []);
        assert.deepStrictEqual(result.nearby, []);
        assert.deepStrictEqual(result.visible, [b]);
    });

    it("out of sight range — not in any set", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", position: 0 });
        const b = makeEntity(w, { name: "B", position: 20 });
        const result = buildAwareness(w, a, [a, b]);
        assert.deepStrictEqual(result.coLocated, []);
        assert.deepStrictEqual(result.nearby, []);
        assert.deepStrictEqual(result.visible, []);
    });

    it("different floor — not visible", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A", floor: 0 });
        const b = makeEntity(w, { name: "B", floor: 1 });
        const result = buildAwareness(w, a, [a, b]);
        assert.deepStrictEqual(result.visible, []);
    });

    it("dead entities excluded", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const b = makeEntity(w, { name: "B", alive: false });
        const result = buildAwareness(w, a, [a, b]);
        assert.deepStrictEqual(result.visible, []);
    });

    it("excludes self", () => {
        const w = createWorld();
        const a = makeEntity(w, { name: "A" });
        const result = buildAwareness(w, a, [a]);
        assert.deepStrictEqual(result.coLocated, []);
    });
});
