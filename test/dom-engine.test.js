import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

describe("DOM: Engine boundary registry", () => {
    it("dawn handler resurrects dead player", () => {
        const game = bootGame();
        game.Surv.kill("test");
        assert.ok(game.state.dead);

        // Advance to dawn — should trigger resurrection
        game.Tick.advanceToDawn();
        assert.strictEqual(game.state.dead, false, "player resurrected at dawn");
        assert.strictEqual(game.state.deathCause, null, "death cause cleared");
    });

    it("dawn handler moves NPCs", () => {
        const game = bootGame();
        const positionsBefore = game.state.npcs.map(n => n.position);
        game.Tick.advanceToDawn();
        const positionsAfter = game.state.npcs.map(n => n.position);
        // At least some NPCs should have moved
        const moved = positionsBefore.some((p, i) => p !== positionsAfter[i]);
        assert.ok(moved, "NPCs moved on dawn");
    });

    it("social physics decays NPC psychology over time", () => {
        const game = bootGame();
        // Use a scattered loner NPC (wave 2, index 8+) — nearby NPCs co-sleep
        // and restore hope/lucidity, masking decay
        const loner = game.state.npcs[8];
        const psychBefore = game.Social.getNpcPsych(loner.id);
        const hopeBefore = psychBefore.hope;
        // Run several dawns — loner sleeps alone, losing hope each night
        for (let i = 0; i < 30; i++) game.Tick.advanceToDawn();
        const psychAfter = game.Social.getNpcPsych(loner.id);
        assert.ok(psychAfter.hope < hopeBefore, "hope decayed");
    });

    it("resetHour handler closes open book", () => {
        const game = bootGame();
        game.state.openBook = { side: 0, position: 1, floor: 10, bookIndex: 5 };
        game.state.openPage = 3;
        // Advance past reset hour (tick 230)
        game.state.tick = 225;
        game.Tick.advance(10);
        assert.strictEqual(game.state.openBook, null, "book closed at reset hour");
        assert.strictEqual(game.state.openPage, 0, "page reset at reset hour");
    });
});

describe("DOM: Engine.advanceTime batch mode", () => {
    it("advances tick and day correctly", () => {
        const game = bootGame();
        game.state.tick = 0;
        game.state.day = 1;
        const result = game.Engine.advanceTime(50);
        assert.strictEqual(game.state.tick, 50);
        assert.strictEqual(game.state.day, 1);
        assert.strictEqual(result.finalTick, 50);
    });

    it("fires boundary handlers and updates lightsOn", () => {
        const game = bootGame();
        game.state.tick = 155;
        game.state.day = 1;
        game.state.lightsOn = true;
        game.Engine.advanceTime(10);
        assert.strictEqual(game.state.lightsOn, false, "lights off after crossing tick 160");
    });

    it("fires dawn handlers on day boundary", () => {
        const game = bootGame();
        game.state.tick = 235;
        game.state.day = 1;
        game.state.dead = true;
        game.state.deathCause = "test";
        const result = game.Engine.advanceTime(10);
        assert.ok(result.tickEvents.includes("dawn"));
        assert.strictEqual(game.state.dead, false, "resurrection via advanceTime dawn");
    });

    it("defers goto during batch mode", () => {
        const game = bootGame();
        // Register a handler that tries to goto
        let handlerRan = false;
        game.Engine.onBoundary("dawn", function () {
            handlerRan = true;
            game.Engine.goto("Menu");
        });
        game.state.tick = 235;
        game.state.day = 1;
        game.Engine.advanceTime(10);
        assert.ok(handlerRan, "handler executed");
        // goto was deferred and executed — should be on Menu
        assert.strictEqual(game.state.screen, "Menu");
    });

    it("last deferred goto wins", () => {
        const game = bootGame();
        game.Engine.onBoundary("dawn", function () {
            game.Engine.goto("Death");
            game.Engine.goto("Menu");
        });
        game.state.tick = 235;
        game.state.day = 1;
        game.Engine.advanceTime(10);
        assert.strictEqual(game.state.screen, "Menu");
    });
});

describe("DOM: Screen kind taxonomy", () => {
    it("state screens have kind state", () => {
        const game = bootGame();
        const stateScreens = ["Corridor", "Kiosk", "Bedroom", "Menu", "Win"];
        for (const name of stateScreens) {
            const screen = game.Engine._screens[name];
            assert.ok(screen, name + " exists");
            assert.strictEqual(screen.kind, "state", name + " is state");
        }
    });

    it("transition screens have kind transition", () => {
        const game = bootGame();
        const transScreens = ["Wait", "Sleep", "Chasm", "Submission Attempt",
            "Kiosk Get Drink", "Kiosk Get Food", "Kiosk Get Alcohol"];
        for (const name of transScreens) {
            const screen = game.Engine._screens[name];
            assert.ok(screen, name + " exists");
            assert.strictEqual(screen.kind, "transition", name + " is transition");
        }
    });
});

describe("DOM: Screen exit lifecycle", () => {
    it("exit fires on screen transition", () => {
        const game = bootGame();
        let exitFired = false;
        game.Engine._screens["Corridor"].exit = function () {
            exitFired = true;
        };
        game.Engine.goto("Kiosk");
        assert.ok(exitFired, "Corridor exit() fired when leaving");
        // Cleanup
        delete game.Engine._screens["Corridor"].exit;
    });

    it("exit error does not prevent transition", () => {
        const game = bootGame();
        game.Engine._screens["Corridor"].exit = function () {
            throw new Error("exit boom");
        };
        game.Engine.goto("Kiosk");
        assert.strictEqual(game.state.screen, "Kiosk", "transitioned despite exit error");
        delete game.Engine._screens["Corridor"].exit;
    });
});
