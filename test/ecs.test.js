import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, removeComponent,
    getComponent, hasComponent, query, destroy, entitiesWith,
} from "../lib/ecs.core.ts";

describe("createWorld", () => {
    it("returns a world with nextId 0 and empty components", () => {
        const w = createWorld();
        assert.strictEqual(w.nextId, 0);
        assert.strictEqual(w.components.size, 0);
    });
});

describe("spawn", () => {
    it("returns incrementing IDs", () => {
        const w = createWorld();
        assert.strictEqual(spawn(w), 0);
        assert.strictEqual(spawn(w), 1);
        assert.strictEqual(spawn(w), 2);
    });
});

describe("addComponent / getComponent / hasComponent", () => {
    it("stores and retrieves a component", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, "pos", { x: 1, y: 2 });
        assert.deepStrictEqual(getComponent(w, e, "pos"), { x: 1, y: 2 });
        assert.strictEqual(hasComponent(w, e, "pos"), true);
    });

    it("returns undefined for missing component", () => {
        const w = createWorld();
        const e = spawn(w);
        assert.strictEqual(getComponent(w, e, "pos"), undefined);
        assert.strictEqual(hasComponent(w, e, "pos"), false);
    });

    it("returns undefined for non-existent component key", () => {
        const w = createWorld();
        assert.strictEqual(getComponent(w, 999, "nope"), undefined);
        assert.strictEqual(hasComponent(w, 999, "nope"), false);
    });

    it("overwrites existing component", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, "pos", { x: 1 });
        addComponent(w, e, "pos", { x: 99 });
        assert.deepStrictEqual(getComponent(w, e, "pos"), { x: 99 });
    });

    it("different entities have independent components", () => {
        const w = createWorld();
        const a = spawn(w);
        const b = spawn(w);
        addComponent(w, a, "hp", { val: 10 });
        addComponent(w, b, "hp", { val: 50 });
        assert.deepStrictEqual(getComponent(w, a, "hp"), { val: 10 });
        assert.deepStrictEqual(getComponent(w, b, "hp"), { val: 50 });
    });
});

describe("removeComponent", () => {
    it("removes a component", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, "pos", { x: 1 });
        removeComponent(w, e, "pos");
        assert.strictEqual(hasComponent(w, e, "pos"), false);
        assert.strictEqual(getComponent(w, e, "pos"), undefined);
    });

    it("no-op for missing component", () => {
        const w = createWorld();
        const e = spawn(w);
        removeComponent(w, e, "pos"); // should not throw
    });

    it("no-op for non-existent component key", () => {
        const w = createWorld();
        removeComponent(w, 0, "nope"); // should not throw
    });
});

describe("query", () => {
    it("returns entities with all specified components", () => {
        const w = createWorld();
        const a = spawn(w);
        const b = spawn(w);
        const c = spawn(w);
        addComponent(w, a, "pos", { x: 1 });
        addComponent(w, a, "hp", { val: 10 });
        addComponent(w, b, "pos", { x: 2 });
        // b has no hp
        addComponent(w, c, "pos", { x: 3 });
        addComponent(w, c, "hp", { val: 30 });

        const results = query(w, ["pos", "hp"]);
        assert.strictEqual(results.length, 2);
        const ids = results.map(r => r[0]);
        assert.ok(ids.includes(a));
        assert.ok(ids.includes(c));
        assert.ok(!ids.includes(b));
    });

    it("returns component values in key order", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, "pos", { x: 5 });
        addComponent(w, e, "hp", { val: 42 });

        const results = query(w, ["pos", "hp"]);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0][0], e);
        assert.deepStrictEqual(results[0][1], { x: 5 });
        assert.deepStrictEqual(results[0][2], { val: 42 });
    });

    it("returns empty for no matching entities", () => {
        const w = createWorld();
        spawn(w);
        assert.deepStrictEqual(query(w, ["pos"]), []);
    });

    it("returns empty for empty keys", () => {
        const w = createWorld();
        assert.deepStrictEqual(query(w, []), []);
    });

    it("returns empty when a component key has no map", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, "pos", { x: 1 });
        assert.deepStrictEqual(query(w, ["pos", "nonexistent"]), []);
    });

    it("single-component query works", () => {
        const w = createWorld();
        const a = spawn(w);
        const b = spawn(w);
        addComponent(w, a, "tag", {});
        const results = query(w, ["tag"]);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0][0], a);
    });
});

describe("destroy", () => {
    it("removes entity from all component maps", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, "pos", { x: 1 });
        addComponent(w, e, "hp", { val: 10 });
        addComponent(w, e, "tag", {});
        destroy(w, e);
        assert.strictEqual(hasComponent(w, e, "pos"), false);
        assert.strictEqual(hasComponent(w, e, "hp"), false);
        assert.strictEqual(hasComponent(w, e, "tag"), false);
    });

    it("does not affect other entities", () => {
        const w = createWorld();
        const a = spawn(w);
        const b = spawn(w);
        addComponent(w, a, "pos", { x: 1 });
        addComponent(w, b, "pos", { x: 2 });
        destroy(w, a);
        assert.deepStrictEqual(getComponent(w, b, "pos"), { x: 2 });
    });

    it("no-op for entity with no components", () => {
        const w = createWorld();
        const e = spawn(w);
        destroy(w, e); // should not throw
    });
});

describe("entitiesWith", () => {
    it("returns all entities that have the component", () => {
        const w = createWorld();
        const a = spawn(w);
        const b = spawn(w);
        const c = spawn(w);
        addComponent(w, a, "pos", {});
        addComponent(w, c, "pos", {});
        const result = entitiesWith(w, "pos");
        assert.strictEqual(result.length, 2);
        assert.ok(result.includes(a));
        assert.ok(result.includes(c));
    });

    it("returns empty for non-existent key", () => {
        const w = createWorld();
        assert.deepStrictEqual(entitiesWith(w, "nope"), []);
    });
});
