import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootGame, resetGame } from "./dom-harness.js";
import { getComponent } from "../lib/ecs.core.ts";

const game = bootGame();

function pressKey(g, key) {
    const ev = new g.window.KeyboardEvent("keydown", { key, bubbles: true });
    g.document.dispatchEvent(ev);
}

function goTo(g, screen) {
    g.Engine.goto(screen);
    assert.strictEqual(g.state.screen, screen, "setup: on " + screen);
}

function atRestArea(g) {
    g.state.position = 0n;
    g.state.floor = 10n;
}

function atNonRestArea(g) {
    g.state.position = 1n;
    g.state.floor = 10n;
}

/* --------------------------------------------------------
 * Corridor — global keys (vi movement, actions, debug)
 * -------------------------------------------------------- */

describe("Keybindings: Corridor", () => {
    beforeEach(() => resetGame(game));

    it("h moves left", () => {
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "h");
        assert.strictEqual(game.state.screen, "Corridor");
        assert.strictEqual(game.state.position, pos - 1n);
    });

    it("ArrowLeft moves left", () => {
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "ArrowLeft");
        assert.strictEqual(game.state.position, pos - 1n);
    });

    it("l moves right", () => {
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "l");
        assert.strictEqual(game.state.position, pos + 1n);
    });

    it("ArrowRight moves right", () => {
        goTo(game, "Corridor");
        const pos = game.state.position;
        pressKey(game, "ArrowRight");
        assert.strictEqual(game.state.position, pos + 1n);
    });

    it("k moves up (stairs at rest area)", () => {
        atRestArea(game);
        goTo(game, "Corridor");
        const floor = game.state.floor;
        pressKey(game, "k");
        assert.strictEqual(game.state.floor, floor + 1n);
    });

    it("ArrowUp moves up", () => {
        atRestArea(game);
        goTo(game, "Corridor");
        const floor = game.state.floor;
        pressKey(game, "ArrowUp");
        assert.strictEqual(game.state.floor, floor + 1n);
    });

    it("j moves down", () => {
        atRestArea(game);
        game.state.floor = 5n;
        goTo(game, "Corridor");
        pressKey(game, "j");
        assert.strictEqual(game.state.floor, 4n);
    });

    it("ArrowDown moves down", () => {
        atRestArea(game);
        game.state.floor = 5n;
        goTo(game, "Corridor");
        pressKey(game, "ArrowDown");
        assert.strictEqual(game.state.floor, 4n);
    });

    it("j does not go below floor 0", () => {
        atRestArea(game);
        game.state.floor = 0n;
        goTo(game, "Corridor");
        pressKey(game, "j");
        assert.strictEqual(game.state.floor, 0n);
    });

    it("x crosses to other side at floor 0", () => {
        game.state.floor = 0n;
        goTo(game, "Corridor");
        const side = game.state.side;
        pressKey(game, "x");
        assert.strictEqual(game.state.side, side === 0 ? 1 : 0);
    });

    it(". opens Wait screen", () => {
        goTo(game, "Corridor");
        pressKey(game, ".");
        assert.strictEqual(game.state.screen, "Wait");
    });

    it("z opens Sleep when canSleep", () => {
        game.state.exhaustion = 100;
        goTo(game, "Corridor");
        pressKey(game, "z");
        assert.strictEqual(game.state.screen, "Sleep");
    });

    it("z does nothing when not tired enough", () => {
        game.state.exhaustion = 0;
        goTo(game, "Corridor");
        pressKey(game, "z");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("J opens Chasm above floor 0", () => {
        game.state.floor = 50n;
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Chasm");
    });

    it("J works at non-rest-area above floor 0", () => {
        atNonRestArea(game);
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Chasm");
    });

    it("J does nothing at floor 0", () => {
        game.state.floor = 0n;
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("J skips confirm when despairing", () => {
        game.state.floor = 50n;
        game.state.despairing = true;
        goTo(game, "Corridor");
        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Falling");
    });

    it("K opens Kiosk at rest area with lights on", () => {
        atRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "K");
        assert.strictEqual(game.state.screen, "Kiosk");
    });

    it("K does nothing at non-rest-area", () => {
        atNonRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "K");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("K does nothing when lights off", () => {
        atRestArea(game);
        game.state.lightsOn = false;
        goTo(game, "Corridor");
        pressKey(game, "K");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("b opens Bedroom at rest area", () => {
        atRestArea(game);
        goTo(game, "Corridor");
        pressKey(game, "b");
        assert.strictEqual(game.state.screen, "Bedroom");
    });

    it("b does nothing at non-rest-area", () => {
        atNonRestArea(game);
        goTo(game, "Corridor");
        pressKey(game, "b");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("s opens Submission Slot at rest area with lights on", () => {
        atRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Submission Slot");
    });

    it("s does nothing at non-rest-area", () => {
        atNonRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Corridor");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("s does nothing when lights off", () => {
        atRestArea(game);
        game.state.lightsOn = false;
        goTo(game, "Corridor");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("backtick toggles debug", () => {
        game.state._debugAllowed = true;
        goTo(game, "Corridor");
        const before = game.state.debug;
        pressKey(game, "`");
        assert.strictEqual(game.state.debug, !before);
    });

    it("backtick does nothing without _debugAllowed", () => {
        game.state._debugAllowed = false;
        goTo(game, "Corridor");
        const before = game.state.debug;
        pressKey(game, "`");
        assert.strictEqual(game.state.debug, before);
    });

    it("Escape opens Menu", () => {
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
    beforeEach(() => resetGame(game));

    function openBook() {
        const coords = { side: 0, position: 0n, floor: 10n, bookIndex: 0 };
        game.state.openBook = coords;
        game.state.openPage = 5;
        goTo(game, "Shelf Open Book");
    }

    it("h flips page left", () => {
        openBook();
        pressKey(game, "h");
        assert.strictEqual(game.state.openPage, 4);
    });

    it("ArrowLeft flips page left", () => {
        openBook();
        pressKey(game, "ArrowLeft");
        assert.strictEqual(game.state.openPage, 4);
    });

    it("h does not go below page 0", () => {
        openBook();
        game.state.openPage = 0;
        game.Engine.goto("Shelf Open Book");
        pressKey(game, "h");
        assert.strictEqual(game.state.openPage, 0);
    });

    it("l flips page right", () => {
        openBook();
        pressKey(game, "l");
        assert.strictEqual(game.state.openPage, 6);
    });

    it("ArrowRight flips page right", () => {
        openBook();
        pressKey(game, "ArrowRight");
        assert.strictEqual(game.state.openPage, 6);
    });

    it("t takes the book", () => {
        openBook();
        assert.strictEqual(game.state.heldBook, null);
        pressKey(game, "t");
        assert.notStrictEqual(game.state.heldBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("t does nothing if already holding this book", () => {
        const coords = { side: 0, position: 0n, floor: 10n, bookIndex: 0 };
        game.state.heldBook = { ...coords };
        game.state.openBook = { ...coords };
        game.state.openPage = 5;
        goTo(game, "Shelf Open Book");
        pressKey(game, "t");
        assert.strictEqual(game.state.screen, "Shelf Open Book");
    });

    it("p puts back a held book", () => {
        const coords = { side: 0, position: 0n, floor: 10n, bookIndex: 0 };
        game.state.heldBook = { ...coords };
        game.state.openBook = { ...coords };
        game.state.openPage = 5;
        goTo(game, "Shelf Open Book");
        pressKey(game, "p");
        assert.strictEqual(game.state.heldBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("p does nothing if not holding this book", () => {
        openBook();
        pressKey(game, "p");
        assert.strictEqual(game.state.screen, "Shelf Open Book");
    });

    it("q closes the book", () => {
        openBook();
        pressKey(game, "q");
        assert.strictEqual(game.state.openBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("H jumps to front cover", () => {
        openBook();
        assert.strictEqual(game.state.openPage, 5);
        pressKey(game, "H");
        assert.strictEqual(game.state.openPage, 0);
        assert.strictEqual(game.state.screen, "Shelf Open Book");
    });

    it("Escape closes the book", () => {
        openBook();
        pressKey(game, "Escape");
        assert.strictEqual(game.state.openBook, null);
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Menu
 * -------------------------------------------------------- */

describe("Keybindings: Menu", () => {
    beforeEach(() => resetGame(game));

    it("Escape returns to previous screen", () => {
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
    beforeEach(() => resetGame(game));

    it("e goes to sign intro", () => {
        goTo(game, "Life Story");
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Sign Intro");
    });

    it("E goes to sign intro", () => {
        goTo(game, "Life Story");
        pressKey(game, "E");
        assert.strictEqual(game.state.screen, "Sign Intro");
    });
});

describe("Keybindings: Sign Intro", () => {
    beforeEach(() => resetGame(game));

    it("e continues to corridor", () => {
        goTo(game, "Sign Intro");
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("E continues to corridor", () => {
        goTo(game, "Sign Intro");
        pressKey(game, "E");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Kiosk
 * -------------------------------------------------------- */

describe("Keybindings: Kiosk", () => {
    beforeEach(() => resetGame(game));

    function enterKiosk() {
        atRestArea(game);
        game.state.lightsOn = true;
        goTo(game, "Kiosk");
    }

    it("1 gets water", () => {
        enterKiosk();
        pressKey(game, "1");
        assert.strictEqual(game.state.screen, "Kiosk Get Drink");
    });

    it("2 gets food", () => {
        enterKiosk();
        pressKey(game, "2");
        assert.strictEqual(game.state.screen, "Kiosk Get Food");
    });

    it("3 gets alcohol", () => {
        enterKiosk();
        pressKey(game, "3");
        assert.strictEqual(game.state.screen, "Kiosk Get Alcohol");
    });

    it("q leaves kiosk", () => {
        enterKiosk();
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape leaves kiosk", () => {
        enterKiosk();
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Kiosk sub-screens (Get Drink / Get Food / Get Alcohol)
 * -------------------------------------------------------- */

describe("Keybindings: Kiosk sub-screens", () => {
    beforeEach(() => resetGame(game));

    for (const sub of ["Kiosk Get Drink", "Kiosk Get Food", "Kiosk Get Alcohol"]) {
        it("Enter returns to Kiosk from " + sub, () => {
            atRestArea(game);
            game.state.lightsOn = true;
            goTo(game, sub);
            pressKey(game, "Enter");
            assert.strictEqual(game.state.screen, "Kiosk");
        });

        it("Space returns to Kiosk from " + sub, () => {
            atRestArea(game);
            game.state.lightsOn = true;
            goTo(game, sub);
            pressKey(game, " ");
            assert.strictEqual(game.state.screen, "Kiosk");
        });

        it("e returns to Kiosk from " + sub, () => {
            atRestArea(game);
            game.state.lightsOn = true;
            goTo(game, sub);
            pressKey(game, "e");
            assert.strictEqual(game.state.screen, "Kiosk");
        });

        it("Escape opens Menu from " + sub, () => {
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
    beforeEach(() => resetGame(game));

    it("z sleeps", () => {
        atRestArea(game);
        goTo(game, "Bedroom");
        pressKey(game, "z");
        assert.strictEqual(game.state.screen, "Sleep");
    });

    it("q leaves bedroom", () => {
        atRestArea(game);
        goTo(game, "Bedroom");
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape leaves bedroom", () => {
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
    beforeEach(() => resetGame(game));

    it("Enter continues from sleep", () => {
        goTo(game, "Sleep");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Space continues from sleep", () => {
        goTo(game, "Sleep");
        pressKey(game, " ");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("e continues from sleep", () => {
        goTo(game, "Sleep");
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape opens Menu from sleep", () => {
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
    beforeEach(() => resetGame(game));

    it("s submits when holding a book", () => {
        atRestArea(game);
        game.state.heldBook = { side: 0, position: 0n, floor: 10n, bookIndex: 0 };
        goTo(game, "Submission Slot");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Submission Attempt");
    });

    it("s does nothing without a held book", () => {
        atRestArea(game);
        game.state.heldBook = null;
        goTo(game, "Submission Slot");
        pressKey(game, "s");
        assert.strictEqual(game.state.screen, "Submission Slot");
    });

    it("q leaves submission slot", () => {
        atRestArea(game);
        goTo(game, "Submission Slot");
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape leaves submission slot", () => {
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
    beforeEach(() => resetGame(game));

    it("Enter continues", () => {
        goTo(game, "Submission Attempt");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Space continues", () => {
        goTo(game, "Submission Attempt");
        pressKey(game, " ");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("e continues", () => {
        goTo(game, "Submission Attempt");
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

/* --------------------------------------------------------
 * Chasm
 * -------------------------------------------------------- */

describe("Keybindings: Chasm", () => {
    beforeEach(() => resetGame(game));

    it("n returns to corridor", () => {
        game.state.floor = 50n;
        goTo(game, "Chasm");
        pressKey(game, "n");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("N returns to corridor", () => {
        game.state.floor = 50n;
        goTo(game, "Chasm");
        pressKey(game, "N");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("q returns to corridor", () => {
        game.state.floor = 50n;
        goTo(game, "Chasm");
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Escape returns to corridor", () => {
        game.state.floor = 50n;
        goTo(game, "Chasm");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("y confirms jump", () => {
        game.state.floor = 50n;
        goTo(game, "Chasm");
        pressKey(game, "y");
        assert.strictEqual(game.state.screen, "Falling");
    });

    it("Y confirms jump", () => {
        game.state.floor = 50n;
        goTo(game, "Chasm");
        pressKey(game, "Y");
        assert.strictEqual(game.state.screen, "Falling");
    });
});

/* --------------------------------------------------------
 * Death
 * -------------------------------------------------------- */

describe("Keybindings: Death", () => {
    beforeEach(() => resetGame(game));

    function setupDeath() {
        game.state.dead = true;
        game.state.deathCause = "fell";
        goTo(game, "Death");
    }

    it("Enter continues from death", () => {
        setupDeath();
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Space continues from death", () => {
        setupDeath();
        pressKey(game, " ");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("e continues from death", () => {
        setupDeath();
        pressKey(game, "e");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("backtick toggles debug on death screen", () => {
        game.state._debugAllowed = true;
        setupDeath();
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
    beforeEach(() => resetGame(game));

    function setupFalling() {
        game.state.floor = 50n;
        goTo(game, "Chasm");
        pressKey(game, "y");
        assert.strictEqual(game.state.screen, "Falling");
    }

    it("Escape opens menu from falling", () => {
        setupFalling();
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Menu");
        assert.strictEqual(game.state._menuReturn, "Falling");
    });

    it("backtick toggles debug while falling", () => {
        game.state._debugAllowed = true;
        setupFalling();
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
    beforeEach(() => resetGame(game));

    it("Escape from Corridor sets _menuReturn to Corridor", () => {
        goTo(game, "Corridor");
        pressKey(game, "Escape");
        assert.strictEqual(game.state._menuReturn, "Corridor");
    });

    it("Escape from Life Story sets _menuReturn to Life Story", () => {
        goTo(game, "Life Story");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Menu");
        assert.strictEqual(game.state._menuReturn, "Life Story");
    });
});

/* --------------------------------------------------------
 * Talk screen keybindings
 * -------------------------------------------------------- */

function placeNpcHere(g, npcIndex) {
    const npc = g.state.npcs[npcIndex];
    npc.side = g.state.side;
    npc.position = g.state.position;
    npc.floor = g.state.floor;
    npc.alive = true;
    g.Social.syncNpcPositions();
    return npc;
}

function placeNpcWithBonds(g, npcIndex) {
    const npc = placeNpcHere(g, npcIndex);
    const world = g.Social.getWorld();
    const playerEnt = g.Social.getPlayerEntity();
    const npcEnt = g.Social.getNpcEntity(npc.id);
    const playerRels = getComponent(world, playerEnt, "relationships");
    const npcRels = getComponent(world, npcEnt, "relationships");
    playerRels.bonds.set(npcEnt, {
        familiarity: 25, affinity: 20,
        firstContact: 0, lastContact: 100, encounters: 5,
    });
    npcRels.bonds.set(playerEnt, {
        familiarity: 25, affinity: 20,
        firstContact: 0, lastContact: 100, encounters: 5,
    });
    return npc;
}

function openTalkWith(g, npc) {
    g.state._talkTarget = npc;
    g.Engine.goto("Talk");
    assert.strictEqual(g.state.screen, "Talk");
}

describe("Keybindings: Talk screen", () => {
    beforeEach(() => resetGame(game));

    it("1 triggers kind approach", () => {
        const npc = placeNpcHere(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "1");
        assert.strictEqual(game.state.screen, "Talk Result");
    });

    it("2 triggers neutral approach", () => {
        const npc = placeNpcHere(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "2");
        assert.strictEqual(game.state.screen, "Talk Result");
    });

    it("3 triggers dismissive approach", () => {
        const npc = placeNpcHere(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "3");
        assert.strictEqual(game.state.screen, "Talk Result");
    });

    it("w triggers spend time when available", () => {
        const npc = placeNpcWithBonds(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "w");
        assert.strictEqual(game.state.screen, "Spend Time Result");
    });

    it("i triggers recruit when available", () => {
        const npc = placeNpcWithBonds(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "i");
        assert.strictEqual(game.state.screen, "Recruit Result");
    });

    it("q returns to Corridor from Talk", () => {
        const npc = placeNpcHere(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "q");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Enter continues from Talk Result back to Talk", () => {
        const npc = placeNpcHere(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "1");
        assert.strictEqual(game.state.screen, "Talk Result");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Talk");
    });

    it("Escape from Talk Result returns to Corridor", () => {
        const npc = placeNpcHere(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "1");
        assert.strictEqual(game.state.screen, "Talk Result");
        pressKey(game, "Escape");
        assert.strictEqual(game.state.screen, "Corridor");
    });

    it("Enter continues from Spend Time Result back to Talk", () => {
        const npc = placeNpcWithBonds(game, 0);
        openTalkWith(game, npc);
        pressKey(game, "w");
        assert.strictEqual(game.state.screen, "Spend Time Result");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Talk");
    });

    it("can talk multiple times: Talk → 1 → Enter → 1 → Enter", () => {
        const npc = placeNpcHere(game, 0);
        openTalkWith(game, npc);

        // First conversation
        pressKey(game, "1");
        assert.strictEqual(game.state.screen, "Talk Result", "first talk result");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Talk", "back to talk");

        // Second conversation (NPC stays pinned from first talk)
        pressKey(game, "2");
        assert.strictEqual(game.state.screen, "Talk Result", "second talk result");
        pressKey(game, "Enter");
        assert.strictEqual(game.state.screen, "Talk", "back to talk again");

        // Third — dismissive
        pressKey(game, "3");
        assert.strictEqual(game.state.screen, "Talk Result", "third talk result");
    });
});
