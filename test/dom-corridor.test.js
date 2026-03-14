import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { bootGame, resetGame } from "./dom-harness.js";

const game = bootGame();

/** Extract the static corridor prose (madlib descriptions + features only). */
function getCorridorProse(document) {
    const view = document.getElementById("corridor-view");
    if (!view) return "";
    const paras = view.querySelectorAll("p:not([class]), p.feature");
    return Array.from(paras).map(p => p.textContent).join("\n");
}

describe("Corridor description stability", () => {
    beforeEach(() => resetGame(game));

    it("same location produces same description across re-renders", () => {
        game.state.position = 1n;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "re-rendering same location should produce identical prose");
    });

    it("same location produces same description after moving away and back", () => {
        game.state.position = 1n;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.state.position = 2n;
        game.Engine.goto("Corridor");
        game.state.position = 1n;
        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "returning to same location should show same description");
    });

    it("description is stable across ticks at the same location", () => {
        game.state.position = 3n;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.Tick.advance(5);
        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "advancing ticks should not change corridor description");
    });

    it("rest area description is stable across ticks", () => {
        game.state.position = 0n;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.Tick.advance(3);
        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "rest area description should be stable across ticks");
    });

    it("different locations produce varied descriptions", () => {
        const descriptions = new Set();
        for (let pos = 1; pos <= 9; pos++) {
            game.state.position = BigInt(pos);
            game.Engine.goto("Corridor");
            descriptions.add(getCorridorProse(game.document));
        }
        assert.ok(descriptions.size >= 2, "should see at least 2 distinct descriptions across 9 segments");
    });
});
