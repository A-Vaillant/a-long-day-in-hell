/**
 * DOM integration tests for event-log save/load/clear via localStorage.
 * Tests the full round-trip through Engine.save() and Engine.init() load path.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame, createGame } from "./dom-harness.js";

const LOG_KEY = "hell_eventlog";
const SAVE_KEY = "hell_save";

describe("event-log localStorage serialization", () => {
    it("Engine.save() writes hell_eventlog to localStorage", () => {
        const { Engine, EventLog, window } = bootGame();

        EventLog.appendEvents([
            { tick: 10, day: 1, type: "death",  text: "Alice died.", npcIds: [0] },
            { tick: 20, day: 1, type: "escape", text: "Bob escaped.", npcIds: [1] },
        ]);

        Engine.save();

        const raw = window.localStorage.getItem(LOG_KEY);
        assert.ok(raw, "hell_eventlog key should exist after save");
        const parsed = JSON.parse(raw);
        assert.ok(Array.isArray(parsed), "should be an array");
        assert.strictEqual(parsed.length, 2);
        assert.strictEqual(parsed[0].type, "death");
        assert.strictEqual(parsed[1].type, "escape");
    });

    it("Engine.save() embeds _savedLogCount and _savedAt in state", () => {
        const { Engine, EventLog, state, window } = bootGame();

        EventLog.appendEvents([
            { tick: 1, day: 1, type: "bond", text: "A met B.", npcIds: [0, 1] },
            { tick: 2, day: 1, type: "bond", text: "A met C.", npcIds: [0, 2] },
            { tick: 3, day: 1, type: "bond", text: "B met C.", npcIds: [1, 2] },
        ]);

        const before = Date.now();
        Engine.save();
        const after = Date.now();

        const savedState = JSON.parse(window.localStorage.getItem(SAVE_KEY));
        assert.strictEqual(savedState._savedLogCount, 3, "_savedLogCount should reflect event count");
        assert.ok(savedState._savedAt >= before && savedState._savedAt <= after,
            "_savedAt should be a recent timestamp");
    });

    it("Engine.clearSave() removes both hell_save and hell_eventlog", () => {
        const { Engine, EventLog, window } = bootGame();

        EventLog.appendEvents([{ tick: 1, day: 1, type: "death", text: "x", npcIds: [0] }]);
        Engine.save();

        assert.ok(window.localStorage.getItem(SAVE_KEY), "state save should exist");
        assert.ok(window.localStorage.getItem(LOG_KEY), "log save should exist");

        Engine.clearSave();

        assert.strictEqual(window.localStorage.getItem(SAVE_KEY), null, "state save should be gone");
        assert.strictEqual(window.localStorage.getItem(LOG_KEY), null, "log save should be gone");
    });

    it("event log is cleared in memory when clearSave() is called", () => {
        const { Engine, EventLog, window } = bootGame();

        EventLog.appendEvents([{ tick: 1, day: 1, type: "death", text: "x", npcIds: [0] }]);
        assert.strictEqual(EventLog.count(), 1);

        Engine.clearSave();

        assert.strictEqual(EventLog.count(), 0, "in-memory log should be cleared");
    });

    it("log round-trips through save and Engine.init() load", () => {
        // Phase 1: boot a game, add events, save
        const game1 = bootGame("roundtrip-seed");
        game1.EventLog.appendEvents([
            { tick: 5,  day: 2, type: "escape",  text: "Charlie escaped.", npcIds: [3] },
            { tick: 10, day: 2, type: "chasm",   text: "Dana fell.",       npcIds: [4] },
            { tick: 15, day: 2, type: "bond",    text: "Eve met Frank.",   npcIds: [5, 6] },
        ]);
        game1.Engine.save();

        const savedState = game1.window.localStorage.getItem(SAVE_KEY);
        const savedLog   = game1.window.localStorage.getItem(LOG_KEY);

        // Phase 2: create a fresh game, pre-seed localStorage, then init
        const game2 = createGame();
        game2.window.localStorage.setItem(SAVE_KEY, savedState);
        game2.window.localStorage.setItem(LOG_KEY, savedLog);
        game2.Engine.init();

        // Log should be restored
        assert.strictEqual(game2.EventLog.count(), 3, "should restore 3 events");
        const all = game2.EventLog.getAll();
        assert.strictEqual(all[0].type, "escape");
        assert.strictEqual(all[0].text, "Charlie escaped.");
        assert.strictEqual(all[1].type, "chasm");
        assert.strictEqual(all[2].type, "bond");
        assert.ok(all[2].npcIds.includes(5) && all[2].npcIds.includes(6) && all[2].npcIds.length === 2,
            "bond event should have both NPC ids");
    });

    it("load with missing hell_eventlog leaves log empty", () => {
        const game1 = bootGame("missing-log-seed");
        game1.Engine.save();

        const savedState = game1.window.localStorage.getItem(SAVE_KEY);
        // Deliberately do NOT store the log

        const game2 = createGame();
        game2.window.localStorage.setItem(SAVE_KEY, savedState);
        // No LOG_KEY set
        game2.Engine.init();

        assert.strictEqual(game2.EventLog.count(), 0, "missing log should restore as empty");
    });

    it("load with corrupt hell_eventlog leaves log empty", () => {
        const game1 = bootGame("corrupt-log-seed");
        game1.Engine.save();

        const savedState = game1.window.localStorage.getItem(SAVE_KEY);

        const game2 = createGame();
        game2.window.localStorage.setItem(SAVE_KEY, savedState);
        game2.window.localStorage.setItem(LOG_KEY, "this is not json {{{{");
        game2.Engine.init();

        assert.strictEqual(game2.EventLog.count(), 0, "corrupt log should restore as empty");
    });

    it("RESTORE_CAP: loading a huge log keeps only the newest 10000 entries", () => {
        // Build a log of 10100 entries in localStorage directly
        const entries = [];
        for (let i = 0; i < 10100; i++) {
            entries.push({ tick: i, day: 1, type: "death", text: "x " + i, npcIds: [0] });
        }

        const game1 = bootGame("cap-seed");
        game1.Engine.save();
        const savedState = game1.window.localStorage.getItem(SAVE_KEY);

        const game2 = createGame();
        game2.window.localStorage.setItem(SAVE_KEY, savedState);
        game2.window.localStorage.setItem(LOG_KEY, JSON.stringify(entries));
        game2.Engine.init();

        assert.strictEqual(game2.EventLog.count(), 10000, "should cap at 10000");
        // Should keep the newest (last 10000), so first entry is index 100
        assert.strictEqual(game2.EventLog.getAll()[0].text, "x 100",
            "should keep newest entries (skip oldest 100)");
    });

    it("save metadata shows in Menu screen", () => {
        const { Engine, EventLog, window } = bootGame();

        EventLog.appendEvents([
            { tick: 1, day: 1, type: "bond", text: "x", npcIds: [0] },
        ]);
        Engine.save();

        Engine.goto("Menu");
        const html = window.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("menu-save-slot"), "should render save slot element");
        assert.ok(html.includes("Day"), "should show current day in save slot");
        assert.ok(html.includes("event"), "should show event count in save slot");
    });
});
