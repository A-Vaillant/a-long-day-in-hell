import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.js";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP,
    DEFAULT_THRESHOLDS, DEFAULT_BOND,
} from "../lib/social.core.js";
import {
    inviteAcceptance, invite, dismiss, attack, decideAction,
} from "../lib/actions.core.js";

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

    it("costs more hope when killing someone you know", () => {
        const w1 = createWorld();
        const s1 = makeEntity(w1, { name: "Player" });
        const t1 = makeEntity(w1, { name: "Stranger" });

        const w2 = createWorld();
        const s2 = makeEntity(w2, { name: "Player" });
        const t2 = makeEntity(w2, { name: "Friend" });
        setBond(w2, s2, t2, 80, 50);

        attack(w1, s1, t1);
        attack(w2, s2, t2);

        const hope1 = getComponent(w1, s1, PSYCHOLOGY).hope;
        const hope2 = getComponent(w2, s2, PSYCHOLOGY).hope;
        assert.ok(hope2 < hope1, "killing someone you know costs more hope");
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
    it("catatonic entities always idle", () => {
        const w = createWorld();
        const e = makeEntity(w, { name: "Cat", lucidity: 80, hope: 5 });

        const action = decideAction(w, e, [], stubRng([0.5]));
        assert.strictEqual(action.action, "idle");
    });

    it("catatonic idles even with co-located entities", () => {
        const w = createWorld();
        const e = makeEntity(w, { name: "Cat", lucidity: 80, hope: 5 });
        const other = makeEntity(w, { name: "Other" });

        const action = decideAction(w, e, [other], stubRng([0.5]));
        assert.strictEqual(action.action, "idle");
    });

    it("mad entity may attack non-mad co-located entity", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const sane = makeEntity(w, { name: "Sane" });

        // rng.next() < 0.3 triggers attack
        const action = decideAction(w, mad, [sane], stubRng([0.1]));
        assert.strictEqual(action.action, "attack");
        assert.strictEqual(action.target, sane);
    });

    it("mad entity idles when no targets", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });

        const action = decideAction(w, mad, [], stubRng([0.5]));
        assert.strictEqual(action.action, "idle");
    });

    it("mad entity idles when only other mad entities present", () => {
        const w = createWorld();
        const mad1 = makeEntity(w, { name: "Mad1", lucidity: 20, hope: 50 });
        const mad2 = makeEntity(w, { name: "Mad2", lucidity: 20, hope: 50 });

        const action = decideAction(w, mad1, [mad2], stubRng([0.1]));
        assert.strictEqual(action.action, "idle");
    });

    it("mad entity idles when roll >= 0.3", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const sane = makeEntity(w, { name: "Sane" });

        const action = decideAction(w, mad, [sane], stubRng([0.5]));
        assert.strictEqual(action.action, "idle");
    });

    it("anxious entity flees from mad", () => {
        const w = createWorld();
        const anxious = makeEntity(w, { name: "Anx", lucidity: 55, hope: 80 });
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });

        const action = decideAction(w, anxious, [mad], stubRng([0.5]));
        assert.strictEqual(action.action, "flee");
        assert.strictEqual(action.from, mad);
    });

    it("anxious entity may invite bonded entity", () => {
        const w = createWorld();
        const anx = makeEntity(w, { name: "Anx", lucidity: 55, hope: 80 });
        const friend = makeEntity(w, { name: "Friend" });
        setBond(w, anx, friend, 10, 10);

        // rng: 0.1 < 0.2 = invite
        const action = decideAction(w, anx, [friend], stubRng([0.1]));
        assert.strictEqual(action.action, "invite");
    });

    it("anxious entity may wander", () => {
        const w = createWorld();
        const anx = makeEntity(w, { name: "Anx", lucidity: 55, hope: 80 });

        // No co-located, skip invite loop, rng: 0.1 < 0.3 = wander, 0.3 < 0.5 = direction -1
        const action = decideAction(w, anx, [], stubRng([0.1, 0.3]));
        assert.strictEqual(action.action, "wander");
    });

    it("calm entity flees from mad with probability", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });

        // rng 0.3 < 0.5 = flee
        const action = decideAction(w, calm, [mad], stubRng([0.3]));
        assert.strictEqual(action.action, "flee");
    });

    it("calm entity does not flee mad when roll >= 0.5", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });

        // rng 0.6 >= 0.5 = don't flee, then falls through to invite/wander
        const action = decideAction(w, calm, [mad], stubRng([0.6, 0.9, 0.9, 0.9, 0.9]));
        assert.notStrictEqual(action.action, "flee");
    });

    it("calm entity may invite stranger", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const stranger = makeEntity(w, { name: "Stranger" });

        // No mad to flee, no bond, stranger branch: rng 0.05 < 0.1 = invite
        const action = decideAction(w, calm, [stranger], stubRng([0.05]));
        assert.strictEqual(action.action, "invite");
    });

    it("dead entity returns idle", () => {
        const w = createWorld();
        const dead = makeEntity(w, { name: "Dead", alive: false });

        const action = decideAction(w, dead, [], stubRng([0.5]));
        assert.strictEqual(action.action, "idle");
    });

    it("entity with no psychology returns idle", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, IDENTITY, { name: "X", alive: true });

        const action = decideAction(w, e, [], stubRng([0.5]));
        assert.strictEqual(action.action, "idle");
    });

    it("mad entity skips dead co-located entities as targets", () => {
        const w = createWorld();
        const mad = makeEntity(w, { name: "Mad", lucidity: 20, hope: 50 });
        const dead = makeEntity(w, { name: "Dead", alive: false });

        const action = decideAction(w, mad, [dead], stubRng([0.1]));
        assert.strictEqual(action.action, "idle");
    });

    it("calm entity skips catatonic for invites", () => {
        const w = createWorld();
        const calm = makeEntity(w, { name: "Calm" });
        const cat = makeEntity(w, { name: "Cat", lucidity: 80, hope: 5 });

        // All rolls permissive, but catatonic should be skipped for invite
        const action = decideAction(w, calm, [cat], stubRng([0.01, 0.01, 0.01, 0.3, 0.5]));
        // Should skip invite and eventually wander or idle
        assert.notStrictEqual(action.action, "invite");
    });

    it("wander direction can be positive or negative", () => {
        const w = createWorld();
        const calm1 = makeEntity(w, { name: "C1" });
        const calm2 = makeEntity(w, { name: "C2", position: 99 });

        // For calm1: skip flee (no mad), skip invite (no co-located viable),
        // wander: 0.1 < 0.4, direction: 0.2 < 0.5 → -1
        const a1 = decideAction(w, calm1, [], stubRng([0.1, 0.2]));
        // direction: 0.8 >= 0.5 → +1
        const a2 = decideAction(w, calm2, [], stubRng([0.1, 0.8]));

        if (a1.action === "wander") assert.strictEqual(a1.direction, -1);
        if (a2.action === "wander") assert.strictEqual(a2.direction, 1);
    });
});
