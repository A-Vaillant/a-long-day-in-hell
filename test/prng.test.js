import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hash, seedFromString, makeXoshiro128ss } from "../lib/prng.core.ts";

describe("hash", () => {
    it("returns a uint32", () => {
        const h = hash("hello");
        assert.ok(h >= 0 && h <= 0xFFFFFFFF);
        assert.strictEqual(h, Math.floor(h));
    });

    it("is deterministic", () => {
        assert.strictEqual(hash("test"), hash("test"));
    });

    it("produces different values for different inputs", () => {
        assert.notStrictEqual(hash("a"), hash("b"));
    });
});

describe("seedFromString", () => {
    it("produces the same sequence for the same seed", () => {
        const r1 = seedFromString("hell");
        const r2 = seedFromString("hell");
        for (let i = 0; i < 100; i++) {
            assert.strictEqual(r1.next(), r2.next());
        }
    });

    it("produces different sequences for different seeds", () => {
        const r1 = seedFromString("hell");
        const r2 = seedFromString("heaven");
        const vals1 = Array.from({ length: 10 }, () => r1.next());
        const vals2 = Array.from({ length: 10 }, () => r2.next());
        assert.notDeepStrictEqual(vals1, vals2);
    });

    it("next() returns floats in [0, 1)", () => {
        const rng = seedFromString("test");
        for (let i = 0; i < 1000; i++) {
            const v = rng.next();
            assert.ok(v >= 0 && v < 1, `Out of range: ${v}`);
        }
    });

    it("nextInt(n) returns integers in [0, n)", () => {
        const rng = seedFromString("test");
        for (let i = 0; i < 1000; i++) {
            const v = rng.nextInt(6);
            assert.ok(v >= 0 && v < 6 && Number.isInteger(v), `Bad value: ${v}`);
        }
    });
});

describe("fork", () => {
    it("child PRNG is deterministic for the same parent sequence and key", () => {
        const r1 = seedFromString("parent");
        const r2 = seedFromString("parent");
        const child1 = r1.fork("gallery:0,0,0");
        const child2 = r2.fork("gallery:0,0,0");
        for (let i = 0; i < 50; i++) {
            assert.strictEqual(child1.next(), child2.next());
        }
    });

    it("different keys produce independent children", () => {
        const r = seedFromString("parent");
        const c1 = r.fork("key-a");
        // need a fresh parent at the same state — fork consumes parent state,
        // so reset from scratch for key-b
        const r2 = seedFromString("parent");
        r2.fork("key-a"); // advance past fork("key-a")
        // actually just check that two forks from same parent give different sequences
        const r3 = seedFromString("parent");
        const ca = r3.fork("alpha");
        const cb = r3.fork("beta");
        const va = Array.from({ length: 10 }, () => ca.next());
        const vb = Array.from({ length: 10 }, () => cb.next());
        assert.notDeepStrictEqual(va, vb);
    });

    it("forking does not mutate the parent beyond advancing it once", () => {
        const r1 = seedFromString("parent");
        const r2 = seedFromString("parent");
        r1.fork("child");
        r2.fork("child");
        // Both parents advanced identically, so subsequent values should match
        for (let i = 0; i < 20; i++) {
            assert.strictEqual(r1.next(), r2.next());
        }
    });
});
