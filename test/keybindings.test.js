import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

function pressKey(game, key) {
    const ev = new game.window.KeyboardEvent("keydown", { key, bubbles: true });
    game.document.dispatchEvent(ev);
}

function goTo(game, screen) {
    game.Engine.goto(screen);
    assert.strictEqual(game.state.screen, screen, "setup: on " + screen);
}

function atRestArea(game) {
    game.state.position = 0;
    game.state.floor = 10;
}

function atNonRestArea(game) {
    game.state.position = 1;
    game.state.floor = 10;
}

/* --------------------------------------------------------
 * Corridor — global keys (vi movement, actions, debug)
 * -------------------------------------------------------- */

describe("Keybindings: Corridor", () => {
    it("h moves left", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "h");
        assert.strictEqual(game.state.screen, "Corridor");
        assert.strictEqual(game.state.position, pos - 1);
    });

    it("ArrowLeft moves left", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "ArrowLeft");
        assert.strictEqual(game.state.position, pos - 1);
    });

    it("l moves right", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "l");
        assert.strictEqual(game.state.position, pos + 1);
    });

    it("ArrowRight moves right", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "ArrowRight");
        assert.strictEqual(game.state.position, pos + 1);
    });

    it("k moves up (stairs at rest area)", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Corridor");
        const floor = game.state.floor;
        pressKey(game, "k");
        assert.strictEqual(game.state.floor, floor + 1);
    });

    it("ArrowUp moves up", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Corridor");
        const floor = game.state.floor;
        pressKey(game, "ArrowUp");
        assert.strictEqual(game.state.floor, floor + 1);
    });

    it("j moves down", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.floor = 5;
        goTo(game, "Corridor");
        pressKey(game, "j");
        assert.strictEqual(game.state.floor, 4);
    });

    it("ArrowDown moves down", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.floor = 5;
        goTo(game, "Corridor");
        pressKey(game, "ArrowDown");
        assert.strictEqual(game.state.floor, 4);
    });

    it("j does not go below floor 0", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.floor = 0;
        goTo(game, "Corridor");
        pressKey(game, "j");
        assert.strictEqual(game.state.floor, 0);
    });

    it("x crosses to other side at floor 0", () => {
        const game = bootGame();
        game.state.floor = 0;
        goTo(game, "Corridor");
        const side = game.state.side;
        pressKey(game, "x");
        assert.strictEqual(game.state.side, side === 0 ? 1 : 0);
    });

    it(". opens Wait screen", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        pressKey(game, ".");
        assert.strictEqual(game.state.screen, "Wait");
    });

    it("z opens Sleep when canSleep", () => {
        const game = bootGame();
        game.state.exhaustion = 100;
        goTo(game, "Corridor");
        pressKey(game, "z");
        assert.strictEqual(game.state.screen, "Sleep");
    });

    it("z does nothing when not tired enough", () => {
        const game = bootGame();
        game.state.exhaustion = 0;
        goTo(game, "Corridor");
        pressKey(game, "z");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("J opens Chasm above floor 0", () => {
        const game = bootGame();
        game.state.floor = 50;
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Chasm");
    });

    it("J works at non-rest-area above floor 0", () => {
        const game = bootGame();
        atNonRestArea(game);
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Chasm");
    });

    it("J does nothing at floor 0", () => {
        const game = bootGame();
        game.state.floor = 0;
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("J skips confirm when despairing", () => {
        const game = bootGame();
        game.state.floor = 50;
        game.state.despairing = true;
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Falling");
    });

    it("K opens Kiosk at rest area with lights on", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "K");
        assert.strictEqual(game.state.screen, "Kiosk");
    });

    it("K does nothing at non-rest-area", () => {
        const game = bootGame();
        atNonRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "K");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("K does nothing when lights off", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.lightsOn = false;
        goTo(game, "Corridor");
        pressKey(game, "K");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("b opens Bedroom at rest area", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Corridor");
        pressKey(game, "b");
        assert.strictEqual(game.state.screen, "Bedroom");
    });

    it("b does nothing at non-rest-area", () => {
        const game = bootGame();
        atNonRestArea(game);
        goTo(game, "Corridor");
        pressKey(game, "b");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("s opens Submission Slot at rest area with lights on", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Submission Slot");
    });

    it("s does nothing at non-rest-area", () => {
        const game = bootGame();
        atNonRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("s does nothing when lights off", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.lightsOn = false;
        goTo(game, "Corridor");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("backtick toggles debug", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        const before = game.state.debug;
        pressKey(game, "`");
        assert.strictEqual(game.state.debug, !before);
    });

    it("Escape opens Menu", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Menu");
        assert.strictEqual(game.state._menuReturn, "Corridor");
    });
});

/* --------------------------------------------------------
 * Shelf Open Book
 * -------------------------------------------------------- */

describe("Keybindings: Shelf Open Book", () => {
    function openBook(game) {
        const coords = { side: 0, position: 0, floor: 10, bookIndex: 0 };
        game.state.openBook = coords;
        game.state.openPage = 5;
        goTo(game, "Shelf Open Book");
    }

    it("h flips page left", () => {
        const game = bootGame();
        openBook(game);
        pressKey(game, "h");
        assert.strictEqual(game.state.openPage, 4);
    });

    it("ArrowLeft flips page left", () => {
        const game = bootGame();
        openBook(game);
        pressKey(game, "ArrowLeft");
        assert.strictEqual(game.state.openPage, 4);
    });

    it("h does not go below page 0", () => {
        const game = bootGame();
        openBook(game);
        game.state.openPage = 0;
        game.Engine.goto("Shelf Open Book");
        pressKey(game, "h");
        assert.strictEqual(game.state.openPage, 0);
    });

    it("l flips page right", () => {
        const game = bootGame();
        openBook(game);
        pressKey(game, "l");
        assert.strictEqual(game.state.openPage, 6);
    });

    it("ArrowRight flips page right", () => {
        const game = bootGame();
        openBook(game);
        pressKey(game, "ArrowRight");
        assert.strictEqual(game.state.openPage, 6);
    });

    it("t takes the book", () => {
        const game = bootGame();
        openBook(game);
        assert.strictEqual(game.state.heldBook, null);
        pressKey(game, "t");
        assert.notStrictEqual(game.state.heldBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("t does nothing if already holding this book", () => {
        const game = bootGame();
        const coords = { side: 0, position: 0, floor: 10, bookIndex: 0 };
        game.state.heldBook = { ...coords };
        game.state.openBook = { ...coords };
        game.state.openPage = 5;
        goTo(game, "Shelf Open Book");
        pressKey(game, "t");
        assert.strictEqual(game.state.screen, "Shelf Open Book");
    });

    it("p puts back a held book", () => {
        const game = bootGame();
        const coords = { side: 0, position: 0, floor: 10, bookIndex: 0 };
        game.state.heldBook = { ...coords };
        game.state.openBook = { ...coords };
        game.state.openPage = 5;
        goTo(game, "Shelf Open Book");
        pressKey(game, "p");
        assert.strictEqual(game.state.heldBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("p does nothing if not holding this book", () => {
        const game = bootGame();
        openBook(game);
        pressKey(game, "p");
        assert.strictEqual(game.state.screen, "Shelf Open Book");
    });

    it("q closes the book", () => {
        const game = bootGame();
        openBook(game);
        pressKey(game, "q");
        assert.strictEqual(game.state.openBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape closes the book", () => {
        const game = bootGame();
        openBook(game);
        pressKey(game, "Escape");
        assert.strictEqual(game.state.openBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Menu
 * -------------------------------------------------------- */

describe("Keybindings: Menu", () => {
    it("Escape returns to previous screen", () => {
        const game = bootGame();
        game.state._menuReturn = "Corridor";
        goTo(game, "Menu");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Life Story
 * -------------------------------------------------------- */

describe("Keybindings: Life Story", () => {
    it("e continues from life story", () => {
        const game = bootGame();
        goTo(game, "Life Story");
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("E continues from life story", () => {
        const game = bootGame();
        goTo(game, "Life Story");
        pressKey(game, "E");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Kiosk
 * -------------------------------------------------------- */

describe("Keybindings: Kiosk", () => {
    function enterKiosk(game) {
        atRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Kiosk");
    }

    it("1 gets water", () => {
        const game = bootGame();
        enterKiosk(game);
        pressKey(game, "1");
        assert.strictEqual(game.state.screen, "Kiosk Get Drink");
    });

    it("2 gets food", () => {
        const game = bootGame();
        enterKiosk(game);
        pressKey(game, "2");
        assert.strictEqual(game.state.screen, "Kiosk Get Food");
    });

    it("3 gets alcohol", () => {
        const game = bootGame();
        enterKiosk(game);
        pressKey(game, "3");
        assert.strictEqual(game.state.screen, "Kiosk Get Alcohol");
    });

    it("q leaves kiosk", () => {
        const game = bootGame();
        enterKiosk(game);
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape leaves kiosk", () => {
        const game = bootGame();
        enterKiosk(game);
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Kiosk sub-screens (Get Drink / Get Food / Get Alcohol)
 * -------------------------------------------------------- */

describe("Keybindings: Kiosk sub-screens", () => {
    for (const sub of ["Kiosk Get Drink", "Kiosk Get Food", "Kiosk Get Alcohol"]) {
        it("Enter returns to Kiosk from " + sub, () => {
            const game = bootGame();
            atRestArea(game);
            game.state.lightsOn = true;
            goTo(game, sub);
            pressKey(game, "Enter");
            assert.strictEqual(game.state.screen, "Kiosk");
        });

        it("Space returns to Kiosk from " + sub, () => {
            const game = bootGame();
            atRestArea(game);
            game.state.lightsOn = true;
            goTo(game, sub);
            pressKey(game, " ");
            assert.strictEqual(game.state.screen, "Kiosk");
        });

        it("e returns to Kiosk from " + sub, () => {
            const game = bootGame();
            atRestArea(game);
            game.state.lightsOn = true;
            goTo(game, sub);
            pressKey(game, "e");
            assert.strictEqual(game.state.screen, "Kiosk");
        });

        it("Escape opens Menu from " + sub, () => {
            const game = bootGame();
            atRestArea(game);
            game.state.lightsOn = true;
            goTo(game, sub);
            pressKey(game, "Escape");
            assert.strictEqual(game.state.screen, "Menu");
            assert.strictEqual(game.state._menuReturn, "Kiosk");
        });
    }
});

/* --------------------------------------------------------
 * Bedroom
 * -------------------------------------------------------- */

describe("Keybindings: Bedroom", () => {
    it("z sleeps", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Bedroom");
        pressKey(game, "z");
        assert.strictEqual(game.state.screen, "Sleep");
    });

    it("q leaves bedroom", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Bedroom");
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape leaves bedroom", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Bedroom");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Sleep
 * -------------------------------------------------------- */

describe("Keybindings: Sleep", () => {
    it("Enter continues from sleep", () => {
        const game = bootGame();
        goTo(game, "Sleep");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Space continues from sleep", () => {
        const game = bootGame();
        goTo(game, "Sleep");
        pressKey(game, " ");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("e continues from sleep", () => {
        const game = bootGame();
        goTo(game, "Sleep");
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape opens Menu from sleep", () => {
        const game = bootGame();
        goTo(game, "Sleep");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Menu");
        assert.strictEqual(game.state._menuReturn, "Corridor");
    });
});

/* --------------------------------------------------------
 * Submission Slot
 * -------------------------------------------------------- */

describe("Keybindings: Submission Slot", () => {
    it("s submits when holding a book", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.heldBook = { side: 0, position: 0, floor: 10, bookIndex: 0 };
        goTo(game, "Submission Slot");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Submission Attempt");
    });

    it("s does nothing without a held book", () => {
        const game = bootGame();
        atRestArea(game);
        game.state.heldBook = null;
        goTo(game, "Submission Slot");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Submission Slot");
    });

    it("q leaves submission slot", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Submission Slot");
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape leaves submission slot", () => {
        const game = bootGame();
        atRestArea(game);
        goTo(game, "Submission Slot");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Submission Attempt
 * -------------------------------------------------------- */

describe("Keybindings: Submission Attempt", () => {
    it("Enter continues", () => {
        const game = bootGame();
        goTo(game, "Submission Attempt");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Space continues", () => {
        const game = bootGame();
        goTo(game, "Submission Attempt");
        pressKey(game, " ");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("e continues", () => {
        const game = bootGame();
        goTo(game, "Submission Attempt");
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Chasm
 * -------------------------------------------------------- */

describe("Keybindings: Chasm", () => {
    it("n returns to corridor", () => {
        const game = bootGame();
        game.state.floor = 50;
        goTo(game, "Chasm");
        pressKey(game, "n");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("N returns to corridor", () => {
        const game = bootGame();
        game.state.floor = 50;
        goTo(game, "Chasm");
        pressKey(game, "N");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("q returns to corridor", () => {
        const game = bootGame();
        game.state.floor = 50;
        goTo(game, "Chasm");
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape returns to corridor", () => {
        const game = bootGame();
        game.state.floor = 50;
        goTo(game, "Chasm");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("y confirms jump", () => {
        const game = bootGame();
        game.state.floor = 50;
        goTo(game, "Chasm");
        pressKey(game, "y");
        assert.strictEqual(game.state.screen, "Falling");
    });

    it("Y confirms jump", () => {
        const game = bootGame();
        game.state.floor = 50;
        goTo(game, "Chasm");
        pressKey(game, "Y");
        assert.strictEqual(game.state.screen, "Falling");
    });
});

/* --------------------------------------------------------
 * Death
 * -------------------------------------------------------- */

describe("Keybindings: Death", () => {
    function setupDeath(game) {
        game.state.dead = true;
        game.state.deathCause = "fell";
        goTo(game, "Death");
    }

    it("Enter continues from death", () => {
        const game = bootGame();
        setupDeath(game);
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Space continues from death", () => {
        const game = bootGame();
        setupDeath(game);
        pressKey(game, " ");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("e continues from death", () => {
        const game = bootGame();
        setupDeath(game);
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("backtick toggles debug on death screen", () => {
        const game = bootGame();
        setupDeath(game);
        const before = game.state.debug;
        pressKey(game, "`");
        assert.strictEqual(game.state.debug, !before);
        assert.strictEqual(game.state.screen, "Death");
    });
});

/* --------------------------------------------------------
 * Falling
 * -------------------------------------------------------- */

describe("Keybindings: Falling", () => {
    function setupFalling(game) {
        game.state.floor = 50;
        goTo(game, "Chasm");
        pressKey(game, "y");
        assert.strictEqual(game.state.screen, "Falling");
    }

    it("Escape opens menu from falling", () => {
        const game = bootGame();
        setupFalling(game);
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Menu");
        assert.strictEqual(game.state._menuReturn, "Falling");
    });

    it("backtick toggles debug while falling", () => {
        const game = bootGame();
        setupFalling(game);
        const before = game.state.debug;
        pressKey(game, "`");
        assert.strictEqual(game.state.debug, !before);
        assert.strictEqual(game.state.screen, "Falling");
    });
});

/* --------------------------------------------------------
 * Escape from various screens sets correct _menuReturn
 * -------------------------------------------------------- */

describe("Keybindings: Escape menu return", () => {
    it("Escape from Corridor sets _menuReturn to Corridor", () => {
        const game = bootGame();
        goTo(game, "Corridor");
        pressKey(game, "Escape");
        assert.strictEqual(game.state._menuReturn, "Corridor");
    });

    it("Escape from Life Story sets _menuReturn to Life Story", () => {
        const game = bootGame();
        goTo(game, "Life Story");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Menu");
        assert.strictEqual(game.state._menuReturn, "Life Story");
    });
});
