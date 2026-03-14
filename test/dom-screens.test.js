/**
 * Screen render coverage — every registered screen renders without errors
 * and produces non-empty HTML in #passage.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootGame, resetGame } from "./dom-harness.js";
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";

import { RESET_HOUR_TICK } from "../lib/tick.core.ts";

const G = GALLERIES_PER_SEGMENT;

const game = bootGame();

function getHTML() {
    return game.document.getElementById("passage").innerHTML;
}

// --- Screens that work with default bootGame state (at rest area, floor 10) ---

describe("screen render coverage: basic screens", () => {
    beforeEach(() => resetGame(game));

    // Transition screens (Wait, Sleep, Read Held Book, Falling) redirect via
    // setTimeout and return empty — they're tested by asserting the redirect target.
    for (const screen of [
        "Corridor",
        "Kiosk",
        "Kiosk Get Drink",
        "Kiosk Get Food",
        "Kiosk Get Alcohol",
        "Sign",
        "Bedroom",
        "Submission Slot",
        "Menu",
        "Memory",
        "Life Story",
        "Sign Intro",
    ]) {
        it(`"${screen}" renders non-empty HTML`, () => {
            game.Engine.goto(screen);
            const html = getHTML();
            assert.ok(html.length > 0, `${screen} produced empty HTML`);
        });
    }
});

// --- Corridor at non-rest-area (shelf grid) ---

describe("screen render coverage: corridor variants", () => {
    beforeEach(() => resetGame(game));

    it("Corridor at non-rest-area renders shelf grid", () => {
        game.state.position = 3n; // not a rest area
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(html.includes("corridor-grid"), "should have shelf grid");
    });

    it("Corridor at rest area shows kiosk hint", () => {
        // resetGame starts at position 0 (rest area) with _spawnPosition = 0
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(html.includes("kiosk-hint"), "should have kiosk-hint");
        assert.ok(html.includes("where you began"), "should mention spawn");
    });

    it("Corridor at different rest area shows kiosk count", () => {
        game.state.position = G; // 1 kiosk away
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(html.includes("1st kiosk"), "should show 1st kiosk");
    });

    it("Corridor at spawn kiosk shows 'where you began'", () => {
        // position 0, floor 10, same as spawn
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(html.includes("This is where you began."), "exact spawn should say 'This is where you began.'");
    });

    it("Corridor same kiosk different floor shows floor offset", () => {
        game.state.floor = 5n; // spawn was floor 10
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(html.includes("kiosk-hint"), "should have kiosk hint");
        assert.ok(html.includes("5 floors below where you began"), "should show floor difference");
        assert.ok(!html.includes("0th"), "should not say 0th kiosk");
    });

    it("Corridor on other side hides kiosk hint", () => {
        game.state.side = 1; // spawn was side 0
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(!html.includes("kiosk-hint"), "should not show kiosk hint on other side");
    });

    it("Corridor dark renders when lights off", () => {
        game.state.lightsOn = false;
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(html.length > 0, "dark corridor should render");
    });
});

// --- Screens that need special state ---

describe("screen render coverage: stateful screens", () => {
    beforeEach(() => resetGame(game));

    it("Shelf Open Book renders with a book open", () => {
        game.state.openBook = {
            side: 0, position: 0n, floor: 10n, bookIndex: 0,
        };
        game.state.openPage = 1;
        game.Engine.goto("Shelf Open Book");
        const html = getHTML();
        assert.ok(html.length > 0, "book view should render");
    });

    it("Read Held Book transitions to Shelf Open Book", () => {
        game.state.heldBook = {
            side: 0, position: 0n, floor: 10n, bookIndex: 0,
        };
        game.Engine.goto("Read Held Book");
        // Transition screen — sets up openBook and redirects
        assert.ok(game.state.openBook, "should set openBook");
        assert.strictEqual(game.state.openPage, 1, "should set page to 1");
    });

    it("Chasm renders", () => {
        // floor > 0 already (floor 10)
        game.Engine.goto("Chasm");
        const html = getHTML();
        assert.ok(html.length > 0, "chasm should render");
    });

    it("Death renders with death cause", () => {
        game.state.dead = true;
        game.state.deathCause = "thirst";
        game.state.deaths = 1;
        game.Engine.goto("Death");
        const html = getHTML();
        assert.ok(html.length > 0, "death screen should render");
    });

    it("Submission Attempt renders", () => {
        game.state.heldBook = {
            side: 0, position: 0n, floor: 10n, bookIndex: 0,
        };
        game.Engine.goto("Submission Attempt");
        const html = getHTML();
        assert.ok(html.length > 0, "submission attempt should render");
    });

    it("Win renders", () => {
        game.state.won = true;
        game.Engine.goto("Win");
        const html = getHTML();
        assert.ok(html.length > 0, "win screen should render");
    });

    it("Talk renders with a talk target", () => {
        // Need an NPC to talk to
        const npcs = game.Npc.here();
        if (npcs.length > 0) {
            game.state._talkTarget = npcs[0];
            game.Engine.goto("Talk");
            const html = getHTML();
            assert.ok(html.length > 0, "talk screen should render");
        } else {
            // No NPCs nearby — create a fake target
            game.state._talkTarget = {
                id: 1, name: "TestNPC", alive: true,
                disposition: "neutral", side: 0, position: 0n, floor: 10n,
            };
            game.Engine.goto("Talk");
            const html = getHTML();
            assert.ok(html.length > 0, "talk screen should render");
        }
    });

    it("Falling sets screen state", () => {
        game.Engine.goto("Falling");
        // Falling is an animation screen — may produce empty HTML initially
        assert.strictEqual(game.state.screen, "Falling");
    });
});

// --- Mercy / Life Story screen shows book distance ---

describe("screen render coverage: mercy hint", () => {
    beforeEach(() => resetGame(game));

    it("Life Story shows kiosk-based book distance", () => {
        game.Engine.goto("Life Story");
        const html = getHTML();
        assert.ok(html.includes("divine"), "should have divine class on mercy text");
        assert.ok(html.includes("kiosk"), "mercy hint should mention kiosks");
    });
});

// --- Morale desaturation ---

describe("morale desaturation", () => {
    beforeEach(() => resetGame(game));

    // jsdom converts hsl() to rgb(), so we measure saturation via channel spread
    function rgbSpread(style) {
        const m = style.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (!m) return null;
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        return Math.max(r, g, b) - Math.min(r, g, b);
    }

    it("book spines at full morale have color (nonzero rgb spread)", () => {
        game.state.position = 1n;
        game.state.morale = 100;
        game.Engine.goto("Corridor");
        const spine = game.document.querySelector(".book-spine:not(.book-gap)");
        assert.ok(spine, "spine exists");
        const spread = rgbSpread(spine.style.background);
        assert.ok(spread !== null, "spine has rgb background: " + spine.style.background);
        assert.ok(spread > 0, "should have color at full morale, spread=" + spread);
    });

    it("book spines at zero morale are grey (zero rgb spread)", () => {
        game.state.position = 1n;
        game.state.morale = 0;
        game.state.despairing = true;
        game.Engine.goto("Corridor");
        const spines = game.document.querySelectorAll(".book-spine:not(.book-gap)");
        assert.ok(spines.length > 0, "spines exist");
        for (const spine of spines) {
            const spread = rgbSpread(spine.style.background);
            assert.strictEqual(spread, 0,
                "should be grey at zero morale: " + spine.style.background);
        }
    });

    it("desaturation doesn't start until morale drops below 70", () => {
        game.state.position = 1n;
        game.state.morale = 70;
        game.Engine.goto("Corridor");
        const spread70 = rgbSpread(game.document.querySelector(".book-spine:not(.book-gap)").style.background);

        // Reset and render at morale 100 for comparison
        resetGame(game);
        game.state.position = 1n;
        game.state.morale = 100;
        game.Engine.goto("Corridor");
        const spread100 = rgbSpread(game.document.querySelector(".book-spine:not(.book-gap)").style.background);

        assert.strictEqual(spread70, spread100,
            "morale 70 and 100 should have identical saturation");
    });

    it("morale below 70 reduces saturation vs full morale", () => {
        game.state.position = 1n;
        game.state.morale = 35;
        game.Engine.goto("Corridor");
        const spread35 = rgbSpread(game.document.querySelector(".book-spine:not(.book-gap)").style.background);

        // Reset and render at morale 100 for comparison
        resetGame(game);
        game.state.position = 1n;
        game.state.morale = 100;
        game.Engine.goto("Corridor");
        const spread100 = rgbSpread(game.document.querySelector(".book-spine:not(.book-gap)").style.background);

        assert.ok(spread35 < spread100,
            `morale 35 spread ${spread35} should be less than full ${spread100}`);
    });

    it("book cover desaturates with morale", () => {
        game.state.position = 1n;
        game.state.openBook = { side: 0, position: 1n, floor: 10n, bookIndex: 3 };
        game.state.openPage = 0;

        game.state.morale = 100;
        game.Engine.goto("Shelf Open Book");
        const s100 = game.document.getElementById("book-single").style.getPropertyValue("--cover-s");

        game.state.morale = 0;
        game.Engine.goto("Shelf Open Book");
        const s0 = game.document.getElementById("book-single").style.getPropertyValue("--cover-s");

        assert.strictEqual(s0, "0%", "cover should be fully desaturated at morale 0");
        assert.ok(parseInt(s100) > 0, "cover should have saturation at morale 100");
    });
});

// --- Pass-out screen at reset hour ---

describe("pass-out at reset hour", () => {
    beforeEach(() => resetGame(game));

    it("moving at tick just before reset hour triggers pass-out screen", () => {
        game.state.tick = RESET_HOUR_TICK - 1;
        game.state.position = 1n;
        game.state.screen = "Corridor";
        const result = game.window.Actions.resolve({ type: "move", dir: "right" });
        assert.strictEqual(result.screen, "Passing Out",
            "should redirect to Passing Out screen");
    });

    it("waiting at tick just before reset hour triggers pass-out", () => {
        game.state.tick = RESET_HOUR_TICK - 1;
        game.state.screen = "Corridor";
        const result = game.window.Actions.resolve({ type: "wait" });
        assert.strictEqual(result.screen, "Passing Out",
            "wait should trigger pass-out at reset hour");
    });

    it("eating at kiosk at tick just before reset hour triggers pass-out", () => {
        game.state.tick = RESET_HOUR_TICK - 1;
        game.state.position = 0n; // rest area
        game.state.lightsOn = true;
        const result = game.window.Actions.resolve({ type: "eat" });
        assert.strictEqual(result.screen, "Passing Out",
            "eating should trigger pass-out at reset hour");
    });

    it("talking to NPC at tick just before reset hour triggers pass-out", () => {
        game.state.tick = RESET_HOUR_TICK - 1;
        // Need an NPC nearby to talk to
        if (game.state.npcs && game.state.npcs.length > 0) {
            const npc = game.state.npcs[0];
            npc.side = game.state.side;
            npc.position = game.state.position;
            npc.floor = game.state.floor;
            game.Social.syncNpcPositions();
            const result = game.window.Actions.resolve({ type: "talk", npcId: npc.id, approach: "neutral" });
            if (result.resolved) {
                assert.strictEqual(result.screen, "Passing Out",
                    "talking should trigger pass-out at reset hour");
            }
        }
    });

    it("after pass-out, time has advanced to dawn", () => {
        game.state.tick = RESET_HOUR_TICK - 1;
        game.state.position = 1n;
        game.state.screen = "Corridor";
        game.window.Actions.resolve({ type: "move", dir: "right" });
        // onForcedSleep advances to dawn — lights should be on, tick < reset hour
        assert.ok(game.state.lightsOn, "should be daytime after pass-out");
        assert.ok(game.state.tick < RESET_HOUR_TICK,
            "tick should be before reset hour (new day)");
    });

    it("moving well before reset hour does NOT trigger pass-out", () => {
        game.state.tick = 500; // midday
        game.state.position = 1n;
        const result = game.window.Actions.resolve({ type: "move", dir: "right" });
        assert.notStrictEqual(result.screen, "Passing Out",
            "should not pass out during the day");
    });

    it("doMove returns false on pass-out (prevents Corridor goto)", () => {
        game.state.tick = RESET_HOUR_TICK - 1;
        game.state.position = 1n;
        game.state.screen = "Corridor";
        const moved = game.window.doMove("right");
        assert.strictEqual(moved, false,
            "doMove should return false when redirecting to pass-out");
        assert.strictEqual(game.state.screen, "Passing Out",
            "screen should be Passing Out, not Corridor");
    });
});

// --- Sleep morale ---

describe("sleep morale recovery", () => {
    beforeEach(() => resetGame(game));

    it("sleeping on corridor floor does not restore morale", () => {
        game.state.morale = 50;
        game.state.exhaustion = 100;
        game.state.tick = 500;
        game.state._lastScreen = "Corridor";
        game.Tick.onSleep();
        assert.strictEqual(game.state.morale, 50,
            "corridor floor sleep should not change morale");
    });

    it("sleeping in bedroom restores a small amount of morale", () => {
        game.state.morale = 50;
        game.state.exhaustion = 100;
        game.state.tick = 500;
        game.state._lastScreen = "Bedroom";
        game.Tick.onSleep();
        assert.ok(game.state.morale > 50,
            "bedroom sleep should restore some morale");
        // +1 per hour of sleep — modest, not a full reset
        assert.ok(game.state.morale < 80,
            "bedroom morale boost should be modest (got " + game.state.morale + ")");
    });

    it("forced sleep (pass-out) does not restore morale", () => {
        game.state.morale = 50;
        game.state.tick = RESET_HOUR_TICK - 1;
        game.state.position = 1n;
        game.window.Actions.resolve({ type: "move", dir: "right" });
        // Move itself costs a tiny morale tick; pass-out should not add any back
        assert.ok(game.state.morale <= 50,
            "pass-out should not restore morale (got " + game.state.morale + ")");
    });
});

// --- Dark corridor despairing ---

describe("dark corridor despairing", () => {
    beforeEach(() => resetGame(game));

    it("dark corridor shows ellipsis when despairing", () => {
        game.state.position = 1n;
        game.state.lightsOn = false;
        game.state.despairing = true;
        game.state.morale = 0;
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(html.includes("corridor-despair"),
            "dark despairing corridor should have despair class");
        assert.ok(html.includes("..."),
            "dark despairing corridor should show ellipsis");
    });

    it("dark corridor shows prose when not despairing", () => {
        game.state.position = 1n;
        game.state.lightsOn = false;
        game.state.despairing = false;
        game.Engine.goto("Corridor");
        const html = getHTML();
        assert.ok(!html.includes("corridor-despair"),
            "dark non-despairing corridor should not have despair class");
    });
});
