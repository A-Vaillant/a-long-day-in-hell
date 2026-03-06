/* Keybindings — vim-style navigation + game actions. */

import { state } from "./state.js";
import { Engine } from "./engine.js";
import { Book } from "./book.js";
import { Chasm } from "./chasm.js";
import { Despair } from "./despairing.js";
import { Lib } from "./library.js";
import { doMove } from "./screens.js";

const VI_MOVE = {
    "h": "left",  "ArrowLeft":  "left",
    "l": "right", "ArrowRight": "right",
    "k": "up",    "ArrowUp":    "up",
    "j": "down",  "ArrowDown":  "down",
    "x": "cross",
};

document.addEventListener("keydown", function (ev) {
    if (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA") return;

    const screen = state.screen;
    const key = ev.key;

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
                if (state.openPage < Book.PAGES_PER_BOOK + 1) {
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
    } else if (screen === "Falling") {
        switch (key) {
            case "w":
                ev.preventDefault();
                document.getElementById("fall-wait")?.click();
                return;
            case "g":
                ev.preventDefault();
                document.getElementById("fall-grab")?.click();
                return;
            case "t":
                ev.preventDefault();
                document.getElementById("fall-throw")?.click();
                return;
            case "Escape":
                ev.preventDefault();
                state._menuReturn = screen;
                Engine.goto("Menu");
                return;
        }
        if (key === "`" || key === "~") {
            ev.preventDefault();
            state.debug = !state.debug;
            Engine.goto(screen);
        }
        return;
    } else if (screen === "Kiosk") {
        switch (key) {
            case "1":
                ev.preventDefault();
                Engine.goto("Kiosk Get Drink");
                return;
            case "2":
                ev.preventDefault();
                Engine.goto("Kiosk Get Food");
                return;
            case "3":
                ev.preventDefault();
                Engine.goto("Kiosk Get Alcohol");
                return;
            case "q": case "Escape":
                ev.preventDefault();
                Engine.goto("Corridor");
                return;
        }
        return;
    } else if (screen === "Kiosk Get Drink" || screen === "Kiosk Get Food" || screen === "Kiosk Get Alcohol") {
        if (key === "Enter" || key === " " || key === "e") {
            ev.preventDefault();
            Engine.goto("Kiosk");
            return;
        }
        if (key === "Escape") {
            ev.preventDefault();
            state._menuReturn = "Kiosk";
            Engine.goto("Menu");
            return;
        }
        return;
    } else if (screen === "Bedroom") {
        switch (key) {
            case "z":
                ev.preventDefault();
                Engine.goto("Sleep Stub");
                return;
            case "q": case "Escape":
                ev.preventDefault();
                Engine.goto("Corridor");
                return;
        }
        return;
    } else if (screen === "Sleep Stub") {
        if (key === "Enter" || key === " " || key === "e") {
            ev.preventDefault();
            Engine.goto("Corridor");
            return;
        }
        if (key === "Escape") {
            ev.preventDefault();
            state._menuReturn = "Corridor";
            Engine.goto("Menu");
            return;
        }
        return;
    } else if (screen === "Submission Slot") {
        if (key === "s" && state.heldBook !== null) {
            ev.preventDefault();
            Engine.goto("Submission Attempt");
            return;
        }
        if (key === "q" || key === "Escape") {
            ev.preventDefault();
            Engine.goto("Corridor");
            return;
        }
        return;
    } else if (screen === "Submission Attempt") {
        if (key === "Enter" || key === " " || key === "e") {
            ev.preventDefault();
            Engine.goto("Corridor");
            return;
        }
        return;
    } else if (screen === "Chasm Stub") {
        if (key === "y" || key === "Y") {
            ev.preventDefault();
            const btn = document.getElementById("chasm-jump-yes");
            if (btn) btn.click();
            return;
        }
        if (key === "n" || key === "N" || key === "Escape" || key === "q") {
            ev.preventDefault();
            Engine.goto("Corridor");
            return;
        }
        return;
    } else if (screen === "Death") {
        if (key === "Enter" || key === " " || key === "e") {
            ev.preventDefault();
            Engine.goto("Corridor");
            return;
        }
        if (key === "`" || key === "~") {
            ev.preventDefault();
            state.debug = !state.debug;
            Engine.goto(screen);
        }
        return;
    }

    if (key === "Escape") {
        ev.preventDefault();
        const KIOSK_SUBS = ["Kiosk Get Drink", "Kiosk Get Food", "Kiosk Get Alcohol"];
        const TRANSIENT = ["Wait Stub", "Sleep Stub", "Submission Attempt", "Chasm Stub", "Falling"].concat(KIOSK_SUBS);
        if (KIOSK_SUBS.indexOf(screen) !== -1) {
            state._menuReturn = "Kiosk";
        } else if (TRANSIENT.indexOf(screen) !== -1) {
            state._menuReturn = "Corridor";
        } else {
            state._menuReturn = screen;
        }
        Engine.goto("Menu");
        return;
    }

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
            Engine.goto("Sleep Stub");
            break;
        case "J": {
            ev.preventDefault();
            const seg = Lib.getSegment(state.side, state.position, state.floor);
            if (seg.restArea && state.floor > 0) {
                if (Despair.chasmSkipsConfirm()) {
                    Chasm.jump(state.side);
                    Engine.goto("Falling");
                } else {
                    Engine.goto("Chasm Stub");
                }
            }
            break;
        }
        case "K": {
            ev.preventDefault();
            const kseg = Lib.getSegment(state.side, state.position, state.floor);
            if (kseg.restArea && state.lightsOn) Engine.goto("Kiosk");
            break;
        }
        case "b": {
            ev.preventDefault();
            const bseg = Lib.getSegment(state.side, state.position, state.floor);
            if (bseg.restArea) Engine.goto("Bedroom");
            break;
        }
        case "s": {
            ev.preventDefault();
            const sseg = Lib.getSegment(state.side, state.position, state.floor);
            if (sseg.restArea && state.lightsOn) Engine.goto("Submission Slot");
            break;
        }
        case "~":
        case "`":
            ev.preventDefault();
            state.debug = !state.debug;
            Engine.goto(screen);
            break;
    }
});
