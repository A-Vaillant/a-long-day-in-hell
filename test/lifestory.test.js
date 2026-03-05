import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateLifeStory } from "../lib/lifestory.core.js";
import { BOOKS_PER_GALLERY, isRestArea } from "../lib/library.core.js";

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
                    assert.ok(story.bookCoords.floor >= 0,
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
