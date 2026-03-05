import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    encodeCoords, decodeCoords,
    generateTargetPage, recoverCoords,
    mix32, unmix32, lcgNext, lcgPrev,
    packCoords, unpackCoords,
    LCG_A, LCG_A_INV,
} from "../lib/invertible.core.js";

describe("mix32 / unmix32", () => {
    it("round-trips", () => {
        const vals = [0, 1, 0xDEADBEEF, 0xFFFFFFFF, 42, 123456789];
        for (const v of vals) {
            assert.strictEqual(unmix32(mix32(v)), v, `failed for ${v}`);
        }
    });
});

describe("packCoords / unpackCoords", () => {
    it("round-trips positive position", () => {
        const c = unpackCoords(...packCoords(1, 500, 42, 1919));
        assert.deepStrictEqual(c, { side: 1, position: 500, floor: 42, bookIndex: 1919 });
    });

    it("round-trips negative position", () => {
        const c = unpackCoords(...packCoords(0, -3000, 99, 0));
        assert.deepStrictEqual(c, { side: 0, position: -3000, floor: 99, bookIndex: 0 });
    });
});

describe("LCG inverse", () => {
    it("LCG_A * LCG_A_INV ≡ 1 (mod 2^32)", () => {
        assert.strictEqual(Math.imul(LCG_A, LCG_A_INV) >>> 0, 1);
    });

    it("lcgPrev reverses lcgNext", () => {
        const states = [0, 1, 0xCAFEBABE, 0xFFFFFFFF, 999];
        for (const s of states) {
            assert.strictEqual(lcgPrev(lcgNext(s)), s >>> 0, `failed for ${s}`);
        }
    });
});

describe("encodeCoords / decodeCoords", () => {
    it("round-trips with various coords and seeds", () => {
        const cases = [
            [0, 0, 10, 0, "seed1"],
            [1, -5000, 99, 1919, "anotherseed"],
            [0, 4999, 0, 500, "hello world"],
            [1, -1, 50, 1, ""],
        ];
        for (const [side, pos, floor, bi, seed] of cases) {
            const [s0, s1] = encodeCoords(side, pos, floor, bi, seed);
            const decoded = decodeCoords(s0, s1, seed);
            assert.deepStrictEqual(decoded, { side, position: pos, floor, bookIndex: bi },
                `failed for coords (${side},${pos},${floor},${bi}) seed="${seed}"`);
        }
    });

    it("different seeds produce different states", () => {
        const [a0, a1] = encodeCoords(0, 100, 10, 5, "seed_a");
        const [b0, b1] = encodeCoords(0, 100, 10, 5, "seed_b");
        assert.ok(a0 !== b0 || a1 !== b1);
    });
});

describe("generateTargetPage", () => {
    it("is deterministic", () => {
        const p1 = generateTargetPage(0, 100, 10, 5, 0, "myseed");
        const p2 = generateTargetPage(0, 100, 10, 5, 0, "myseed");
        assert.strictEqual(p1, p2);
    });

    it("produces 40 lines of 80 chars", () => {
        const page = generateTargetPage(1, -50, 3, 42, 0, "test");
        const lines = page.split("\n");
        assert.strictEqual(lines.length, 40);
        for (const line of lines) {
            assert.strictEqual(line.length, 80);
        }
    });

    it("all chars are printable ASCII", () => {
        const page = generateTargetPage(0, 0, 0, 0, 5, "ascii");
        for (const ch of page) {
            if (ch === "\n") continue;
            const code = ch.charCodeAt(0);
            assert.ok(code >= 32 && code <= 126, `non-printable: ${code}`);
        }
    });

    it("different pages produce different content", () => {
        const p0 = generateTargetPage(0, 0, 0, 0, 0, "s");
        const p1 = generateTargetPage(0, 0, 0, 0, 1, "s");
        assert.notStrictEqual(p0, p1);
    });
});

describe("recoverCoords", () => {
    it("recovers coordinates from page 0 characters", () => {
        const coords = { side: 1, position: -2345, floor: 77, bookIndex: 1234 };
        const seed = "recovery_test";
        const page = generateTargetPage(coords.side, coords.position, coords.floor, coords.bookIndex, 0, seed);
        const firstChars = page.replace(/\n/g, "").slice(0, 12);
        const recovered = recoverCoords(firstChars, seed);
        assert.ok(recovered, "should recover coords");
        assert.deepStrictEqual(recovered, coords);
    });

    it("works with different seeds", () => {
        const cases = [
            { side: 0, position: 0, floor: 10, bookIndex: 0, seed: "alpha" },
            { side: 1, position: 4999, floor: 0, bookIndex: 1919, seed: "beta" },
            { side: 0, position: -5000, floor: 50, bookIndex: 100, seed: "gamma" },
        ];
        for (const { side, position, floor, bookIndex, seed } of cases) {
            const page = generateTargetPage(side, position, floor, bookIndex, 0, seed);
            const chars = page.replace(/\n/g, "").slice(0, 12);
            const recovered = recoverCoords(chars, seed);
            assert.ok(recovered, `should recover for seed=${seed}`);
            assert.deepStrictEqual(recovered, { side, position, floor, bookIndex });
        }
    });

    it("returns null with too few characters", () => {
        assert.strictEqual(recoverCoords("abcdefghi", "seed"), null);
    });
});
