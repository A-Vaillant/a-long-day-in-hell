import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootGame, resetGame } from "./dom-harness.js";

const game = bootGame();

function pressKey(g, key) {
    const ev = new g.window.KeyboardEvent("keydown", { key, bubbles: true });
    g.document.dispatchEvent(ev);
}

function clickElement(g, id) {
    const el = g.document.getElementById(id);
    assert.ok(el, "element #" + id + " exists");
    el.click();
}

function clickIfExists(g, id) {
    const el = g.document.getElementById(id);
    if (el) el.click();
    return !!el;
}

function getPassageText(g) {
    return g.document.getElementById("passage").textContent;
}

describe("DOM: chasm and freefall", () => {
    beforeEach(() => resetGame(game));

    it("J key opens chasm from non-rest-area above floor 0", () => {
        game.state.position = 1n;
        game.state.floor = 100n;
        game.Engine.goto("Corridor");

        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Chasm", "chasm from non-rest-area");
    });

    it("J key opens chasm screen at rest area above floor 0", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.Engine.goto("Corridor");

        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Chasm", "navigated to chasm screen");
    });

    it("J key does nothing at floor 0", () => {
        game.state.position = 0n;
        game.state.floor = 0n;
        game.Engine.goto("Corridor");

        pressKey(game, "J");
        assert.strictEqual(game.state.screen, "Corridor", "can't jump at floor 0");
    });

    it("chasm screen shows confirmation and back link", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.Engine.goto("Chasm");

        const text = getPassageText(game);
        assert.ok(text.includes("railing"), "mentions railing");
        assert.ok(game.document.getElementById("chasm-jump-yes"), "has jump-yes button");
    });

    it("confirming jump enters freefall", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.Engine.goto("Chasm");

        clickElement(game, "chasm-jump-yes");

        assert.strictEqual(game.state.screen, "Falling", "on falling screen");
        assert.ok(game.state.falling !== null, "falling state is set");
        assert.strictEqual(game.state.falling.speed, 0, "initial speed is 0");
    });

    it("Y key confirms jump on chasm screen", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.Engine.goto("Chasm");

        pressKey(game, "y");

        assert.strictEqual(game.state.screen, "Falling", "on falling screen after Y");
        assert.ok(game.state.falling !== null, "falling state set");
    });

    it("N key returns to corridor from chasm screen", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.Engine.goto("Chasm");

        pressKey(game, "n");
        assert.strictEqual(game.state.screen, "Corridor", "back to corridor");
    });

    it("falling screen shows altitude-aware prose and grab description", () => {
        game.state.position = 0n;
        game.state.floor = 1000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        const text = getPassageText(game);
        assert.ok(text.includes("Falling"), "shows falling header");
        assert.ok(text.includes("railing"), "shows grab description");
        assert.ok(game.document.getElementById("fall-wait"), "has wait action");
        assert.ok(game.document.getElementById("fall-grab"), "has grab action");
    });

    it("wait action advances fall", () => {
        game.state.position = 0n;
        game.state.floor = 1000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        const floorBefore = game.state.floor;
        clickElement(game, "fall-wait");

        assert.ok(game.state.floor < floorBefore, "floor decreased after wait");
        assert.ok(game.state.falling.speed > 0, "speed increased");
    });

    it("multiple waits accumulate speed", () => {
        game.state.position = 0n;
        game.state.floor = 10000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 5; i++) {
            clickElement(game, "fall-wait");
        }

        assert.strictEqual(game.state.falling.speed, 5, "speed is 5 after 5 ticks");
        assert.strictEqual(game.state.floor, BigInt(10000 - 15), "fell 1+2+3+4+5 = 15 floors");
    });

    it("throw book clears held book", () => {
        game.state.position = 0n;
        game.state.floor = 1000n;
        game.state.heldBook = { side: 0, position: 0n, floor: 1000n, bookIndex: 5 };
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        assert.ok(game.document.getElementById("fall-throw"), "throw button visible");
        clickElement(game, "fall-throw");

        assert.strictEqual(game.state.heldBook, null, "book is gone");
    });

    it("no throw button when not holding a book", () => {
        game.state.position = 0n;
        game.state.floor = 1000n;
        game.state.heldBook = null;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        assert.strictEqual(game.document.getElementById("fall-throw"), null, "no throw button");
    });

    it("despairing skips confirmation — jumps immediately", () => {
        game.state.position = 0n;
        game.state.floor = 500n;
        game.state.morale = 0;
        game.state.despairing = true;
        game.Engine.goto("Chasm");

        assert.ok(game.state.falling !== null, "falling state set immediately when despairing");
    });

    it("landing at floor 0 from low height goes to corridor", () => {
        game.state.position = 0n;
        game.state.floor = 3n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        let safety = 0;
        while (game.state.falling && safety < 20) {
            clickElement(game, "fall-wait");
            safety++;
        }

        assert.strictEqual(game.state.floor, 0n, "at floor 0");
        assert.strictEqual(game.state.falling, null, "no longer falling");
        assert.strictEqual(game.state.dead, false, "survived the fall");
        assert.strictEqual(game.state.screen, "Corridor", "back on corridor");
    });

    it("fatal landing at floor 0 shows death screen (gravity)", () => {
        game.state.position = 0n;
        game.state.floor = 200n;
        const deathsBefore = game.state.deaths || 0;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        let safety = 0;
        while (game.state.screen === "Falling" && safety < 100) {
            clickElement(game, "fall-wait");
            safety++;
        }

        assert.strictEqual(game.state.screen, "Death", "on death screen");
        assert.strictEqual(game.state.deaths, deathsBefore + 1, "death counted");
        const text = getPassageText(game);
        assert.ok(text.includes("impact"), "death text mentions impact (gravity)");
    });

    it("failed grab reduces mortality", () => {
        game.state.position = 0n;
        game.state.floor = 100000n;
        game.state.mortality = 100;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 55; i++) {
            clickElement(game, "fall-wait");
        }

        let mortalityBefore = game.state.mortality;
        let gotFailure = false;
        for (let attempt = 0; attempt < 10 && !gotFailure; attempt++) {
            mortalityBefore = game.state.mortality;
            if (!game.state.falling) break;
            clickElement(game, "fall-grab");
            if (game.state.falling) {
                gotFailure = true;
                assert.ok(game.state.mortality < mortalityBefore, "mortality decreased on failed grab");
            }
        }
        assert.ok(gotFailure, "at least one grab failed at terminal velocity");
    });

    it("grab failure can kill player (death cause: trauma)", () => {
        game.state.position = 0n;
        game.state.floor = 100000n;
        game.state.mortality = 10;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 45; i++) {
            clickElement(game, "fall-wait");
        }

        let safety = 0;
        while (!game.state.dead && game.state.falling && safety < 20) {
            if (!clickIfExists(game, "fall-grab")) break;
            if (game.state.falling) clickIfExists(game, "fall-wait");
            safety++;
        }

        if (game.state.dead) {
            assert.strictEqual(game.state.deathCause, "trauma", "death cause is trauma");
        }
    });

    it("lights-out shows darkness prose during freefall", () => {
        game.state.position = 0n;
        game.state.floor = 10000n;
        game.state.lightsOn = false;
        game.state.tick = 170;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        const text = getPassageText(game);
        assert.ok(text.includes("Darkness"), "shows darkness prose during lights-out fall");
    });

    it("falling state persists through save/load round-trip", () => {
        game.state.position = 0n;
        game.state.floor = 10000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 3; i++) {
            clickElement(game, "fall-wait");
        }

        const fallingBefore = JSON.parse(JSON.stringify(game.state.falling));
        const floorBefore = game.state.floor;

        game.Engine.save();
        const saved = game.Engine.load();

        assert.ok(saved.falling, "falling state in save data");
        assert.strictEqual(saved.falling.speed, fallingBefore.speed, "speed preserved");
        assert.strictEqual(saved.floor, floorBefore, "floor preserved");
    });

    it("corridor renders correctly after grabbing a railing mid-fall", () => {
        game.state.position = 0n;
        game.state.floor = 30n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        clickElement(game, "fall-wait");

        game.state.falling.speed = 0;
        let grabbed = false;
        for (let attempt = 0; attempt < 10 && !grabbed; attempt++) {
            game.Engine.goto("Falling");
            clickElement(game, "fall-grab");
            grabbed = game.state.falling === null;
            if (!grabbed) {
                game.state.falling.speed = 0;
                game.state.tick++;
            }
        }
        assert.ok(grabbed, "grab succeeded within 10 attempts at speed 0");

        assert.strictEqual(game.state.screen, "Corridor", "on corridor after grab");
        assert.strictEqual(game.state.falling, null, "not falling");
        assert.ok(game.state.floor > 0n, "stopped above floor 0");

        const text = getPassageText(game);
        assert.ok(text.length > 0, "corridor has content");
    });

    it("jump link shown in corridor at non-rest-area when above floor 0", () => {
        game.state.position = 1n;
        game.state.floor = 100n;
        game.Engine.goto("Corridor");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("Chasm"), "chasm link at non-rest-area above floor 0");
    });

    it("jump link hidden at floor 0", () => {
        game.state.position = 0n;
        game.state.floor = 0n;
        game.Engine.goto("Corridor");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(!html.includes("Chasm"), "no jump link at floor 0");
    });

    it("jump link visible at rest area above floor 0", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.Engine.goto("Corridor");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("Chasm"), "jump link present");
    });

    it("tick advances during freefall (time passes)", () => {
        game.state.position = 0n;
        game.state.floor = 10000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        const tickBefore = game.state.tick;
        for (let i = 0; i < 5; i++) {
            clickElement(game, "fall-wait");
        }

        assert.ok(game.state.tick > tickBefore, "tick advanced during fall");
    });

    it("chasm view text changes with altitude", () => {
        game.state.position = 0n;

        game.state.floor = 50000n;
        game.Engine.goto("Chasm");
        const highText = getPassageText(game);

        game.state.floor = 15n;
        game.Engine.goto("Chasm");
        const lowText = getPassageText(game);

        assert.notStrictEqual(highText, lowText, "different altitude produces different text");
        assert.ok(lowText.includes("bottom") || lowText.includes("bridge"), "low altitude mentions visible bottom");
    });

    it("falling prose changes as you descend", () => {
        game.state.position = 0n;
        game.state.floor = 50000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        const highText = getPassageText(game);

        game.state.floor = 100n;
        game.Engine.goto("Falling");
        const lowText = getPassageText(game);

        assert.notStrictEqual(highText, lowText, "falling text changes with altitude");
    });

    it("failed grab at high speed reduces speed", () => {
        game.state.position = 0n;
        game.state.floor = 100000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 55; i++) {
            clickElement(game, "fall-wait");
        }
        assert.strictEqual(game.state.falling.speed, 50, "at terminal velocity");

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
        game.state.position = 0n;
        game.state.floor = 100000n;
        game.state.mortality = 10;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 45; i++) {
            clickElement(game, "fall-wait");
        }

        let safety = 0;
        while (!game.state.dead && game.state.falling && safety < 20) {
            if (!clickIfExists(game, "fall-grab")) break;
            if (game.state.falling && !game.state.dead) {
                // still falling, screen re-rendered
            }
            safety++;
        }

        if (game.state.dead && game.state.deathCause === "trauma") {
            assert.strictEqual(game.state.screen, "Death", "on death screen");
            const floorAtDeath = game.state.floor;
            assert.ok(floorAtDeath > 0, "died mid-air, not at floor 0");

            const link = game.document.querySelector("[data-goto='Corridor']");
            assert.ok(link, "continue link exists");
            link.click();

            assert.strictEqual(game.state.dead, false, "resurrected");
            if (game.state.falling) {
                assert.ok(game.state.floor < floorAtDeath, "fell further during death/sleep");
            } else {
                assert.strictEqual(game.state.floor, 0n, "hit bottom during night");
            }
        }
    });

    it("fall continues through voluntary sleep", () => {
        game.state.position = 0n;
        game.state.floor = 500n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 5; i++) {
            clickElement(game, "fall-wait");
        }
        assert.ok(game.state.falling, "still falling");
        assert.strictEqual(game.state.falling.speed, 5, "speed is 5");

        game.Tick.advance(10);
        assert.ok(game.state.falling || game.state.floor === 0n, "fall advanced");
    });

    it("corridor shows 'chasm' label when not despairing", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.state.despairing = false;
        game.Engine.goto("Corridor");

        const actions = game.document.getElementById("actions");
        assert.ok(actions, "actions div exists");
        assert.ok(actions.innerHTML.includes("chasm"), "shows 'chasm' label");
        assert.ok(!actions.innerHTML.includes("jump"), "does not show 'jump'");
    });

    it("corridor shows 'jump' label when despairing", () => {
        game.state.position = 0n;
        game.state.floor = 100n;
        game.state.despairing = true;
        game.Engine.goto("Corridor");

        const actions = game.document.getElementById("actions");
        assert.ok(actions, "actions div exists");
        assert.ok(actions.innerHTML.includes("jump"), "shows 'jump' when despairing");
    });

    it("despairing J key skips confirmation, enters freefall directly", () => {
        game.state.position = 0n;
        game.state.floor = 500n;
        game.state.morale = 0;
        game.state.despairing = true;

        game.Engine.goto("Corridor");
        pressKey(game, "J");

        assert.strictEqual(game.state.screen, "Falling", "went straight to Falling");
        assert.ok(game.state.falling !== null, "falling state set");
    });

    it("failed grab shows feedback text on next render", () => {
        game.state.position = 0n;
        game.state.floor = 100000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 55; i++) {
            clickElement(game, "fall-wait");
        }

        let gotFeedback = false;
        for (let attempt = 0; attempt < 20 && !gotFeedback; attempt++) {
            if (!game.state.falling) break;
            clickElement(game, "fall-grab");
            if (game.state.falling && game.state.screen === "Falling") {
                const text = getPassageText(game);
                if (text.includes("railing") && (text.includes("tears free") || text.includes("brush metal"))) {
                    gotFeedback = true;
                }
            }
        }
        assert.ok(gotFeedback, "grab failure feedback text was shown");
    });

    it("grab button present at terminal velocity (5% chance)", () => {
        game.state.position = 0n;
        game.state.floor = 100000n;
        game.Engine.goto("Chasm");
        clickElement(game, "chasm-jump-yes");

        for (let i = 0; i < 55; i++) {
            clickElement(game, "fall-wait");
        }

        assert.ok(game.state.falling.speed === 50, "at terminal velocity");
        assert.ok(game.document.getElementById("fall-grab"), "grab still available (5% chance)");
    });
});
