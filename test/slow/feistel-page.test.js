import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    feistelKey, permute, unpermute,
    extractPage, unifiedBookPage,
    textToAddressFull, addressToText,
    PLAYABLE_ADDRESS_MAX,
} from "../../lib/invertible.core.ts";
import { generateFullStoryBook } from "../../lib/book.core.ts";
import { generatePlayerWorld } from "../../lib/lifestory.core.ts";
import { CHARS_PER_BOOK, CHARS_PER_PAGE } from "../../lib/scale.core.ts";

const SEED = "feistel-test-seed";
const KEY = feistelKey(SEED);

describe("Feistel permutation", () => {
    it("roundtrips: unpermute(permute(x)) === x", () => {
        const addrs = [
            0n, 1n, 42n, 999999n,
            PLAYABLE_ADDRESS_MAX,
            PLAYABLE_ADDRESS_MAX / 2n,
            PLAYABLE_ADDRESS_MAX - 1n,
        ];
        for (const addr of addrs) {
            const p = permute(addr, KEY);
            const back = unpermute(p, KEY);
            assert.strictEqual(back, addr, `roundtrip failed for ${addr}`);
        }
    });

    it("roundtrips 100 random addresses", () => {
        const rng = (i) => BigInt(Math.floor(Math.random() * Number(PLAYABLE_ADDRESS_MAX)));
        for (let i = 0; i < 100; i++) {
            const addr = rng(i);
            assert.strictEqual(unpermute(permute(addr, KEY), KEY), addr);
        }
    });

    it("outputs stay within [0, PLAYABLE_ADDRESS_MAX]", () => {
        for (let i = 0n; i < 200n; i++) {
            const p = permute(i, KEY);
            assert.ok(p >= 0n && p <= PLAYABLE_ADDRESS_MAX,
                `permute(${i}) = ${p} out of range`);
        }
    });

    it("scatters adjacent inputs", () => {
        // Adjacent addresses should map to distant outputs
        let closeCount = 0;
        const threshold = PLAYABLE_ADDRESS_MAX / 1000n;
        for (let i = 0n; i < 50n; i++) {
            const a = permute(i, KEY);
            const b = permute(i + 1n, KEY);
            const diff = a > b ? a - b : b - a;
            if (diff < threshold) closeCount++;
        }
        // Allow a few coincidences but most should scatter
        assert.ok(closeCount < 5,
            `${closeCount}/50 adjacent pairs mapped close together`);
    });

    it("is bijective over 1000 distinct inputs", () => {
        const outputs = new Set();
        for (let i = 0n; i < 1000n; i++) {
            outputs.add(permute(i, KEY).toString());
        }
        assert.strictEqual(outputs.size, 1000, "expected all outputs distinct");
    });

    it("different seeds produce different permutations", () => {
        const key2 = feistelKey("different-seed");
        let sameCount = 0;
        for (let i = 0n; i < 100n; i++) {
            if (permute(i, KEY) === permute(i, key2)) sameCount++;
        }
        assert.ok(sameCount < 5, `${sameCount}/100 collisions between different keys`);
    });
});

describe("extractPage", () => {
    it("first page matches addressToText slice", { timeout: 30000 }, () => {
        // Build a multi-page text (2 pages = 6400 chars)
        const text = "A".repeat(CHARS_PER_PAGE * 2);
        const addr = textToAddressFull(text);
        const page0 = extractPage(addr, 0, text.length);
        const page1 = extractPage(addr, 1, text.length);
        assert.strictEqual(page0, text.slice(0, CHARS_PER_PAGE));
        assert.strictEqual(page1, text.slice(CHARS_PER_PAGE));
    });

    it("matches full addressToText for book-length text", { timeout: 30000 }, () => {
        const { story } = generatePlayerWorld("extract-page-test");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };
        const fullBook = generateFullStoryBook(story.storyText, fields);
        const addr = textToAddressFull(fullBook);

        // Check first, middle, and last pages
        for (const k of [0, 205, 409]) {
            const t0 = performance.now();
            const page = extractPage(addr, k);
            const elapsed = performance.now() - t0;
            const expected = fullBook.slice(k * CHARS_PER_PAGE, (k + 1) * CHARS_PER_PAGE);
            assert.strictEqual(page, expected, `page ${k} mismatch`);
            console.log(`  extractPage(${k}): ${elapsed.toFixed(0)}ms`);
        }
    });

    it("page 0 and page 409 differ for non-trivial address", { timeout: 30000 }, () => {
        const { story } = generatePlayerWorld("page-diff-test");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };
        const fullBook = generateFullStoryBook(story.storyText, fields);
        const addr = textToAddressFull(fullBook);

        const page0 = extractPage(addr, 0);
        const page409 = extractPage(addr, 409);
        assert.notStrictEqual(page0, page409);
    });
});

describe("unifiedBookPage with Feistel", () => {
    it("produces the player's story at playerBookAddress", { timeout: 60000 }, () => {
        const { playerBookAddress, story } = generatePlayerWorld("unified-feistel");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };
        const fullBook = generateFullStoryBook(story.storyText, fields);
        const fullRawAddress = textToAddressFull(fullBook);
        const key = feistelKey("unified-feistel");

        // Check pages 0, 100, 409
        for (const k of [0, 100, 409]) {
            const page = unifiedBookPage(playerBookAddress, fullRawAddress, playerBookAddress, key, k);
            const expected = fullBook.slice(k * CHARS_PER_PAGE, (k + 1) * CHARS_PER_PAGE);
            assert.strictEqual(page, expected, `page ${k} should match player's book`);
        }
    });

    it("produces different content one shelf over", { timeout: 60000 }, () => {
        const { playerBookAddress, story } = generatePlayerWorld("feistel-neighbor");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };
        const fullBook = generateFullStoryBook(story.storyText, fields);
        const fullRawAddress = textToAddressFull(fullBook);
        const key = feistelKey("feistel-neighbor");

        const playerPage0 = unifiedBookPage(playerBookAddress, fullRawAddress, playerBookAddress, key, 0);
        const neighborPage0 = unifiedBookPage(playerBookAddress + 1n, fullRawAddress, playerBookAddress, key, 0);

        assert.notStrictEqual(neighborPage0, playerPage0,
            "neighbor book should differ from player's book on page 0");

        // Neighbor should be noise — low character match rate
        let matching = 0;
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            if (neighborPage0[i] === playerPage0[i]) matching++;
        }
        const matchRate = matching / CHARS_PER_PAGE;
        assert.ok(matchRate < 0.05,
            `${(matchRate * 100).toFixed(1)}% match — expected noise`);
    });

    it("produces noise-like content far from origin", { timeout: 60000 }, () => {
        const { playerBookAddress, story } = generatePlayerWorld("feistel-noise");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };
        const fullBook = generateFullStoryBook(story.storyText, fields);
        const fullRawAddress = textToAddressFull(fullBook);
        const key = feistelKey("feistel-noise");

        const noisePage = unifiedBookPage(
            playerBookAddress + 1000000n, fullRawAddress, playerBookAddress, key, 0
        );
        const playerPage = fullBook.slice(0, CHARS_PER_PAGE);

        let matching = 0;
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            if (noisePage[i] === playerPage[i]) matching++;
        }
        // ~1/95 ≈ 1% character matches by chance
        const matchRate = matching / CHARS_PER_PAGE;
        assert.ok(matchRate < 0.05,
            `${(matchRate * 100).toFixed(1)}% character match — expected noise (<5%)`);
    });

    it("same address + same page is deterministic", () => {
        const { playerBookAddress, story } = generatePlayerWorld("feistel-determinism");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };
        const fullBook = generateFullStoryBook(story.storyText, fields);
        const fullRawAddress = textToAddressFull(fullBook);
        const key = feistelKey("feistel-determinism");

        const addr = playerBookAddress + 42n;
        const a = unifiedBookPage(addr, fullRawAddress, playerBookAddress, key, 5);
        const b = unifiedBookPage(addr, fullRawAddress, playerBookAddress, key, 5);
        assert.strictEqual(a, b, "same inputs must produce same output");
    });

    it("different pages of the same noise book differ", () => {
        const { playerBookAddress, story } = generatePlayerWorld("feistel-pages");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };
        const fullBook = generateFullStoryBook(story.storyText, fields);
        const fullRawAddress = textToAddressFull(fullBook);
        const key = feistelKey("feistel-pages");

        const addr = playerBookAddress + 7n;
        const p0 = unifiedBookPage(addr, fullRawAddress, playerBookAddress, key, 0);
        const p1 = unifiedBookPage(addr, fullRawAddress, playerBookAddress, key, 1);
        assert.notStrictEqual(p0, p1, "different pages should have different noise");
    });
});
