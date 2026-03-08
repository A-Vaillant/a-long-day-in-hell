import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY_MAX, textToAddress, isInBounds } from "../lib/invertible.core.ts";

describe("LIBRARY_MAX", () => {
    it("equals 95^66", () => {
        assert.strictEqual(LIBRARY_MAX, 95n ** 66n);
    });

    it("is a large but finite bigint (~131 decimal digits)", () => {
        assert.ok(LIBRARY_MAX > 0n);
        assert.ok(LIBRARY_MAX.toString().length >= 130 && LIBRARY_MAX.toString().length <= 132);
    });
});

describe("textToAddress", () => {
    it("empty string → 0", () => {
        assert.strictEqual(textToAddress(""), 0n);
    });

    it("single space (codepoint 32, digit 0) → 0", () => {
        assert.strictEqual(textToAddress(" "), 0n);
    });

    it("single '!' (codepoint 33, digit 1) → 1", () => {
        assert.strictEqual(textToAddress("!"), 1n);
    });

    it("'~' (codepoint 126, digit 94) → 94", () => {
        assert.strictEqual(textToAddress("~"), 94n);
    });

    it("two chars: ab = a*95 + b", () => {
        const a = "!".charCodeAt(0) - 32; // 1
        const b = '"'.charCodeAt(0) - 32; // 2
        assert.strictEqual(textToAddress('!"'), BigInt(a * 95 + b));
    });

    it("exits early when address exceeds limit", () => {
        // '~' repeated 67 times blows past LIBRARY_MAX early
        const longText = '~'.repeat(1000);
        const result = textToAddress(longText, LIBRARY_MAX);
        assert.ok(result > LIBRARY_MAX);
    });

    it("deterministic — same text same result", () => {
        const text = "Hello, world!";
        assert.strictEqual(textToAddress(text), textToAddress(text));
    });
});

describe("isInBounds", () => {
    it("empty string is in bounds", () => {
        assert.ok(isInBounds(""));
    });

    it("short text (≤66 chars) is in bounds", () => {
        assert.ok(isInBounds("You were born."));
        assert.ok(isInBounds(" ".repeat(65)));
        assert.ok(isInBounds("~".repeat(66)));
    });

    it("text exceeding 66 high chars is out of bounds", () => {
        assert.ok(!isInBounds("~".repeat(67)));
    });

    it("typical NPC prose is out of bounds (damned)", () => {
        const prose = "Your name was Rosa Ingram. You were a librarian, from Portland. You died of heart failure. Before you died, you were thinking about the garden.";
        assert.ok(!isInBounds(prose));
    });

    it("any text over ~130 chars of max-value chars is definitely out", () => {
        assert.ok(!isInBounds("~".repeat(200)));
    });
});
