import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
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
});

describe("GodmodeLog filters", () => {
    beforeEach(() => {
        GodmodeLog.init();
    });

    it("search is off by default", () => {
        assert.strictEqual(GodmodeLog.isFilterOn("search"), false);
    });

    it("other filters are on by default", () => {
        for (const type of ["death", "resurrection", "disposition", "bond", "group", "pilgrimage", "escape"]) {
            assert.strictEqual(GodmodeLog.isFilterOn(type), true, type + " should be on");
        }
    });

    it("toggleFilter flips state and returns new value", () => {
        assert.strictEqual(GodmodeLog.isFilterOn("bond"), true);
        const result = GodmodeLog.toggleFilter("bond");
        assert.strictEqual(result, false);
        assert.strictEqual(GodmodeLog.isFilterOn("bond"), false);
    });

    it("toggleFilter twice restores original state", () => {
        GodmodeLog.toggleFilter("death");
        GodmodeLog.toggleFilter("death");
        assert.strictEqual(GodmodeLog.isFilterOn("death"), true);
    });

    it("toggleFilter on search turns it on", () => {
        GodmodeLog.toggleFilter("search");
        assert.strictEqual(GodmodeLog.isFilterOn("search"), true);
    });

    it("getFilters returns copy of all filter states", () => {
        const f = GodmodeLog.getFilters();
        assert.strictEqual(f.search, false);
        assert.strictEqual(f.death, true);
        // Mutating the copy doesn't affect internal state
        f.death = false;
        assert.strictEqual(GodmodeLog.isFilterOn("death"), true);
    });

    it("init resets filters to defaults", () => {
        GodmodeLog.toggleFilter("death");  // off
        GodmodeLog.toggleFilter("search"); // on
        GodmodeLog.init();
        assert.strictEqual(GodmodeLog.isFilterOn("death"), true);
        assert.strictEqual(GodmodeLog.isFilterOn("search"), false);
    });

    it("getFiltered returns only events matching active filters", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "death", text: "A died" });
        GodmodeLog.push({ tick: 2, day: 1, type: "bond", text: "A met B" });
        GodmodeLog.push({ tick: 3, day: 1, type: "search", text: "searching" });
        GodmodeLog.push({ tick: 4, day: 1, type: "death", text: "B died" });

        // search is off by default
        const filtered = GodmodeLog.getFiltered(100);
        assert.strictEqual(filtered.length, 3); // 2 deaths + 1 bond
        assert.ok(filtered.every(e => e.type !== "search"));
    });

    it("getFiltered respects toggled-off filter", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "death", text: "A died" });
        GodmodeLog.push({ tick: 2, day: 1, type: "bond", text: "A met B" });
        GodmodeLog.push({ tick: 3, day: 1, type: "death", text: "B died" });

        GodmodeLog.toggleFilter("bond"); // turn off
        const filtered = GodmodeLog.getFiltered(100);
        assert.strictEqual(filtered.length, 2);
        assert.ok(filtered.every(e => e.type === "death"));
    });

    it("getFiltered returns newest first", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "death", text: "first" });
        GodmodeLog.push({ tick: 5, day: 1, type: "death", text: "second" });
        const filtered = GodmodeLog.getFiltered(100);
        assert.strictEqual(filtered[0].text, "second");
        assert.strictEqual(filtered[1].text, "first");
    });

    it("getFiltered limits to n results", () => {
        for (let i = 0; i < 10; i++) {
            GodmodeLog.push({ tick: i, day: 1, type: "death", text: "death " + i });
        }
        const filtered = GodmodeLog.getFiltered(3);
        assert.strictEqual(filtered.length, 3);
        assert.strictEqual(filtered[0].text, "death 9");
    });

    it("getFiltered returns empty when all types filtered out", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "death", text: "A died" });
        GodmodeLog.toggleFilter("death");
        const filtered = GodmodeLog.getFiltered(100);
        assert.strictEqual(filtered.length, 0);
    });

    it("toggle + getFiltered simulates click-to-filter flow", () => {
        // Simulate: events arrive, user clicks "bond" filter off, bond events disappear
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B" });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died" });
        GodmodeLog.push({ tick: 3, day: 1, type: "bond", text: "D met E" });

        // Before toggle: 3 visible (search off but no search events)
        assert.strictEqual(GodmodeLog.getFiltered(100).length, 3);

        // User clicks "bond" filter
        GodmodeLog.toggleFilter("bond");
        const after = GodmodeLog.getFiltered(100);
        assert.strictEqual(after.length, 1);
        assert.strictEqual(after[0].type, "death");

        // User clicks "bond" again to re-enable
        GodmodeLog.toggleFilter("bond");
        assert.strictEqual(GodmodeLog.getFiltered(100).length, 3);
    });
});

