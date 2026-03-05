/* Book wrapper — registers window.Book. */

(function () {
    "use strict";

    var core = window._BookCore;
    var lifeCore = window._LifeStoryCore;

    function isTargetBook(side, position, floor, bookIndex) {
        var tb = state.targetBook;
        return tb && tb.side === side && tb.position === position &&
            tb.floor === floor && tb.bookIndex === bookIndex;
    }

    window.Book = {
        getPage: function (side, position, floor, bookIndex, pageIndex) {
            if (isTargetBook(side, position, floor, bookIndex)) {
                return lifeCore.generateBookPage(state.lifeStory, pageIndex);
            }
            return core.generateBookPage(
                side, position, floor, bookIndex, pageIndex,
                PRNG.getSeed()
            );
        },

        getMeta: function (side, position, floor, bookIndex) {
            return core.bookMeta(side, position, floor, bookIndex);
        },

        findCoherentFragment: function (pageText) {
            return core.findCoherentFragment(pageText);
        },

        isTargetBook: isTargetBook,

        PAGES_PER_BOOK: core.PAGES_PER_BOOK,
        CHARS_PER_LINE: core.CHARS_PER_LINE,
        LINES_PER_PAGE: core.LINES_PER_PAGE,
    };
}());
