import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY } from "../lib/social.core.ts";
import {
    NEEDS, DEFAULT_NEEDS,
    needsSystem, needsDecayMultiplier, resetNeedsAtDawn,
} from "../lib/needs.core.ts";

function makeNpc(world, { position = 0, alive = true, hunger = 0, thirst = 0, exhaustion = 0 } = {}) {
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name: "Test", alive });
    addComponent(world, e, POSITION, { side: 0, position, floor: 0 });
    addComponent(world, e, NEEDS, { hunger, thirst, exhaustion });
    return e;
}

describe("needsSystem", () => {
    it("accumulates hunger/thirst/exhaustion per tick", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5 }); // not a rest area
        needsSystem(w, true);
        const n = getComponent(w, e, NEEDS);
        assert.ok(n.hunger > 0);
        assert.ok(n.thirst > 0);
        assert.ok(n.exhaustion > 0);
    });

    it("auto-eats at rest area when above threshold and lights on", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 0, hunger: 55 }); // rest area
        needsSystem(w, true);
        const n = getComponent(w, e, NEEDS);
        // Should have eaten: 55 + rate - 40 < 55
        assert.ok(n.hunger < 55);
    });

    it("auto-drinks at rest area when above threshold and lights on", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 0, thirst: 55 });
        needsSystem(w, true);
        const n = getComponent(w, e, NEEDS);
        assert.ok(n.thirst < 55);
    });

    it("auto-sleeps at rest area when exhaustion above threshold", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 0, exhaustion: 75 });
        needsSystem(w, true);
        const n = getComponent(w, e, NEEDS);
        assert.equal(n.exhaustion, 0);
    });

    it("does NOT auto-eat when not at rest area", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5, hunger: 55 });
        needsSystem(w, true);
        const n = getComponent(w, e, NEEDS);
        assert.ok(n.hunger > 55); // only accumulated, no relief
    });

    it("does NOT auto-eat when lights off", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 0, hunger: 55 });
        needsSystem(w, false);
        const n = getComponent(w, e, NEEDS);
        assert.ok(n.hunger > 55);
    });

    it("kills NPC when hunger >= 100", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5, hunger: 99.99 });
        needsSystem(w, true);
        const ident = getComponent(w, e, IDENTITY);
        assert.equal(ident.alive, false);
    });

    it("kills NPC when thirst >= 100", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5, thirst: 99.99 });
        needsSystem(w, true);
        const ident = getComponent(w, e, IDENTITY);
        assert.equal(ident.alive, false);
    });

    it("skips dead entities", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5, alive: false, hunger: 50 });
        needsSystem(w, true);
        const n = getComponent(w, e, NEEDS);
        assert.equal(n.hunger, 50); // unchanged
    });

    it("batch mode accumulates needs", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5 });
        needsSystem(w, true, undefined, 100);
        const n = getComponent(w, e, NEEDS);
        assert.ok(n.hunger > DEFAULT_NEEDS.hungerRate * 50);
        assert.ok(n.thirst > DEFAULT_NEEDS.thirstRate * 50);
    });

    it("batch mode auto-eats multiple cycles at rest area", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 0 });
        needsSystem(w, true, undefined, 10000);
        const n = getComponent(w, e, NEEDS);
        // After 10000 ticks at rest area, should have eaten many times
        // hunger should be well below 100 despite accumulation
        assert.ok(n.hunger < DEFAULT_NEEDS.eatThreshold);
    });
});

describe("needsDecayMultiplier", () => {
    it("returns 1.0 when no needs critical", () => {
        assert.equal(needsDecayMultiplier({ hunger: 50, thirst: 50, exhaustion: 50 }), 1.0);
    });

    it("returns 1.5 when 1 need critical", () => {
        assert.equal(needsDecayMultiplier({ hunger: 85, thirst: 50, exhaustion: 50 }), 1.5);
    });

    it("returns 2.0 when 2+ needs critical", () => {
        assert.equal(needsDecayMultiplier({ hunger: 85, thirst: 85, exhaustion: 50 }), 2.0);
    });
});

describe("resetNeedsAtDawn", () => {
    it("revives dead NPCs and resets needs", () => {
        const w = createWorld();
        const e = makeNpc(w, { alive: false, hunger: 100, thirst: 100, exhaustion: 50 });
        resetNeedsAtDawn(w);
        const ident = getComponent(w, e, IDENTITY);
        const n = getComponent(w, e, NEEDS);
        assert.equal(ident.alive, true);
        assert.equal(n.hunger, 0);
        assert.equal(n.thirst, 0);
        assert.equal(n.exhaustion, 0);
    });

    it("does not reset alive NPCs", () => {
        const w = createWorld();
        const e = makeNpc(w, { alive: true, hunger: 50, thirst: 30, exhaustion: 20 });
        resetNeedsAtDawn(w);
        const n = getComponent(w, e, NEEDS);
        assert.equal(n.hunger, 50);
        assert.equal(n.thirst, 30);
    });
});
