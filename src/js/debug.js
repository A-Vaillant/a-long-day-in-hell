/* Debug API — only active when State.variables.debug === true.
 * Exposed as setup.Debug (SugarCube) and window.Debug (for shot-scraper/console).
 *
 * Usage from browser console or tests:
 *   Debug.goToBook(0, 5, 10, 42)   → teleport + open book 42 at west/seg5/floor10
 *   Debug.goToLocation(1, 3, 7)    → teleport to east corridor, seg 3, floor 7
 *   Debug.getBookKey()             → "0:5:10:42" (current open book coords)
 *   Debug.getLocation()            → { side, position, floor }
 *   Debug.openPage(n)              → jump to page n of current open book
 *   Debug.setSeed(s)               → re-seed PRNG and restart (full reload)
 */

(function () {
    "use strict";

    const api = {
        goToLocation(side, position, floor) {
            State.variables.side     = side;
            State.variables.position = position;
            State.variables.floor    = floor;
            State.variables.mode     = "explore";
            Engine.play("Corridor");
        },

        goToBook(side, position, floor, bookIndex) {
            State.variables.side      = side;
            State.variables.position  = position;
            State.variables.floor     = floor;
            State.variables.openBook  = { side, position, floor, bookIndex };
            State.variables.openPage  = 0;
            State.variables.mode      = "shelf";
            Engine.play("Shelf Open Book");
        },

        openPage(n) {
            if (!State.variables.openBook) return "no book open";
            State.variables.openPage = n;
            Engine.play("Shelf Open Book");
        },

        getBookKey() {
            const b = State.variables.openBook;
            if (!b) return null;
            return `${b.side}:${b.position}:${b.floor}:${b.bookIndex}`;
        },

        getLocation() {
            return {
                side:     State.variables.side,
                position: State.variables.position,
                floor:    State.variables.floor,
            };
        },

        setSeed(seed) {
            const url = new URL(window.location.href);
            url.searchParams.set("seed", String(seed));
            window.location.href = url.toString();
        },
    };

    setup.Debug = api;
    window.Debug = api;
}());
