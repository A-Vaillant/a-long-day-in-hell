/* Keybindings — vim-style navigation + game actions.
 *
 * Exploration mode (mode === "explore"):
 *   h / ArrowLeft  → left
 *   l / ArrowRight → right
 *   k / ArrowUp    → up (stairs)
 *   j / ArrowDown  → down (stairs)
 *   (y/u/b/n unused for now — no diagonals in this geometry)
 *   .            → wait
 *   r            → read/interact (open shelf mode)
 *   i            → inventory/status (stub)
 *   z            → sleep/rest (stub)
 *   J            → jump into chasm
 *   K            → try to get back
 *   ~            → toggle debug panel
 *
 * Shelf mode (mode === "shelf"):
 *   Esc          → back to gallery
 *   (TBD)
 */

(function () {
    "use strict";

    const VI_MOVE = {
        "h": "left",  "ArrowLeft":  "left",
        "l": "right", "ArrowRight": "right",
        "k": "up",    "ArrowUp":    "up",
        "j": "down",  "ArrowDown":  "down",
        "x": "cross",  // cross bridge
    };

    function getMode() {
        return State.variables.mode || "explore";
    }

    const DIR_PASSAGE = {
        left: "Corridor Move Left",
        right: "Corridor Move Right",
        up: "Corridor Move Up",
        down: "Corridor Move Down",
        cross: "Corridor Move Cross",
    };

    function doMove(dir) {
        const loc = {
            side:     State.variables.side,
            position: State.variables.position,
            floor:    State.variables.floor,
        };
        const available = setup.Library.availableMoves(loc);
        if (!available.includes(dir)) return;
        Engine.play(DIR_PASSAGE[dir]);
    }

    $(document).on("keydown.hell", function (ev) {
        // Don't capture inside inputs
        if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA") return;

        const mode = getMode();
        const key = ev.key;

        if (mode === "explore") {
            if (Object.prototype.hasOwnProperty.call(VI_MOVE, key)) {
                ev.preventDefault();
                doMove(VI_MOVE[key]);
                return;
            }
            switch (key) {
                case ".":
                    ev.preventDefault();
                    Engine.play("Wait Stub");
                    break;
                case "r":
                    ev.preventDefault();
                    Engine.play("Shelf Browse");
                    break;
                case "i":
                    ev.preventDefault();
                    Engine.play("Shelf Stub"); // stub
                    break;
                case "z":
                    ev.preventDefault();
                    Engine.play("Wait Stub"); // stub
                    break;
                case "J":
                    ev.preventDefault();
                    Engine.play("Chasm Stub");
                    break;
                case "K":
                    ev.preventDefault();
                    Engine.play("Corridor"); // stub: "try to get back"
                    break;
                case "~":
                case "`":
                    ev.preventDefault();
                    State.variables.debug = !State.variables.debug;
                    Engine.play("Corridor");
                    break;
            }
        } else if (mode === "shelf") {
            if (key === "Escape") {
                ev.preventDefault();
                State.variables.mode = "explore";
                Engine.play("Corridor");
            }
        }
    });
}());
