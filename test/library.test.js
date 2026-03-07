import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateSegment, availableMoves, applyMove, locationKey, describeLocation,
    isRestArea, DIRS, BOTTOM_FLOOR, SEGMENT_BOOK_COUNT, BOOKS_PER_GALLERY, GALLERIES_PER_SEGMENT,
} from "../lib/library.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

function makeFork(seed) {
    const rng = seedFromString(seed);
    return (key) => rng.fork(key);
}

// position 0 is a rest area; position 1 is not
const origin     = { side: 0, position: 0, floor: 1 };   // rest area, floor 1
const mid        = { side: 0, position: 1, floor: 1 };   // gallery, floor 1
const bottom     = { side: 0, position: 0, floor: BOTTOM_FLOOR }; // rest area, floor 0
const bottomMid  = { side: 0, position: 1, floor: BOTTOM_FLOOR }; // gallery, floor 0

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

    it("has rest area only at gallery boundaries", () => {
        for (let pos = 0; pos < GALLERIES_PER_SEGMENT * 2; pos++) {
            const s = generateSegment(0, pos, 1, makeFork("seed"));
            if (pos % GALLERIES_PER_SEGMENT === 0) {
                assert.ok(s.restArea !== null, `pos ${pos} should have rest area`);
                assert.strictEqual(s.restArea.hasStairs, true);
                assert.strictEqual(s.restArea.hasKiosk, true);
                assert.strictEqual(s.restArea.bedsAvailable, 7);
            } else {
                assert.strictEqual(s.restArea, null, `pos ${pos} should not have rest area`);
            }
        }
    });

    it("has bridge only at floor 0 rest areas", () => {
        const atBottomRest  = generateSegment(0, 0, BOTTOM_FLOOR, makeFork("seed"));
        const atBottomMid   = generateSegment(0, 1, BOTTOM_FLOOR, makeFork("seed"));
        const aboveRest     = generateSegment(0, 0, 1, makeFork("seed"));
        assert.strictEqual(atBottomRest.hasBridge, true);
        assert.strictEqual(atBottomMid.hasBridge, false);
        assert.strictEqual(aboveRest.hasBridge, false);
    });

    it("has correct book count per gallery", () => {
        const s = generateSegment(0, 0, 0, makeFork("seed"));
        assert.strictEqual(s.bookCount, BOOKS_PER_GALLERY);
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
        assert.ok(availableMoves(origin).includes(DIRS.LEFT));
        assert.ok(availableMoves(origin).includes(DIRS.RIGHT));
        assert.ok(availableMoves(mid).includes(DIRS.LEFT));
        assert.ok(availableMoves(mid).includes(DIRS.RIGHT));
    });

    it("includes up only at rest areas", () => {
        assert.ok(availableMoves(origin).includes(DIRS.UP));
        assert.ok(availableMoves(bottom).includes(DIRS.UP));
        assert.ok(!availableMoves(mid).includes(DIRS.UP));
    });

    it("includes down above floor 0 at rest areas only", () => {
        assert.ok(availableMoves(origin).includes(DIRS.DOWN));
        assert.ok(!availableMoves(mid).includes(DIRS.DOWN));
    });

    it("does not include down at floor 0", () => {
        assert.ok(!availableMoves(bottom).includes(DIRS.DOWN));
    });

    it("includes cross only at floor 0 rest areas", () => {
        assert.ok(availableMoves(bottom).includes(DIRS.CROSS));
        assert.ok(!availableMoves(origin).includes(DIRS.CROSS));
        assert.ok(!availableMoves(bottomMid).includes(DIRS.CROSS));
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

    it("up increments floor at rest area", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.UP),
            { side: 0, position: 0, floor: 2 });
    });

    it("up throws outside rest area", () => {
        assert.throws(() => applyMove(mid, DIRS.UP), /rest area/);
    });

    it("down decrements floor at rest area", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.DOWN),
            { side: 0, position: 0, floor: 0 });
    });

    it("down throws at floor 0", () => {
        assert.throws(() => applyMove(bottom, DIRS.DOWN), /Cannot descend/);
    });

    it("down throws outside rest area", () => {
        assert.throws(() => applyMove(mid, DIRS.DOWN), /rest area/);
    });

    it("cross switches side at floor 0 rest area", () => {
        assert.deepStrictEqual(applyMove(bottom, DIRS.CROSS),
            { side: 1, position: 0, floor: 0 });
        assert.deepStrictEqual(
            applyMove({ side: 1, position: 0, floor: 0 }, DIRS.CROSS),
            { side: 0, position: 0, floor: 0 });
    });

    it("cross throws above floor 0", () => {
        assert.throws(() => applyMove(origin, DIRS.CROSS), /bottom floor/);
    });

    it("cross throws outside rest area", () => {
        assert.throws(() => applyMove(bottomMid, DIRS.CROSS), /rest area/);
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
        const once  = applyMove(bottom, DIRS.CROSS);  // bottom is position 0 (rest area)
        const twice = applyMove(once,   DIRS.CROSS);
        assert.deepStrictEqual(twice, bottom);
    });
});
