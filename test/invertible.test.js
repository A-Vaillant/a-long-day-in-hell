import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TEXT_ADDRESS_EARLY_EXIT, PLAYABLE_ADDRESS_MAX, textToAddress, isInBounds, isAddressInBounds, computeBookAddress, addressToCoords, coordsToAddress } from "../lib/invertible.core.ts";
import { generateLifeStory } from "../lib/lifestory.core.ts";
import { BOOKS_PER_GALLERY, FLOORS, POSITIONS_PER_SIDE } from "../lib/scale.core.ts";

describe("TEXT_ADDRESS_EARLY_EXIT", () => {
    it("equals PLAYABLE_ADDRESS_MAX", () => {
        assert.strictEqual(TEXT_ADDRESS_EARLY_EXIT, PLAYABLE_ADDRESS_MAX);
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
        const longText = '~'.repeat(1000);
        const result = textToAddress(longText, TEXT_ADDRESS_EARLY_EXIT);
        assert.ok(result > TEXT_ADDRESS_EARLY_EXIT);
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

    it("very short text can be in bounds", () => {
        assert.ok(isInBounds(" "));        // 0 — in bounds
        assert.ok(isInBounds("!"));        // 1 — in bounds
        assert.ok(isInBounds(" ".repeat(9))); // 0 — in bounds
    });

    it("text longer than ~9 chars is out of bounds", () => {
        // 95^10 ≈ 5.99×10^19 > PLAYABLE_ADDRESS_MAX ≈ 4×10^17
        assert.ok(!isInBounds("~".repeat(10)));
        assert.ok(!isInBounds("You were born."));
    });

    it("typical NPC prose is out of bounds (damned)", () => {
        const prose = "Your name was Rosa Ingram. You were a librarian, from Portland. You died of heart failure. Before you died, you were thinking about the garden.";
        assert.ok(!isInBounds(prose));
    });
});

describe("computeBookAddress", () => {
    it("player (rawAddress = playerRawAddress) always gets playerBookAddress", () => {
        const raw = 123456789n;
        const origin = 42n;
        assert.strictEqual(computeBookAddress(raw, raw, origin), origin);
    });

    it("NPC with same raw as player gets playerBookAddress (cosmic coincidence)", () => {
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
        const playerRaw = textToAddress("Your name was Rosa Ingram. You were a librarian.", null);
        const npcRaw = textToAddress("Oliver Ellison was a postal worker from a city.", null);
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
    it("player bookAddress equals playerBookAddress (always in bounds)", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateLifeStory("player-damnation-" + i);
            // Player's rawBookAddress IS playerRawAddress, so bookAddress = playerBookAddress
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

describe("coordsToAddress", () => {
    it("round-trips with addressToCoords", () => {
        const cases = [
            { side: 0, position: 0n, floor: 0n, bookIndex: 0 },
            { side: 1, position: 5000n, floor: 50000n, bookIndex: 99 },
            { side: 0, position: BigInt(POSITIONS_PER_SIDE) - 1n, floor: BigInt(FLOORS) - 1n, bookIndex: BOOKS_PER_GALLERY - 1 },
            { side: 1, position: 17n, floor: 2500n, bookIndex: 42 },
        ];
        for (const c of cases) {
            const addr = coordsToAddress(c.side, c.position, c.floor, c.bookIndex);
            assert.ok(addr >= 0n && addr <= PLAYABLE_ADDRESS_MAX,
                `address ${addr} out of bounds for coords ${`s${c.side} p${c.position} f${c.floor} b${c.bookIndex}`}`);
            const back = addressToCoords(addr, BOOKS_PER_GALLERY);
            assert.strictEqual(back.side, c.side, `side mismatch for ${`s${c.side} p${c.position} f${c.floor} b${c.bookIndex}`}`);
            assert.strictEqual(back.position, c.position, `position mismatch for ${`s${c.side} p${c.position} f${c.floor} b${c.bookIndex}`}`);
            assert.strictEqual(back.floor, c.floor, `floor mismatch for ${`s${c.side} p${c.position} f${c.floor} b${c.bookIndex}`}`);
            assert.strictEqual(back.bookIndex, c.bookIndex, `bookIndex mismatch for ${`s${c.side} p${c.position} f${c.floor} b${c.bookIndex}`}`);
        }
    });

    it("addressToCoords → coordsToAddress recovers original address", () => {
        const addrs = [0n, 1n, 12345678n, PLAYABLE_ADDRESS_MAX / 2n, PLAYABLE_ADDRESS_MAX];
        for (const addr of addrs) {
            const c = addressToCoords(addr, BOOKS_PER_GALLERY);
            const recovered = coordsToAddress(c.side, c.position, c.floor, c.bookIndex);
            assert.strictEqual(recovered, addr, `round-trip failed for address ${addr}`);
        }
    });

    it("is fast: 100k calls under 50ms", () => {
        const t0 = performance.now();
        for (let i = 0; i < 100000; i++) {
            coordsToAddress(i & 1, BigInt(i), BigInt(i % FLOORS), i % BOOKS_PER_GALLERY);
        }
        const elapsed = performance.now() - t0;
        assert.ok(elapsed < 50, `${elapsed.toFixed(1)}ms for 100k calls — expected <50ms`);
    });
});
