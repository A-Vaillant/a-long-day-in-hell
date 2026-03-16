import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyAction } from "../lib/action-dispatch.core.ts";
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";

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
