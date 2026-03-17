import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY } from "../lib/social.core.ts";
import { INTENT } from "../lib/intent.core.ts";
import { MOVEMENT } from "../lib/movement.core.ts";
import { SEARCHING, createSearching } from "../lib/search.core.ts";
import { SLEEP } from "../lib/sleep.core.ts";
import { MEMORY, createMemory, grantBookVision, getBookVision } from "../lib/memory.core.ts";
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";
import { behaviorToAction } from "../lib/npc-action.core.ts";
import { resolveAction } from "../lib/action-dispatch.core.ts";

function makeNpc(world, overrides = {}) {
    const entity = spawn(world);
    addComponent(world, entity, POSITION, {
        side: overrides.side ?? 0,
        position: overrides.position ?? 5n,
        floor: overrides.floor ?? 10n,
    });
    addComponent(world, entity, IDENTITY, {
        name: overrides.name ?? "TestNPC",
        alive: overrides.alive ?? true,
        free: false,
    });
    addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
    addComponent(world, entity, INTENT, {
        behavior: overrides.behavior ?? "idle",
        cooldown: 0,
        elapsed: 0,
    });
    addComponent(world, entity, MOVEMENT, {
        targetPosition: null,
        heading: overrides.heading ?? 1,
    });
    addComponent(world, entity, SEARCHING, createSearching());
    const mem = createMemory();
    addComponent(world, entity, MEMORY, mem);
    if (overrides.homePosition !== undefined) {
        addComponent(world, entity, SLEEP, {
            home: { side: 0, position: overrides.homePosition, floor: overrides.floor ?? 10n },
            bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0,
            nomadic: false,
        });
    }
    return { entity, mem };
}

describe("behaviorToAction", () => {
    it("idle → wait", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "idle" });
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "wait" });
    });

    it("explore → move in heading direction", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "explore", heading: 1 });
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "move", dir: "right" });
    });

    it("explore with negative heading → move left", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "explore", heading: -1 });
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "move", dir: "left" });
    });

    it("seek_rest → move toward nearest rest area", () => {
        const world = createWorld();
        // At position 5, nearest rest area is 0 (distance 5) or 17 (distance 12)
        const { entity } = makeNpc(world, { behavior: "seek_rest", position: 5n });
        const action = behaviorToAction(world, entity);
        assert.equal(action.type, "move");
        assert.equal(action.dir, "left"); // toward 0
    });

    it("seek_rest at rest area → wait", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "seek_rest", position: 0n });
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "wait" });
    });

    it("pilgrimage → move toward vision coords", () => {
        const world = createWorld();
        const { entity, mem } = makeNpc(world, { behavior: "pilgrimage", position: 5n, floor: 10n });
        grantBookVision(mem, { side: 0, position: 100n, floor: 10n, bookIndex: 3 }, 0);
        const action = behaviorToAction(world, entity);
        assert.equal(action.type, "move");
        assert.equal(action.dir, "right"); // toward position 100
    });

    it("pilgrimage on wrong floor → move to rest area for stairs", () => {
        const world = createWorld();
        const { entity, mem } = makeNpc(world, { behavior: "pilgrimage", position: 0n, floor: 5n });
        grantBookVision(mem, { side: 0, position: 100n, floor: 10n, bookIndex: 3 }, 0);
        const action = behaviorToAction(world, entity);
        // At rest area (pos 0), different floor → go up
        assert.equal(action.type, "move");
        assert.equal(action.dir, "up");
    });

    it("pilgrimage on wrong side → cross at floor 0", () => {
        const world = createWorld();
        const { entity, mem } = makeNpc(world, { behavior: "pilgrimage", position: 0n, floor: 0n, side: 0 });
        grantBookVision(mem, { side: 1, position: 100n, floor: 10n, bookIndex: 3 }, 0);
        const action = behaviorToAction(world, entity);
        assert.equal(action.type, "move");
        assert.equal(action.dir, "cross");
    });

    it("pilgrimage with found book → head to rest area", () => {
        const world = createWorld();
        const { entity, mem } = makeNpc(world, { behavior: "pilgrimage", position: 5n, floor: 10n });
        grantBookVision(mem, { side: 0, position: 100n, floor: 10n, bookIndex: 3 }, 0);
        getBookVision(mem).state = "found";
        const action = behaviorToAction(world, entity);
        assert.equal(action.type, "move");
        assert.equal(action.dir, "left"); // toward rest area at 0
    });

    it("pilgrimage without vision → wait", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "pilgrimage" });
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "wait" });
    });

    it("search with active searching → read_book", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "search", position: 5n });
        const search = getComponent(world, entity, "searching");
        search.active = true;
        search.bookIndex = 7;
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "read_book", bookIndex: 7 });
    });

    it("search without active searching → wait", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "search" });
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "wait" });
    });

    it("wander_mad → move (direction varies)", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "wander_mad" });
        const action = behaviorToAction(world, entity);
        assert.equal(action.type, "move");
        assert.ok(action.dir === "left" || action.dir === "right");
    });

    it("socialize → wait", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "socialize" });
        const action = behaviorToAction(world, entity);
        assert.deepEqual(action, { type: "wait" });
    });

    it("dead NPC → null", () => {
        const world = createWorld();
        const { entity } = makeNpc(world, { behavior: "explore", alive: false });
        const action = behaviorToAction(world, entity);
        assert.equal(action, null);
    });

    it("return_home → move toward home position", () => {
        const world = createWorld();
        const G = BigInt(GALLERIES_PER_SEGMENT);
        const { entity } = makeNpc(world, {
            behavior: "return_home",
            position: 5n,
            floor: 10n,
            homePosition: 0n,
        });
        const action = behaviorToAction(world, entity);
        assert.equal(action.type, "move");
        assert.equal(action.dir, "left"); // toward home at 0
    });
});

describe("resolveAction for NPC-like state", () => {
    // resolveAction works on GameState. For NPCs, we construct a minimal
    // GameState-shaped object from ECS components. This tests that the
    // state mutations work correctly without time advance.

    function makeNpcState(overrides = {}) {
        return {
            side: 0, position: 5n, floor: 10n,
            tick: 0, day: 1, lightsOn: true,
            hunger: 0, thirst: 0, exhaustion: 0, morale: 100, mortality: 100,
            despairing: false, dead: false,
            heldBook: null, openBook: null, openPage: 0,
            dwellHistory: {},
            targetBook: { side: 0, position: 100n, floor: 50n, bookIndex: 5 },
            submissionsAttempted: 0, nonsensePagesRead: 0, totalMoves: 0,
            deaths: 0, deathCause: null,
            _mercyKiosks: {}, _mercyKioskDone: false, _mercyArrival: null, _despairDays: 0,
            falling: null, eventDeck: [], lastEvent: null,
            won: false, _readBlocked: false, _submissionWon: false, _lastMove: null,
            ...overrides,
        };
    }

    const ctx = { seed: "npc-test", eventCards: [] };

    it("move right changes position without advancing time", () => {
        const s = makeNpcState({ position: 5n });
        const r = resolveAction(s, { type: "move", dir: "right" }, ctx);
        assert.equal(r.resolved, true);
        assert.equal(s.position, 6n);
        assert.equal(r.ticksConsumed, 0); // no time advance
        assert.equal(s.tick, 0); // time unchanged
    });

    it("wait resolves without state mutation", () => {
        const s = makeNpcState();
        const r = resolveAction(s, { type: "wait" }, ctx);
        assert.equal(r.resolved, true);
        assert.equal(s.tick, 0); // time unchanged
    });

    it("eat at rest area changes hunger without advancing time", () => {
        const s = makeNpcState({ position: 0n, hunger: 50 });
        const r = resolveAction(s, { type: "eat" }, ctx);
        assert.equal(r.resolved, true);
        assert.ok(s.hunger < 50);
        assert.equal(s.tick, 0);
    });

    it("move up applies exhaustion", () => {
        const s = makeNpcState({ position: 0n, floor: 5n });
        resolveAction(s, { type: "move", dir: "up" }, ctx);
        assert.ok(s.exhaustion >= 1.5);
    });

    it("multiple NPCs can resolve actions on separate state objects", () => {
        const s1 = makeNpcState({ position: 5n });
        const s2 = makeNpcState({ position: 10n });
        resolveAction(s1, { type: "move", dir: "right" }, ctx);
        resolveAction(s2, { type: "move", dir: "left" }, ctx);
        assert.equal(s1.position, 6n);
        assert.equal(s2.position, 9n);
        // Neither affected the other
    });
});
