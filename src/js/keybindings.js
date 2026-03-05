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
 *   Esc          → back to corridor
 *
 * Book open (mode === "shelf", openBook set):
 *   h / ArrowLeft  → previous spread
 *   l / ArrowRight → next spread
 *   Esc / q        → back to shelf browse
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

    // Mutates state for a move action. Returns true if move was valid.
    // Callers are responsible for navigation (Engine.play or <<goto>>).
    setup.doMove = function (dir) {
        const loc = {
            side:     State.variables.side,
            position: State.variables.position,
            floor:    State.variables.floor,
        };
        const available = setup.Library.availableMoves(loc);
        if (!available.includes(dir)) return false;
        const dest = setup.Library.applyMove(loc, dir);
        State.variables.side     = dest.side;
        State.variables.position = dest.position;
        State.variables.floor    = dest.floor;
        setup.Tick.onMove();
        return true;
    };

    $(document).on("keydown.hell", function (ev) {
        // Don't capture inside inputs
        if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA") return;

        const mode = getMode();
        const key = ev.key;

        if (mode === "explore") {
            if (Object.prototype.hasOwnProperty.call(VI_MOVE, key)) {
                ev.preventDefault();
                if (setup.doMove(VI_MOVE[key])) Engine.play("Corridor");
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
            var v = State.variables;
            if (v.openBook !== null) {
                // Book is open — page flip and close
                switch (key) {
                    case "h": case "ArrowLeft":
                        ev.preventDefault();
                        if (v.openPage > 0) {
                            v.openPage -= 1;
                            Engine.play("Shelf Open Book");
                        }
                        break;
                    case "l": case "ArrowRight":
                        ev.preventDefault();
                        if (v.openPage < 207) {
                            v.openPage += 1;
                            Engine.play("Shelf Open Book");
                        }
                        break;
                    case "Escape": case "q":
                        ev.preventDefault();
                        v.openBook = null;
                        Engine.play("Shelf Browse");
                        break;
                }
            } else {
                // Shelf browse
                if (key === "Escape") {
                    ev.preventDefault();
                    v.mode = "explore";
                    Engine.play("Corridor");
                }
            }
        }
    });
}());
