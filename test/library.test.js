import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateSegment, availableMoves, applyMove, locationKey, describeLocation,
    DIRS, BOTTOM_FLOOR, SEGMENT_BOOK_COUNT,
} from "../lib/library.core.js";
import { seedFromString } from "../lib/prng.core.js";

function makeFork(seed) {
    const rng = seedFromString(seed);
    return (key) => rng.fork(key);
}

const origin = { side: 0, position: 0, floor: 1 };
const bottom = { side: 0, position: 0, floor: BOTTOM_FLOOR };

describe("locationKey", () => {
    it("produces unique keys for distinct locations", () => {
        const keys = new Set([
            locationKey({ side: 0, position: 0, floor: 0 }),
            locationKey({ side: 1, position: 0, floor: 0 }),
            locationKey({ side: 0, position: 1, floor: 0 }),
            locationKey({ side: 0, position: 0, floor: 1 }),
        ]);
        assert.strictEqual(keys.size, 4);
    });
});

describe("generateSegment", () => {
    it("is deterministic for the same coordinates and seed", () => {
        const s1 = generateSegment(0, 0, 1, makeFork("seed"));
        const s2 = generateSegment(0, 0, 1, makeFork("seed"));
        assert.deepStrictEqual(s1, s2);
    });

    it("differs for different positions", () => {
        const s1 = generateSegment(0, 0, 1, makeFork("seed"));
        const s2 = generateSegment(0, 1, 1, makeFork("seed"));
        assert.notDeepStrictEqual(s1, s2);
    });

    it("differs for different seeds across a sample of segments", () => {
        // lightLevel is the only stochastic field; test over many positions
        // to confirm the seed actually produces different outputs somewhere
        const results_a = Array.from({ length: 50 }, (_, i) =>
            generateSegment(0, i, 2, makeFork("seed-a")).lightLevel);
        const results_b = Array.from({ length: 50 }, (_, i) =>
            generateSegment(0, i, 2, makeFork("seed-b")).lightLevel);
        assert.notDeepStrictEqual(results_a, results_b);
    });

    it("always has a rest area with stairs, kiosk, submission slot", () => {
        for (let pos = 0; pos < 5; pos++) {
            const s = generateSegment(0, pos, 1, makeFork("seed"));
            assert.strictEqual(s.restArea.hasStairs, true);
            assert.strictEqual(s.restArea.hasKiosk, true);
            assert.strictEqual(s.restArea.hasSubmissionSlot, true);
            assert.strictEqual(s.restArea.bedsAvailable, 7);
        }
    });

    it("has bridge only at floor 0", () => {
        const atBottom = generateSegment(0, 0, BOTTOM_FLOOR, makeFork("seed"));
        const aboveBottom = generateSegment(0, 0, 1, makeFork("seed"));
        assert.strictEqual(atBottom.hasBridge, true);
        assert.strictEqual(aboveBottom.hasBridge, false);
    });

    it("has correct book count", () => {
        const s = generateSegment(0, 0, 0, makeFork("seed"));
        assert.strictEqual(s.bookCount, SEGMENT_BOOK_COUNT);
    });

    it("lightLevel is either normal or dim", () => {
        for (let i = 0; i < 20; i++) {
            const s = generateSegment(0, i, 1, makeFork("seed"));
            assert.ok(["normal", "dim"].includes(s.lightLevel));
        }
    });
});

describe("availableMoves", () => {
    it("always includes left and right", () => {
        const moves = availableMoves(origin);
        assert.ok(moves.includes(DIRS.LEFT));
        assert.ok(moves.includes(DIRS.RIGHT));
    });

    it("always includes up", () => {
        assert.ok(availableMoves(origin).includes(DIRS.UP));
        assert.ok(availableMoves(bottom).includes(DIRS.UP));
    });

    it("includes down above floor 0", () => {
        assert.ok(availableMoves(origin).includes(DIRS.DOWN));
    });

    it("does not include down at floor 0", () => {
        assert.ok(!availableMoves(bottom).includes(DIRS.DOWN));
    });

    it("includes cross only at floor 0", () => {
        assert.ok(availableMoves(bottom).includes(DIRS.CROSS));
        assert.ok(!availableMoves(origin).includes(DIRS.CROSS));
    });
});

describe("applyMove", () => {
    it("left decrements position", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.LEFT),
            { side: 0, position: -1, floor: 1 });
    });

    it("right increments position", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.RIGHT),
            { side: 0, position: 1, floor: 1 });
    });

    it("up increments floor", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.UP),
            { side: 0, position: 0, floor: 2 });
    });

    it("down decrements floor", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.DOWN),
            { side: 0, position: 0, floor: 0 });
    });

    it("down throws at floor 0", () => {
        assert.throws(() => applyMove(bottom, DIRS.DOWN), /Cannot descend/);
    });

    it("cross switches side at floor 0", () => {
        assert.deepStrictEqual(applyMove(bottom, DIRS.CROSS),
            { side: 1, position: 0, floor: 0 });
        assert.deepStrictEqual(
            applyMove({ side: 1, position: 3, floor: 0 }, DIRS.CROSS),
            { side: 0, position: 3, floor: 0 });
    });

    it("cross throws above floor 0", () => {
        assert.throws(() => applyMove(origin, DIRS.CROSS), /bottom floor/);
    });

    it("left then right returns to origin", () => {
        const after = applyMove(applyMove(origin, DIRS.LEFT), DIRS.RIGHT);
        assert.deepStrictEqual(after, origin);
    });

    it("up then down returns to origin", () => {
        const after = applyMove(applyMove(origin, DIRS.UP), DIRS.DOWN);
        assert.deepStrictEqual(after, origin);
    });

    it("cross twice returns to original side", () => {
        const once  = applyMove(bottom, DIRS.CROSS);
        const twice = applyMove(once,   DIRS.CROSS);
        assert.deepStrictEqual(twice, bottom);
    });
});
