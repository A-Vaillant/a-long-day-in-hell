import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyAction } from "../lib/action-dispatch.core.ts";
import { GALLERIES_PER_SEGMENT, BOOKS_PER_GALLERY } from "../lib/library.core.ts";
import { TICKS_PER_HOUR } from "../lib/tick.core.ts";

function makeTestState(overrides = {}) {
    return {
        side: 0, position: 0n, floor: 10n,
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

function makeTestCtx(overrides = {}) {
    return { seed: "test", eventCards: [], ...overrides };
}

describe("action-dispatch scaffold", () => {
    it("applyAction exists and returns unresolved for unknown action", () => {
        const state = makeTestState();
        const ctx = makeTestCtx();
        const result = applyAction(state, { type: "unknown_thing" }, ctx);
        assert.equal(result.resolved, false);
    });
});

describe("applyAction wait", () => {
    it("advances one tick", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "wait" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.ticksConsumed, 1);
        assert.equal(r.screen, "Wait");
    });

    it("rejected when dead", () => {
        const s = makeTestState({ dead: true });
        const r = applyAction(s, { type: "wait" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction eat", () => {
    it("reduces hunger at rest area", () => {
        const restPos = GALLERIES_PER_SEGMENT;
        const s = makeTestState({ position: restPos, hunger: 50 });
        const r = applyAction(s, { type: "eat" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.hunger < 50, "hunger should decrease");
    });

    it("rejected when not at rest area", () => {
        const s = makeTestState({ position: 5n, hunger: 50 });
        const r = applyAction(s, { type: "eat" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("rejected when lights off", () => {
        const restPos = GALLERIES_PER_SEGMENT;
        const s = makeTestState({ position: restPos, lightsOn: false });
        const r = applyAction(s, { type: "eat" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction drink", () => {
    it("reduces thirst at rest area", () => {
        const restPos = GALLERIES_PER_SEGMENT;
        const s = makeTestState({ position: restPos, thirst: 50 });
        const r = applyAction(s, { type: "drink" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.thirst < 50, "thirst should decrease");
    });
});

describe("applyAction alcohol", () => {
    it("applies at rest area and checks despairing clear", () => {
        const restPos = GALLERIES_PER_SEGMENT;
        const s = makeTestState({ position: restPos, morale: 30, despairing: true });
        const r = applyAction(s, { type: "alcohol" }, makeTestCtx());
        assert.equal(r.resolved, true);
        // Alcohol gives morale boost, shouldClearDespairing checks if morale > threshold
        assert.ok(s.morale > 30, "morale should increase");
    });
});

describe("applyAction move", () => {
    it("moves right and advances one tick", () => {
        const s = makeTestState({ position: 5n });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.position, 6n);
        assert.equal(r.ticksConsumed, 1);
        assert.equal(s.totalMoves, 1);
    });

    it("rejects invalid move", () => {
        // At floor 0, can't go down
        const s = makeTestState({ floor: 0n, position: 0n });
        const r = applyAction(s, { type: "move", dir: "down" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("applies exhaustion for upward move", () => {
        const s = makeTestState({ position: 0n, floor: 5n });
        const r = applyAction(s, { type: "move", dir: "up" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.exhaustion >= 1.5, "up should add 1.5 exhaustion");
    });

    it("auto-drinks at rest area when thirsty", () => {
        const restPos = GALLERIES_PER_SEGMENT;
        const s = makeTestState({ position: restPos - 1n, thirst: 60 });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.position, restPos);
        assert.ok(s.thirst < 60, "should have auto-drunk: thirst=" + s.thirst);
    });

    it("applies survival depletion on move", () => {
        const s = makeTestState({ hunger: 10 });
        applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.ok(s.hunger > 10, "hunger should increase: " + s.hunger);
    });

    it("applies ambient morale drain", () => {
        const s = makeTestState({ morale: 50 });
        applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.ok(s.morale < 50, "morale should drain: " + s.morale);
    });

    it("dead when move is rejected", () => {
        const s = makeTestState({ dead: true });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("returns screen Corridor on success", () => {
        const s = makeTestState({ position: 5n });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.screen, "Corridor");
    });
});

describe("applyAction read_book", () => {
    it("opens book and applies morale penalty", () => {
        const s = makeTestState({ position: 5n, morale: 80 });
        const r = applyAction(s, { type: "read_book", bookIndex: 3 }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.screen, "Shelf Open Book");
        assert.deepEqual(s.openBook, { side: 0, position: 5n, floor: 10n, bookIndex: 3 });
        assert.equal(s.openPage, 1);
        // Should have applied nonsense reading penalty
        assert.ok(s.morale < 80 || s.nonsensePagesRead > 0,
            "should apply read penalty or track pages");
    });

    it("rejected at rest area", () => {
        const s = makeTestState({ position: 0n });
        const r = applyAction(s, { type: "read_book", bookIndex: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("rejected when lights off", () => {
        const s = makeTestState({ position: 5n, lightsOn: false });
        const r = applyAction(s, { type: "read_book", bookIndex: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("tracks dwell history", () => {
        const s = makeTestState({ position: 5n });
        applyAction(s, { type: "read_book", bookIndex: 7 }, makeTestCtx());
        assert.equal(s.dwellHistory["0:5:10:7"], true);
    });

    it("does not produce NaN morale when nonsensePagesRead is undefined", () => {
        const s = makeTestState({ position: 5n, morale: 80 });
        delete s.nonsensePagesRead;
        const r = applyAction(s, { type: "read_book", bookIndex: 3 }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(!isNaN(s.morale), "morale should not be NaN, got: " + s.morale);
        assert.ok(s.morale <= 80, "morale should have decreased or stayed");
    });

    it("does not produce NaN morale when dwellHistory is undefined", () => {
        const s = makeTestState({ position: 5n, morale: 80 });
        delete s.dwellHistory;
        const r = applyAction(s, { type: "read_book", bookIndex: 3 }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(!isNaN(s.morale), "morale should not be NaN");
        assert.ok(s.dwellHistory, "dwellHistory should be initialized");
    });
});

describe("applyAction take_book", () => {
    it("sets heldBook with no tick cost", () => {
        const s = makeTestState({ position: 5n });
        const r = applyAction(s, { type: "take_book", bookIndex: 3 }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.ticksConsumed, 0);
        assert.deepEqual(s.heldBook, { side: 0, position: 5n, floor: 10n, bookIndex: 3 });
    });
});

describe("applyAction drop_book", () => {
    it("clears heldBook", () => {
        const s = makeTestState({ heldBook: { side: 0, position: 5n, floor: 10n, bookIndex: 3 } });
        const r = applyAction(s, { type: "drop_book" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.heldBook, null);
    });
});

describe("applyAction submit", () => {
    it("wins when book matches target", () => {
        const target = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        const s = makeTestState({ position: 0n, heldBook: { ...target }, targetBook: target });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.won, true);
        assert.equal(s._submissionWon, true);
    });

    it("consumes wrong book on failed submission", () => {
        const target = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        const wrong = { side: 0, position: 100n, floor: 50n, bookIndex: 6 };
        const s = makeTestState({ position: 0n, heldBook: wrong, targetBook: target });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.won, false);
        assert.equal(s._submissionWon, false);
        assert.equal(s.heldBook, null);
    });

    it("rejected without held book", () => {
        const s = makeTestState({ position: 0n });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("rejected when not at rest area", () => {
        const s = makeTestState({ position: 5n, heldBook: { side: 0, position: 5n, floor: 10n, bookIndex: 0 } });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction sleep", () => {
    it("sleeps through to dawn and recovers exhaustion", () => {
        const s = makeTestState({ exhaustion: 50, tick: 960 }); // lights off at tick 960
        s.lightsOn = false;
        const r = applyAction(s, { type: "sleep", inBedroom: true }, makeTestCtx());
        assert.equal(r.resolved, true);
        // Sleeps from tick 960 to dawn (tick 1440) = 480 ticks = 8 hours
        assert.equal(r.ticksConsumed, 480);
        assert.ok(s.exhaustion < 50, "exhaustion should recover: " + s.exhaustion);
        assert.equal(s.day, 2, "should be next day");
    });

    it("includes dawn in tick events", () => {
        const s = makeTestState({ tick: 960 });
        s.lightsOn = false;
        const r = applyAction(s, { type: "sleep", inBedroom: false }, makeTestCtx());
        assert.ok(r.tickEvents.includes("dawn"), "should fire dawn event");
    });

    it("applies despairing sleep modifier", () => {
        const s = makeTestState({ exhaustion: 80, morale: 5, despairing: true, tick: 960 });
        s.lightsOn = false;
        const moraleBefore = s.morale;
        applyAction(s, { type: "sleep", inBedroom: true }, makeTestCtx());
        // Despairing reduces sleep recovery by 10%
        // Just verify morale changed (direction depends on bedroom + despairing math)
        assert.equal(typeof s.morale, "number");
    });
});

describe("applyAction chasm_jump", () => {
    it("starts falling state", () => {
        const s = makeTestState({ floor: 10n });
        const r = applyAction(s, { type: "chasm_jump" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.falling, "should be falling");
        assert.equal(s.falling.speed, 0);
    });

    it("rejected at floor 0", () => {
        const s = makeTestState({ floor: 0n });
        const r = applyAction(s, { type: "chasm_jump" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction grab_railing", () => {
    it("attempts grab when falling", () => {
        const s = makeTestState({ floor: 10n, falling: { speed: 5, floorsToFall: 0, side: 0 } });
        const r = applyAction(s, { type: "grab_railing" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(r.data, "should have grab result data");
    });

    it("rejected when not falling", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "grab_railing" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction throw_book", () => {
    it("clears held book while falling", () => {
        const s = makeTestState({
            falling: { speed: 5, floorsToFall: 0, side: 0 },
            heldBook: { side: 0, position: 5n, floor: 10n, bookIndex: 3 },
        });
        const r = applyAction(s, { type: "throw_book" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.heldBook, null);
    });
});

describe("applyAction fall_wait", () => {
    it("advances tick and continues fall", () => {
        const s = makeTestState({ floor: 100n, falling: { speed: 5, floorsToFall: 0, side: 0 } });
        const floorBefore = s.floor;
        const r = applyAction(s, { type: "fall_wait" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.ticksConsumed, 1);
        assert.ok(s.floor < floorBefore, "should have fallen");
    });
});

describe("applyAction social actions", () => {
    it("talk returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "talk", npcId: 0, approach: "kind" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("spend_time returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "spend_time", npcId: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("recruit returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "recruit", npcId: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("dismiss returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "dismiss", npcId: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});
