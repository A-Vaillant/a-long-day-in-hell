import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectEvents } from "../src/js/godmode-detect.js";

function makeNpc(overrides) {
    return {
        id: 0, name: "Alice", side: 0, position: 0, floor: 100,
        disposition: "calm", alive: true, lucidity: 100, hope: 100,
        personality: null, bonds: [], groupId: null,
        ...overrides,
    };
}

function makeSnap(npcs, overrides) {
    return { npcs, day: 1, tick: 10, lightsOn: true, ...overrides };
}

describe("detectEvents", () => {
    it("returns empty for identical snapshots", () => {
        const npc = makeNpc();
        const snap = makeSnap([npc]);
        const events = detectEvents(snap, snap);
        assert.strictEqual(events.length, 0);
    });

    it("returns empty for null inputs", () => {
        assert.deepStrictEqual(detectEvents(null, null), []);
        assert.deepStrictEqual(detectEvents(null, makeSnap([])), []);
        assert.deepStrictEqual(detectEvents(makeSnap([]), null), []);
    });

    it("detects death", () => {
        const prev = makeSnap([makeNpc({ alive: true })]);
        const curr = makeSnap([makeNpc({ alive: false })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "death");
        assert.ok(events[0].text.includes("Alice"));
        assert.ok(events[0].text.includes("died"));
    });

    it("detects resurrection", () => {
        const prev = makeSnap([makeNpc({ alive: false })]);
        const curr = makeSnap([makeNpc({ alive: true })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "resurrection");
        assert.ok(events[0].text.includes("dawn"));
    });

    it("detects disposition change", () => {
        const prev = makeSnap([makeNpc({ disposition: "calm" })]);
        const curr = makeSnap([makeNpc({ disposition: "anxious" })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "disposition");
        assert.ok(events[0].text.includes("anxious"));
    });

    it("does not emit disposition change for dead NPCs", () => {
        const prev = makeSnap([makeNpc({ disposition: "calm", alive: false })]);
        const curr = makeSnap([makeNpc({ disposition: "dead", alive: false })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 0);
    });

    it("detects new bond (familiarity crosses 1.0)", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", bonds: [] }),
            makeNpc({ id: 1, name: "Bob", bonds: [] }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", bonds: [{ name: "Bob", familiarity: 1.5, affinity: 0.5 }] }),
            makeNpc({ id: 1, name: "Bob", bonds: [{ name: "Alice", familiarity: 1.5, affinity: 0.5 }] }),
        ]);
        const events = detectEvents(prev, curr);
        // Only one event (alphabetically first emits)
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "bond");
        assert.ok(events[0].text.includes("Alice"));
        assert.ok(events[0].text.includes("Bob"));
    });

    it("does not duplicate bond event for reverse pair", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Zara", bonds: [] }),
            makeNpc({ id: 1, name: "Amy", bonds: [] }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Zara", bonds: [{ name: "Amy", familiarity: 2, affinity: 1 }] }),
            makeNpc({ id: 1, name: "Amy", bonds: [{ name: "Zara", familiarity: 2, affinity: 1 }] }),
        ]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.ok(events[0].text.startsWith("Amy"), "alphabetically first name emits");
    });

    it("does not emit bond for already-known NPC", () => {
        const existingBond = { name: "Bob", familiarity: 5, affinity: 2 };
        const prev = makeSnap([makeNpc({ bonds: [existingBond] })]);
        const curr = makeSnap([makeNpc({ bonds: [{ ...existingBond, familiarity: 6 }] })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 0);
    });

    it("detects group formation", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 7 }),
            makeNpc({ id: 1, name: "Bob", groupId: 7 }),
        ]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "group");
        assert.ok(events[0].text.includes("Alice"));
        assert.ok(events[0].text.includes("Bob"));
        assert.ok(events[0].text.includes("formed a group"));
    });

    it("does not duplicate group event (only lowest id emits)", () => {
        const prev = makeSnap([
            makeNpc({ id: 5, name: "Eve", groupId: null }),
            makeNpc({ id: 2, name: "Charlie", groupId: null }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 5, name: "Eve", groupId: 3 }),
            makeNpc({ id: 2, name: "Charlie", groupId: 3 }),
        ]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1, "exactly one group event");
    });

    it("handles multiple events in one tick", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", disposition: "calm", alive: true, bonds: [] }),
            makeNpc({ id: 1, name: "Bob", alive: true }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", disposition: "anxious", alive: true,
                bonds: [{ name: "Bob", familiarity: 2, affinity: 1 }] }),
            makeNpc({ id: 1, name: "Bob", alive: false }),
        ]);
        const events = detectEvents(prev, curr);
        const types = events.map(e => e.type);
        assert.ok(types.includes("disposition"), "has disposition event");
        assert.ok(types.includes("death"), "has death event");
        assert.ok(types.includes("bond"), "has bond event");
    });
});
