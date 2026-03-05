/* Book wrapper — page generation, dwell timers, target book detection. */

import {
    PAGES_PER_BOOK, DWELL_MS,
    generateBookPage, bookMeta, tokenize,
    findOriginalFragments, dwellMoraleDelta,
} from "../../lib/book.core.js";
import { generateLifeBookPage } from "../../lib/lifestory.core.js";
import { PRNG } from "./prng.js";
import { state } from "./state.js";
import { Engine } from "./engine.js";

function isTargetBook(side, position, floor, bookIndex) {
    const tb = state.targetBook;
    return tb && tb.side === side && tb.position === position &&
        tb.floor === floor && tb.bookIndex === bookIndex;
}

let _dwellTimer = null;
let _dwellPage = null;

function clearDwell() {
    if (_dwellTimer !== null) { clearTimeout(_dwellTimer); _dwellTimer = null; }
    _dwellPage = null;
}

function startDwell(bk, pageIndex, pageResult) {
    clearDwell();
    if (pageIndex < 0) return;
    _dwellPage = { side: bk.side, position: bk.position, floor: bk.floor,
                   bookIndex: bk.bookIndex, pageIndex: pageIndex };
    const totalWords = tokenize(TEXT.stories[pageResult.storyId].text).length;
    _dwellTimer = setTimeout(function () {
        _dwellTimer = null;
        const result = dwellMoraleDelta(pageResult.editDistance, totalWords, state.nonsensePagesRead || 0);
        state.morale = Math.max(0, Math.min(100, state.morale + result.delta));
        if (result.isNonsense) {
            state.nonsensePagesRead = (state.nonsensePagesRead || 0) + 1;
        }
        if (state.screen === "Shelf Open Book") Engine.goto("Shelf Open Book");
    }, DWELL_MS);
}

export const Book = {
    getPage(side, position, floor, bookIndex, pageIndex) {
        if (isTargetBook(side, position, floor, bookIndex)) {
            return {
                text: generateLifeBookPage(state.lifeStory, pageIndex),
                storyId: -1,
                editDistance: 0,
            };
        }
        return generateBookPage(
            side, position, floor, bookIndex, pageIndex,
            PRNG.getSeed(), TEXT.stories, TEXT.dictionary
        );
    },
    getMeta(side, position, floor, bookIndex) {
        return bookMeta(side, position, floor, bookIndex);
    },
    findFragments(storyId, degradedText) {
        if (storyId < 0 || storyId >= TEXT.stories.length) return [];
        const degradedTokens = tokenize(degradedText);
        const originalTokens = tokenize(TEXT.stories[storyId].text);
        return findOriginalFragments(degradedTokens, originalTokens);
    },
    startDwell,
    clearDwell,
    isTargetBook,
    PAGES_PER_BOOK,
    DWELL_MS,
};
