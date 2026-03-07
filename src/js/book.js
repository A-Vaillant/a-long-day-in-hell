/* Book wrapper — page generation, target book detection. */

import {
    PAGES_PER_BOOK, LINES_PER_PAGE, CHARS_PER_LINE,
    generateBookPage, bookMeta,
} from "../../lib/book.core.ts";
import { PRNG } from "./prng.js";
import { state } from "./state.js";

function isTargetBook(side, position, floor, bookIndex) {
    const tb = state.targetBook;
    return tb && tb.side === side && tb.position === position &&
        tb.floor === floor && tb.bookIndex === bookIndex;
}

export const Book = {
    getPage(side, position, floor, bookIndex, pageIndex) {
        if (isTargetBook(side, position, floor, bookIndex) &&
            pageIndex === state.lifeStory.targetPage) {
            return state.lifeStory.storyText;
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
