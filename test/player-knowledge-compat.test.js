/**
 * Regression test: screens.js calls Social.getPlayerKnowledge() and accesses
 * .searchedSegments and .bookVision on the result. After the Knowledge→Memory
 * migration, these must still work or be replaced with Memory-based helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    createMemory, getBookVision, getSearchProgress,
    isSegmentSearched, markSegmentSearched, grantBookVision,
} from "../lib/memory.core.ts";

describe("player knowledge compat (post-Knowledge deletion)", () => {
    it("searchedSegments check works via isSegmentSearched on Memory", () => {
        const mem = createMemory();
        // screens.js line 362: playerKnow.searchedSegments.has("side:pos:floor")
        // This crashes because Memory has no .searchedSegments field.
        // Correct approach: isSegmentSearched(mem, side, pos, floor)
        markSegmentSearched(mem, 0, 100n, 50n);
        assert.equal(isSegmentSearched(mem, 0, 100n, 50n), true);
        assert.equal(isSegmentSearched(mem, 0, 101n, 50n), false);

        // Verify the OLD pattern would crash
        assert.equal(mem.searchedSegments, undefined,
            "Memory should NOT have a searchedSegments field — it lives on SearchProgressEntry");
    });

    it("bookVision presence check works via getBookVision on Memory", () => {
        // screens.js line 371: playerKnow && playerKnow.bookVision (truthy check)
        const mem = createMemory();
        assert.equal(getBookVision(mem), null, "no vision → null");
        grantBookVision(mem, { side: 0, position: 100n, floor: 50n, bookIndex: 5 }, 0);
        assert.ok(getBookVision(mem), "with vision → truthy");
    });

    it("bookVision coords check works via getBookVision on Memory", () => {
        const mem = createMemory();
        // screens.js line 499: pkOpen.bookVision (checking if player has a vision)
        // This returns undefined because Memory has no .bookVision field.
        // Correct approach: getBookVision(mem)
        assert.equal(mem.bookVision, undefined,
            "Memory should NOT have a bookVision field — use getBookVision()");

        grantBookVision(mem, { side: 0, position: 100n, floor: 50n, bookIndex: 5 }, 0);
        const vision = getBookVision(mem);
        assert.ok(vision, "getBookVision should return the entry");
        assert.ok(vision.coords, "entry should have coords");
    });
});
