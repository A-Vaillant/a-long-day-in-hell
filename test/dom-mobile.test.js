import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

/**
 * Collect all tappable action links within a rendered screen.
 * Returns elements matching [data-goto] or [data-action].
 */
function getTapTargets(document) {
    return Array.from(document.querySelectorAll("[data-goto], [data-action]"));
}

describe("Mobile tap targets", () => {
    it("corridor at rest area has tappable links for all facilities", () => {
        const game = bootGame();
        game.state.position = 0; // rest area
        game.Engine.goto("Corridor");

        const targets = getTapTargets(game.document);
        const labels = targets.map(el => el.textContent.trim());

        assert.ok(targets.length >= 4, `expected ≥4 tap targets at rest area, got ${targets.length}`);
        // All targets must have data-goto so CSS [data-goto] selector applies
        for (const el of targets) {
            assert.ok(el.hasAttribute("data-goto"),
                `tap target "${el.textContent.trim()}" missing data-goto attribute`);
        }
    });

    it("corridor at gallery has movement links with data-goto", () => {
        const game = bootGame();
        game.state.position = 1; // gallery
        game.Engine.goto("Corridor");

        const targets = getTapTargets(game.document);
        assert.ok(targets.length >= 2, `expected ≥2 tap targets at gallery, got ${targets.length}`);

        // Movement links should have data-action="move-*"
        const moveTargets = targets.filter(el => {
            const action = el.getAttribute("data-action");
            return action && action.startsWith("move-");
        });
        assert.ok(moveTargets.length >= 1, "should have at least one movement link");
    });

    it("kiosk screen has tappable facility links", () => {
        const game = bootGame();
        game.state.position = 0;
        game.Engine.goto("Kiosk");

        const targets = getTapTargets(game.document);
        assert.ok(targets.length >= 2, `expected ≥2 tap targets at kiosk, got ${targets.length}`);

        const gotos = targets.map(el => el.getAttribute("data-goto"));
        assert.ok(gotos.includes("Kiosk Get Drink") || gotos.includes("Kiosk Get Food"),
            "kiosk should have food/drink links");
    });

    it("bedroom screen has tappable links", () => {
        const game = bootGame();
        game.state.position = 0;
        game.Engine.goto("Bedroom");

        const targets = getTapTargets(game.document);
        assert.ok(targets.length >= 1, `expected ≥1 tap target in bedroom, got ${targets.length}`);

        const gotos = targets.map(el => el.getAttribute("data-goto"));
        assert.ok(gotos.includes("Corridor"), "bedroom should have a back/leave link");
    });

    it("book view has navigation and action links", () => {
        const game = bootGame();
        // Open a book
        game.state.position = 1;
        game.state.openBook = { side: 0, position: 1, floor: 10, bookIndex: 0 };
        game.state.openPage = 2; // middle page so both prev/next show
        game.Engine.goto("Shelf Open Book");

        const targets = getTapTargets(game.document);
        assert.ok(targets.length >= 2, `expected ≥2 tap targets in book view, got ${targets.length}`);

        const actions = targets.map(el => el.getAttribute("data-action")).filter(Boolean);
        // Should have page navigation
        assert.ok(
            actions.includes("page-prev") || actions.includes("page-next"),
            "book view should have page navigation links"
        );
    });

    it("all tap targets across screens have consistent data-goto attributes", () => {
        const game = bootGame();
        const screens = ["Corridor", "Kiosk", "Bedroom", "Sign"];

        for (const screen of screens) {
            game.state.position = 0;
            game.Engine.goto(screen);

            const targets = getTapTargets(game.document);
            for (const el of targets) {
                const goto = el.getAttribute("data-goto");
                assert.ok(goto && goto.length > 0,
                    `empty data-goto on "${el.textContent.trim()}" in ${screen} screen`);
            }
        }
    });

    it("dark corridor still shows bedroom link", () => {
        const game = bootGame();
        game.state.position = 0; // rest area
        game.state.lightsOn = false;
        game.Engine.goto("Corridor");

        const targets = getTapTargets(game.document);
        const gotos = targets.map(el => el.getAttribute("data-goto"));
        assert.ok(gotos.includes("Bedroom"),
            "bedroom link should be available when lights are off");
    });

    it("rest area has enough distinct actions for mobile navigation", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.lightsOn = true;
        game.Engine.goto("Corridor");

        const targets = getTapTargets(game.document);
        const distinctGotos = new Set(targets.map(el => el.getAttribute("data-goto")));

        // Rest area should offer: movement, wait, kiosk, bedroom, submission, sign (at minimum)
        assert.ok(distinctGotos.size >= 5,
            `expected ≥5 distinct destinations at rest area, got ${distinctGotos.size}: ${[...distinctGotos].join(", ")}`);
    });
});
