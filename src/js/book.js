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

    var _dwellTimer = null;
    var _dwellPage = null;    // { side, position, floor, bookIndex, pageIndex }

    function clearDwell() {
        if (_dwellTimer !== null) { clearTimeout(_dwellTimer); _dwellTimer = null; }
        _dwellPage = null;
    }

    function startDwell(bk, pageIndex, pageText) {
        clearDwell();
        // Covers and back covers have no text to score
        if (pageIndex < 0) return;
        _dwellPage = { side: bk.side, position: bk.position, floor: bk.floor,
                       bookIndex: bk.bookIndex, pageIndex: pageIndex };
        var sensibility = core.scoreSensibility(pageText);
        _dwellTimer = setTimeout(function () {
            _dwellTimer = null;
            var result = core.dwellMoraleDelta(sensibility, state.nonsensePagesRead || 0);
            state.morale = Math.max(0, Math.min(100, state.morale + result.delta));
            if (result.isNonsense) {
                state.nonsensePagesRead = (state.nonsensePagesRead || 0) + 1;
            }
            // Re-render to show morale change / notice
            if (state.screen === "Shelf Open Book") Engine.goto("Shelf Open Book");
        }, core.DWELL_MS);
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

        scoreSensibility: function (pageText) {
            return core.scoreSensibility(pageText);
        },

        dwellMoraleDelta: function (sensibility, nonsenseCount) {
            return core.dwellMoraleDelta(sensibility, nonsenseCount);
        },

        /** Start dwell timer for a page. Called from afterRender. */
        startDwell: startDwell,

        /** Cancel any active dwell timer. Called on page flip / book close. */
        clearDwell: clearDwell,

        isTargetBook: isTargetBook,

        PAGES_PER_BOOK: core.PAGES_PER_BOOK,
        CHARS_PER_LINE: core.CHARS_PER_LINE,
        LINES_PER_PAGE: core.LINES_PER_PAGE,
        SENSIBILITY_THRESHOLD: core.SENSIBILITY_THRESHOLD,
        DWELL_MS: core.DWELL_MS,
    };
}());
