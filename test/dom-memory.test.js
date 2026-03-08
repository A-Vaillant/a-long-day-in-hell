/**
 * DOM tests for the Memory screen and sidebar action registry.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";

describe("Memory screen", () => {
    it("opens via Engine.goto and sets screen state", () => {
        const { Engine, state } = bootGame();
        Engine.goto("Memory");
        assert.strictEqual(state.screen, "Memory");
    });

    it("renders empty state prose when player has no memories", () => {
        const { Engine, document } = bootGame();
        Engine.goto("Memory");
        const html = document.getElementById("passage").innerHTML;
        assert.ok(html.includes("memory-view"), "should have memory-view container");
        assert.ok(html.includes("Memory"), "should show location header");
    });

    it("renders memory entries when player has memories", () => {
        const { Engine, Social, document, state } = bootGame();

        // Inject a memory entry directly into the player's ECS component
        const mem = Social.getPlayerMemory();
        assert.ok(mem, "player should have MEMORY component");
        mem.entries.push({
            id: 0,
            type: "witnessEscape",
            tick: (state.day - 1) * 240 + state.tick,
            weight: 8,
            initialWeight: 10,
            permanent: false,
            subject: null,
            contagious: false,
        });

        Engine.goto("Memory");
        const html = document.getElementById("passage").innerHTML;
        assert.ok(html.includes("memory-entry"), "should render at least one memory entry");
        assert.ok(html.includes("memory-vivid") || html.includes("memory-clear"),
            "should have a vividness class");
    });

    it("shows permanence marker for permanent memories", () => {
        const { Engine, Social, document, state } = bootGame();

        const mem = Social.getPlayerMemory();
        mem.entries.push({
            id: 1,
            type: "witnessChasm",
            tick: (state.day - 1) * 240 + state.tick,
            weight: 5,
            initialWeight: 10,
            permanent: true,
            subject: null,
            contagious: false,
        });

        Engine.goto("Memory");
        const html = document.getElementById("passage").innerHTML;
        assert.ok(html.includes("permanent"), "permanent memory should be marked");
    });

    it("shows age as 'today' for current-tick memories", () => {
        const { Engine, Social, document, state } = bootGame();
        const currentTick = (state.day - 1) * 240 + state.tick;
        const mem = Social.getPlayerMemory();
        mem.entries.push({
            id: 2, type: "witnessEscape", tick: currentTick,
            weight: 8, initialWeight: 10, permanent: false, subject: null, contagious: false,
        });

        Engine.goto("Memory");
        const html = document.getElementById("passage").innerHTML;
        assert.ok(html.includes("today"), "recent memory should show 'today'");
    });

    it("shows age as 'yesterday' for memories from prior day", () => {
        const { Engine, Social, document, state } = bootGame();
        const currentTick = (state.day - 1) * 240 + state.tick;
        const mem = Social.getPlayerMemory();
        mem.entries.push({
            id: 3, type: "foundBody", tick: currentTick - 240, // 1 day ago
            weight: 4, initialWeight: 10, permanent: false, subject: null, contagious: false,
        });

        Engine.goto("Memory");
        const html = document.getElementById("passage").innerHTML;
        assert.ok(html.includes("yesterday"), "day-old memory should show 'yesterday'");
    });

    it("sorts entries by weight descending (most vivid first)", () => {
        const { Engine, Social, document, state } = bootGame();
        const tick = (state.day - 1) * 240 + state.tick;
        const mem = Social.getPlayerMemory();
        // Push in reverse order — low weight first, high weight second
        // Sort should flip them so high-weight renders first.
        mem.entries.push(
            { id: 10, type: "foundBody",     tick, weight: 2, initialWeight: 10, permanent: false, subject: null, contagious: false },
            { id: 11, type: "witnessEscape", tick, weight: 9, initialWeight: 10, permanent: false, subject: null, contagious: false },
        );

        Engine.goto("Memory");
        // Check rendered order via the vividness classes: id=11 (weight 9 = vivid) should be first
        const entries = document.getElementById("passage").querySelectorAll(".memory-entry");
        assert.strictEqual(entries.length, 2, "should render 2 entries");
        // First entry should be the vivid one (weight 9 / initialWeight 10 = 0.9 → vivid)
        assert.ok(entries[0].classList.contains("memory-vivid"),
            "first entry should be the higher-weight (vivid) memory");
        // Second entry should be distant (weight 2 / initialWeight 10 = 0.2 → below 0.25 threshold)
        assert.ok(entries[1].classList.contains("memory-distant"),
            "second entry should be the lower-weight (distant) memory");
    });

    it("q key returns to Corridor", () => {
        const { Engine, state, window } = bootGame();
        Engine.goto("Memory");
        assert.strictEqual(state.screen, "Memory");

        window.document.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: "q", bubbles: true })
        );
        assert.strictEqual(state.screen, "Corridor");
    });

    it("Escape key returns to Corridor", () => {
        const { Engine, state, window } = bootGame();
        Engine.goto("Memory");

        window.document.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })
        );
        assert.strictEqual(state.screen, "Corridor");
    });

    it("back link (q) is rendered in the screen", () => {
        const { Engine, document } = bootGame();
        Engine.goto("Memory");
        const html = document.getElementById("passage").innerHTML;
        assert.ok(html.includes("kbd"), "should show a key hint");
        assert.ok(html.includes("Back") || html.includes("data-goto=\"Corridor\""),
            "should show a back navigation link");
    });
});

describe("Sidebar action registry", () => {
    it("memory action appears in sidebar sb-actions div", () => {
        const { Engine, document } = bootGame();
        // Sidebar is rendered in updateSidebar — trigger a render
        Engine.goto("Corridor");
        const sidebar = document.getElementById("story-caption");
        assert.ok(sidebar, "sidebar element should exist");
        const html = sidebar.innerHTML;
        assert.ok(html.includes("sb-menu"), "sidebar should have sb-menu div");
        assert.ok(html.includes("Memory"), "memory action should appear in sidebar");
        assert.ok(html.includes("<kbd>m</kbd>"), "memory key hint should appear");
    });

    it("sidebar action link navigates to registered screen on click", () => {
        const { Engine, document, state } = bootGame();
        Engine.goto("Corridor");

        const sidebar = document.getElementById("story-caption");
        const memLink = sidebar.querySelector('[data-goto="Memory"]');
        assert.ok(memLink, "memory link should exist in sidebar");
        memLink.click();
        assert.strictEqual(state.screen, "Memory");
    });

    it("m key navigates to Memory from Corridor", () => {
        const { Engine, state, window } = bootGame();
        assert.strictEqual(state.screen, "Corridor");

        window.document.dispatchEvent(
            new window.KeyboardEvent("keydown", { key: "m", bubbles: true })
        );
        assert.strictEqual(state.screen, "Memory");
    });

    it("registered actions all appear in sidebar", () => {
        const { Engine, document } = bootGame();
        Engine.goto("Corridor");
        const sidebarHtml = document.getElementById("story-caption").innerHTML;

        for (const action of Engine._sidebarActions) {
            assert.ok(sidebarHtml.includes(action.label),
                "sidebar should include label: " + action.label);
            assert.ok(sidebarHtml.includes(action.key),
                "sidebar should include key: " + action.key);
        }
    });
});
