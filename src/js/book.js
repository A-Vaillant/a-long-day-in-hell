/* Book wrapper — page generation, target book detection, life-story books. */

import {
    PAGES_PER_BOOK, LINES_PER_PAGE, CHARS_PER_LINE,
    generateBookPage, generateStoryPage, bookMeta,
} from "../../lib/book.core.ts";
import { generateNPCLifeStory } from "../../lib/lifestory.core.ts";
import { digitWiseBookPage, coordsToAddress } from "../../lib/invertible.core.ts";
import { PRNG } from "./prng.js";
import { state } from "./state.js";

function isTargetBook(side, position, floor, bookIndex) {
    const tb = state.targetBook;
    return tb && tb.side === side && tb.position === position &&
        tb.floor === floor && tb.bookIndex === bookIndex;
}

/**
 * Check if a book at these coords belongs to any NPC.
 *
 * Detection works by content, not stored coords: for each NPC, derive their
 * story and compute the coords that fall out of that text. If those coords
 * match the book being opened, this is their book — a wild coincidence.
 *
 * NPCs have no stored bookCoords. They don't know where their book is.
 */
function findNPCStory(side, position, floor, bookIndex) {
    if (!state.npcs) return null;
    const seed = PRNG.getSeed();
    for (const npc of state.npcs) {
        const story = generateNPCLifeStory(npc.id, seed, state.playerRawAddress, state.playerBookAddress);
        const bc = story.bookCoords;
        if (bc.side === side && bc.position === position &&
            bc.floor === floor && bc.bookIndex === bookIndex) {
            return story;
        }
    }
    return null;
}

/**
 * Get a life-story page (player or NPC). Returns the real prose on the
 * target page, tedious life-arc content on all other pages.
 */
function getStoryBookPage(story, pageIndex) {
    return generateStoryPage(story.storyText, {
        name: story.name,
        occupation: story.occupation,
        hometown: story.hometown,
        causeOfDeath: story.causeOfDeath,
    }, pageIndex);
}

export const Book = {
    getPage(side, position, floor, bookIndex, pageIndex) {
        // Unified digit-wise codepath — no branch between player/NPC/noise
        if (state._featureFlags && state._featureFlags.digitWiseBooks) {
            const address = coordsToAddress(side, position, floor, bookIndex);
            const flat = digitWiseBookPage(
                address, state._originPad, state._playerDigits,
                state._feistelKey, pageIndex,
            );
            // Insert newlines for rendering (core function returns flat math output)
            const lines = [];
            for (let i = 0; i < flat.length; i += CHARS_PER_LINE) {
                lines.push(flat.slice(i, i + CHARS_PER_LINE));
            }
            return lines.join("\n");
        }
        // Legacy codepath (pre-3.2 saves)
        if (isTargetBook(side, position, floor, bookIndex)) {
            return getStoryBookPage(state.lifeStory, pageIndex);
        }
        const npcStory = findNPCStory(side, position, floor, bookIndex);
        if (npcStory) {
            return getStoryBookPage(npcStory, pageIndex);
        }
        return generateBookPage(
            side, position, floor, bookIndex, pageIndex,
            PRNG.getSeed()
        );
    },
    getMeta(side, position, floor, bookIndex) {
        return bookMeta(side, position, floor, bookIndex);
    },
    isTargetBook,
    PAGES_PER_BOOK,
    LINES_PER_PAGE,
    CHARS_PER_LINE,
};
