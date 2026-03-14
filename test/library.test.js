import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateSegment, availableMoves, applyMove, locationKey, describeLocation,
    isRestArea, adjacentKiosks, mercyKiosk,
    DIRS, BOTTOM_FLOOR, SEGMENT_BOOK_COUNT, BOOKS_PER_GALLERY, GALLERIES_PER_SEGMENT,
} from "../lib/library.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

function makeFork(seed) {
    const rng = seedFromString(seed);
    return (key) => rng.fork(key);
}

// position 0 is a rest area; position 1 is not
const origin     = { side: 0, position: 0n, floor: 1n };   // rest area, floor 1
const mid        = { side: 0, position: 1n, floor: 1n };   // gallery, floor 1
const bottom     = { side: 0, position: 0n, floor: BOTTOM_FLOOR }; // rest area, floor 0
const bottomMid  = { side: 0, position: 1n, floor: BOTTOM_FLOOR }; // gallery, floor 0

describe("locationKey", () => {
    it("produces unique keys for distinct locations", () => {
        const keys = new Set([
            locationKey({ side: 0, position: 0n, floor: 0n }),
            locationKey({ side: 1, position: 0n, floor: 0n }),
            locationKey({ side: 0, position: 1n, floor: 0n }),
            locationKey({ side: 0, position: 0n, floor: 1n }),
        ]);
        assert.strictEqual(keys.size, 4);
    });
});

describe("generateSegment", () => {
    it("is deterministic for the same coordinates and seed", () => {
        const s1 = generateSegment(0, 0n, 1n, makeFork("seed"));
        const s2 = generateSegment(0, 0n, 1n, makeFork("seed"));
        assert.deepStrictEqual(s1, s2);
    });

    it("differs for different positions", () => {
        const s1 = generateSegment(0, 0n, 1n, makeFork("seed"));
        const s2 = generateSegment(0, 1n, 1n, makeFork("seed"));
        assert.notDeepStrictEqual(s1, s2);
    });

    it("differs for different seeds across a sample of segments", () => {
        // lightLevel is the only stochastic field; test over many positions
        // to confirm the seed actually produces different outputs somewhere
        const results_a = Array.from({ length: 50 }, (_, i) =>
            generateSegment(0, BigInt(i), 2n, makeFork("seed-a")).lightLevel);
        const results_b = Array.from({ length: 50 }, (_, i) =>
            generateSegment(0, BigInt(i), 2n, makeFork("seed-b")).lightLevel);
        assert.notDeepStrictEqual(results_a, results_b);
    });

    it("has rest area only at gallery boundaries", () => {
        for (let pos = 0; pos < Number(GALLERIES_PER_SEGMENT) * 2; pos++) {
            const s = generateSegment(0, BigInt(pos), 1n, makeFork("seed"));
            if (BigInt(pos) % GALLERIES_PER_SEGMENT === 0n) {
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
        const atBottomRest  = generateSegment(0, 0n, BOTTOM_FLOOR, makeFork("seed"));
        const atBottomMid   = generateSegment(0, 1n, BOTTOM_FLOOR, makeFork("seed"));
        const aboveRest     = generateSegment(0, 0n, 1n, makeFork("seed"));
        assert.strictEqual(atBottomRest.hasBridge, true);
        assert.strictEqual(atBottomMid.hasBridge, false);
        assert.strictEqual(aboveRest.hasBridge, false);
    });

    it("has correct book count per gallery", () => {
        const s = generateSegment(0, 0n, 0n, makeFork("seed"));
        assert.strictEqual(s.bookCount, BOOKS_PER_GALLERY);
    });

    it("lightLevel is either normal or dim", () => {
        for (let i = 0; i < 20; i++) {
            const s = generateSegment(0, BigInt(i), 1n, makeFork("seed"));
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
            { side: 0, position: -1n, floor: 1n });
    });

    it("right increments position", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.RIGHT),
            { side: 0, position: 1n, floor: 1n });
    });

    it("up increments floor at rest area", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.UP),
            { side: 0, position: 0n, floor: 2n });
    });

    it("up throws outside rest area", () => {
        assert.throws(() => applyMove(mid, DIRS.UP), /rest area/);
    });

    it("down decrements floor at rest area", () => {
        assert.deepStrictEqual(applyMove(origin, DIRS.DOWN),
            { side: 0, position: 0n, floor: 0n });
    });

    it("down throws at floor 0", () => {
        assert.throws(() => applyMove(bottom, DIRS.DOWN), /Cannot descend/);
    });

    it("down throws outside rest area", () => {
        assert.throws(() => applyMove(mid, DIRS.DOWN), /rest area/);
    });

    it("cross switches side at floor 0 rest area", () => {
        assert.deepStrictEqual(applyMove(bottom, DIRS.CROSS),
            { side: 1, position: 0n, floor: 0n });
        assert.deepStrictEqual(
            applyMove({ side: 1, position: 0n, floor: 0n }, DIRS.CROSS),
            { side: 0, position: 0n, floor: 0n });
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

describe("adjacentKiosks", () => {
    it("book at position 1 → kiosks at 0 and 17", () => {
        const k = adjacentKiosks(1n);
        assert.strictEqual(k.left, 0n);
        assert.strictEqual(k.right, 17n);
    });

    it("book at position 16 → kiosks at 0 and 17", () => {
        const k = adjacentKiosks(16n);
        assert.strictEqual(k.left, 0n);
        assert.strictEqual(k.right, 17n);
    });

    it("book at position 18 → kiosks at 17 and 34", () => {
        const k = adjacentKiosks(18n);
        assert.strictEqual(k.left, 17n);
        assert.strictEqual(k.right, 34n);
    });

    it("negative position", () => {
        const k = adjacentKiosks(-1n);
        assert.strictEqual(k.left, -17n);
        assert.strictEqual(k.right, 0n);
    });

    it("both kiosks are rest areas", () => {
        const k = adjacentKiosks(100n);
        assert.ok(isRestArea(k.left));
        assert.ok(isRestArea(k.right));
    });
});

describe("mercyKiosk", () => {
    const bookCoords = { side: 0, position: 5n, floor: 100n };

    it("returns 'left' at the left adjacent kiosk", () => {
        const loc = { side: 0, position: 0n, floor: 100n };
        assert.strictEqual(mercyKiosk(loc, bookCoords), "left");
    });

    it("returns 'right' at the right adjacent kiosk", () => {
        const loc = { side: 0, position: 17n, floor: 100n };
        assert.strictEqual(mercyKiosk(loc, bookCoords), "right");
    });

    it("returns null at a different kiosk on the same floor", () => {
        const loc = { side: 0, position: 34n, floor: 100n };
        assert.strictEqual(mercyKiosk(loc, bookCoords), null);
    });

    it("returns null at the right position but wrong floor", () => {
        const loc = { side: 0, position: 0n, floor: 99n };
        assert.strictEqual(mercyKiosk(loc, bookCoords), null);
    });

    it("returns null at the right position but wrong side", () => {
        const loc = { side: 1, position: 0n, floor: 100n };
        assert.strictEqual(mercyKiosk(loc, bookCoords), null);
    });

    it("returns null at a non-rest-area position", () => {
        const loc = { side: 0, position: 5n, floor: 100n };
        assert.strictEqual(mercyKiosk(loc, bookCoords), null);
    });

    it("works with large coordinates", () => {
        const bigBook = { side: 1, position: 10n ** 100n + 3n, floor: 50000n };
        const kiosks = adjacentKiosks(bigBook.position);
        const loc = { side: 1, position: kiosks.right, floor: 50000n };
        assert.strictEqual(mercyKiosk(loc, bigBook), "right");
    });

    it("works for NPC book coords too", () => {
        // Any entity with known book coordinates can trigger mercy
        const npcBook = { side: 0, position: 35n, floor: 200n };
        const npcLoc = { side: 0, position: 34n, floor: 200n };
        assert.strictEqual(mercyKiosk(npcLoc, npcBook), "left");
    });
});
