import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateBookPage, bookMeta, tokenize, detokenize,
    findOriginalFragments, dwellMoraleDelta,
    PAGES_PER_BOOK, DWELL_MS, EDIT_THRESHOLD,
} from "../lib/book.core.js";
import { readFileSync } from "node:fs";

const stories = JSON.parse(readFileSync(new URL("../content/stories.json", import.meta.url), "utf8"));
const dictionary = JSON.parse(readFileSync(new URL("../content/dictionary.json", import.meta.url), "utf8"));

describe("tokenize / detokenize", () => {
    it("round-trips simple text", () => {
        const text = "Hello world, this is a test.";
        assert.strictEqual(detokenize(tokenize(text)), text);
    });

    it("preserves trailing punctuation", () => {
        const tokens = tokenize("kitchen, table.");
        assert.strictEqual(tokens[0].word, "kitchen");
        assert.strictEqual(tokens[0].trailing, ",");
        assert.strictEqual(tokens[1].word, "table");
        assert.strictEqual(tokens[1].trailing, ".");
    });

    it("preserves leading punctuation", () => {
        const tokens = tokenize("(the end)");
        assert.strictEqual(tokens[0].leading, "(");
        assert.strictEqual(tokens[0].word, "the");
        assert.strictEqual(tokens[1].word, "end");
        assert.strictEqual(tokens[1].trailing, ")");
    });

    it("handles em-dash and quotes", () => {
        const text = '"Hello," she said -- "goodbye."';
        assert.strictEqual(detokenize(tokenize(text)), text);
    });

    it("round-trips all stories", () => {
        for (const story of stories) {
            assert.strictEqual(detokenize(tokenize(story.text)), story.text,
                `round-trip failed for story ${story.id}: "${story.title}"`);
        }
    });
});

describe("generateBookPage", () => {
    it("returns { text, storyId, editDistance }", () => {
        const result = generateBookPage(0, 0, 0, 0, 0, "seed", stories, dictionary);
        assert.ok(typeof result.text === "string");
        assert.ok(typeof result.storyId === "number");
        assert.ok(typeof result.editDistance === "number");
    });

    it("storyId is within range", () => {
        for (let i = 0; i < 20; i++) {
            const result = generateBookPage(0, i, 0, 0, 0, "seed", stories, dictionary);
            assert.ok(result.storyId >= 0 && result.storyId < stories.length,
                `storyId ${result.storyId} out of range`);
        }
    });

    it("is deterministic for same inputs", () => {
        const a = generateBookPage(0, 0, 1, 3, 7, "seed", stories, dictionary);
        const b = generateBookPage(0, 0, 1, 3, 7, "seed", stories, dictionary);
        assert.strictEqual(a.text, b.text);
        assert.strictEqual(a.storyId, b.storyId);
        assert.strictEqual(a.editDistance, b.editDistance);
    });

    it("differs for different book indices", () => {
        const a = generateBookPage(0, 0, 1, 0, 0, "seed", stories, dictionary);
        const b = generateBookPage(0, 0, 1, 1, 0, "seed", stories, dictionary);
        assert.ok(a.text !== b.text || a.storyId !== b.storyId);
    });

    it("differs for different page indices", () => {
        const a = generateBookPage(0, 0, 1, 0, 0, "seed", stories, dictionary);
        const b = generateBookPage(0, 0, 1, 0, 1, "seed", stories, dictionary);
        assert.ok(a.text !== b.text || a.storyId !== b.storyId);
    });

    it("differs for different seeds", () => {
        const a = generateBookPage(0, 0, 1, 0, 0, "seed-a", stories, dictionary);
        const b = generateBookPage(0, 0, 1, 0, 0, "seed-b", stories, dictionary);
        assert.ok(a.text !== b.text || a.storyId !== b.storyId);
    });

    it("all pages are accessible", () => {
        for (let i = 0; i < PAGES_PER_BOOK; i++) {
            assert.doesNotThrow(() => generateBookPage(0, 0, 0, 0, i, "seed", stories, dictionary));
        }
    });

    it("edit distance is non-negative and <= word count", () => {
        for (let i = 0; i < 50; i++) {
            const result = generateBookPage(0, i, 0, 0, 0, "test", stories, dictionary);
            const wordCount = tokenize(stories[result.storyId].text).length;
            assert.ok(result.editDistance >= 0);
            assert.ok(result.editDistance <= wordCount,
                `editDistance ${result.editDistance} > wordCount ${wordCount}`);
        }
    });

    it("all stories in corpus are reachable", () => {
        const seen = new Set();
        // Sample enough pages to hit all 15 stories
        for (let i = 0; i < 500 && seen.size < stories.length; i++) {
            const result = generateBookPage(0, i, 0, i % 192, i % 11, "reachability", stories, dictionary);
            seen.add(result.storyId);
        }
        assert.strictEqual(seen.size, stories.length,
            `only reached ${seen.size}/${stories.length} stories`);
    });
});

describe("edit distance distribution", () => {
    it("most pages have high edit distance", () => {
        let highEdit = 0;
        const N = 200;
        for (let i = 0; i < N; i++) {
            const result = generateBookPage(0, i, 0, 0, 0, "dist", stories, dictionary);
            const wordCount = tokenize(stories[result.storyId].text).length;
            if (result.editDistance / wordCount > 0.5) highEdit++;
        }
        assert.ok(highEdit > N * 0.6,
            `expected >60% high edit, got ${(highEdit / N * 100).toFixed(1)}%`);
    });

    it("some pages have low edit distance (rare but present)", () => {
        let lowEdit = 0;
        const N = 1000;
        for (let i = 0; i < N; i++) {
            const result = generateBookPage(1, i, 5, i % 192, i % 11, "lowcheck", stories, dictionary);
            const wordCount = tokenize(stories[result.storyId].text).length;
            if (result.editDistance / wordCount < 0.3) lowEdit++;
        }
        assert.ok(lowEdit > 0,
            `expected at least 1 low-edit page in ${N} samples, got 0`);
    });
});

describe("bookMeta", () => {
    it("returns correct fields", () => {
        const m = bookMeta(1, 5, 3, 42);
        assert.deepStrictEqual(m, { side: 1, position: 5, floor: 3, bookIndex: 42 });
    });
});

describe("findOriginalFragments", () => {
    it("finds runs of 3+ matching words", () => {
        const original = tokenize("The cat sat on the mat in the sun.");
        // Degrade words 3 and 4 ("on", "the")
        const degraded = original.map((t, i) =>
            (i === 3 || i === 4) ? { ...t, word: "xyz" } : t
        );
        const frags = findOriginalFragments(degraded, original);
        // Should find "The cat sat" (0-3) and "mat in the sun" (5-end) — wait, "mat in the sun." is 4 words
        assert.ok(frags.length >= 1);
        assert.ok(frags.some(f => f.end - f.start >= 3));
    });

    it("returns empty for fully degraded text", () => {
        const original = tokenize("The cat sat on the mat.");
        const degraded = original.map(t => ({ ...t, word: "zzz" }));
        const frags = findOriginalFragments(degraded, original);
        assert.strictEqual(frags.length, 0);
    });

    it("ignores runs shorter than 3 words", () => {
        const original = tokenize("one two three four five six");
        // Replace every other word
        const degraded = original.map((t, i) =>
            (i % 2 === 0) ? t : { ...t, word: "zzz" }
        );
        const frags = findOriginalFragments(degraded, original);
        assert.strictEqual(frags.length, 0);
    });

    it("case-insensitive matching", () => {
        const original = tokenize("The Cat Sat on a mat.");
        const degraded = tokenize("the cat sat on a mat.");
        const frags = findOriginalFragments(degraded, original);
        assert.ok(frags.length >= 1);
    });
});

describe("dwellMoraleDelta", () => {
    it("rewards low-edit pages with positive delta", () => {
        const result = dwellMoraleDelta(5, 100, 0);
        assert.ok(result.delta > 0);
        assert.strictEqual(result.isNonsense, false);
    });

    it("penalizes high-edit pages with negative delta", () => {
        const result = dwellMoraleDelta(80, 100, 0);
        assert.ok(result.delta < 0);
        assert.strictEqual(result.isNonsense, true);
    });

    it("threshold boundary: at threshold is nonsense", () => {
        // editFraction = 30/100 = 0.3, which equals EDIT_THRESHOLD → nonsense
        const result = dwellMoraleDelta(30, 100, 0);
        assert.ok(result.delta < 0);
        assert.strictEqual(result.isNonsense, true);
    });

    it("threshold boundary: just below is sensible", () => {
        const result = dwellMoraleDelta(29, 100, 0);
        assert.ok(result.delta > 0);
        assert.strictEqual(result.isNonsense, false);
    });

    it("nonsense penalty diminishes with pages read", () => {
        const first  = dwellMoraleDelta(80, 100, 0);
        const second = dwellMoraleDelta(80, 100, 1);
        const fifth  = dwellMoraleDelta(80, 100, 4);
        const tenth  = dwellMoraleDelta(80, 100, 9);

        assert.ok(first.delta < second.delta);
        assert.ok(second.delta < fifth.delta);
        assert.ok(fifth.delta < tenth.delta);
    });

    it("nonsense penalty approaches zero for large counts", () => {
        const result = dwellMoraleDelta(80, 100, 100);
        assert.ok(Math.abs(result.delta) < 0.05);
    });

    it("sensible reward is constant regardless of nonsense count", () => {
        const a = dwellMoraleDelta(5, 100, 0);
        const b = dwellMoraleDelta(5, 100, 50);
        assert.strictEqual(a.delta, b.delta);
    });
});

describe("dwell constants", () => {
    it("EDIT_THRESHOLD is reasonable", () => {
        assert.ok(EDIT_THRESHOLD > 0.1, "threshold too low");
        assert.ok(EDIT_THRESHOLD < 0.5, "threshold too high");
    });

    it("DWELL_MS is a reasonable delay", () => {
        assert.ok(DWELL_MS >= 1000);
        assert.ok(DWELL_MS <= 5000);
    });
});
