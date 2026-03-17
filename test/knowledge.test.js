import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateNpcLifeStory, generateLifeStory } from "../lib/lifestory.core.ts";
import {
    MEMORY, createMemory,
    grantBookVision, grantVagueBookVision,
    getBookVision, isAtBookSegment, isInVisionRadius,
} from "../lib/memory.core.ts";
import { PLAYABLE_ADDRESS_MAX } from "../lib/invertible.core.ts";

import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY } from "../lib/social.core.ts";
import { PERSONALITY } from "../lib/personality.core.ts";
import { INTENT } from "../lib/intent.core.ts";
import {
    evaluateIntent, getAvailableBehaviors, DEFAULT_SCORERS,
    DEFAULT_INTENT,
} from "../lib/intent.core.ts";
import { MOVEMENT, movementSystem } from "../lib/movement.core.ts";
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";

function makeRng(val = 0.5) {
    return { next() { return val; }, nextInt(n) { return Math.floor(val * n); } };
}

// Shared anchors
const _playerStory = generateLifeStory("knowledge-test-seed");
const TEST_PLAYER_RAW = _playerStory.rawBookAddress;
const TEST_RANDOM_ORIGIN = PLAYABLE_ADDRESS_MAX / 2n;

describe("generateNpcLifeStory (from lifestory.core)", () => {
    it("returns a life story with book coords", () => {
        const story = generateNpcLifeStory("test-seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        assert.ok(story.name);
        assert.ok(story.storyText);
        assert.ok(story.bookCoords);
        assert.equal(typeof story.bookCoords.side, "number");
        assert.equal(typeof story.bookCoords.position, "bigint");
        assert.equal(typeof story.bookCoords.floor, "bigint");
        assert.equal(typeof story.bookCoords.bookIndex, "number");
    });

    it("different NPC IDs produce different life stories", () => {
        const s1 = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        const s2 = generateNpcLifeStory("seed", 1, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        assert.notEqual(s1.name, s2.name);
    });

    it("same seed + NPC ID is deterministic", () => {
        const s1 = generateNpcLifeStory("seed", 5, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        const s2 = generateNpcLifeStory("seed", 5, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        assert.equal(s1.name, s2.name);
        assert.equal(s1.storyText, s2.storyText);
        assert.deepEqual(s1.bookCoords, s2.bookCoords);
    });
});

describe("Memory book vision (replaces Knowledge)", () => {
    it("createMemory starts with no bookVision", () => {
        const mem = createMemory();
        assert.equal(getBookVision(mem), null);
    });

    it("grantBookVision creates a bookVision entry", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        const vision = getBookVision(mem);
        assert.ok(vision);
        assert.deepEqual(vision.coords, story.bookCoords);
        assert.equal(vision.state, "granted");
        assert.equal(vision.accurate, true);
        assert.equal(vision.vague, false);
    });

    it("grantVagueBookVision sets vague flag and radius", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantVagueBookVision(mem, story.bookCoords, 50, 0);
        const vision = getBookVision(mem);
        assert.ok(vision);
        assert.equal(vision.vague, true);
        assert.equal(vision.radius, 50);
        assert.equal(vision.accurate, true);
        assert.equal(vision.coords.side, story.bookCoords.side);
        assert.equal(vision.coords.floor, story.bookCoords.floor);
        const diff = vision.coords.position > story.bookCoords.position
            ? vision.coords.position - story.bookCoords.position
            : story.bookCoords.position - vision.coords.position;
        assert.ok(diff <= 50n, "jittered position within radius: diff=" + diff);
    });

    it("isInVisionRadius true when within radius", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantVagueBookVision(mem, story.bookCoords, 50, 0);
        const vision = getBookVision(mem);
        const pos = { side: vision.coords.side, position: vision.coords.position + 10n, floor: vision.coords.floor };
        assert.equal(isInVisionRadius(vision, pos), true);
    });

    it("isInVisionRadius false when outside radius", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantVagueBookVision(mem, story.bookCoords, 50, 0);
        const vision = getBookVision(mem);
        const pos = { side: vision.coords.side, position: vision.coords.position + 200n, floor: vision.coords.floor };
        assert.equal(isInVisionRadius(vision, pos), false);
    });

    it("isInVisionRadius false when on wrong side or floor", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantVagueBookVision(mem, story.bookCoords, 50, 0);
        const vision = getBookVision(mem);
        const wrongSide = { side: 1 - vision.coords.side, position: vision.coords.position, floor: vision.coords.floor };
        assert.equal(isInVisionRadius(vision, wrongSide), false);
        const wrongFloor = { side: vision.coords.side, position: vision.coords.position, floor: vision.coords.floor + 1n };
        assert.equal(isInVisionRadius(vision, wrongFloor), false);
    });

    it("isInVisionRadius false when no vision", () => {
        assert.equal(isInVisionRadius(null, { side: 0, position: 0n, floor: 10n }), false);
    });

    it("grantBookVision (accurate) sets coords to actual book location", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        const vision = getBookVision(mem);
        assert.deepEqual(vision.coords, story.bookCoords);
        assert.equal(vision.accurate, true);
    });
});

describe("pilgrimage intent scorer", () => {
    function makeEntity(world, opts = {}) {
        const entity = spawn(world);
        addComponent(world, entity, POSITION, {
            side: opts.side ?? 0, position: opts.position ?? 5n, floor: opts.floor ?? 10n,
        });
        addComponent(world, entity, IDENTITY, { name: "Test", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, entity, PERSONALITY, {
            temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5,
        });
        return entity;
    }

    it("pilgrimage excluded when no memory", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined);
    });

    it("pilgrimage excluded when no bookVision in memory", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        addComponent(world, entity, MEMORY, createMemory());
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined);
    });

    it("pilgrimage scores high when bookVision is set", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 5n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.ok(pilgrim, "pilgrimage should be in results");
        assert.ok(pilgrim.score >= 2.0, "pilgrimage should score high: " + pilgrim.score);
        assert.equal(results[0].behavior, "pilgrimage",
            "pilgrimage should be highest-scored: " + JSON.stringify(results.slice(0, 3)));
    });

    it("pilgrimage excluded when already at book location", () => {
        const world = createWorld();
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 5n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        const vision = getBookVision(mem);
        const entity = makeEntity(world, {
            side: vision.coords.side,
            position: vision.coords.position,
            floor: vision.coords.floor,
        });
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined, "pilgrimage should not appear when at destination");
    });

    it("pilgrimage excluded when bookVision state is exhausted", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 5n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        getBookVision(mem).state = "exhausted";
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined, "pilgrimage should not appear when exhausted");
    });

    it("pilgrimage excluded when vague vision and within radius (search takes over)", () => {
        const world = createWorld();
        const mem = createMemory();
        // Manually place vague vision near entity
        grantVagueBookVision(mem, { side: 0, position: 20n, floor: 10n, bookIndex: 5 }, 50, 0);
        // Entity at position 5, vision jittered near 20, radius 50 → within radius
        const entity = makeEntity(world, { side: 0, position: 5n, floor: 10n });
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined, "pilgrimage should yield to search when in vision radius");
    });

    it("pilgrimage still scores when vague vision but outside radius", () => {
        const world = createWorld();
        const entity = makeEntity(world, { side: 0, position: 5n, floor: 10n });
        const mem = createMemory();
        grantVagueBookVision(mem, { side: 0, position: 500n, floor: 10n, bookIndex: 5 }, 50, 0);
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.ok(pilgrim, "pilgrimage should score when outside vague radius");
    });

    it("pilgrimage excluded when entity is free (dead)", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const ident = getComponent(world, entity, "identity");
        ident.alive = false;
        ident.free = true;
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 5n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        addComponent(world, entity, MEMORY, mem);
        const intent = getComponent(world, entity, "intent");
        const result = evaluateIntent(
            intent, { lucidity: 80, hope: 80 }, false, null, null, makeRng(),
        );
        assert.equal(result, null, "already idle, no transition needed");
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
        addComponent(world, entity, MOVEMENT, { targetPosition: null, heading: 1 });
        const mem = createMemory();
        grantBookVision(mem, { ...visionCoords }, 0);
        addComponent(world, entity, MEMORY, mem);
        return { world, entity };
    }

    it("moves toward target position on same side/floor", () => {
        const { world, entity } = makeWorld(
            { side: 0, position: 5n, floor: 10n },
            { side: 0, position: 15n, floor: 10n, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.position, 6n, "should step toward target");
    });

    it("goes to rest area then changes floor", () => {
        const restPos = GALLERIES_PER_SEGMENT;
        const { world, entity } = makeWorld(
            { side: 0, position: restPos, floor: 10n },
            { side: 0, position: restPos, floor: 20n, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.floor, 11n, "should go up one floor");
    });

    it("goes to floor 0 and crosses chasm for wrong side", () => {
        const { world, entity } = makeWorld(
            { side: 0, position: 0n, floor: 0n },
            { side: 1, position: 5n, floor: 10n, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.side, 1, "should cross chasm");
    });

    it("descends toward floor 0 when on wrong side", () => {
        const { world, entity } = makeWorld(
            { side: 0, position: 0n, floor: 5n },
            { side: 1, position: 5n, floor: 10n, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.floor, 4n, "should descend toward floor 0");
        assert.equal(pos.side, 0, "should not have crossed yet");
    });

    it("batch mode handles multi-axis pilgrimage", () => {
        const { world, entity } = makeWorld(
            { side: 0, position: 5n, floor: 10n },
            { side: 0, position: 15n, floor: 10n, bookIndex: 0 },
        );
        movementSystem(world, makeRng(0.01), undefined, 100);
        const pos = getComponent(world, entity, POSITION);
        assert.equal(pos.position, 15n, "should have reached target position");
    });
});

describe("pilgrimage intent scorer (memory-based)", () => {
    function makeEntity(world, opts = {}) {
        const entity = spawn(world);
        addComponent(world, entity, POSITION, {
            side: opts.side ?? 0, position: opts.position ?? 5n, floor: opts.floor ?? 10n,
        });
        addComponent(world, entity, IDENTITY, { name: "Test", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, entity, PERSONALITY, {
            temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5,
        });
        return entity;
    }

    it("pilgrimage scores high with bookVision memory", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const mem = createMemory();
        grantBookVision(mem, { side: 1, position: 500n, floor: 30n, bookIndex: 2 }, 0);
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.ok(pilgrim, "pilgrimage should score with bookVision memory");
        assert.ok(pilgrim.score >= 2.0);
    });

    it("pilgrimage excluded with exhausted bookVision memory", () => {
        const world = createWorld();
        const entity = makeEntity(world);
        const mem = createMemory();
        grantBookVision(mem, { side: 0, position: 500n, floor: 30n, bookIndex: 2 }, 0);
        getBookVision(mem).state = "exhausted";
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined);
    });

    it("pilgrimage excluded when at exact vision location via memory", () => {
        const world = createWorld();
        const mem = createMemory();
        grantBookVision(mem, { side: 0, position: 20n, floor: 10n, bookIndex: 3 }, 0);
        const vision = getBookVision(mem);
        const entity = makeEntity(world, {
            side: vision.coords.side,
            position: vision.coords.position,
            floor: vision.coords.floor,
        });
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined, "pilgrimage should not appear when already at destination");
    });

    it("pilgrimage excluded when vague vision and within radius via memory", () => {
        const world = createWorld();
        const entity = makeEntity(world, { side: 0, position: 5n, floor: 10n });
        const mem = createMemory();
        grantVagueBookVision(mem, { side: 0, position: 20n, floor: 10n, bookIndex: 5 }, 50, 0);
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined, "pilgrimage should yield to search when within vague radius");
    });

    it("pilgrimage still scores when vague vision but outside radius via memory", () => {
        const world = createWorld();
        const entity = makeEntity(world, { side: 0, position: 5n, floor: 10n });
        const mem = createMemory();
        grantVagueBookVision(mem, { side: 0, position: 500n, floor: 10n, bookIndex: 5 }, 50, 0);
        addComponent(world, entity, MEMORY, mem);
        const results = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = results.find(r => r.behavior === "pilgrimage");
        assert.ok(pilgrim, "pilgrimage should score when outside vague radius");
    });
});

describe("escape resolution (memory-based)", () => {
    it("isAtBookSegment returns true at matching segment", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 5n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        const vision = getBookVision(mem);
        const at = isAtBookSegment(vision, {
            side: vision.coords.side,
            position: vision.coords.position,
            floor: vision.coords.floor,
        });
        assert.equal(at, true);
    });

    it("isAtBookSegment returns false at wrong position", () => {
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 5n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        const vision = getBookVision(mem);
        assert.equal(isAtBookSegment(vision, {
            side: vision.coords.side,
            position: vision.coords.position + 1n,
            floor: vision.coords.floor,
        }), false);
    });

    it("isAtBookSegment returns false without vision", () => {
        assert.equal(isAtBookSegment(null, { side: 0, position: 5n, floor: 10n }), false);
    });

    it("found state + pilgrimage targets nearest rest area", () => {
        const world = createWorld();
        const entity = spawn(world);
        addComponent(world, entity, POSITION, { side: 0, position: 7n, floor: 10n });
        addComponent(world, entity, IDENTITY, { name: "Pilgrim", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "pilgrimage", cooldown: 20, elapsed: 0 });
        addComponent(world, entity, MOVEMENT, { targetPosition: null, heading: 1 });
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 5n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        // Simulate having found the book
        getBookVision(mem).state = "found";
        addComponent(world, entity, MEMORY, mem);

        movementSystem(world, makeRng(0.01));
        const pos = getComponent(world, entity, POSITION);
        // Position 7 → nearest rest area is 0 (dist 7), should step toward it
        assert.equal(pos.position, 6n, "should step toward nearest rest area");
    });
});
