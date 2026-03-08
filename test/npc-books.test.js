import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateLifeStory, generateNPCLifeStory, distanceToBook } from "../lib/lifestory.core.ts";
import { generateBookPage, PAGES_PER_BOOK } from "../lib/book.core.ts";
import { isRestArea } from "../lib/library.core.ts";
import { spawnNPCs } from "../lib/npc.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

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

    it("NPC books are cosmically far from origin (random placement)", () => {
        // NPC books use random placement — position ±5B segments.
        // Any NPC spawned near origin should be billions of segments from their book.
        const origin = { side: 0, position: 0n, floor: 0n };
        const distances = [];
        for (let i = 0; i < 20; i++) {
            const story = generateNPCLifeStory(i, SEED);
            distances.push(distanceToBook(origin, story.bookCoords));
        }
        const avgDist = distances.reduce((a, b) => a + b, 0n) / BigInt(distances.length);
        assert.ok(avgDist > 1_000_000n,
            `average NPC book distance should be >1M segments from origin (got ${avgDist})`);
    });
});

describe("spawn distribution", () => {
    describe("player spawn (random mode)", () => {
        it("player is always at least 666,666 segments from their book", () => {
            for (let i = 0; i < 50; i++) {
                const story = generateLifeStory("spawn-dist-" + i, { placement: "random" });
                const dist = story.playerStart.position - story.bookCoords.position;
                const absDist = dist < 0n ? -dist : dist;
                assert.ok(absDist >= 666_666n,
                    `seed ${i}: player only ${absDist} segments from book`);
            }
        });

        it("player spawn is spread across a wide range (not all clustered)", () => {
            const positions = [];
            for (let i = 0; i < 30; i++) {
                const story = generateLifeStory("spread-" + i, { placement: "random" });
                positions.push(story.playerStart.position);
            }
            const min = positions.reduce((a, b) => a < b ? a : b);
            const max = positions.reduce((a, b) => a > b ? a : b);
            const range = max - min;
            // Across 30 samples the range should be substantial — at least 10M segments
            assert.ok(range > 10_000_000n,
                `player spawn range too narrow: ${range} segments across 30 samples`);
        });

        it("player spawn floors are non-negative", () => {
            for (let i = 0; i < 50; i++) {
                const story = generateLifeStory("floor-" + i, { placement: "random" });
                assert.ok(story.playerStart.floor >= 0n,
                    `seed ${i}: playerStart.floor ${story.playerStart.floor} negative`);
            }
        });
    });

    describe("NPC spawn", () => {
        it("NPCs spawn near player position (within ~100 segments)", () => {
            const playerLoc = { side: 0, position: 5_000_000_000n, floor: 50n };
            const rng = seedFromString("npc-spawn-test");
            const names = ["A","B","C","D","E","F","G","H"];
            const npcs = spawnNPCs(playerLoc, 8, names, rng);
            for (const npc of npcs) {
                const dist = npc.position - playerLoc.position;
                const absDist = dist < 0n ? -dist : dist;
                assert.ok(absDist < 200n,
                    `NPC ${npc.name} spawned ${absDist} segments from player (expected <200)`);
            }
        });

        it("NPCs books are far from their spawn location", () => {
            // NPC spawns near player; their books are randomly placed — cosmically far.
            const playerLoc = { side: 0, position: 5_000_000_000n, floor: 50n };
            for (let i = 0; i < 16; i++) {
                const story = generateNPCLifeStory(i, SEED);
                const dist = distanceToBook(playerLoc, story.bookCoords);
                // Book is randomly placed: at least sometimes billions of segments away.
                // We just assert it's never 0 (NPC never spawns on their own book).
                assert.ok(dist > 0n, `NPC ${i} spawned exactly on their book`);
            }
        });

        it("NPC books are broadly distributed (not all near origin)", () => {
            const positions = [];
            for (let i = 0; i < 30; i++) {
                const story = generateNPCLifeStory(i, SEED);
                positions.push(story.bookCoords.position);
            }
            const min = positions.reduce((a, b) => a < b ? a : b);
            const max = positions.reduce((a, b) => a > b ? a : b);
            const range = max - min;
            assert.ok(range > 100_000_000n,
                `NPC book range too narrow: ${range} across 30 NPCs`);
        });
    });
});
