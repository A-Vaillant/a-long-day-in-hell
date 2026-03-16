import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyAction } from "../lib/action-dispatch.core.ts";

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
