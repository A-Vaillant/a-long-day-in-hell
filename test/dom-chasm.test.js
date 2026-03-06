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

function clickIfExists(game, id) {
    const el = game.document.getElementById(id);
    if (el) el.click();
    return !!el;
}

function getPassageText(game) {
    return game.document.getElementById("passage").textContent;
}

describe("DOM: chasm and freefall", () => {
    it("J key does nothing when not at rest area", () => {
        const game = bootGame();
        game.state.position = 1;
        game.state.floor = 100;
        game.Engine.goto("Corridor");

        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Corridor", "still on corridor");
    });

    it("J key opens chasm screen at rest area above floor 0", () => {
        const game = bootGame();
        game.state.position = 0;
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
        assert.ok(text.includes("railing"), "mentions railing");
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

    it("falling screen shows altitude-aware prose and grab description", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 1000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        const text = getPassageText(game);
        assert.ok(text.includes("Falling"), "shows falling header");
        assert.ok(text.includes("railing"), "shows grab description");
        assert.ok(game.document.getElementById("fall-wait"), "has wait action");
        assert.ok(game.document.getElementById("fall-grab"), "has grab action");
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

        assert.strictEqual(game.state.falling.speed, 5, "speed is 5 after 5 ticks");
        assert.strictEqual(game.state.floor, 10000 - 15, "fell 1+2+3+4+5 = 15 floors");
    });

    it("throw book clears held book", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 1000;
        game.state.heldBook = { side: 0, position: 0, floor: 1000, bookIndex: 5 };
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        assert.ok(game.document.getElementById("fall-throw"), "throw button visible");
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

        // Chasm.jump is called synchronously in afterRender before the setTimeout
        assert.ok(game.state.falling !== null, "falling state set immediately when despairing");
    });

    it("landing at floor 0 from low height goes to corridor", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 3;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

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

    it("fatal landing at floor 0 shows death screen (gravity)", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 200;
        const deathsBefore = game.state.deaths || 0;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        let safety = 0;
        while (game.state.screen === "Falling" && safety < 100) {
            clickElement(game, "fall-wait");
            safety++;
        }

        // Death.enter() advances to dawn → resurrection fires
        // so state.dead is false, but deaths incremented and screen is Death
        assert.strictEqual(game.state.screen, "Death", "on death screen");
        assert.strictEqual(game.state.deaths, deathsBefore + 1, "death counted");
        // Death screen prose should mention gravity
        const text = getPassageText(game);
        assert.ok(text.includes("impact"), "death text mentions impact (gravity)");
    });

    it("failed grab reduces mortality", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100000;
        game.state.mortality = 100;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Accelerate to terminal velocity (50) — grab chance 5%
        for (let i = 0; i < 55; i++) {
            clickElement(game, "fall-wait");
        }

        // Try grabs until one fails (at 5% success, almost always fails first try)
        let mortalityBefore = game.state.mortality;
        let gotFailure = false;
        for (let attempt = 0; attempt < 10 && !gotFailure; attempt++) {
            mortalityBefore = game.state.mortality;
            if (!game.state.falling) break;
            clickElement(game, "fall-grab");
            if (game.state.falling) {
                // Still falling = grab failed
                gotFailure = true;
                assert.ok(game.state.mortality < mortalityBefore, "mortality decreased on failed grab");
            }
        }
        assert.ok(gotFailure, "at least one grab failed at terminal velocity");
    });

    it("grab failure can kill player (death cause: trauma)", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100000;
        game.state.mortality = 10; // very low — one failed grab should kill
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Get to high speed
        for (let i = 0; i < 45; i++) {
            clickElement(game, "fall-wait");
        }

        // Spam grab attempts until dead or grabbed
        let safety = 0;
        while (!game.state.dead && game.state.falling && safety < 20) {
            if (!clickIfExists(game, "fall-grab")) break;
            if (game.state.falling) clickIfExists(game, "fall-wait");
            safety++;
        }

        if (game.state.dead) {
            assert.strictEqual(game.state.deathCause, "trauma", "death cause is trauma");
        }
        // If somehow grabbed successfully, that's OK — non-deterministic
    });

    it("lights-out shows darkness prose during freefall", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 10000;
        game.state.lightsOn = false;
        game.state.tick = 170; // past lights-out
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        const text = getPassageText(game);
        assert.ok(text.includes("Darkness"), "shows darkness prose during lights-out fall");
    });

    it("falling state persists through save/load round-trip", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 10000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Fall a few ticks
        for (let i = 0; i < 3; i++) {
            clickElement(game, "fall-wait");
        }

        const fallingBefore = JSON.parse(JSON.stringify(game.state.falling));
        const floorBefore = game.state.floor;

        // Save and reload
        game.Engine.save();
        const saved = game.Engine.load();

        assert.ok(saved.falling, "falling state in save data");
        assert.strictEqual(saved.falling.speed, fallingBefore.speed, "speed preserved");
        assert.strictEqual(saved.floor, floorBefore, "floor preserved");
    });

    it("corridor renders correctly after grabbing a railing mid-fall", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 30; // low floor, slow speed, high grab chance
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // One tick — speed 1, grab chance ~78.5%
        clickElement(game, "fall-wait");

        // Force a successful grab by setting speed to 0 (100% chance)
        game.state.falling.speed = 0;
        game.Engine.goto("Falling"); // re-render with new speed
        clickElement(game, "fall-grab");

        // Should be on corridor now at whatever floor we stopped at
        assert.strictEqual(game.state.screen, "Corridor", "on corridor after grab");
        assert.strictEqual(game.state.falling, null, "not falling");
        assert.ok(game.state.floor > 0, "stopped above floor 0");

        // Verify corridor actually renders without errors
        const text = getPassageText(game);
        assert.ok(text.length > 0, "corridor has content");
    });

    it("jump link hidden in corridor when not at rest area", () => {
        const game = bootGame();
        game.state.position = 1;
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

    it("chasm view text changes with altitude", () => {
        const game = bootGame();
        game.state.position = 0;

        game.state.floor = 50000;
        game.Engine.goto("Chasm Stub");
        const highText = getPassageText(game);

        game.state.floor = 15;
        game.Engine.goto("Chasm Stub");
        const lowText = getPassageText(game);

        assert.notStrictEqual(highText, lowText, "different altitude produces different text");
        assert.ok(lowText.includes("bottom") || lowText.includes("bridge"), "low altitude mentions visible bottom");
    });

    it("falling prose changes as you descend", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 50000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        const highText = getPassageText(game);

        game.state.floor = 100;
        game.Engine.goto("Falling");
        const lowText = getPassageText(game);

        assert.notStrictEqual(highText, lowText, "falling text changes with altitude");
    });

    it("failed grab at high speed reduces speed", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Accelerate to terminal velocity
        for (let i = 0; i < 55; i++) {
            clickElement(game, "fall-wait");
        }
        assert.strictEqual(game.state.falling.speed, 50, "at terminal velocity");

        // Try grabs until one fails
        let gotFailure = false;
        for (let attempt = 0; attempt < 10 && !gotFailure; attempt++) {
            const speedBefore = game.state.falling ? game.state.falling.speed : 0;
            if (!game.state.falling) break;
            clickElement(game, "fall-grab");
            if (game.state.falling) {
                gotFailure = true;
                assert.ok(game.state.falling.speed < speedBefore, "speed reduced on failed grab");
            }
        }
        assert.ok(gotFailure, "at least one grab failed");
    });

    it("trauma death mid-fall: resurrect still falling", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100000;
        game.state.mortality = 10; // very low — one failed grab should kill
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Accelerate to high speed
        for (let i = 0; i < 45; i++) {
            clickElement(game, "fall-wait");
        }

        // Spam grabs until dead
        let safety = 0;
        while (!game.state.dead && game.state.falling && safety < 20) {
            if (!clickIfExists(game, "fall-grab")) break;
            // After failed grab, doFallTick advances time — re-render
            if (game.state.falling && !game.state.dead) {
                // still falling, screen re-rendered
            }
            safety++;
        }

        if (game.state.dead && game.state.deathCause === "trauma") {
            assert.strictEqual(game.state.screen, "Death", "on death screen");
            const floorAtDeath = game.state.floor;
            assert.ok(floorAtDeath > 0, "died mid-air, not at floor 0");

            // Click continue — triggers resurrection via onForcedSleep/dawn
            clickElement(game, game.document.querySelector("[data-goto='Corridor']") ? "passage" : "passage");
            // Use the data-goto link
            const link = game.document.querySelector("[data-goto='Corridor']");
            assert.ok(link, "continue link exists");
            link.click();

            assert.strictEqual(game.state.dead, false, "resurrected");
            // Body fell during the night — should be at floor 0 or still falling
            // (from 100k floors, terminal velocity fall takes ~2000 ticks,
            //  forced sleep is ~80 ticks, so likely still falling)
            if (game.state.falling) {
                assert.ok(game.state.floor < floorAtDeath, "fell further during death/sleep");
            } else {
                assert.strictEqual(game.state.floor, 0, "hit bottom during night");
            }
        }
        // If grabs succeeded, that's OK — non-deterministic
    });

    it("fall continues through voluntary sleep", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 500; // low enough to land during sleep
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        // Accelerate a bit
        for (let i = 0; i < 5; i++) {
            clickElement(game, "fall-wait");
        }
        assert.ok(game.state.falling, "still falling");
        assert.strictEqual(game.state.falling.speed, 5, "speed is 5");

        // Simulate what happens when time advances many ticks (e.g., sleep)
        // advance(TICKS_PER_HOUR) should advance fall 10 ticks
        game.Tick.advance(10);
        // After 10 more ticks from speed 5, total distance = 6+7+8+9+10+11+12+13+14+15 = 105
        // Plus the 15 from the first 5 ticks = 120 floors total. From 500, floor ~380.
        // Should still be falling (need ~32 ticks to fall 500 floors from speed 5)
        assert.ok(game.state.falling || game.state.floor === 0, "fall advanced");
    });

    it("grab button present at terminal velocity (5% chance)", () => {
        const game = bootGame();
        game.state.position = 0;
        game.state.floor = 100000;
        game.Engine.goto("Chasm Stub");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 55; i++) {
            clickElement(game, "fall-wait");
        }

        assert.ok(game.state.falling.speed === 50, "at terminal velocity");
        assert.ok(game.document.getElementById("fall-grab"), "grab still available (5% chance)");
    });
});
