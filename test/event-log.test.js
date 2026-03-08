import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    appendEvents, getAll, getForNpc, count, resetLog,
} from "../src/js/event-log.js";

// saveLog/loadLog/clearLog touch localStorage — tested via DOM harness in
// test/event-log-dom.test.js

describe("event-log (pure)", () => {
    beforeEach(() => resetLog());

    it("starts empty", () => {
        assert.strictEqual(count(), 0);
        assert.deepStrictEqual(getAll(), []);
    });

    it("appends single event", () => {
        appendEvents([{ tick: 1, day: 1, type: "death", text: "Alice died.", npcIds: [0] }]);
        assert.strictEqual(count(), 1);
        assert.strictEqual(getAll()[0].type, "death");
    });

    it("appends multiple events in one call", () => {
        appendEvents([
            { tick: 1, day: 1, type: "escape", text: "Bob escaped.", npcIds: [1] },
            { tick: 2, day: 1, type: "chasm",  text: "Eve fell.",    npcIds: [2] },
        ]);
        assert.strictEqual(count(), 2);
    });

    it("appends across multiple calls", () => {
        appendEvents([{ tick: 1, day: 1, type: "bond", text: "A met B.", npcIds: [0, 1] }]);
        appendEvents([{ tick: 2, day: 1, type: "bond", text: "A met C.", npcIds: [0, 2] }]);
        assert.strictEqual(count(), 2);
    });

    it("getAll returns chronological order", () => {
        appendEvents([
            { tick: 1, day: 1, type: "death",  text: "first",  npcIds: [0] },
            { tick: 2, day: 1, type: "escape", text: "second", npcIds: [1] },
        ]);
        const all = getAll();
        assert.strictEqual(all[0].text, "first");
        assert.strictEqual(all[1].text, "second");
    });

    it("getForNpc filters by id", () => {
        appendEvents([
            { tick: 1, day: 1, type: "death",  text: "Alice died.", npcIds: [0] },
            { tick: 2, day: 1, type: "escape", text: "Bob escaped.", npcIds: [1] },
            { tick: 3, day: 1, type: "bond",   text: "Alice met Bob.", npcIds: [0, 1] },
        ]);
        const alice = getForNpc(0);
        assert.strictEqual(alice.length, 2);
        assert.ok(alice.every(e => e.npcIds.includes(0)));

        const bob = getForNpc(1);
        assert.strictEqual(bob.length, 2);
    });

    it("getForNpc returns empty for unknown id", () => {
        appendEvents([{ tick: 1, day: 1, type: "death", text: "Alice died.", npcIds: [0] }]);
        assert.deepStrictEqual(getForNpc(99), []);
    });

    it("getForNpc handles events with no npcIds", () => {
        appendEvents([{ tick: 1, day: 1, type: "system", text: "lights out." }]);
        assert.deepStrictEqual(getForNpc(0), []);
    });

    it("resetLog clears all entries", () => {
        appendEvents([{ tick: 1, day: 1, type: "death", text: "x", npcIds: [0] }]);
        resetLog();
        assert.strictEqual(count(), 0);
        assert.deepStrictEqual(getAll(), []);
    });

    it("getAll returns live array reference (mutations visible)", () => {
        const ref = getAll();
        appendEvents([{ tick: 1, day: 1, type: "death", text: "x", npcIds: [0] }]);
        assert.strictEqual(ref.length, 1);
    });
});
