import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { KNOWLEDGE, createKnowledge, generateNpcLifeStory, grantVision, isAtBookSegment } from "../lib/knowledge.core.ts";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY } from "../lib/social.core.ts";
import { PERSONALITY } from "../lib/personality.core.ts";
import { INTENT } from "../lib/intent.core.ts";
import {
    evaluateIntent, getAvailableBehaviors, DEFAULT_SCORERS,
    DEFAULT_INTENT,
} from "../lib/intent.core.ts";
import { MOVEMENT, movementSystem } from "../lib/movement.core.ts";

function makeRng(val = 0.5) {
    return { next() { return val; }, nextInt(n) { return Math.floor(val * n); } };
}

describe("knowledge.core", () => {
    it("generateNpcLifeStory returns a life story with book coords", () => {
        const story = generateNpcLifeStory("test-seed", 0, { side: 0, position: 0, floor: 10 });
        assert.ok(story.name);
        assert.ok(story.storyText);
        assert.ok(story.bookCoords);
        assert.equal(typeof story.bookCoords.side, "number");
        assert.equal(typeof story.bookCoords.position, "number");
        assert.equal(typeof story.bookCoords.floor, "number");
        assert.equal(typeof story.bookCoords.bookIndex, "number");
    });

    it("different NPC IDs produce different life stories", () => {
        const s1 = generateNpcLifeStory("seed", 0, { side: 0, position: 0, floor: 10 });
        const s2 = generateNpcLifeStory("seed", 1, { side: 0, position: 0, floor: 10 });
        // Names should differ (extremely high probability with 25x25 pool)
        assert.notEqual(s1.name, s2.name);
    });

    it("same seed + NPC ID is deterministic", () => {
        const s1 = generateNpcLifeStory("seed", 5, { side: 0, position: 0, floor: 10 });
        const s2 = generateNpcLifeStory("seed", 5, { side: 0, position: 0, floor: 10 });
        assert.equal(s1.name, s2.name);
        assert.equal(s1.storyText, s2.storyText);
        assert.deepEqual(s1.bookCoords, s2.bookCoords);
    });

    it("createKnowledge starts with no vision", () => {
        const k = createKnowledge("seed", 0, { side: 0, position: 0, floor: 10 });
        assert.equal(k.bookVision, null);
        assert.equal(k.visionAccurate, true);
        assert.equal(k.hasBook, false);
        assert.ok(k.lifeStory.bookCoords);
    });

    it("grantVision (accurate) sets bookVision to actual coords", () => {
        const k = createKnowledge("seed", 0, { side: 0, position: 0, floor: 10 });
        grantVision(k, true);
        assert.deepEqual(k.bookVision, k.lifeStory.bookCoords);
        assert.equal(k.visionAccurate, true);
    });

    it("grantVision (false) sets bogus coords", () => {
        const k = createKnowledge("seed", 0, { side: 0, position: 0, floor: 10 });
        const bogus = { side: 1, position: 999, floor: 50, bookIndex: 42 };
        grantVision(k, false, bogus);
        assert.deepEqual(k.bookVision, bogus);
        assert.equal(k.visionAccurate, false);
    });
});

describe("pilgrimage intent scorer", () => {
    function makeEntity(world, opts = {}) {
        const entity = spawn(world);
        addComponent(world, entity, POSITION, {
            side: opts.side ?? 0, position: opts.position ?? 5, floor: opts.floor ?? 10,
        });
        addComponent(world, entity, IDENTITY, { name: "Test", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, entity, PERSONALITY, {
            temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5,
        });
        return entity;
    }

    it("pilgrimage excluded when no knowledge", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined);
    });

    it("pilgrimage excluded when no vision", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        addComponent(world, entity, KNOWLEDGE, k);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined);
    });

    it("pilgrimage scores high when vision is set", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        grantVision(k, true);
        addComponent(world, entity, KNOWLEDGE, k);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.ok(pilgrim, "pilgrimage should be in results");
        assert.ok(pilgrim.score >= 2.0, "pilgrimage should score high: " + pilgrim.score);
        // Should be top or near-top behavior
        assert.equal(results[0].behavior, "pilgrimage",
            "pilgrimage should be highest-scored: " + JSON.stringify(results.slice(0, 3)));
    });

    it("pilgrimage excluded when already at book location", () => {
        const world = createWorld();
        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        grantVision(k, true);
        // Place entity at the vision's book location
        const entity = makeEntity(world, {
            side: k.bookVision.side,
            position: k.bookVision.position,
            floor: k.bookVision.floor,
        });
        addComponent(world, entity, KNOWLEDGE, k);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined, "pilgrimage should not appear when at destination");
    });

    it("pilgrimage excluded when entity is free (dead)", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        // Mark entity as dead (free entities are dead)
        const ident = getComponent(world, entity, "identity");
        ident.alive = false;
        ident.free = true;
        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        grantVision(k, true);
        addComponent(world, entity, KNOWLEDGE, k);
        // evaluateIntent forces idle for dead entities — pilgrimage never activates
        const intent = getComponent(world, entity, "intent");
        const result = evaluateIntent(
            intent, { lucidity: 80, hope: 80 }, false, null, null, makeRng(),
        );
        // Already idle → returns null (no change). If not idle, would force idle.
        assert.equal(result, null, "already idle, no transition needed");
        // Verify: if intent were pilgrimage, it would be forced to idle
        intent.behavior = "pilgrimage";
        const result2 = evaluateIntent(
            intent, { lucidity: 80, hope: 80 }, false, null, null, makeRng(),
        );
        assert.equal(result2.behavior, "idle", "dead entity forced from pilgrimage to idle");
    });
});

describe("pilgrimage movement", () => {
    function makeWorld(npcPos, visionCoords) {
        const world = createWorld();
        const entity = spawn(world);
        addComponent(world, entity, POSITION, { ...npcPos });
        addComponent(world, entity, IDENTITY, { name: "Pilgrim", alive: true });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "pilgrimage", cooldown: 20, elapsed: 0 });
        addComponent(world, entity, MOVEMENT, { targetPosition: null, moveAccum: 0 });
        const k = createKnowledge("seed", 0, npcPos);
        k.bookVision = { ...visionCoords };
        k.visionAccurate = true;
        addComponent(world, entity, KNOWLEDGE, k);
        return { world, entity };
    }

    it("moves toward target position on same side/floor", () => {
        const { world, entity } = makeWorld(
            { side: 0, position: 5, floor: 10 },
            { side: 0, position: 15, floor: 10, bookIndex: 0 },
        );
        // rng=0.01 ensures move fires (moveProb=0.15)
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.position, 6, "should step toward target");
    });

    it("goes to rest area then changes floor", () => {
        // NPC at rest area (pos 10), needs to go to floor 20
        const { world, entity } = makeWorld(
            { side: 0, position: 10, floor: 10 },
            { side: 0, position: 10, floor: 20, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        // At rest area, same position as target → should take stairs
        assert.equal(pos.floor, 11, "should go up one floor");
    });

    it("goes to floor 0 and crosses chasm for wrong side", () => {
        // NPC at rest area (pos 0), floor 0, needs to cross to side 1
        const { world, entity } = makeWorld(
            { side: 0, position: 0, floor: 0 },
            { side: 1, position: 5, floor: 10, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.side, 1, "should cross chasm");
    });

    it("descends toward floor 0 when on wrong side", () => {
        // NPC at rest area (pos 0), floor 5, wrong side
        const { world, entity } = makeWorld(
            { side: 0, position: 0, floor: 5 },
            { side: 1, position: 5, floor: 10, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.floor, 4, "should descend toward floor 0");
        assert.equal(pos.side, 0, "should not have crossed yet");
    });

    it("batch mode handles multi-axis pilgrimage", () => {
        // NPC at pos 5, floor 10 — target at pos 15, floor 10, same side
        const { world, entity } = makeWorld(
            { side: 0, position: 5, floor: 10 },
            { side: 0, position: 15, floor: 10, bookIndex: 0 },
        );
        // Batch 100 ticks — should reach target
        movementSystem(world, makeRng(0.01), undefined, 100);
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.position, 15, "should have reached target position");
    });
});

describe("escape resolution", () => {
    it("isAtBookSegment returns true at matching segment", () => {

        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        grantVision(k, true);
        const at = isAtBookSegment(k, {
            side: k.bookVision.side,
            position: k.bookVision.position,
            floor: k.bookVision.floor,
        });
        assert.equal(at, true);
    });

    it("isAtBookSegment returns false at wrong position", () => {

        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        grantVision(k, true);
        assert.equal(isAtBookSegment(k, { side: k.bookVision.side, position: k.bookVision.position + 1, floor: k.bookVision.floor }), false);
    });

    it("isAtBookSegment returns false without vision", () => {

        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        assert.equal(isAtBookSegment(k, { side: 0, position: 5, floor: 10 }), false);
    });

    it("hasBook + pilgrimage targets nearest rest area", () => {
        // NPC with hasBook at non-rest position should target nearest rest area
        const world = createWorld();
        const entity = spawn(world);
        addComponent(world, entity, POSITION, { side: 0, position: 7, floor: 10 });
        addComponent(world, entity, IDENTITY, { name: "Pilgrim", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "pilgrimage", cooldown: 20, elapsed: 0 });
        addComponent(world, entity, MOVEMENT, { targetPosition: null, moveAccum: 0 });
        const k = createKnowledge("seed", 0, { side: 0, position: 5, floor: 10 });
        grantVision(k, true);
        k.hasBook = true;
        addComponent(world, entity, KNOWLEDGE, k);

        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        // Position 7 → nearest rest area is 10, should step toward it
        assert.equal(pos.position, 8, "should step toward rest area");
    });
});
