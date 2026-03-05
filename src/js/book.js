/* Book wrapper — page generation, dwell timers, target book detection. */

import {
    PAGES_PER_BOOK, CHARS_PER_LINE, LINES_PER_PAGE,
    generateBookPage, bookMeta, findCoherentFragment,
    scoreSensibility, SENSIBILITY_THRESHOLD, DWELL_MS, dwellMoraleDelta,
} from "../../lib/book.core.js";
import { generateBookPage as generateLifeStoryPage } from "../../lib/lifestory.core.js";
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

function startDwell(bk, pageIndex, pageText) {
    clearDwell();
    if (pageIndex < 0) return;
    _dwellPage = { side: bk.side, position: bk.position, floor: bk.floor,
                   bookIndex: bk.bookIndex, pageIndex: pageIndex };
    const sensibility = scoreSensibility(pageText);
    _dwellTimer = setTimeout(function () {
        _dwellTimer = null;
        const result = dwellMoraleDelta(sensibility, state.nonsensePagesRead || 0);
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
            return generateLifeStoryPage(state.lifeStory, pageIndex);
        }
        return generateBookPage(side, position, floor, bookIndex, pageIndex, PRNG.getSeed());
    },
    getMeta(side, position, floor, bookIndex) {
        return bookMeta(side, position, floor, bookIndex);
    },
    findCoherentFragment(pageText) { return findCoherentFragment(pageText); },
    scoreSensibility(pageText) { return scoreSensibility(pageText); },
    dwellMoraleDelta(sensibility, nonsenseCount) { return dwellMoraleDelta(sensibility, nonsenseCount); },
    startDwell,
    clearDwell,
    isTargetBook,
    PAGES_PER_BOOK,
    CHARS_PER_LINE,
    LINES_PER_PAGE,
    SENSIBILITY_THRESHOLD,
    DWELL_MS,
};
