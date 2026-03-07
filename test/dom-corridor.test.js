import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

/** Extract the static corridor prose (madlib descriptions + features only). */
function getCorridorProse(document) {
    const view = document.getElementById("corridor-view");
    if (!view) return "";
    // Select only the elements that should be deterministic for a location:
    // madlib paragraphs (no class) and feature paragraphs (.feature)
    const paras = view.querySelectorAll("p:not([class]), p.feature");
    return Array.from(paras).map(p => p.textContent).join("\n");
}

describe("Corridor description stability", () => {
    it("same location produces same description across re-renders", () => {
        const game = bootGame();
        game.state.position = 1;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "re-rendering same location should produce identical prose");
    });

    it("same location produces same description after moving away and back", () => {
        const game = bootGame();
        game.state.position = 1;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.state.position = 2;
        game.Engine.goto("Corridor");
        game.state.position = 1;
        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "returning to same location should show same description");
    });

    it("description is stable across ticks at the same location", () => {
        const game = bootGame();
        game.state.position = 3;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.Tick.advance(5);
        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "advancing ticks should not change corridor description");
    });

    it("rest area description is stable across ticks", () => {
        const game = bootGame();
        game.state.position = 0;
        game.Engine.goto("Corridor");
        const prose1 = getCorridorProse(game.document);

        game.Tick.advance(3);
        game.Engine.goto("Corridor");
        const prose2 = getCorridorProse(game.document);

        assert.equal(prose1, prose2, "rest area description should be stable across ticks");
    });

    it("different locations produce varied descriptions", () => {
        const game = bootGame();
        const descriptions = new Set();
        for (let pos = 1; pos <= 9; pos++) {
            game.state.position = pos;
            game.Engine.goto("Corridor");
            descriptions.add(getCorridorProse(game.document));
        }
        assert.ok(descriptions.size >= 2, "should see at least 2 distinct descriptions across 9 segments");
    });
});
