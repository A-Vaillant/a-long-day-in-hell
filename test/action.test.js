import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { costsTick, TICK_ACTIONS, INSTANT_ACTIONS } from "../lib/action.core.ts";
import {
    evaluateIntent, getAvailableBehaviors, intentSystem,
    DEFAULT_SCORERS, DEFAULT_INTENT, INTENT,
} from "../lib/intent.core.ts";
import { createWorld, spawn, addComponent, getComponent, hasComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY, PLAYER } from "../lib/social.core.ts";
import { PERSONALITY } from "../lib/personality.core.ts";
import { NEEDS } from "../lib/needs.core.ts";

function makeRng(val = 0.5) {
    return { next() { return val; }, nextInt(n) { return Math.floor(val * n); } };
}

describe("action.core", () => {
    it("costsTick returns true for tick actions", () => {
        assert.ok(costsTick({ type: "move", dir: "left" }));
        assert.ok(costsTick({ type: "wait" }));
        assert.ok(costsTick({ type: "eat" }));
        assert.ok(costsTick({ type: "sleep" }));
    });

    it("costsTick returns false for instant actions", () => {
        assert.ok(!costsTick({ type: "take_book", bookIndex: 0 }));
        assert.ok(!costsTick({ type: "drop_book" }));
        assert.ok(!costsTick({ type: "throw_book" }));
        assert.ok(!costsTick({ type: "chasm_jump" }));
    });

    it("social actions cost ticks", () => {
        assert.ok(costsTick({ type: "seek_companion", targetId: 1 }));
        assert.ok(costsTick({ type: "flee" }));
    });
});

describe("getAvailableBehaviors", () => {
    function makeWorld() {
        const world = createWorld();
        const entity = spawn(world);
        addComponent(world, entity, POSITION, { side: 0, position: 5, floor: 10 });
        addComponent(world, entity, IDENTITY, { name: "Test", alive: true });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, entity, PERSONALITY, {
            temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5,
        });
        return { world, entity };
    }

    it("returns scored behaviors sorted by score", () => {
        const { world, entity } = makeWorld();
        const results = getAvailableBehaviors(world, entity, makeRng());
        assert.ok(results.length > 0);
        // Should be sorted descending
        for (let i = 1; i < results.length; i++) {
            assert.ok(results[i - 1].score >= results[i].score,
                `${results[i-1].behavior}(${results[i-1].score}) >= ${results[i].behavior}(${results[i].score})`);
        }
    });

    it("excludes behaviors with -Infinity score", () => {
        const { world, entity } = makeWorld();
        const results = getAvailableBehaviors(world, entity, makeRng());
        // wander_mad should be excluded (entity is not mad)
        const mad = results.find(r => r.behavior === "wander_mad");
        assert.equal(mad, undefined);
    });

    it("includes explore and search for calm entity", () => {
        const { world, entity } = makeWorld();
        const results = getAvailableBehaviors(world, entity, makeRng());
        const behaviors = results.map(r => r.behavior);
        assert.ok(behaviors.includes("explore"), "should include explore");
        assert.ok(behaviors.includes("search"), "should include search");
    });

    it("includes seek_rest when needs are high", () => {
        const { world, entity } = makeWorld();
        addComponent(world, entity, NEEDS, { hunger: 90, thirst: 90, exhaustion: 50 });
        const results = getAvailableBehaviors(world, entity, makeRng());
        const behaviors = results.map(r => r.behavior);
        assert.ok(behaviors.includes("seek_rest"));
    });

    it("returns empty for missing components", () => {
        const world = createWorld();
        const entity = spawn(world);
        const results = getAvailableBehaviors(world, entity, makeRng());
        assert.equal(results.length, 0);
    });
});

describe("intentSystem skips player", () => {
    it("does not modify player intent", () => {
        const world = createWorld();

        // Player entity
        const player = spawn(world);
        addComponent(world, player, IDENTITY, { name: "Player", alive: true });
        addComponent(world, player, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, player, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, player, PLAYER, {});
        addComponent(world, player, PERSONALITY, {
            temperament: 0.5, pace: 0.8, openness: 0.5, outlook: 0.5,
        });

        // NPC entity (should get updated)
        const npc = spawn(world);
        addComponent(world, npc, IDENTITY, { name: "NPC", alive: true });
        addComponent(world, npc, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, npc, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, npc, PERSONALITY, {
            temperament: 0.5, pace: 0.8, openness: 0.5, outlook: 0.5,
        });

        intentSystem(world, makeRng());

        const playerIntent = getComponent(world, player, INTENT);
        const npcIntent = getComponent(world, npc, INTENT);

        // Player should stay idle (not touched by arbiter)
        assert.equal(playerIntent.behavior, "idle");
        assert.equal(playerIntent.elapsed, 0); // not incremented

        // NPC should have been evaluated (behavior changed from idle)
        assert.notEqual(npcIntent.behavior, "idle", "NPC should have switched from idle");
    });
});
