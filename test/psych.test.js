import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import { PSYCHOLOGY } from "../lib/social.core.ts";
import {
    HABITUATION,
    DEFAULT_SHOCKS,
    attenuateShock,
    getExposure,
    applyShock,
    applyShockToEntity,
} from "../lib/psych.core.ts";

// --- Helpers ---

function makePsych(lucidity = 100, hope = 100) {
    return { lucidity, hope };
}

function makeHabit(exposures = {}) {
    return { exposures: new Map(Object.entries(exposures)) };
}

function makeWorld() {
    const world = createWorld();
    const e = spawn(world);
    addComponent(world, e, PSYCHOLOGY, makePsych());
    addComponent(world, e, HABITUATION, makeHabit());
    return { world, entity: e };
}

// --- attenuateShock ---

describe("attenuateShock", () => {
    it("returns full base at zero exposures", () => {
        const source = { lucidity: -10, hope: -5, habitRate: 0.5 };
        const result = attenuateShock(source, 0);
        assert.equal(result.lucidity, -10);
        assert.equal(result.hope, -5);
    });

    it("attenuates with hyperbolic curve", () => {
        const source = { lucidity: -10, hope: -10, habitRate: 1.0 };
        // 1 exposure: -10 / (1 + 1*1) = -5
        const r1 = attenuateShock(source, 1);
        assert.equal(r1.lucidity, -5);
        assert.equal(r1.hope, -5);
        // 4 exposures: -10 / (1 + 1*4) = -2
        const r4 = attenuateShock(source, 4);
        assert.equal(r4.lucidity, -2);
        assert.equal(r4.hope, -2);
    });

    it("habitRate 0 means no habituation", () => {
        const source = { lucidity: -10, hope: -10, habitRate: 0 };
        const r100 = attenuateShock(source, 100);
        assert.equal(r100.lucidity, -10);
        assert.equal(r100.hope, -10);
    });

    it("high habitRate numbs quickly", () => {
        const source = { lucidity: -10, hope: -10, habitRate: 2.0 };
        // 1 exposure: -10 / (1 + 2*1) = -3.33...
        const r1 = attenuateShock(source, 1);
        assert.ok(r1.lucidity > -4 && r1.lucidity < -3);
        // 5 exposures: -10 / (1 + 2*5) = -0.909...
        const r5 = attenuateShock(source, 5);
        assert.ok(r5.lucidity > -1);
    });

    it("never reaches exactly zero", () => {
        const source = { lucidity: -10, hope: -10, habitRate: 1.0 };
        const r1000 = attenuateShock(source, 1000);
        assert.ok(r1000.lucidity < 0);
        assert.ok(r1000.hope < 0);
    });
});

// --- getExposure ---

describe("getExposure", () => {
    it("returns 0 for unknown source", () => {
        const habit = makeHabit();
        assert.equal(getExposure(habit, "beingKilled"), 0);
    });

    it("returns stored count", () => {
        const habit = makeHabit({ beingKilled: 5 });
        assert.equal(getExposure(habit, "beingKilled"), 5);
    });
});

// --- applyShock ---

describe("applyShock", () => {
    it("applies full damage on first exposure", () => {
        const psych = makePsych(100, 100);
        const habit = makeHabit();
        const impact = applyShock(psych, habit, "beingKilled");
        // beingKilled: lucidity -5, hope -8
        assert.equal(psych.lucidity, 95);
        assert.equal(psych.hope, 92);
        assert.equal(impact.lucidity, -5);
        assert.equal(impact.hope, -8);
    });

    it("increments exposure counter", () => {
        const psych = makePsych();
        const habit = makeHabit();
        applyShock(psych, habit, "beingKilled");
        assert.equal(getExposure(habit, "beingKilled"), 1);
        applyShock(psych, habit, "beingKilled");
        assert.equal(getExposure(habit, "beingKilled"), 2);
    });

    it("attenuates on repeated exposure", () => {
        const psych = makePsych(100, 100);
        const habit = makeHabit({ beingKilled: 5 });
        // beingKilled: hope -8, habitRate 0.8
        // 5 exposures: -8 / (1 + 0.8*5) = -8/5 = -1.6
        const impact = applyShock(psych, habit, "beingKilled");
        assert.ok(impact.hope > -2 && impact.hope < -1);
    });

    it("works without habituation component (full shock)", () => {
        const psych = makePsych(100, 100);
        const impact = applyShock(psych, undefined, "beingKilled");
        assert.equal(psych.lucidity, 95);
        assert.equal(psych.hope, 92);
    });

    it("does not increment exposure without habituation component", () => {
        const psych = makePsych();
        applyShock(psych, undefined, "beingKilled");
        // No crash, no counter
    });

    it("returns zero impact for unknown source", () => {
        const psych = makePsych(50, 50);
        const habit = makeHabit();
        const impact = applyShock(psych, habit, "nonexistent");
        assert.equal(impact.lucidity, 0);
        assert.equal(impact.hope, 0);
        assert.equal(psych.lucidity, 50);
        assert.equal(psych.hope, 50);
    });

    it("clamps psychology to 0 floor", () => {
        const psych = makePsych(2, 2);
        const habit = makeHabit();
        applyShock(psych, habit, "beingKilled");
        assert.equal(psych.lucidity, 0);
        assert.equal(psych.hope, 0);
    });

    it("clamps psychology to 100 ceiling", () => {
        // Hypothetical positive shock source
        const psych = makePsych(99, 99);
        const habit = makeHabit();
        const config = { heal: { lucidity: 10, hope: 10, habitRate: 0 } };
        applyShock(psych, habit, "heal", config);
        assert.equal(psych.lucidity, 100);
        assert.equal(psych.hope, 100);
    });

    it("tracks separate sources independently", () => {
        const psych = makePsych(100, 100);
        const habit = makeHabit();
        applyShock(psych, habit, "beingKilled");
        applyShock(psych, habit, "witnessAttack");
        assert.equal(getExposure(habit, "beingKilled"), 1);
        assert.equal(getExposure(habit, "witnessAttack"), 1);
    });

    it("returns actual applied delta (respecting clamp)", () => {
        const psych = makePsych(2, 2);
        const habit = makeHabit();
        const impact = applyShock(psych, habit, "companionMad");
        // companionMad: lucidity -8, hope -5, but clamped to 0
        assert.equal(impact.lucidity, -2);
        assert.equal(impact.hope, -2);
    });
});

// --- applyShockToEntity ---

describe("applyShockToEntity", () => {
    it("applies shock via world lookup", () => {
        const { world, entity } = makeWorld();
        const impact = applyShockToEntity(world, entity, "beingKilled");
        const psych = getComponent(world, entity, PSYCHOLOGY);
        assert.equal(psych.lucidity, 95);
        assert.equal(psych.hope, 92);
        assert.equal(impact.lucidity, -5);
        assert.equal(impact.hope, -8);
    });

    it("increments habituation via world lookup", () => {
        const { world, entity } = makeWorld();
        applyShockToEntity(world, entity, "beingKilled");
        applyShockToEntity(world, entity, "beingKilled");
        const habit = getComponent(world, entity, HABITUATION);
        assert.equal(getExposure(habit, "beingKilled"), 2);
    });

    it("second shock is weaker than first", () => {
        const { world, entity } = makeWorld();
        const first = applyShockToEntity(world, entity, "beingKilled");
        const second = applyShockToEntity(world, entity, "beingKilled");
        assert.ok(Math.abs(second.hope) < Math.abs(first.hope));
    });

    it("returns zero for entity without psychology", () => {
        const world = createWorld();
        const e = spawn(world);
        const impact = applyShockToEntity(world, e, "beingKilled");
        assert.equal(impact.lucidity, 0);
        assert.equal(impact.hope, 0);
    });

    it("works without habituation component (full shock every time)", () => {
        const world = createWorld();
        const e = spawn(world);
        addComponent(world, e, PSYCHOLOGY, makePsych());
        // No HABITUATION component
        const first = applyShockToEntity(world, e, "beingKilled");
        const second = applyShockToEntity(world, e, "beingKilled");
        // Both full strength since no habituation tracking
        assert.equal(first.hope, second.hope);
    });
});

// --- Habituation curves for each default source ---

describe("default shock sources", () => {
    it("witnessChasm: heavy hope, slow habituation", () => {
        const src = DEFAULT_SHOCKS.witnessChasm;
        assert.ok(src.hope < -10);
        assert.ok(src.habitRate < 0.5);
        // After 3 exposures still significant
        const r3 = attenuateShock(src, 3);
        assert.ok(r3.hope < -5);
    });

    it("beingKilled: fast habituation", () => {
        const src = DEFAULT_SHOCKS.beingKilled;
        assert.ok(src.habitRate >= 0.8);
        // After 5 exposures, mostly numb
        const r5 = attenuateShock(src, 5);
        assert.ok(Math.abs(r5.hope) < 2);
    });

    it("companionMad: heavy lucidity, very slow habituation", () => {
        const src = DEFAULT_SHOCKS.companionMad;
        assert.ok(Math.abs(src.lucidity) > Math.abs(src.hope));
        assert.ok(src.habitRate < 0.2);
        // After 5 exposures still painful
        const r5 = attenuateShock(src, 5);
        assert.ok(Math.abs(r5.lucidity) > 3);
    });

    it("witnessAttack: numbs fastest", () => {
        const src = DEFAULT_SHOCKS.witnessAttack;
        assert.ok(src.habitRate >= 1.0);
        // After 3 exposures, barely registers
        const r3 = attenuateShock(src, 3);
        assert.ok(Math.abs(r3.lucidity) < 2);
        assert.ok(Math.abs(r3.hope) < 1);
    });

    it("beingDismissed: hope only", () => {
        const src = DEFAULT_SHOCKS.beingDismissed;
        assert.equal(src.lucidity, 0);
        assert.ok(src.hope < 0);
    });

    it("committingViolence: moderate all around", () => {
        const src = DEFAULT_SHOCKS.committingViolence;
        assert.ok(src.lucidity < 0);
        assert.ok(src.hope < 0);
        assert.ok(src.habitRate > 0.3 && src.habitRate < 1.0);
    });
});

// --- Full habituation arc ---

describe("habituation arc", () => {
    it("beingKilled: 10 deaths shows clear numbness curve", () => {
        const psych = makePsych(100, 100);
        const habit = makeHabit();
        const impacts = [];
        for (let i = 0; i < 10; i++) {
            // Reset psych to isolate each impact
            psych.lucidity = 100;
            psych.hope = 100;
            impacts.push(applyShock(psych, habit, "beingKilled"));
        }
        // Each impact should be weaker than the last
        for (let i = 1; i < impacts.length; i++) {
            assert.ok(Math.abs(impacts[i].hope) < Math.abs(impacts[i - 1].hope),
                `impact ${i} should be weaker than ${i - 1}`);
        }
        // First should be strong, last should be weak
        assert.ok(Math.abs(impacts[0].hope) > 5);
        assert.ok(Math.abs(impacts[9].hope) < 2);
    });

    it("companionMad: stays painful longer", () => {
        const psych = makePsych(100, 100);
        const habit = makeHabit();
        const impacts = [];
        for (let i = 0; i < 10; i++) {
            psych.lucidity = 100;
            psych.hope = 100;
            impacts.push(applyShock(psych, habit, "companionMad"));
        }
        // After 5 exposures, companionMad lucidity impact should still be > 3
        assert.ok(Math.abs(impacts[4].lucidity) > 3,
            "companionMad should still hurt at 5 exposures");
    });
});
