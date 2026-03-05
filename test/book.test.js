import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateBookPage, bookMeta, findCoherentFragment, scoreSensibility,
    dwellMoraleDelta, SENSIBILITY_THRESHOLD, DWELL_MS,
    PAGES_PER_BOOK, LINES_PER_PAGE, CHARS_PER_LINE, CHARS_PER_PAGE, CHARS_PER_BOOK, CHARSET,
} from "../lib/book.core.js";
describe("constants", () => {
    it("charset is 95 characters", () => {
        assert.strictEqual(CHARSET.length, 95);
    });
    it("CHARS_PER_PAGE is 3200", () => {
        assert.strictEqual(CHARS_PER_PAGE, 3200);
    });
    it("CHARS_PER_BOOK is 35200", () => {
        assert.strictEqual(CHARS_PER_BOOK, 35_200);
    });
});

describe("generateBookPage", () => {
    it("returns correct number of lines", () => {
        const page = generateBookPage(0, 0, 0, 0, 0, "seed");
        const lines = page.split("\n");
        assert.strictEqual(lines.length, LINES_PER_PAGE);
    });

    it("each line is 80 characters", () => {
        const page = generateBookPage(0, 0, 0, 0, 0, "seed");
        for (const line of page.split("\n")) {
            assert.strictEqual(line.length, CHARS_PER_LINE);
        }
    });

    it("all characters are in the charset", () => {
        const page = generateBookPage(0, 0, 0, 0, 0, "seed");
        for (const ch of page) {
            if (ch === "\n") continue;
            assert.ok(CHARSET.includes(ch), `unexpected char: ${JSON.stringify(ch)}`);
        }
    });

    it("is deterministic for same inputs", () => {
        const a = generateBookPage(0, 0, 1, 3, 7, "seed");
        const b = generateBookPage(0, 0, 1, 3, 7, "seed");
        assert.strictEqual(a, b);
    });

    it("differs for different book indices", () => {
        const a = generateBookPage(0, 0, 1, 0, 0, "seed");
        const b = generateBookPage(0, 0, 1, 1, 0, "seed");
        assert.notStrictEqual(a, b);
    });

    it("differs for different page indices", () => {
        const a = generateBookPage(0, 0, 1, 0, 0, "seed");
        const b = generateBookPage(0, 0, 1, 0, 1, "seed");
        assert.notStrictEqual(a, b);
    });

    it("differs for different positions", () => {
        const a = generateBookPage(0, 100, 1, 0, 0, "seed");
        const b = generateBookPage(0, 200, 1, 0, 0, "seed");
        assert.notStrictEqual(a, b);
    });

    it("differs for different seeds", () => {
        const a = generateBookPage(0, 0, 1, 0, 0, "seed-a");
        const b = generateBookPage(0, 0, 1, 0, 0, "seed-b");
        assert.notStrictEqual(a, b);
    });

    it("all pages are accessible without error", () => {
        for (let i = 0; i < PAGES_PER_BOOK; i++) {
            assert.doesNotThrow(() => generateBookPage(0, 0, 0, 0, i, "seed"));
        }
    });
});

describe("bookMeta", () => {
    it("returns correct fields", () => {
        const m = bookMeta(1, 5, 3, 42);
        assert.deepStrictEqual(m, { side: 1, position: 5, floor: 3, bookIndex: 42 });
    });
});

describe("scoreSensibility", () => {
    it("returns 0 for empty string", () => {
        assert.strictEqual(scoreSensibility(""), 0);
    });

    it("returns 0 for non-letter content", () => {
        assert.strictEqual(scoreSensibility("1234 !@#$ %^&*"), 0);
    });

    it("scores random book pages very low", () => {
        const page = generateBookPage(0, 0, 0, 0, 0, "seed");
        const score = scoreSensibility(page);
        assert.ok(score < 0.08, `random page scored ${score}, expected < 0.08`);
    });

    it("scores English prose significantly higher than random", () => {
        const english = "The quick brown fox jumps over the lazy dog. " +
            "She sat by the window and watched the rain fall on the street. " +
            "There was nothing left to do but wait for the morning light.";
        const random = generateBookPage(0, 0, 0, 0, 0, "seed");
        const engScore = scoreSensibility(english);
        const rndScore = scoreSensibility(random);
        assert.ok(engScore > rndScore * 3,
            `English ${engScore.toFixed(4)} should be >3x random ${rndScore.toFixed(4)}`);
    });

    it("scores are deterministic", () => {
        const text = "Hello there, this is a test of the scoring system.";
        assert.strictEqual(scoreSensibility(text), scoreSensibility(text));
    });

    it("is case-insensitive", () => {
        assert.strictEqual(
            scoreSensibility("THE QUICK BROWN FOX"),
            scoreSensibility("the quick brown fox")
        );
    });

    it("returns value in [0, 1]", () => {
        const texts = [
            "the the the the the",
            generateBookPage(0, 0, 0, 0, 0, "seed"),
            "abcdefghijklmnopqrstuvwxyz",
            "aaaa bbbb cccc dddd",
        ];
        for (const t of texts) {
            const s = scoreSensibility(t);
            assert.ok(s >= 0 && s <= 1, `score ${s} out of [0,1] for input`);
        }
    });
});

describe("dwellMoraleDelta", () => {
    it("rewards sensible pages with positive delta", () => {
        const result = dwellMoraleDelta(0.30, 0);
        assert.ok(result.delta > 0, `expected positive delta, got ${result.delta}`);
        assert.strictEqual(result.isNonsense, false);
    });

    it("penalizes nonsense pages with negative delta", () => {
        const result = dwellMoraleDelta(0.02, 0);
        assert.ok(result.delta < 0, `expected negative delta, got ${result.delta}`);
        assert.strictEqual(result.isNonsense, true);
    });

    it("threshold boundary: at threshold counts as sensible", () => {
        const result = dwellMoraleDelta(SENSIBILITY_THRESHOLD, 0);
        assert.ok(result.delta > 0);
        assert.strictEqual(result.isNonsense, false);
    });

    it("threshold boundary: just below is nonsense", () => {
        const result = dwellMoraleDelta(SENSIBILITY_THRESHOLD - 0.001, 0);
        assert.ok(result.delta < 0);
        assert.strictEqual(result.isNonsense, true);
    });

    it("nonsense penalty diminishes with pages read", () => {
        const first  = dwellMoraleDelta(0.02, 0);
        const second = dwellMoraleDelta(0.02, 1);
        const fifth  = dwellMoraleDelta(0.02, 4);
        const tenth  = dwellMoraleDelta(0.02, 9);

        // All negative
        assert.ok(first.delta < 0);
        assert.ok(second.delta < 0);
        assert.ok(fifth.delta < 0);
        assert.ok(tenth.delta < 0);

        // Strictly diminishing (less negative = closer to 0)
        assert.ok(first.delta < second.delta,
            `first ${first.delta} should hurt more than second ${second.delta}`);
        assert.ok(second.delta < fifth.delta,
            `second ${second.delta} should hurt more than fifth ${fifth.delta}`);
        assert.ok(fifth.delta < tenth.delta,
            `fifth ${fifth.delta} should hurt more than tenth ${tenth.delta}`);
    });

    it("nonsense penalty approaches zero for large counts", () => {
        const result = dwellMoraleDelta(0.02, 100);
        assert.ok(Math.abs(result.delta) < 0.05,
            `after 100 pages, penalty should be negligible, got ${result.delta}`);
    });

    it("sensible reward is constant regardless of nonsense count", () => {
        const a = dwellMoraleDelta(0.30, 0);
        const b = dwellMoraleDelta(0.30, 50);
        assert.strictEqual(a.delta, b.delta);
    });
});

describe("dwell constants", () => {
    it("SENSIBILITY_THRESHOLD is between random noise and English", () => {
        assert.ok(SENSIBILITY_THRESHOLD > 0.03, "threshold too low — random pages would pass");
        assert.ok(SENSIBILITY_THRESHOLD < 0.30, "threshold too high — only perfect English would pass");
    });

    it("DWELL_MS is a reasonable delay", () => {
        assert.ok(DWELL_MS >= 1000, "dwell too short — rapid flipping would trigger");
        assert.ok(DWELL_MS <= 5000, "dwell too long — tedious to trigger");
    });
});

describe("findCoherentFragment", () => {
    it("returns null for pure noise", () => {
        // A string of non-alpha chars
        const noise = "&*^%$#@!".repeat(100);
        assert.strictEqual(findCoherentFragment(noise), null);
    });

    it("finds a legible fragment embedded in noise", () => {
        const text = "Aj;kLJjppOjnfe7 hello world ImNB2uyS@;jHnMBVF";
        const result = findCoherentFragment(text);
        assert.ok(result !== null);
        assert.ok(result.includes("hello world"));
    });

    it("returns the longest match", () => {
        const text = "ab &*& abcde fghij klmno";
        const result = findCoherentFragment(text);
        // "abcde fghij klmno" is longer than "ab"
        assert.ok(result !== null && result.length >= "abcde fghij klmno".length);
    });
});
