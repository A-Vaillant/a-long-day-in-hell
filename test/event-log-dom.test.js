/**
 * DOM integration tests for event-log save/load/clear via localStorage.
 * Tests the full round-trip through Engine.save() and Engine.init() load path.
 *
 * Save slots: state is stored under hell_save_<id>, logs under hell_eventlog_<id>.
 * The slot index (hell_slots) tracks which slot is active.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootGame, resetGame, createGame } from "./dom-harness.js";

const game = bootGame();
const SLOTS_KEY = "hell_slots";

/** Get the active slot id from localStorage. */
function activeSlotId(win) {
    const raw = win.localStorage.getItem(SLOTS_KEY);
    if (!raw) return null;
    return JSON.parse(raw).activeSlot;
}

/** Get the state save key for the active slot. */
function saveKey(win) {
    return "hell_save_" + activeSlotId(win);
}

/** Get the log save key for the active slot. */
function logKey(win) {
    return "hell_eventlog_" + activeSlotId(win);
}

describe("event-log localStorage serialization", () => {
    beforeEach(() => {
        resetGame(game);
        game.window.localStorage.clear();
        game.EventLog.resetLog();
    });

    it("Engine.save() writes event log to slotted localStorage key", () => {
        const { Engine, EventLog, window } = game;

        EventLog.appendEvents([
            { tick: 10, day: 1, type: "death",  text: "Alice died.", npcIds: [0] },
            { tick: 20, day: 1, type: "escape", text: "Bob escaped.", npcIds: [1] },
        ]);

        Engine.save();

        const slotId = activeSlotId(window);
        assert.ok(slotId, "should have an active slot after save");
        const raw = window.localStorage.getItem(logKey(window));
        assert.ok(raw, "event log key should exist after save");
        const parsed = JSON.parse(raw);
        assert.ok(Array.isArray(parsed), "should be an array");
        assert.strictEqual(parsed.length, 2);
        assert.strictEqual(parsed[0].type, "death");
        assert.strictEqual(parsed[1].type, "escape");
    });

    it("Engine.save() embeds _savedLogCount and _savedAt in state", () => {
        const { Engine, EventLog, state, window } = game;

        EventLog.appendEvents([
            { tick: 1, day: 1, type: "bond", text: "A met B.", npcIds: [0, 1] },
            { tick: 2, day: 1, type: "bond", text: "A met C.", npcIds: [0, 2] },
            { tick: 3, day: 1, type: "bond", text: "B met C.", npcIds: [1, 2] },
        ]);

        const before = Date.now();
        Engine.save();
        const after = Date.now();

        const savedState = JSON.parse(window.localStorage.getItem(saveKey(window)));
        assert.strictEqual(savedState._savedLogCount, 3, "_savedLogCount should reflect event count");
        assert.ok(savedState._savedAt >= before && savedState._savedAt <= after,
            "_savedAt should be a recent timestamp");
    });

    it("Engine.clearSave() removes slot state and log", () => {
        const { Engine, EventLog, window } = game;

        EventLog.appendEvents([{ tick: 1, day: 1, type: "death", text: "x", npcIds: [0] }]);
        Engine.save();

        const sk = saveKey(window);
        const lk = logKey(window);
        assert.ok(window.localStorage.getItem(sk), "state save should exist");
        assert.ok(window.localStorage.getItem(lk), "log save should exist");

        Engine.clearSave();

        assert.strictEqual(window.localStorage.getItem(sk), null, "state save should be gone");
        assert.strictEqual(window.localStorage.getItem(lk), null, "log save should be gone");
    });

    it("event log is cleared in memory when clearSave() is called", () => {
        const { Engine, EventLog, window } = game;

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

        // Grab everything from localStorage — slots index + slot data + slot log
        const slotsRaw = game1.window.localStorage.getItem(SLOTS_KEY);
        const slotId = activeSlotId(game1.window);
        const savedState = game1.window.localStorage.getItem("hell_save_" + slotId);
        const savedLog   = game1.window.localStorage.getItem("hell_eventlog_" + slotId);

        // Phase 2: create a fresh game, pre-seed localStorage, then init
        const game2 = createGame();
        game2.window.localStorage.setItem(SLOTS_KEY, slotsRaw);
        game2.window.localStorage.setItem("hell_save_" + slotId, savedState);
        game2.window.localStorage.setItem("hell_eventlog_" + slotId, savedLog);
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

    it("load with missing event log leaves log empty", () => {
        const game1 = bootGame("missing-log-seed");
        game1.Engine.save();

        const slotsRaw = game1.window.localStorage.getItem(SLOTS_KEY);
        const slotId = activeSlotId(game1.window);
        const savedState = game1.window.localStorage.getItem("hell_save_" + slotId);

        const game2 = createGame();
        game2.window.localStorage.setItem(SLOTS_KEY, slotsRaw);
        game2.window.localStorage.setItem("hell_save_" + slotId, savedState);
        // Deliberately do NOT store the log
        game2.Engine.init();

        assert.strictEqual(game2.EventLog.count(), 0, "missing log should restore as empty");
    });

    it("load with corrupt event log leaves log empty", () => {
        const game1 = bootGame("corrupt-log-seed");
        game1.Engine.save();

        const slotsRaw = game1.window.localStorage.getItem(SLOTS_KEY);
        const slotId = activeSlotId(game1.window);
        const savedState = game1.window.localStorage.getItem("hell_save_" + slotId);

        const game2 = createGame();
        game2.window.localStorage.setItem(SLOTS_KEY, slotsRaw);
        game2.window.localStorage.setItem("hell_save_" + slotId, savedState);
        game2.window.localStorage.setItem("hell_eventlog_" + slotId, "this is not json {{{{");
        game2.Engine.init();

        assert.strictEqual(game2.EventLog.count(), 0, "corrupt log should restore as empty");
    });

    it("RESTORE_CAP: loading a huge log keeps only the newest 10000 entries", () => {
        const entries = [];
        for (let i = 0; i < 10100; i++) {
            entries.push({ tick: i, day: 1, type: "death", text: "x " + i, npcIds: [0] });
        }

        const game1 = bootGame("cap-seed");
        game1.Engine.save();
        const slotsRaw = game1.window.localStorage.getItem(SLOTS_KEY);
        const slotId = activeSlotId(game1.window);
        const savedState = game1.window.localStorage.getItem("hell_save_" + slotId);

        const game2 = createGame();
        game2.window.localStorage.setItem(SLOTS_KEY, slotsRaw);
        game2.window.localStorage.setItem("hell_save_" + slotId, savedState);
        game2.window.localStorage.setItem("hell_eventlog_" + slotId, JSON.stringify(entries));
        game2.Engine.init();

        assert.strictEqual(game2.EventLog.count(), 10000, "should cap at 10000");
        assert.strictEqual(game2.EventLog.getAll()[0].text, "x 100",
            "should keep newest entries (skip oldest 100)");
    });

    it("save metadata shows in Menu screen", () => {
        const { Engine, EventLog, window } = game;

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

    it("legacy single-save migrates to slot on load", () => {
        const game1 = bootGame("legacy-migrate");
        game1.Engine.save();

        // Simulate legacy: grab slotted data and move it to old keys
        const slotId = activeSlotId(game1.window);
        const stateJson = game1.window.localStorage.getItem("hell_save_" + slotId);
        const logJson = game1.window.localStorage.getItem("hell_eventlog_" + slotId);

        const game2 = createGame();
        // Set legacy keys, remove slot infrastructure
        game2.window.localStorage.setItem("hell_save", stateJson);
        if (logJson) game2.window.localStorage.setItem("hell_eventlog", logJson);
        // No hell_slots key — triggers migration
        game2.Engine.init();

        // After init, the legacy keys should be gone and a slot should exist
        assert.strictEqual(game2.window.localStorage.getItem("hell_save"), null, "legacy state key should be removed");
        const newSlots = JSON.parse(game2.window.localStorage.getItem(SLOTS_KEY));
        assert.ok(newSlots && newSlots.slots.length > 0, "should have at least one slot");
        assert.strictEqual(newSlots.activeSlot, "legacy", "migrated slot id should be 'legacy'");
    });
});
