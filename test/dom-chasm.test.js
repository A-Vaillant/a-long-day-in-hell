import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

function pressKey(game, key) {
    const ev = new game.window.KeyboardEvent("keydown", { key, bubbles: true });
    game.document.dispatchEvent(ev);
}

function clickElement(game, id) {
    const el = game.document.getElementById(id);
    assert.ok(el, "element #" + id + " exists");
    el.click();
}

function getPassageText(game) {
    return game.document.getElementById("passage").textContent;
}

describe("DOM: chasm and freefall", () => {
    it("J key does nothing when not at rest area", () => {
        const game = bootGame();
        game.state.position = 1; // not a rest area (rest areas at multiples of 10)
        game.state.floor = 100;
        game.Engine.goto("Corridor");

        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Corridor", "still on corridor");
    });

    it("J key opens chasm screen at rest area above floor 0", () => {
        const game = bootGame();
        game.state.position = 0; // rest area
        game.state.floor = 100;
        game.Engine.goto("Corridor");

        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Chasm Stub", "navigated to chasm screen");
    });

    it("J key does nothing at floor 0", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 0;
        game.Engine.goto("Corridor");

        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Corridor", "can't jump at floor 0");
    });

    it("chasm screen shows confirmation and back link", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100;
        game.Engine.goto("Chasm Stub");

        const text = getPassageText(game);
        assert.ok(text.includes("chasm"), "mentions chasm");
        assert.ok(game.document.getElementById("chasm-jump-yes"), "has jump-yes button");
    });

    it("confirming jump enters freefall", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100;
        game.Engine.goto("Chasm Stub");

        clickElement(game, "chasm-jump-yes");

        assert.strictEqual(game.state.screen, "Falling", "on falling screen");
        assert.ok(game.state.falling !== null, "falling state is set");
        assert.strictEqual(game.state.falling.speed, 0, "initial speed is 0");
    });

    it("Y key confirms jump on chasm screen", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100;
        game.Engine.goto("Chasm Stub");

        pressKey(game, "y");

        assert.strictEqual(game.state.screen, "Falling", "on falling screen after Y");
        assert.ok(game.state.falling !== null, "falling state set");
    });

    it("N key returns to corridor from chasm screen", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100;
        game.Engine.goto("Chasm Stub");

        pressKey(game, "n");
        assert.strictEqual(game.state.screen, "Corridor", "back to corridor");
    });

    it("falling screen shows speed and grab chance", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 1000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        const text = getPassageText(game);
        assert.ok(text.includes("Speed"), "shows speed");
        assert.ok(text.includes("Grab"), "shows grab chance");
        assert.ok(text.includes("Floor"), "shows floor");
    });

    it("wait action advances fall", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 1000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        const floorBefore = game.state.floor;
        clickElement(game, "fall-wait");

        assert.ok(game.state.floor < floorBefore, "floor decreased after wait");
        assert.ok(game.state.falling.speed > 0, "speed increased");
    });

    it("multiple waits accumulate speed", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 10000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 5; i++) {
            clickElement(game, "fall-wait");
        }

        assert.strictEqual(game.state.falling.speed, 5, "speed is 5 after 5 ticks (gravity=1/tick)");
        // Fell 1+2+3+4+5 = 15 floors
        assert.strictEqual(game.state.floor, 10000 - 15, "fell correct number of floors");
    });

    it("throw book clears held book", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 1000;
        game.state.heldBook = { side: 0, position: 0, floor: 1000, bookIndex: 5 };
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        assert.ok(game.document.getElementById("fall-throw"), "throw button visible when holding book");
        clickElement(game, "fall-throw");

        assert.strictEqual(game.state.heldBook, null, "book is gone");
    });

    it("no throw button when not holding a book", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 1000;
        game.state.heldBook = null;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        assert.strictEqual(game.document.getElementById("fall-throw"), null, "no throw button");
    });

    it("despairing skips confirmation — jumps immediately", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 500;
        game.state.morale = 0;
        game.state.despairing = true;
        game.Engine.goto("Chasm Stub");

        // Despairing triggers immediate jump via setTimeout(0)
        // In jsdom, we need to flush the microtask queue
        // The afterRender calls setTimeout — run it
        const timers = game.window.setTimeout;
        // Just check state was set — the setTimeout will set falling and goto Falling
        // In jsdom synchronous mode, setTimeout(fn, 0) doesn't auto-fire
        // But Chasm.jump should have been called in afterRender before the setTimeout
        assert.ok(game.state.falling !== null, "falling state set immediately when despairing");
    });

    it("landing at floor 0 from low height goes to corridor", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 3; // low enough that landing is not fatal
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Fall until landed
        let safety = 0;
        while (game.state.falling && safety < 20) {
            clickElement(game, "fall-wait");
            safety++;
        }

        assert.strictEqual(game.state.floor, 0, "at floor 0");
        assert.strictEqual(game.state.falling, null, "no longer falling");
        assert.strictEqual(game.state.dead, false, "survived the fall");
        assert.strictEqual(game.state.screen, "Corridor", "back on corridor");
    });

    it("fatal landing at floor 0 from high speed goes to death screen", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 200; // high enough for fatal speed
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Fall until landed or dead
        let safety = 0;
        while (game.state.screen === "Falling" && safety < 100) {
            clickElement(game, "fall-wait");
            safety++;
        }

        assert.strictEqual(game.state.dead, true, "player is dead");
        assert.strictEqual(game.state.screen, "Death", "on death screen");
    });

    it("jump link hidden in corridor when not at rest area", () => {
        const game = bootGame();
        game.state.position = 1; // not rest area
        game.state.floor = 100;
        game.Engine.goto("Corridor");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(!html.includes("Chasm Stub"), "no jump link at non-rest-area");
    });

    it("jump link hidden at floor 0", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 0;
        game.Engine.goto("Corridor");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(!html.includes("Chasm Stub"), "no jump link at floor 0");
    });

    it("jump link visible at rest area above floor 0", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100;
        game.Engine.goto("Corridor");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("Chasm Stub"), "jump link present");
    });

    it("tick advances during freefall (time passes)", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 10000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        const tickBefore = game.state.tick;
        for (let i = 0; i < 5; i++) {
            clickElement(game, "fall-wait");
        }

        assert.ok(game.state.tick > tickBefore, "tick advanced during fall");
    });
});
