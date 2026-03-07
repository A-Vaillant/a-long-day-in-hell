import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateBookPage, bookMeta,
    PAGES_PER_BOOK, LINES_PER_PAGE, CHARS_PER_LINE, CHARS_PER_PAGE, CHARS_PER_BOOK, CHARSET,
} from "../lib/book.core.ts";

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
