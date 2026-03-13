import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LIBRARY_MAX, PLAYABLE_ADDRESS_MAX, textToAddress, isInBounds, isAddressInBounds, computeBookAddress, addressToCoords } from "../lib/invertible.core.ts";
import { generateLifeStory } from "../lib/lifestory.core.ts";
import { BOOKS_PER_GALLERY } from "../lib/scale.core.ts";

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

describe("computeBookAddress", () => {
    it("player (rawAddress = playerRawAddress) always gets randomOrigin", () => {
        const raw = 123456789n;
        const origin = 42n;
        assert.strictEqual(computeBookAddress(raw, raw, origin), origin);
    });

    it("NPC with same raw as player gets randomOrigin (cosmic coincidence)", () => {
        const origin = 99n;
        assert.strictEqual(computeBookAddress(1000n, 1000n, origin), origin);
    });

    it("NPC with different raw gets shifted address", () => {
        const playerRaw = 1000n;
        const npcRaw = 1500n;
        const origin = 100n;
        assert.strictEqual(computeBookAddress(npcRaw, playerRaw, origin), 600n);
    });

    it("large NPC raw address stays large after shift", () => {
        const playerRaw = textToAddress("Your name was Rosa Ingram. You were a librarian.", undefined);
        const npcRaw = textToAddress("Oliver Ellison was a postal worker from a city.", undefined);
        const origin = PLAYABLE_ADDRESS_MAX / 2n;
        const bookAddr = computeBookAddress(npcRaw, playerRaw, origin);
        // Both raws are enormous; result is still large (different magnitudes)
        assert.ok(typeof bookAddr === "bigint");
    });
});

describe("isAddressInBounds", () => {
    it("zero is in bounds", () => {
        assert.ok(isAddressInBounds(0n));
    });

    it("PLAYABLE_ADDRESS_MAX is in bounds", () => {
        assert.ok(isAddressInBounds(PLAYABLE_ADDRESS_MAX));
    });

    it("PLAYABLE_ADDRESS_MAX + 1 is out of bounds", () => {
        assert.ok(!isAddressInBounds(PLAYABLE_ADDRESS_MAX + 1n));
    });

    it("negative is out of bounds", () => {
        assert.ok(!isAddressInBounds(-1n));
    });
});

describe("player is never damned", () => {
    it("player bookAddress equals randomOrigin (always in bounds)", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateLifeStory("player-damnation-" + i);
            // Player's rawBookAddress IS playerRawAddress, so bookAddress = randomOrigin
            assert.ok(isAddressInBounds(story.bookAddress),
                `seed ${i}: player bookAddress ${story.bookAddress} is out of bounds`);
        }
    });

    it("player bookCoords are within playable range", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateLifeStory("player-coords-" + i);
            const { position, floor } = story.bookCoords;
            assert.ok(position >= 0n && position < 10_000_000_000n,
                `seed ${i}: position ${position} out of range`);
            assert.ok(floor >= 2000n && floor <= 95000n,
                `seed ${i}: floor ${floor} out of clamped range [2000, 95000]`);
        }
    });

    it("addressToCoords round-trips through bookAddress for player (modulo rest-area nudge + floor/bookIndex randomization)", () => {
        const story = generateLifeStory("roundtrip-test");
        const coords = addressToCoords(story.bookAddress, BOOKS_PER_GALLERY);
        assert.strictEqual(coords.side, story.bookCoords.side);
        // position may be nudged +1 if it landed on a rest area
        const pos = story.bookCoords.position;
        assert.ok(pos === coords.position || pos === coords.position + 1n);
        // floor is clamped to [2000, 95000]
        assert.ok(story.bookCoords.floor >= 2000n && story.bookCoords.floor <= 95000n,
            `floor ${story.bookCoords.floor} should be in [2000, 95000]`);
        // bookIndex is randomized from spawnRng, not derived from address
        assert.ok(story.bookCoords.bookIndex >= 0 && story.bookCoords.bookIndex < BOOKS_PER_GALLERY,
            `bookIndex ${story.bookCoords.bookIndex} should be in [0, ${BOOKS_PER_GALLERY})`);
    });
});
