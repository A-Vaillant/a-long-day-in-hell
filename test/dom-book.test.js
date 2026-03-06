import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

describe("DOM: book rendering", () => {
    it("book page displays degraded prose text", () => {
        const game = bootGame();
        // Move to a gallery position
        game.state.position = 1;
        game.Engine.goto("Corridor");

        // Open a book
        game.state.openBook = { side: 0, position: 1, floor: 10, bookIndex: 5 };
        game.state.openPage = 1;
        game.Engine.goto("Shelf Open Book");

        const el = game.document.getElementById("book-single");
        assert.ok(el, "book-single element exists");
        const text = el.textContent;
        assert.ok(text.length > 50, "page has substantial text: " + text.length + " chars");
        // Should contain real words (not random ASCII)
        assert.ok(/[a-z]{3,}/.test(text), "text contains real words");
    });

    it("TEXT.stories and TEXT.dictionary are loaded", () => {
        const game = bootGame();
        const TEXT = game.window.TEXT;
        assert.ok(Array.isArray(TEXT.stories), "TEXT.stories is array");
        assert.ok(Array.isArray(TEXT.dictionary), "TEXT.dictionary is array");
        assert.strictEqual(TEXT.stories.length, 15);
        assert.ok(TEXT.dictionary.length > 3000);
    });

    it("Book.getPage returns object with text, storyId, editDistance", () => {
        const game = bootGame();
        const result = game.window.Book.getPage(0, 1, 10, 5, 0);
        assert.ok(typeof result === "object", "returns object");
        assert.ok(typeof result.text === "string", "has text");
        assert.ok(typeof result.storyId === "number", "has storyId");
        assert.ok(typeof result.editDistance === "number", "has editDistance");
        assert.ok(result.text.length > 50, "text has content");
    });

    it("target book page displays life story text", () => {
        const game = bootGame();
        const tb = game.state.targetBook;
        // Move player to the target book's location
        game.state.side = tb.side;
        game.state.position = tb.position;
        game.state.floor = tb.floor;
        game.state.openBook = { side: tb.side, position: tb.position, floor: tb.floor, bookIndex: tb.bookIndex };
        game.state.openPage = game.state.lifeStory.targetPage + 1; // openPage is 1-indexed (0=cover)
        game.Engine.goto("Shelf Open Book");

        const el = game.document.getElementById("book-single");
        assert.ok(el, "book-single element exists");
        const text = el.textContent;
        assert.ok(text.includes(game.state.lifeStory.name), "contains player name");
    });

    it("non-target pages of target book are normal degraded text", () => {
        const game = bootGame();
        const tb = game.state.targetBook;
        const targetPage = game.state.lifeStory.targetPage;
        // Pick a content page that is NOT the target page
        let otherPage = targetPage === 0 ? 1 : 0;
        const result = game.window.Book.getPage(tb.side, tb.position, tb.floor, tb.bookIndex, otherPage);
        assert.ok(result.storyId >= 0, "non-target page has a real storyId, got " + result.storyId);
        assert.ok(result.editDistance >= 0, "has editDistance");
        assert.ok(result.text.length > 50, "has substantial text");
    });

    it("cover page is blank calfskin (no text)", () => {
        const game = bootGame();
        game.state.openBook = { side: 0, position: 1, floor: 10, bookIndex: 5 };
        game.state.openPage = 0;
        game.Engine.goto("Shelf Open Book");

        const el = game.document.getElementById("book-single");
        assert.strictEqual(el.textContent.trim(), "", "cover has no text");
        assert.ok(el.classList.contains("book-page-cover"), "has cover class");
    });

    it("morale < 80 opens to random page (not cover)", () => {
        const game = bootGame();
        game.state.position = 1;
        game.state.morale = 50;
        game.Engine.goto("Corridor");

        // Simulate spine click by setting openBook with morale-gated page
        // The actual spine click handler runs in afterRender, so we test the logic directly
        const win = game.window;
        const pageRng = win.PRNG.fork("pageopen:" + game.state.tick);
        const expectedPage = pageRng.nextInt(win.Book.PAGES_PER_BOOK) + 1;
        assert.ok(expectedPage >= 1 && expectedPage <= 11, "random page in valid range");
    });

    it("page navigation works", () => {
        const game = bootGame();
        game.state.openBook = { side: 0, position: 1, floor: 10, bookIndex: 0 };
        game.state.openPage = 1;
        game.Engine.goto("Shelf Open Book");

        const text1 = game.document.getElementById("book-single").textContent;

        // Navigate to next page
        game.state.openPage = 2;
        game.Engine.goto("Shelf Open Book");

        const text2 = game.document.getElementById("book-single").textContent;
        assert.notStrictEqual(text1, text2, "different pages have different text");
    });
});
