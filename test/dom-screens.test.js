/**
 * Screen render coverage — every registered screen renders without errors
 * and produces non-empty HTML in #passage.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";

const G = GALLERIES_PER_SEGMENT;

function getHTML(game) {
    return game.document.getElementById("passage").innerHTML;
}

// --- Screens that work with default bootGame state (at rest area, floor 10) ---

describe("screen render coverage: basic screens", () => {
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
            const game = bootGame();
            game.Engine.goto(screen);
            const html = getHTML(game);
            assert.ok(html.length > 0, `${screen} produced empty HTML`);
        });
    }
});

// --- Corridor at non-rest-area (shelf grid) ---

describe("screen render coverage: corridor variants", () => {
    it("Corridor at non-rest-area renders shelf grid", () => {
        const game = bootGame();
        game.state.position = 3n; // not a rest area
        game.Engine.goto("Corridor");
        const html = getHTML(game);
        assert.ok(html.includes("corridor-grid"), "should have shelf grid");
    });

    it("Corridor at rest area shows kiosk hint", () => {
        const game = bootGame();
        // bootGame starts at position 0 (rest area) with _spawnPosition = 0
        game.Engine.goto("Corridor");
        const html = getHTML(game);
        assert.ok(html.includes("kiosk-hint"), "should have kiosk-hint");
        assert.ok(html.includes("where you began"), "should mention spawn");
    });

    it("Corridor at different rest area shows kiosk count", () => {
        const game = bootGame();
        game.state.position = G; // 1 kiosk away
        game.Engine.goto("Corridor");
        const html = getHTML(game);
        assert.ok(html.includes("1st kiosk"), "should show 1st kiosk");
    });

    it("Corridor at spawn kiosk shows 'where you began'", () => {
        const game = bootGame();
        // position 0, floor 10, same as spawn
        game.Engine.goto("Corridor");
        const html = getHTML(game);
        assert.ok(html.includes("This is where you began."), "exact spawn should say 'This is where you began.'");
    });

    it("Corridor same kiosk different floor shows floor offset", () => {
        const game = bootGame();
        game.state.floor = 5n; // spawn was floor 10
        game.Engine.goto("Corridor");
        const html = getHTML(game);
        assert.ok(html.includes("kiosk-hint"), "should have kiosk hint");
        assert.ok(html.includes("5 floors below where you began"), "should show floor difference");
        assert.ok(!html.includes("0th"), "should not say 0th kiosk");
    });

    it("Corridor on other side hides kiosk hint", () => {
        const game = bootGame();
        game.state.side = 1; // spawn was side 0
        game.Engine.goto("Corridor");
        const html = getHTML(game);
        assert.ok(!html.includes("kiosk-hint"), "should not show kiosk hint on other side");
    });

    it("Corridor dark renders when lights off", () => {
        const game = bootGame();
        game.state.lightsOn = false;
        game.Engine.goto("Corridor");
        const html = getHTML(game);
        assert.ok(html.length > 0, "dark corridor should render");
    });
});

// --- Screens that need special state ---

describe("screen render coverage: stateful screens", () => {
    it("Shelf Open Book renders with a book open", () => {
        const game = bootGame();
        game.state.openBook = {
            side: 0, position: 0n, floor: 10n, bookIndex: 0,
        };
        game.state.openPage = 1;
        game.Engine.goto("Shelf Open Book");
        const html = getHTML(game);
        assert.ok(html.length > 0, "book view should render");
    });

    it("Read Held Book transitions to Shelf Open Book", () => {
        const game = bootGame();
        game.state.heldBook = {
            side: 0, position: 0n, floor: 10n, bookIndex: 0,
        };
        game.Engine.goto("Read Held Book");
        // Transition screen — sets up openBook and redirects
        assert.ok(game.state.openBook, "should set openBook");
        assert.strictEqual(game.state.openPage, 1, "should set page to 1");
    });

    it("Chasm renders", () => {
        const game = bootGame();
        // floor > 0 already (floor 10)
        game.Engine.goto("Chasm");
        const html = getHTML(game);
        assert.ok(html.length > 0, "chasm should render");
    });

    it("Death renders with death cause", () => {
        const game = bootGame();
        game.state.dead = true;
        game.state.deathCause = "thirst";
        game.state.deaths = 1;
        game.Engine.goto("Death");
        const html = getHTML(game);
        assert.ok(html.length > 0, "death screen should render");
    });

    it("Submission Attempt renders", () => {
        const game = bootGame();
        game.state.heldBook = {
            side: 0, position: 0n, floor: 10n, bookIndex: 0,
        };
        game.Engine.goto("Submission Attempt");
        const html = getHTML(game);
        assert.ok(html.length > 0, "submission attempt should render");
    });

    it("Win renders", () => {
        const game = bootGame();
        game.state.won = true;
        game.Engine.goto("Win");
        const html = getHTML(game);
        assert.ok(html.length > 0, "win screen should render");
    });

    it("Talk renders with a talk target", () => {
        const game = bootGame();
        // Need an NPC to talk to
        const npcs = game.Npc.here();
        if (npcs.length > 0) {
            game.state._talkTarget = npcs[0];
            game.Engine.goto("Talk");
            const html = getHTML(game);
            assert.ok(html.length > 0, "talk screen should render");
        } else {
            // No NPCs nearby — create a fake target
            game.state._talkTarget = {
                id: 1, name: "TestNPC", alive: true,
                disposition: "neutral", side: 0, position: 0n, floor: 10n,
            };
            game.Engine.goto("Talk");
            const html = getHTML(game);
            assert.ok(html.length > 0, "talk screen should render");
        }
    });

    it("Falling sets screen state", () => {
        const game = bootGame();
        game.Engine.goto("Falling");
        // Falling is an animation screen — may produce empty HTML initially
        assert.strictEqual(game.state.screen, "Falling");
    });
});

// --- Mercy / Life Story screen shows book distance ---

describe("screen render coverage: mercy hint", () => {
    it("Life Story shows kiosk-based book distance", () => {
        const game = bootGame();
        game.Engine.goto("Life Story");
        const html = getHTML(game);
        assert.ok(html.includes("mercy-hint"), "should have mercy hint");
        assert.ok(html.includes("kiosk"), "mercy hint should mention kiosks");
    });
});
