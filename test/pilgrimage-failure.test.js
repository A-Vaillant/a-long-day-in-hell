import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MEMORY_TYPES, DEFAULT_MEMORY_CONFIG, createMemory, addMemory } from "../lib/memory.core.ts";
import { DEFAULT_SHOCKS, attenuateShock, applyShock } from "../lib/psych.core.ts";

describe("pilgrimageFailure memory type", () => {
    it("MEMORY_TYPES includes PILGRIMAGE_FAILURE", () => {
        assert.equal(MEMORY_TYPES.PILGRIMAGE_FAILURE, "pilgrimageFailure");
    });

    it("config exists in DEFAULT_MEMORY_TYPES", () => {
        const tc = DEFAULT_MEMORY_CONFIG.types["pilgrimageFailure"];
        assert.ok(tc, "pilgrimageFailure config should exist");
        assert.equal(tc.permanent, true, "should be permanent");
        assert.ok(tc.initialWeight >= 10, "should have high weight: " + tc.initialWeight);
        assert.equal(tc.shockKey, "pilgrimageFailure");
    });
});

describe("pilgrimageFailure shock", () => {
    it("shock source exists in DEFAULT_SHOCKS", () => {
        const source = DEFAULT_SHOCKS["pilgrimageFailure"];
        assert.ok(source, "pilgrimageFailure shock should exist");
    });

    it("first exposure is devastating — drives lucidity to near zero", () => {
        const source = DEFAULT_SHOCKS["pilgrimageFailure"];
        const impact = attenuateShock(source, 0);
        assert.ok(impact.lucidity <= -40, "lucidity impact should be >= 40 damage: " + impact.lucidity);
        assert.ok(impact.hope <= -40, "hope impact should be >= 40 damage: " + impact.hope);
    });

    it("shock barely habituates — this kind of loss doesn't numb", () => {
        const source = DEFAULT_SHOCKS["pilgrimageFailure"];
        const first = attenuateShock(source, 0);
        const tenth = attenuateShock(source, 10);
        assert.ok(tenth.lucidity <= first.lucidity * 0.5,
            "tenth exposure should still be at least half of first");
    });
});
