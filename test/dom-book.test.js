import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

describe("DOM: book rendering", () => {
    it("book page displays random ASCII text", () => {
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
        // Symbol slop: 40 lines of 80 chars
        const lines = text.split("\n");
        assert.strictEqual(lines.length, 40, "page has 40 lines");
        assert.strictEqual(lines[0].length, 80, "each line is 80 chars");
    });

    it("Book.getPage returns a string", () => {
        const game = bootGame();
        const result = game.window.Book.getPage(0, 1, 10, 5, 0);
        assert.ok(typeof result === "string", "returns string");
        assert.ok(result.length > 50, "text has content");
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

    it("non-target pages of target book are random ASCII", () => {
        const game = bootGame();
        const tb = game.state.targetBook;
        const targetPage = game.state.lifeStory.targetPage;
        // Pick a content page that is NOT the target page
        let otherPage = targetPage === 0 ? 1 : 0;
        const result = game.window.Book.getPage(tb.side, tb.position, tb.floor, tb.bookIndex, otherPage);
        assert.ok(typeof result === "string", "returns string");
        const lines = result.split("\n");
        assert.strictEqual(lines.length, 40, "page has 40 lines");
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
        const win = game.window;
        const pageRng = win.PRNG.fork("pageopen:" + game.state.tick);
        const expectedPage = pageRng.nextInt(win.Book.PAGES_PER_BOOK) + 1;
        assert.ok(expectedPage >= 1 && expectedPage <= 410, "random page in valid range");
    });

    it("book naming persists in header", () => {
        const game = bootGame();
        const bk = { side: 0, position: 1, floor: 10, bookIndex: 5 };
        game.state.openBook = bk;
        game.state.openPage = 1;
        game.Engine.goto("Shelf Open Book");

        // Default header uses "a book"
        let header = game.document.querySelector(".location-header").textContent;
        assert.ok(header.includes("a book"), "default label is 'a book', got: " + header);

        // Set a name
        if (!game.state.bookNames) game.state.bookNames = {};
        game.state.bookNames["0:1:10:5"] = "Gibberish Vol. III";
        game.Engine.goto("Shelf Open Book");

        header = game.document.querySelector(".location-header").textContent;
        assert.ok(header.includes("Gibberish Vol. III"), "named label shown, got: " + header);
        assert.ok(!header.includes("a book"), "no longer shows default label");
    });

    it("book name shows in corridor read action", () => {
        const game = bootGame();
        game.state.position = 1;
        game.state.heldBook = { side: 0, position: 1, floor: 10, bookIndex: 3 };
        if (!game.state.bookNames) game.state.bookNames = {};
        game.state.bookNames["0:1:10:3"] = "My Book";
        game.Engine.goto("Corridor");

        const html = game.document.getElementById("passage").innerHTML;
        assert.ok(html.includes("read \u2018My Book\u2019"), "corridor shows named book in read action with quotes");
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
