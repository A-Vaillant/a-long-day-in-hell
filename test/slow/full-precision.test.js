import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textToAddress, textToAddressFull, addressToText, unifiedBookText, isAddressInBounds, computeBookAddress, PLAYABLE_ADDRESS_MAX } from "../../lib/invertible.core.ts";
import { generatePlayerWorld, generateNPCLifeStory } from "../../lib/lifestory.core.ts";
import { generateFullStoryBook } from "../../lib/book.core.ts";
import { CHARS_PER_BOOK } from "../../lib/scale.core.ts";

describe("textToAddressFull (divide-and-conquer)", () => {
    it("matches textToAddress for short in-bounds strings", () => {
        // Short strings that stay within PLAYABLE_ADDRESS_MAX — both functions should agree
        const short = "Hello";
        const naive = textToAddress(short, null);
        const dc = textToAddressFull(short);
        assert.strictEqual(dc, naive);
    });

    it("matches textToAddress (no limit) for medium strings", () => {
        const medium = "The quick brown fox jumps over the lazy dog. ".repeat(10);
        const naive = textToAddress(medium, null);
        const dc = textToAddressFull(medium);
        assert.strictEqual(dc, naive);
    });

    it("produces a number with the expected digit count for book-length text", () => {
        // 1,312,000 chars of 'A' (charCode 65, digit value 33)
        const bookText = "A".repeat(CHARS_PER_BOOK);
        const t0 = performance.now();
        const addr = textToAddressFull(bookText);
        const elapsed = performance.now() - t0;

        // Should produce a ~2.6M digit number
        const digits = addr.toString(10).length;
        assert.ok(digits > 2_500_000 && digits < 2_700_000,
            `expected ~2.6M digits, got ${digits}`);
        // Should complete in under 5 seconds
        assert.ok(elapsed < 5000, `took ${elapsed.toFixed(0)}ms, expected <5000ms`);
    });
});

describe("full-precision player verification", () => {
    it("player book address equals playerBookAddress (full precision agrees with approximation)", () => {
        for (const seed of ["test-full-1", "test-full-2", "test-full-3"]) {
            const { playerBookAddress, story } = generatePlayerWorld(seed);
            // The approximation: bookAddress should equal playerBookAddress for the player
            assert.strictEqual(story.bookAddress, playerBookAddress,
                `${seed}: bookAddress should equal playerBookAddress`);
            assert.ok(isAddressInBounds(story.bookAddress),
                `${seed}: player book must be in bounds`);
        }
    });

    it("NPC book addresses are out of bounds (damned)", () => {
        const { playerBookAddress, story } = generatePlayerWorld("npc-damnation-test");
        let damnedCount = 0;
        const total = 20;
        for (let i = 0; i < total; i++) {
            const npc = generateNPCLifeStory(i, "npc-damnation-test",
                story.rawBookAddress, playerBookAddress);
            if (!isAddressInBounds(npc.bookAddress)) damnedCount++;
        }
        // All NPCs should be damned — the odds of one being in bounds are ~1 in 10^113
        assert.strictEqual(damnedCount, total,
            `expected all ${total} NPCs damned, got ${damnedCount}`);
    });

    it("full-precision and early-exit agree on damnation verdict for NPCs", { timeout: 30000 }, () => {
        const { playerBookAddress, story } = generatePlayerWorld("verdict-match");
        for (let i = 0; i < 5; i++) {
            const npc = generateNPCLifeStory(i, "verdict-match",
                story.rawBookAddress, playerBookAddress);

            // Early-exit textToAddress (no limit) and full-precision should give same rawBookAddress
            const earlyExit = textToAddress(npc.storyText, null);
            const fullPrecision = textToAddressFull(npc.storyText);
            assert.strictEqual(fullPrecision, earlyExit,
                `NPC ${i}: D&C and Horner's must agree`);

            // Both should produce the same damnation verdict
            const earlyAddr = computeBookAddress(earlyExit, story.rawBookAddress, playerBookAddress);
            const fullAddr = computeBookAddress(fullPrecision, story.rawBookAddress, playerBookAddress);
            assert.strictEqual(isAddressInBounds(fullAddr), isAddressInBounds(earlyAddr),
                `NPC ${i}: damnation verdict must match`);
        }
    });
});

describe("addressToText (inverse D&C)", () => {
    it("roundtrips short strings", () => {
        for (const s of ["Hello", "!", " ", "~", "ABC", "test string 123"]) {
            const addr = textToAddressFull(s);
            const back = addressToText(addr, s.length);
            assert.strictEqual(back, s, `roundtrip failed for "${s}"`);
        }
    });

    it("roundtrips medium strings", () => {
        const s = "The quick brown fox jumps over the lazy dog. ".repeat(10);
        const addr = textToAddressFull(s);
        const back = addressToText(addr, s.length);
        assert.strictEqual(back, s);
    });

    it("roundtrips book-length text", { timeout: 30000 }, () => {
        // Use a short repeating pattern so textToAddressFull is fast
        const bookText = "A".repeat(CHARS_PER_BOOK);
        const addr = textToAddressFull(bookText);
        const t0 = performance.now();
        const back = addressToText(addr, CHARS_PER_BOOK);
        const elapsed = performance.now() - t0;

        assert.strictEqual(back, bookText);
        console.log(`  addressToText (book-length): ${elapsed.toFixed(0)}ms`);
        assert.ok(elapsed < 10000, `took ${elapsed.toFixed(0)}ms, expected <10s`);
    });

    it("address 0 produces all spaces", () => {
        const text = addressToText(0n, 10);
        assert.strictEqual(text, " ".repeat(10));
    });
});

describe("unifiedBookText", () => {
    it("produces the player's full book at playerBookAddress", { timeout: 60000 }, () => {
        const { playerBookAddress, story } = generatePlayerWorld("unified-test");

        // Generate the full 1,312,000-char book from the life-arc generator
        const fullBook = generateFullStoryBook(story.storyText, {
            name: story.name,
            occupation: story.occupation,
            hometown: story.hometown,
            causeOfDeath: story.causeOfDeath,
        });
        assert.strictEqual(fullBook.length, CHARS_PER_BOOK);

        // Compute the raw address from the full book text
        const t0 = performance.now();
        const fullRawAddress = textToAddressFull(fullBook);
        console.log(`  textToAddressFull (full book): ${(performance.now() - t0).toFixed(0)}ms`);

        // The unified function should reproduce the full book at playerBookAddress
        const t1 = performance.now();
        const result = unifiedBookText(playerBookAddress, fullRawAddress, playerBookAddress);
        console.log(`  addressToText (full book): ${(performance.now() - t1).toFixed(0)}ms`);

        assert.strictEqual(result, fullBook,
            "unified function must reproduce the full life-story book at playerBookAddress");
    });

    it("neighbors differ only in trailing characters", () => {
        // Use a short text for speed
        const text = "Hello, world! This is a test.";
        const addr = textToAddressFull(text);
        const origin = 1000n;

        const atOrigin = unifiedBookText(origin, addr, origin, text.length);
        assert.strictEqual(atOrigin, text);

        // address + 1: last character incremented by 1
        const neighbor = unifiedBookText(origin + 1n, addr, origin, text.length);
        // Should share all but the last character
        assert.strictEqual(neighbor.slice(0, -1), text.slice(0, -1),
            "neighbor should share prefix");
        assert.notStrictEqual(neighbor, text,
            "neighbor should differ");
    });
});
