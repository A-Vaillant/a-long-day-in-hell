/* Book wrapper — page generation, target book detection, life-story books. */

import {
    PAGES_PER_BOOK, LINES_PER_PAGE, CHARS_PER_LINE,
    generateBookPage, generateStoryPage, bookMeta,
} from "../../lib/book.core.ts";
import { generateNPCLifeStory } from "../../lib/lifestory.core.ts";
import { PRNG } from "./prng.js";
import { state } from "./state.js";

function isTargetBook(side, position, floor, bookIndex) {
    const tb = state.targetBook;
    return tb && tb.side === side && tb.position === position &&
        tb.floor === floor && tb.bookIndex === bookIndex;
}

/**
 * Check if a book at these coords belongs to any NPC.
 * Returns the NPC's life story if found, null otherwise.
 */
function findNPCStory(side, position, floor, bookIndex) {
    if (!state.npcs) return null;
    const seed = PRNG.getSeed();
    for (const npc of state.npcs) {
        const bc = npc.bookCoords;
        if (bc && bc.side === side && bc.position === position &&
            bc.floor === floor && bc.bookIndex === bookIndex) {
            return generateNPCLifeStory(npc.id, seed);
        }
    }
    return null;
}

/**
 * Get a life-story page (player or NPC). Returns the real prose on the
 * target page, tedious life-arc content on all other pages.
 */
function getStoryBookPage(story, pageIndex) {
    if (pageIndex === story.targetPage) {
        return story.storyText;
    }
    return generateStoryPage(story.storyText, {
        name: story.name,
        occupation: story.occupation,
        hometown: story.hometown,
        causeOfDeath: story.causeOfDeath,
    }, pageIndex);
}

export const Book = {
    getPage(side, position, floor, bookIndex, pageIndex) {
        // Player's book
        if (isTargetBook(side, position, floor, bookIndex)) {
            return getStoryBookPage(state.lifeStory, pageIndex);
        }
        // NPC's book
        const npcStory = findNPCStory(side, position, floor, bookIndex);
        if (npcStory) {
            return getStoryBookPage(npcStory, pageIndex);
        }
        // Random book
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
