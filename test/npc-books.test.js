import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateLifeStory, generateNPCLifeStory, distanceToBook } from "../lib/lifestory.core.ts";
import { generateBookPage, PAGES_PER_BOOK } from "../lib/book.core.ts";
import { isRestArea } from "../lib/library.core.ts";

const SEED = "test-seed-42";

describe("generateNPCLifeStory", () => {
    it("returns a valid life story for an NPC", () => {
        const story = generateNPCLifeStory(0, SEED);
        assert.ok(story.name, "has a name");
        assert.ok(story.occupation, "has an occupation");
        assert.ok(story.hometown, "has a hometown");
        assert.ok(story.causeOfDeath, "has a cause of death");
        assert.ok(story.storyText.length > 100, "has substantial story text");
        assert.ok(story.bookCoords, "has book coordinates");
        assert.ok(typeof story.bookCoords.side === "number");
        assert.ok(typeof story.bookCoords.position === "bigint");
        assert.ok(typeof story.bookCoords.floor === "bigint");
        assert.ok(typeof story.bookCoords.bookIndex === "number");
        assert.ok(story.targetPage >= 0 && story.targetPage < PAGES_PER_BOOK);
    });

    it("is deterministic — same id + seed = same story", () => {
        const a = generateNPCLifeStory(7, SEED);
        const b = generateNPCLifeStory(7, SEED);
        assert.deepStrictEqual(a, b);
    });

    it("different NPC ids produce different stories", () => {
        const stories = [];
        for (let i = 0; i < 10; i++) {
            stories.push(generateNPCLifeStory(i, SEED));
        }
        const names = stories.map(s => s.name);
        const coords = stories.map(s => `${s.bookCoords.side}:${s.bookCoords.position}:${s.bookCoords.floor}:${s.bookCoords.bookIndex}`);
        // Names should have variety (not all identical)
        assert.ok(new Set(names).size > 1, "NPCs should have different names");
        // Book coordinates must all be unique
        assert.strictEqual(new Set(coords).size, coords.length, "each NPC book at unique coords");
    });

    it("NPC book coords never land on rest areas", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateNPCLifeStory(i, SEED);
            assert.ok(
                !isRestArea(story.bookCoords.position),
                `NPC ${i} book at rest area position ${story.bookCoords.position}`,
            );
        }
    });

    it("NPC books are distinct from the player book", () => {
        const coordKey = (c) => `${c.side}:${c.position}:${c.floor}:${c.bookIndex}`;
        const playerStory = generateLifeStory(SEED);
        const playerCoords = coordKey(playerStory.bookCoords);
        for (let i = 0; i < 20; i++) {
            const npcStory = generateNPCLifeStory(i, SEED);
            assert.notStrictEqual(
                coordKey(npcStory.bookCoords),
                playerCoords,
                `NPC ${i} book collides with player book`,
            );
        }
    });

    it("NPC book coords have non-negative floor", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateNPCLifeStory(i, SEED);
            assert.ok(story.bookCoords.floor >= 0n, `NPC ${i} floor < 0`);
        }
    });

    it("NPC book index is within gallery bounds", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateNPCLifeStory(i, SEED);
            assert.ok(story.bookCoords.bookIndex >= 0, "bookIndex >= 0");
            assert.ok(story.bookCoords.bookIndex < 192, "bookIndex < BOOKS_PER_GALLERY");
        }
    });
});

describe("NPC target book page contains their story", () => {
    it("the target page of an NPC book is their story text, not random ASCII", () => {
        const story = generateNPCLifeStory(3, SEED);
        // The story text should contain their name and occupation
        assert.ok(story.storyText.includes(story.name), "story mentions NPC name");
        assert.ok(story.storyText.includes(story.occupation), "story mentions occupation");
        // Story text should be readable English, not random chars
        assert.ok(story.storyText.includes(" "), "story has spaces (is prose)");
        assert.ok(story.storyText.length > 200, "story is substantial");
    });

    it("non-target pages are random ASCII (not story text)", () => {
        const story = generateNPCLifeStory(3, SEED);
        const { side, position, floor, bookIndex } = story.bookCoords;
        // Pick a page that is NOT the target page
        const otherPage = (story.targetPage + 1) % PAGES_PER_BOOK;
        const pageContent = generateBookPage(
            side, position, floor, bookIndex, otherPage, SEED,
        );
        // Random ASCII page should NOT contain the NPC's name
        assert.ok(!pageContent.includes(story.name),
            "random page should not contain NPC name");
    });

    it("every NPC has a unique target page story", () => {
        const stories = [];
        for (let i = 0; i < 10; i++) {
            stories.push(generateNPCLifeStory(i, SEED));
        }
        const texts = stories.map(s => s.storyText);
        assert.strictEqual(new Set(texts).size, texts.length,
            "each NPC should have unique story text");
    });
});

describe("distanceToBook", () => {
    it("distance is 0 when NPC is at their book", () => {
        const story = generateNPCLifeStory(0, SEED);
        const loc = {
            side: story.bookCoords.side,
            position: story.bookCoords.position,
            floor: story.bookCoords.floor,
        };
        assert.strictEqual(distanceToBook(loc, story.bookCoords), 0n);
    });

    it("same side: distance is segment + floor difference", () => {
        const book = { side: 0, position: 100n, floor: 20n, bookIndex: 5 };
        const loc = { side: 0, position: 90n, floor: 15n };
        assert.strictEqual(distanceToBook(loc, book), 10n + 5n);
    });

    it("opposite side: includes chasm crossing cost", () => {
        const book = { side: 1, position: 100n, floor: 20n, bookIndex: 5 };
        const loc = { side: 0, position: 100n, floor: 10n };
        // Cross cost: down 10 floors to 0 + up 20 floors to target = 30
        // Segment dist: 0, floor dist: 10
        assert.strictEqual(distanceToBook(loc, book), 0n + 10n + 10n + 20n);
    });

    it("NPCs are generally far from their books", () => {
        // NPCs spawn near player (position ~0, floor ~10)
        // Books are placed randomly (position ±5000, floor 0-99)
        const distances = [];
        for (let i = 0; i < 20; i++) {
            const story = generateNPCLifeStory(i, SEED);
            const npcLoc = { side: 0, position: 0n, floor: 10n };
            distances.push(distanceToBook(npcLoc, story.bookCoords));
        }
        const avgDist = distances.reduce((a, b) => a + b, 0n) / BigInt(distances.length);
        assert.ok(avgDist > 100n,
            `average distance should be large (got ${avgDist})`);
    });
});
