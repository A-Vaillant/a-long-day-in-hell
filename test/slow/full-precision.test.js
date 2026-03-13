import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { textToAddress, textToAddressFull, isAddressInBounds, computeBookAddress, PLAYABLE_ADDRESS_MAX } from "../../lib/invertible.core.ts";
import { generatePlayerWorld, generateNPCLifeStory } from "../../lib/lifestory.core.ts";
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
    it("player book address equals randomOrigin (full precision agrees with approximation)", () => {
        for (const seed of ["test-full-1", "test-full-2", "test-full-3"]) {
            const { randomOrigin, story } = generatePlayerWorld(seed);
            // The approximation: bookAddress should equal randomOrigin for the player
            assert.strictEqual(story.bookAddress, randomOrigin,
                `${seed}: bookAddress should equal randomOrigin`);
            assert.ok(isAddressInBounds(story.bookAddress),
                `${seed}: player book must be in bounds`);
        }
    });

    it("NPC book addresses are out of bounds (damned)", () => {
        const { randomOrigin, story } = generatePlayerWorld("npc-damnation-test");
        let damnedCount = 0;
        const total = 20;
        for (let i = 0; i < total; i++) {
            const npc = generateNPCLifeStory(i, "npc-damnation-test",
                story.rawBookAddress, randomOrigin);
            if (!isAddressInBounds(npc.bookAddress)) damnedCount++;
        }
        // All NPCs should be damned — the odds of one being in bounds are ~1 in 10^113
        assert.strictEqual(damnedCount, total,
            `expected all ${total} NPCs damned, got ${damnedCount}`);
    });

    it("full-precision and early-exit agree on damnation verdict for NPCs", () => {
        const { randomOrigin, story } = generatePlayerWorld("verdict-match");
        for (let i = 0; i < 5; i++) {
            const npc = generateNPCLifeStory(i, "verdict-match",
                story.rawBookAddress, randomOrigin);

            // Early-exit textToAddress (no limit) and full-precision should give same rawBookAddress
            const earlyExit = textToAddress(npc.storyText, null);
            const fullPrecision = textToAddressFull(npc.storyText);
            assert.strictEqual(fullPrecision, earlyExit,
                `NPC ${i}: D&C and Horner's must agree`);

            // Both should produce the same damnation verdict
            const earlyAddr = computeBookAddress(earlyExit, story.rawBookAddress, randomOrigin);
            const fullAddr = computeBookAddress(fullPrecision, story.rawBookAddress, randomOrigin);
            assert.strictEqual(isAddressInBounds(fullAddr), isAddressInBounds(earlyAddr),
                `NPC ${i}: damnation verdict must match`);
        }
    });
});
