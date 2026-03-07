import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// GodmodeLog is a simple module — import directly
import { GodmodeLog } from "../src/js/godmode-log.js";

describe("GodmodeLog", () => {
    beforeEach(() => {
        GodmodeLog.init();
    });

    it("starts empty", () => {
        assert.strictEqual(GodmodeLog.length, 0);
        assert.deepStrictEqual(GodmodeLog.getRecent(10), []);
    });

    it("push adds events", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        assert.strictEqual(GodmodeLog.length, 1);
    });

    it("getRecent returns newest first", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "first" });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "second" });
        GodmodeLog.push({ tick: 3, day: 1, type: "group", text: "third" });
        const recent = GodmodeLog.getRecent(2);
        assert.strictEqual(recent.length, 2);
        assert.strictEqual(recent[0].text, "third");
        assert.strictEqual(recent[1].text, "second");
    });

    it("getRecent with n larger than buffer returns all", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "only" });
        const recent = GodmodeLog.getRecent(100);
        assert.strictEqual(recent.length, 1);
    });

    it("ring buffer caps at MAX_EVENTS", () => {
        for (let i = 0; i < 250; i++) {
            GodmodeLog.push({ tick: i, day: 1, type: "bond", text: "event " + i });
        }
        assert.ok(GodmodeLog.length <= 200, "should not exceed 200 events");
        const recent = GodmodeLog.getRecent(1);
        assert.strictEqual(recent[0].text, "event 249", "most recent event preserved");
    });

    it("init clears all events", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "test" });
        GodmodeLog.init();
        assert.strictEqual(GodmodeLog.length, 0);
    });

    it("getAll returns events in insertion order", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "first" });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "second" });
        const all = GodmodeLog.getAll();
        assert.strictEqual(all.length, 2);
        assert.strictEqual(all[0].text, "first");
        assert.strictEqual(all[1].text, "second");
    });

    it("events preserve type field", () => {
        const types = ["death", "resurrection", "disposition", "bond", "group", "search", "pilgrimage", "escape"];
        for (const type of types) {
            GodmodeLog.push({ tick: 1, day: 1, type, text: type + " event" });
        }
        const all = GodmodeLog.getAll();
        assert.strictEqual(all.length, types.length);
        for (let i = 0; i < types.length; i++) {
            assert.strictEqual(all[i].type, types[i]);
        }
    });

    it("getRecent filters correctly with type-based retrieval", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "death", text: "A died" });
        GodmodeLog.push({ tick: 2, day: 1, type: "bond", text: "A met B" });
        GodmodeLog.push({ tick: 3, day: 1, type: "death", text: "B died" });
        const recent = GodmodeLog.getRecent(100);
        const deaths = recent.filter(e => e.type === "death");
        const bonds = recent.filter(e => e.type === "bond");
        assert.strictEqual(deaths.length, 2);
        assert.strictEqual(bonds.length, 1);
    });
});
