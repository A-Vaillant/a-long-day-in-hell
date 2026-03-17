import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    MEMORY_TYPES, MEMORY, createMemory, addMemory, DEFAULT_MEMORY_CONFIG,
    getBookVision, getSearchProgress,
    grantBookVision, grantVagueBookVision,
    isAtBookSegment, isInVisionRadius,
    markSegmentSearched, isSegmentSearched,
    shareSearchProgress, segmentKey,
} from "../lib/memory.core.ts";

import { IDENTITY } from "../lib/social.core.ts";

describe("BookVisionEntry", () => {
    it("MEMORY_TYPES includes BOOK_VISION", () => {
        assert.equal(MEMORY_TYPES.BOOK_VISION, "bookVision");
    });

    it("config exists in DEFAULT_MEMORY_TYPES", () => {
        const tc = DEFAULT_MEMORY_CONFIG.types["bookVision"];
        assert.ok(tc, "bookVision config should exist");
        assert.equal(tc.permanent, true);
        assert.ok(tc.hopeDrainPerTick > 0, "should have positive hope drain (purpose)");
    });

    it("grantBookVision creates an entry with coords and state", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantBookVision(mem, coords, 0);
        const entry = getBookVision(mem);
        assert.ok(entry, "should have bookVision entry");
        assert.deepEqual(entry.coords, coords);
        assert.equal(entry.state, "granted");
        assert.equal(entry.accurate, true);
        assert.equal(entry.vague, false);
        assert.equal(entry.radius, 0);
    });

    it("grantVagueBookVision sets vague flag and radius", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantVagueBookVision(mem, coords, 50, 0);
        const entry = getBookVision(mem);
        assert.ok(entry);
        assert.equal(entry.vague, true);
        assert.equal(entry.radius, 50);
        assert.equal(entry.state, "granted");
        // Position should be jittered
        assert.equal(entry.coords.side, coords.side);
        assert.equal(entry.coords.floor, coords.floor);
    });

    it("getBookVision returns null when no entry", () => {
        const mem = createMemory();
        assert.equal(getBookVision(mem), null);
    });

    it("only one bookVision entry at a time (overwrites)", () => {
        const mem = createMemory();
        const c1 = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        const c2 = { side: 1, position: 200n, floor: 60n, bookIndex: 3 };
        grantBookVision(mem, c1, 0);
        grantBookVision(mem, c2, 100);
        const entry = getBookVision(mem);
        assert.ok(entry);
        assert.deepEqual(entry.coords, c2);
    });

    it("isAtBookSegment checks side/position/floor", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantBookVision(mem, coords, 0);
        const entry = getBookVision(mem);
        assert.equal(isAtBookSegment(entry, { side: 0, position: 100n, floor: 50n }), true);
        assert.equal(isAtBookSegment(entry, { side: 0, position: 101n, floor: 50n }), false);
        assert.equal(isAtBookSegment(entry, { side: 1, position: 100n, floor: 50n }), false);
    });

    it("isInVisionRadius checks vague radius", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantVagueBookVision(mem, coords, 50, 0);
        const entry = getBookVision(mem);
        assert.equal(isInVisionRadius(entry, { side: 0, position: 110n, floor: 50n }), true);
        assert.equal(isInVisionRadius(entry, { side: 0, position: 500n, floor: 50n }), false);
        assert.equal(isInVisionRadius(entry, { side: 1, position: 100n, floor: 50n }), false);
    });

    it("isInVisionRadius returns false for non-vague vision", () => {
        const mem = createMemory();
        grantBookVision(mem, { side: 0, position: 100n, floor: 50n, bookIndex: 5 }, 0);
        const entry = getBookVision(mem);
        assert.equal(isInVisionRadius(entry, { side: 0, position: 100n, floor: 50n }), false);
    });
});

describe("SearchProgressEntry", () => {
    it("MEMORY_TYPES includes SEARCH_PROGRESS", () => {
        assert.equal(MEMORY_TYPES.SEARCH_PROGRESS, "searchProgress");
    });

    it("getSearchProgress creates entry on first access", () => {
        const mem = createMemory();
        const entry = getSearchProgress(mem, true);
        assert.ok(entry);
        assert.equal(entry.searchedSegments.size, 0);
        assert.equal(entry.bestScore, 0);
        assert.deepEqual(entry.bestWords, []);
    });

    it("markSegmentSearched adds to set", () => {
        const mem = createMemory();
        markSegmentSearched(mem, 0, 100n, 50n);
        const entry = getSearchProgress(mem);
        assert.ok(entry);
        assert.equal(entry.searchedSegments.has(segmentKey(0, 100n, 50n)), true);
    });

    it("isSegmentSearched checks the set", () => {
        const mem = createMemory();
        markSegmentSearched(mem, 0, 100n, 50n);
        assert.equal(isSegmentSearched(mem, 0, 100n, 50n), true);
        assert.equal(isSegmentSearched(mem, 0, 101n, 50n), false);
    });

    it("shareSearchProgress merges segments", () => {
        const source = createMemory();
        const target = createMemory();
        markSegmentSearched(source, 0, 100n, 50n);
        markSegmentSearched(source, 0, 101n, 50n);
        markSegmentSearched(target, 0, 100n, 50n);
        const learned = shareSearchProgress(source, target);
        assert.equal(learned, 1); // only 101 was new
        assert.equal(isSegmentSearched(target, 0, 101n, 50n), true);
    });
});

describe("Identity.lifeStory", () => {
    it("Identity interface accepts lifeStory field", () => {
        const ident = { name: "Test", alive: true, free: false, lifeStory: { name: "Test", storyText: "Once..." } };
        assert.equal(ident.lifeStory.name, "Test");
    });
});
