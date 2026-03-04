/* SugarCube wrapper for book.core — registers setup.Book. */

(function () {
    "use strict";

    const core = window._BookCore;

    setup.Book = {
        /**
         * Get a single page of a book at the given shelf location.
         * Delegates fork to the global PRNG so pages are seed-dependent.
         */
        getPage(side, position, floor, bookIndex, pageIndex) {
            return core.generateBookPage(
                side, position, floor, bookIndex, pageIndex,
                setup.PRNG.getSeed()
            );
        },

        getMeta(side, position, floor, bookIndex) {
            return core.bookMeta(side, position, floor, bookIndex);
        },

        findCoherentFragment(pageText) {
            return core.findCoherentFragment(pageText);
        },

        PAGES_PER_BOOK: core.PAGES_PER_BOOK,
        CHARS_PER_LINE: core.CHARS_PER_LINE,
        LINES_PER_PAGE: core.LINES_PER_PAGE,
    };
}());
