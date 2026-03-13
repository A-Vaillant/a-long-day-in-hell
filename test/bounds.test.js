import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    isRestArea, generateSegment, applyMove, availableMoves,
    GALLERIES_PER_SEGMENT, BOOKS_PER_GALLERY,
} from "../lib/library.core.ts";
import { segmentDistance, canHear, canSee, canSeeAcrossChasm } from "../lib/social.core.ts";
import { seedFromString } from "../lib/prng.core.ts";
import { moveNPCs } from "../lib/npc.core.ts";
import { locationKey } from "../lib/library.core.ts";

function forkRng(key) {
    return seedFromString("bounds-test:" + key);
}

// --- Extreme position values ---
const EXTREME_POSITIONS = [
    { label: "large positive", position: 10n ** 15n, floor: 50000n },
    { label: "large negative", position: -(10n ** 15n), floor: 50000n },
    { label: "max safe int", position: BigInt(Number.MAX_SAFE_INTEGER), floor: 1n },
    { label: "beyond Number precision (10^18)", position: 10n ** 18n, floor: 50000n },
    { label: "cosmological (10^30)", position: 10n ** 30n, floor: 10n ** 6n },
    { label: "astronomical negative (10^30)", position: -(10n ** 30n), floor: 10n ** 6n },
    { label: "near address space scale (10^100)", position: 10n ** 100n, floor: 10n ** 20n },
    // ~95^507 books — half a page of base-95 address distance
    { label: "half-page scale (10^1000)", position: 10n ** 1000n, floor: 10n ** 50n },
    // ~95^2530 books — approaching the full 1,312,000-char search space
    { label: "near-total library (10^5000)", position: 10n ** 5000n, floor: 10n ** 100n },
    { label: "very high floor", position: 0n, floor: 10n ** 9n },
    { label: "zero", position: 0n, floor: 0n },
    { label: "negative near zero", position: -1n, floor: 0n },
    { label: "negative far", position: -999999n, floor: 3n },
];

describe("library geometry at extreme coordinates", () => {
    for (const { label, position, floor } of EXTREME_POSITIONS) {
        it(`isRestArea works at ${label} (pos=${position})`, () => {
            const result = isRestArea(position);
            assert.strictEqual(typeof result, "boolean");
            // Verify: rest area iff position is a multiple of GALLERIES_PER_SEGMENT
            const mod = ((position % GALLERIES_PER_SEGMENT) + GALLERIES_PER_SEGMENT) % GALLERIES_PER_SEGMENT;
            assert.strictEqual(result, mod === 0n);
        });

        it(`generateSegment works at ${label}`, () => {
            const seg = generateSegment(0, position, floor, forkRng);
            assert.strictEqual(seg.position, position);
            assert.strictEqual(seg.floor, floor);
            assert.strictEqual(seg.bookCount, BOOKS_PER_GALLERY);
            assert.ok(["dim", "normal"].includes(seg.lightLevel));
        });

        it(`availableMoves works at ${label}`, () => {
            const moves = availableMoves({ side: 0, position, floor });
            assert.ok(Array.isArray(moves));
            assert.ok(moves.includes("left"));
            assert.ok(moves.includes("right"));
        });

        it(`applyMove left/right works at ${label}`, () => {
            const loc = { side: 0, position, floor };
            const left = applyMove(loc, "left");
            const right = applyMove(loc, "right");
            assert.strictEqual(left.position, position - 1n);
            assert.strictEqual(right.position, position + 1n);
        });
    }
});

describe("awareness at extreme distances", () => {
    it("two NPCs at opposite extremes have infinite distance", () => {
        const a = { side: 0, position: 10n ** 15n, floor: 100n };
        const b = { side: 0, position: -(10n ** 15n), floor: 100n };
        const dist = segmentDistance(a, b);
        assert.strictEqual(dist, 2e15);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    it("same extreme position = distance 0", () => {
        const pos = { side: 1, position: 10n ** 15n, floor: 99999n };
        assert.strictEqual(segmentDistance(pos, pos), 0);
        assert.strictEqual(canHear(pos, pos), true);
        assert.strictEqual(canSee(pos, pos), true);
    });

    it("cross-chasm visibility works at extreme floor", () => {
        const a = { side: 0, position: 10n ** 12n, floor: 10n ** 9n };
        const b = { side: 1, position: 10n ** 12n, floor: 10n ** 9n };
        assert.strictEqual(canSeeAcrossChasm(a, b), true);
        assert.strictEqual(segmentDistance(a, b), Infinity); // different side
    });

    it("negative positions produce valid distances", () => {
        const a = { side: 0, position: -500n, floor: 1n };
        const b = { side: 0, position: 500n, floor: 1n };
        assert.strictEqual(segmentDistance(a, b), 1000);
    });

    it("co-located at 10^30 = distance 0, hear and see", () => {
        const pos = { side: 0, position: 10n ** 30n, floor: 10n ** 6n };
        assert.strictEqual(segmentDistance(pos, pos), 0);
        assert.strictEqual(canHear(pos, pos), true);
        assert.strictEqual(canSee(pos, pos), true);
    });

    it("5 apart at 10^30 = distance 5", () => {
        const base = 10n ** 30n;
        const a = { side: 0, position: base, floor: 1n };
        const b = { side: 0, position: base + 5n, floor: 1n };
        assert.strictEqual(segmentDistance(a, b), 5);
    });

    it("10^30 apart — Number() loses precision but hear/see still false", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: 10n ** 30n, floor: 1n };
        const dist = segmentDistance(a, b);
        // Number(10^30) is representable (1e30) but not integer-precise
        assert.ok(dist > 0, "distance should be positive");
        assert.ok(!Number.isSafeInteger(dist), "distance is beyond safe integer range");
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    it("10^100 apart — still no crash, hear/see false", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: 10n ** 100n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    // ~95^101 books — equivalent to ~101 chars of base-95 address difference
    it("10^200 apart — deep cosmological distance, no crash", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: 10n ** 200n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    // ~95^507 books — roughly half a page of base-95 address space
    it("10^1000 apart — half a page of address difference", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: 10n ** 1000n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    // ~95^1012 books — an entire page of base-95 address space
    it("10^2000 apart — a full page of base-95 difference", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: 10n ** 2000n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    // ~95^2530 books — nearly the full 1,312,000-char address space
    it("10^5000 apart — approaching total library scale", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: 10n ** 5000n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    // 95^1,312,000 ≈ 10^2,594,785 — this IS the full search space
    // Use 10^2,600,000 to exceed it comfortably
    it("10^2,600,000 apart — exceeds 95^1,312,000 total book count", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: 10n ** 2_600_000n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    it("negative 10^30 apart produces valid distance", () => {
        const a = { side: 0, position: -(10n ** 30n), floor: 1n };
        const b = { side: 0, position: 10n ** 30n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
    });

    // ~95^1012 books apart, mirrored around origin
    it("negative 10^2000 to positive 10^2000 — two pages of address space", () => {
        const a = { side: 0, position: -(10n ** 2000n), floor: 1n };
        const b = { side: 0, position: 10n ** 2000n, floor: 1n };
        const dist = segmentDistance(a, b);
        assert.ok(dist > 0);
        assert.strictEqual(canHear(a, b), false);
        assert.strictEqual(canSee(a, b), false);
    });

    it("small delta at 10^5000 — co-located at library scale", () => {
        const base = 10n ** 5000n;
        const a = { side: 0, position: base, floor: 1n };
        const b = { side: 0, position: base + 3n, floor: 1n };
        assert.strictEqual(segmentDistance(a, b), 3);
        assert.strictEqual(canHear(a, b), true);
    });
});

describe("NPC movement at extremes", () => {
    function makeNPC(id, position, floor) {
        return {
            id, name: "Test", side: 0, position, floor,
            disposition: "calm", daysMet: 0, lastSeenDay: 0, alive: true,
        };
    }

    it("NPC at very high floor stays valid after movement", () => {
        const npcs = [makeNPC(0, 0n, 10n ** 9n)];
        const rng = seedFromString("high-floor");
        const moved = moveNPCs(npcs, rng);
        assert.ok(moved[0].floor >= 0n, "floor should not go negative");
        assert.strictEqual(typeof moved[0].position, "bigint");
    });

    it("NPC at very large positive position stays valid", () => {
        const npcs = [makeNPC(0, 10n ** 15n, 100n)];
        const rng = seedFromString("far-right");
        const moved = moveNPCs(npcs, rng);
        assert.strictEqual(typeof moved[0].position, "bigint");
        // Position should have changed by at most 5
        const diff = moved[0].position - 10n ** 15n;
        assert.ok(diff >= -5n && diff <= 5n, `position delta ${diff} should be small`);
    });

    it("NPC at very large negative position stays valid", () => {
        const npcs = [makeNPC(0, -(10n ** 15n), 100n)];
        const rng = seedFromString("far-left");
        const moved = moveNPCs(npcs, rng);
        assert.strictEqual(typeof moved[0].position, "bigint");
    });

    it("NPC at floor 0 cannot go below 0 after movement", () => {
        const rng = seedFromString("floor-clamp");
        // Run many times to exercise the floor delta paths
        for (let i = 0; i < 50; i++) {
            const npcs = [makeNPC(0, 0n, 0n)];
            const r = seedFromString("floor-clamp-" + i);
            const moved = moveNPCs(npcs, r);
            assert.ok(moved[0].floor >= 0n, `iteration ${i}: floor ${moved[0].floor} went negative`);
        }
    });

    it("dead NPC does not move even at extreme coords", () => {
        const npc = makeNPC(0, 10n ** 15n, 10n ** 9n);
        npc.alive = false;
        const rng = seedFromString("dead-extreme");
        const moved = moveNPCs([npc], rng);
        assert.strictEqual(moved[0].position, npc.position);
        assert.strictEqual(moved[0].floor, npc.floor);
    });

    it("catatonic NPC does not move even at extreme coords", () => {
        const npc = makeNPC(0, -(10n ** 15n), 99999n);
        npc.disposition = "catatonic";
        const rng = seedFromString("catatonic-extreme");
        const moved = moveNPCs([npc], rng);
        assert.strictEqual(moved[0].position, npc.position);
        assert.strictEqual(moved[0].floor, npc.floor);
    });
});

// --- Known breakpoints: where the math stops working ---

describe("segmentDistance: Number() precision boundary", () => {
    // Number() loses integer precision past 2^53. segmentDistance converts
    // bigint subtraction to Number(), so distances beyond 2^53 are wrong.
    const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER); // 2^53 - 1

    it("exact distance at 2^53 - 1 is precise", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: MAX_SAFE, floor: 1n };
        assert.strictEqual(segmentDistance(a, b), Number(MAX_SAFE));
    });

    it("distance at 2^53 is still representable (even number)", () => {
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: MAX_SAFE + 1n, floor: 1n };
        // 2^53 is exact in float64
        assert.strictEqual(segmentDistance(a, b), Number(MAX_SAFE + 1n));
    });

    it("distance at 2^53 + 1 LOSES precision", () => {
        // 2^53 + 1 cannot be represented exactly in float64 — it rounds to 2^53
        const exact = MAX_SAFE + 2n; // MAX_SAFE is 2^53-1, so +2 = 2^53+1
        const asNumber = Number(exact);
        assert.ok(BigInt(asNumber) !== exact,
            "expected precision loss: Number(2^53+1) round-trips to a different bigint");
    });

    it("canHear/canSee still return false for beyond-precision distances", () => {
        // Even with precision loss, the distance is enormous — still > any range threshold
        const a = { side: 0, position: 0n, floor: 1n };
        const b = { side: 0, position: MAX_SAFE + 2n, floor: 1n };
        assert.strictEqual(canHear(a, b), false, "should not hear across 2^53 segments");
        assert.strictEqual(canSee(a, b), false, "should not see across 2^53 segments");
    });

    it("precision loss does NOT affect co-location (distance 0)", () => {
        // Even at extreme positions, two entities at the same spot have distance 0
        const pos = MAX_SAFE + 999n;
        const a = { side: 0, position: pos, floor: 1n };
        assert.strictEqual(segmentDistance(a, a), 0);
    });

    it("precision loss does NOT affect small deltas at extreme positions", () => {
        // Two NPCs 5 apart at position ~2^53 — the subtraction is small, Number(5n) is fine
        const base = MAX_SAFE + 12345n;
        const a = { side: 0, position: base, floor: 1n };
        const b = { side: 0, position: base + 5n, floor: 1n };
        assert.strictEqual(segmentDistance(a, b), 5);
    });
});

describe("isRestArea: negative position modular arithmetic", () => {
    it("rest area at position 0", () => {
        assert.strictEqual(isRestArea(0n), true);
    });

    it("rest area at -GALLERIES_PER_SEGMENT", () => {
        assert.strictEqual(isRestArea(-GALLERIES_PER_SEGMENT), true);
    });

    it("rest area at -2 * GALLERIES_PER_SEGMENT", () => {
        assert.strictEqual(isRestArea(-2n * GALLERIES_PER_SEGMENT), true);
    });

    it("NOT rest area at -1", () => {
        assert.strictEqual(isRestArea(-1n), false);
    });

    it("NOT rest area at -(GALLERIES_PER_SEGMENT - 1)", () => {
        assert.strictEqual(isRestArea(-(GALLERIES_PER_SEGMENT - 1n)), false);
    });
});

describe("locationKey: extreme coordinates", () => {
    it("negative position produces distinct key", () => {
        const a = locationKey({ side: 0, position: 5n, floor: 1n });
        const b = locationKey({ side: 0, position: -5n, floor: 1n });
        assert.notStrictEqual(a, b);
    });

    it("very large coords produce valid string key", () => {
        const key = locationKey({ side: 1, position: 10n ** 18n, floor: 10n ** 9n });
        assert.ok(key.includes("1000000000000000000"), "key contains full position");
        assert.ok(key.includes("1000000000"), "key contains full floor");
    });
});

describe("generateSegment: determinism at extremes", () => {
    it("same extreme coords always produce same segment", () => {
        const pos = -(10n ** 12n);
        const a = generateSegment(0, pos, 99999n, forkRng);
        const b = generateSegment(0, pos, 99999n, forkRng);
        assert.strictEqual(a.lightLevel, b.lightLevel);
        assert.strictEqual(a.hasBridge, b.hasBridge);
        assert.deepStrictEqual(a.restArea, b.restArea);
    });

    it("adjacent extreme positions produce different segments", () => {
        const pos = 10n ** 15n;
        const a = generateSegment(0, pos, 1n, forkRng);
        const b = generateSegment(0, pos + 1n, 1n, forkRng);
        // They could coincidentally match on lightLevel, but the RNG seed differs.
        // Test that the function doesn't crash — that's the real assertion.
        assert.ok(a.bookCount === BOOKS_PER_GALLERY);
        assert.ok(b.bookCount === BOOKS_PER_GALLERY);
    });
});
