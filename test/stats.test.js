import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateStats, statMod, enduranceMod, influenceMod, quicknessMod } from "../lib/stats.core.ts";

function makeRng(values) {
    let i = 0;
    return { next() { return values[i++ % values.length]; } };
}

describe("generateStats", () => {
    it("produces stats in 3–18 range", () => {
        // All 0.0 rolls → each d6 = 1, so 3d6 = 3
        const low = generateStats(makeRng([0.0]));
        assert.strictEqual(low.endurance, 3);
        assert.strictEqual(low.influence, 3);
        assert.strictEqual(low.quickness, 3);

        // All 0.999 rolls → each d6 = 6, so 3d6 = 18
        const high = generateStats(makeRng([0.999]));
        assert.strictEqual(high.endurance, 18);
        assert.strictEqual(high.influence, 18);
        assert.strictEqual(high.quickness, 18);
    });

    it("is deterministic", () => {
        const a = generateStats(makeRng([0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]));
        const b = generateStats(makeRng([0.1, 0.5, 0.9, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6]));
        assert.deepStrictEqual(a, b);
    });
});

describe("statMod", () => {
    it("returns 0.5 for stat 3", () => {
        assert.strictEqual(statMod(3), 0.5);
    });

    it("returns 1.5 for stat 18", () => {
        assert.strictEqual(statMod(18), 1.5);
    });

    it("returns ~1.0 for stat 10–11", () => {
        const mod10 = statMod(10);
        const mod11 = statMod(11);
        assert.ok(mod10 > 0.9 && mod10 < 1.1, `stat 10 mod ${mod10}`);
        assert.ok(mod11 > 0.9 && mod11 < 1.1, `stat 11 mod ${mod11}`);
    });

    it("is monotonically increasing", () => {
        for (let s = 4; s <= 18; s++) {
            assert.ok(statMod(s) > statMod(s - 1), `stat ${s} should be > stat ${s-1}`);
        }
    });
});

describe("enduranceMod", () => {
    it("high endurance = slower need growth (mod < 1)", () => {
        const mod = enduranceMod({ endurance: 18, influence: 10, quickness: 10 });
        assert.ok(mod < 1, `expected < 1, got ${mod}`);
    });

    it("low endurance = faster need growth (mod > 1)", () => {
        const mod = enduranceMod({ endurance: 3, influence: 10, quickness: 10 });
        assert.ok(mod > 1, `expected > 1, got ${mod}`);
    });
});

describe("influenceMod", () => {
    it("high influence = stronger social effects", () => {
        const mod = influenceMod({ endurance: 10, influence: 18, quickness: 10 });
        assert.ok(mod > 1, `expected > 1, got ${mod}`);
    });

    it("low influence = weaker social effects", () => {
        const mod = influenceMod({ endurance: 10, influence: 3, quickness: 10 });
        assert.ok(mod < 1, `expected < 1, got ${mod}`);
    });
});

describe("quicknessMod", () => {
    it("high quickness = faster movement", () => {
        const mod = quicknessMod({ endurance: 10, influence: 10, quickness: 18 });
        assert.ok(mod > 1, `expected > 1, got ${mod}`);
    });

    it("low quickness = slower movement", () => {
        const mod = quicknessMod({ endurance: 10, influence: 10, quickness: 3 });
        assert.ok(mod < 1, `expected < 1, got ${mod}`);
    });
});
