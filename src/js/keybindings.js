/* Keybindings — vim-style navigation + game actions.
 * Dispatches based on state.screen.
 */

(function () {
    "use strict";

    var VI_MOVE = {
        "h": "left",  "ArrowLeft":  "left",
        "l": "right", "ArrowRight": "right",
        "k": "up",    "ArrowUp":    "up",
        "j": "down",  "ArrowDown":  "down",
        "x": "cross",
    };

    document.addEventListener("keydown", function (ev) {
        if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA") return;

        var screen = state.screen;
        var key = ev.key;

        if (screen === "Shelf Open Book") {
            switch (key) {
                case "h": case "ArrowLeft":
                    ev.preventDefault();
                    if (state.openPage > 0) {
                        state.openPage -= 1;
                        Engine.goto("Shelf Open Book");
                    }
                    return;
                case "l": case "ArrowRight":
                    ev.preventDefault();
                    if (state.openPage < 411) {
                        state.openPage += 1;
                        Engine.goto("Shelf Open Book");
                    }
                    return;
                case "Escape": case "q":
                    ev.preventDefault();
                    Book.clearDwell();
                    state.openBook = null;
                    Engine.goto("Corridor");
                    return;
            }
        } else if (screen === "Menu") {
            if (key === "Escape") {
                ev.preventDefault();
                Engine.goto(state._menuReturn || "Corridor");
            }
            return;
        } else if (screen === "Life Story") {
            if (key === "e" || key === "E") {
                ev.preventDefault();
                Engine.goto("Corridor");
                return;
            }
        } else if (screen === "Death") {
            if (key === "`" || key === "~") {
                ev.preventDefault();
                state.debug = !state.debug;
                Engine.goto(screen);
            }
            return;
        }

        // Menu (Escape from gameplay screens)
        if (key === "Escape") {
            ev.preventDefault();
            state._menuReturn = screen;
            Engine.goto("Menu");
            return;
        }

        // Corridor and general navigation
        if (VI_MOVE.hasOwnProperty(key)) {
            ev.preventDefault();
            if (doMove(VI_MOVE[key])) Engine.goto("Corridor");
            return;
        }
        switch (key) {
            case ".":
                ev.preventDefault();
                Engine.goto("Wait Stub");
                break;
            case "z":
                ev.preventDefault();
                Engine.goto("Wait Stub");
                break;
            case "J":
                ev.preventDefault();
                Engine.goto("Chasm Stub");
                break;
            case "~":
            case "`":
                ev.preventDefault();
                state.debug = !state.debug;
                Engine.goto(screen);
                break;
        }
    });
}());
