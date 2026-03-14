import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootGame, resetGame } from "./dom-harness.js";

const game = bootGame();

describe("Menu screen", () => {
    beforeEach(() => resetGame(game));

    it("opens from Corridor and shows resume/save/new-game links", () => {
        game.Engine.goto("Menu");
        assert.equal(game.state.screen, "Menu");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("Resume"), "should show Resume link");
        assert.ok(html.includes("menu-save"), "should show Save link");
        assert.ok(html.includes("menu-new-game"), "should show New Game link");
        assert.ok(!html.includes("menu-confirm-new"), "should NOT show confirm yet");
    });

    it("Resume returns to previous screen", () => {
        assert.equal(game.state.screen, "Corridor");
        game.Engine.goto("Menu");
        assert.equal(game.state._menuReturn, "Corridor");

        const resumeLink = game.document.querySelector('[data-goto="Corridor"]');
        assert.ok(resumeLink, "Resume link should exist");
        resumeLink.click();
        assert.equal(game.state.screen, "Corridor");
    });

    it("New Game click shows confirmation prompt (regression: #82)", () => {
        game.Engine.goto("Menu");

        const newGameLink = game.document.getElementById("menu-new-game");
        assert.ok(newGameLink, "New Game link should exist");
        newGameLink.click();

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("Start a new game"), "should show confirmation text");
        assert.ok(html.includes("menu-confirm-new"), "should show Yes, start over link");
        assert.ok(!html.includes("menu-new-game"), "should NOT show New Game link anymore");
    });

    it("Cancel from confirmation returns to normal menu", () => {
        game.Engine.goto("Menu");

        game.document.getElementById("menu-new-game").click();
        assert.ok(game.state._menuConfirmNew, "confirm flag should be true");

        const cancelLink = game.document.querySelector('[data-goto="Menu"]');
        assert.ok(cancelLink, "Cancel link should exist");
        cancelLink.click();

        const html = game.document.getElementById("passage").innerHTML;
        assert.equal(game.state.screen, "Menu");
    });

    it("Save shows confirmation message", () => {
        game.Engine.goto("Menu");

        const saveLink = game.document.getElementById("menu-save");
        assert.ok(saveLink, "Save link should exist");
        saveLink.click();

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("Saved"), "should show save confirmation");
        assert.ok(html.includes("Day " + game.state.day), "should show current day");
    });

    it("_menuReturn tracks which screen opened the menu", () => {
        game.Engine.goto("Kiosk");
        game.state._menuReturn = game.state.screen;
        game.Engine.goto("Menu");
        assert.equal(game.state._menuReturn, "Kiosk");

        game.Engine.goto("Menu");
        assert.equal(game.state._menuReturn, "Kiosk");
    });

    it("does not save when entering Menu screen", () => {
        game.window.localStorage.clear();

        game.Engine.goto("Menu");

        const slotsRaw = game.window.localStorage.getItem("hell_slots");
        assert.equal(slotsRaw, null, "Menu should not trigger auto-save");
    });
});
