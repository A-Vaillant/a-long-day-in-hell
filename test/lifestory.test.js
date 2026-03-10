import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateLifeStory, formatLifeStory } from "../lib/lifestory.core.ts";
import { BOOKS_PER_GALLERY, isRestArea } from "../lib/library.core.ts";
import { PAGES_PER_BOOK } from "../lib/book.core.ts";

describe("generateLifeStory winnability", () => {
    const SEEDS = 500;

    for (const placement of ["gaussian", "random"]) {
        describe(placement, () => {
            it("bookIndex is within gallery range (0–191)", () => {
                for (let i = 0; i < SEEDS; i++) {
                    const story = generateLifeStory("seed-" + i, { placement });
                    const bi = story.bookCoords.bookIndex;
                    assert.ok(bi >= 0 && bi < BOOKS_PER_GALLERY,
                        `seed-${i}: bookIndex ${bi} out of range`);
                }
            });

            it("position is not a rest area (has shelves)", () => {
                for (let i = 0; i < SEEDS; i++) {
                    const story = generateLifeStory("seed-" + i, { placement });
                    const pos = story.bookCoords.position;
                    assert.ok(!isRestArea(pos),
                        `seed-${i}: position ${pos} is a rest area`);
                }
            });

            it("floor is non-negative", () => {
                for (let i = 0; i < SEEDS; i++) {
                    const story = generateLifeStory("seed-" + i, { placement });
                    assert.ok(story.bookCoords.floor >= 0n,
                        `seed-${i}: floor ${story.bookCoords.floor} is negative`);
                }
            });

            it("side is 0 or 1", () => {
                for (let i = 0; i < SEEDS; i++) {
                    const story = generateLifeStory("seed-" + i, { placement });
                    const s = story.bookCoords.side;
                    assert.ok(s === 0 || s === 1,
                        `seed-${i}: side ${s} invalid`);
                }
            });
        });
    }
});

describe("generateLifeStory prose", () => {
    it("returns storyText as substantial prose", () => {
        const story = generateLifeStory("prose-test");
        assert.ok(typeof story.storyText === "string");
        assert.ok(story.storyText.length > 200, "storyText should be >200 chars, got " + story.storyText.length);
        assert.ok(/[a-z]{3,}/.test(story.storyText), "storyText contains real words");
    });

    it("storyText contains the player name", () => {
        for (let i = 0; i < 50; i++) {
            const story = generateLifeStory("name-check-" + i);
            assert.ok(story.storyText.includes(story.name),
                `seed name-check-${i}: storyText missing name "${story.name}"`);
        }
    });

    it("storyText contains occupation and cause of death", () => {
        const story = generateLifeStory("detail-check");
        assert.ok(story.storyText.includes(story.occupation), "missing occupation");
        assert.ok(story.storyText.includes(story.causeOfDeath), "missing cause of death");
    });

    it("targetPage is valid (0 to PAGES_PER_BOOK-1)", () => {
        for (let i = 0; i < 200; i++) {
            const story = generateLifeStory("tp-" + i);
            assert.ok(story.targetPage >= 0 && story.targetPage < PAGES_PER_BOOK,
                `seed tp-${i}: targetPage ${story.targetPage} out of range 0..${PAGES_PER_BOOK - 1}`);
        }
    });

    it("all 6 prose templates are reachable", () => {
        const texts = new Set();
        // Each template has a distinctive opening pattern
        const patterns = [
            /^Your name was/,
            /was a .+ from .+\. Not a good one/,
            /^You were a .+\. You lived in/,
            /^The life of/,
            /^This is the part where/,
            /died of .+\. Before that, a life:/,
        ];
        for (let i = 0; i < 500; i++) {
            const story = generateLifeStory("tmpl-" + i);
            for (let p = 0; p < patterns.length; p++) {
                if (patterns[p].test(story.storyText)) texts.add(p);
            }
        }
        assert.strictEqual(texts.size, 6,
            "expected all 6 templates reachable, got " + texts.size + ": " + [...texts].join(","));
    });

    it("deterministic: same seed produces same storyText and targetPage", () => {
        const a = generateLifeStory("determinism");
        const b = generateLifeStory("determinism");
        assert.strictEqual(a.storyText, b.storyText);
        assert.strictEqual(a.targetPage, b.targetPage);
    });
});

describe("playerStart", () => {
    it("playerStart has valid shape", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateLifeStory("ps-shape-" + i);
            const ps = story.playerStart;
            assert.ok(ps !== null && typeof ps === "object", "playerStart missing");
            assert.ok(ps.side === 0 || ps.side === 1, "playerStart.side invalid");
            assert.ok(typeof ps.position === "bigint", "playerStart.position not bigint");
            assert.ok(typeof ps.floor === "bigint", "playerStart.floor not bigint");
        }
    });

    it("playerStart floor is non-negative", () => {
        for (let i = 0; i < 100; i++) {
            const story = generateLifeStory("ps-floor-" + i);
            assert.ok(story.playerStart.floor >= 0n,
                `seed ps-floor-${i}: playerStart.floor ${story.playerStart.floor} is negative`);
        }
    });

    it("random mode: playerStart is at least 666,666 segments from book", () => {
        for (let i = 0; i < 20; i++) {
            const story = generateLifeStory("ps-dist-" + i, { placement: "random" });
            const dist = story.playerStart.position - story.bookCoords.position;
            const absDist = dist < 0n ? -dist : dist;
            assert.ok(absDist >= 666_666n,
                `seed ps-dist-${i}: playerStart only ${absDist} segments from book`);
        }
    });

    it("playerStart is on the same side as book", () => {
        for (let i = 0; i < 50; i++) {
            const story = generateLifeStory("ps-side-" + i);
            assert.strictEqual(story.playerStart.side, story.bookCoords.side,
                `seed ps-side-${i}: player on side ${story.playerStart.side}, book on side ${story.bookCoords.side}`);
        }
    });

    it("playerStart floor is 20–30 above book floor", () => {
        for (let i = 0; i < 50; i++) {
            const story = generateLifeStory("ps-floor-off-" + i);
            const floorDiff = story.playerStart.floor - story.bookCoords.floor;
            assert.ok(floorDiff >= 20n && floorDiff <= 30n,
                `seed ps-floor-off-${i}: floor diff ${floorDiff} (expected 20–30)`);
        }
    });

    it("deterministic: same seed produces same playerStart", () => {
        const a = generateLifeStory("ps-det");
        const b = generateLifeStory("ps-det");
        assert.strictEqual(a.playerStart.side, b.playerStart.side);
        assert.strictEqual(a.playerStart.position, b.playerStart.position);
        assert.strictEqual(a.playerStart.floor, b.playerStart.floor);
    });
});

describe("formatLifeStory", () => {
    it("returns string containing name and occupation", () => {
        const story = generateLifeStory("format-test");
        const text = formatLifeStory(story);
        assert.ok(typeof text === "string");
        assert.ok(text.includes(story.name));
        assert.ok(text.includes(story.occupation));
    });
});
