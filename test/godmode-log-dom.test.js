/**
 * DOM integration tests for godmode log filters.
 * Uses jsdom + the REAL GodmodeLog.renderTo / wireFilterClicks code paths.
 *
 * wireFilterClicks uses mousedown (not click) because the render loop
 * replaces innerHTML every frame — a click event won't fire if the
 * target button is destroyed between mousedown and mouseup.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { GodmodeLog, LOG_FILTER_LABELS } from "../src/js/godmode-log.js";

let win; // set in beforeEach, used by helpers

function getVisibleEntries(pane) {
    return Array.from(pane.querySelectorAll(".gm-log-entry"));
}

function getFilterButton(pane, type) {
    return pane.querySelector('[data-filter="' + type + '"]');
}

function isFilterActive(pane, type) {
    const btn = getFilterButton(pane, type);
    return btn && btn.classList.contains("gm-log-filter-on");
}

/** Dispatch a mousedown on a filter button (matches wireFilterClicks). */
function clickFilter(pane, type) {
    const btn = getFilterButton(pane, type);
    btn.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
}

describe("godmode log DOM integration (real code path)", () => {
    let document, pane;

    beforeEach(() => {
        GodmodeLog.init();
        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
        win = dom.window;
        document = dom.window.document;
        pane = document.createElement("div");
        pane.id = "gm-log-pane";
        document.body.appendChild(pane);
        GodmodeLog.wireFilterClicks(pane);
    });

    it("renderTo produces filter buttons for all types", () => {
        GodmodeLog.renderTo(pane);
        const btns = pane.querySelectorAll("[data-filter]");
        assert.strictEqual(btns.length, Object.keys(LOG_FILTER_LABELS).length);
    });

    it("search filter starts inactive, others active", () => {
        GodmodeLog.renderTo(pane);
        assert.strictEqual(isFilterActive(pane, "search"), false);
        assert.strictEqual(isFilterActive(pane, "bond"), true);
        assert.strictEqual(isFilterActive(pane, "death"), true);
    });

    it("mousedown on filter button toggles it off and hides entries", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.renderTo(pane);

        assert.strictEqual(getVisibleEntries(pane).length, 2);
        assert.strictEqual(isFilterActive(pane, "bond"), true);

        clickFilter(pane, "bond");

        assert.strictEqual(isFilterActive(pane, "bond"), false);
        const entries = getVisibleEntries(pane);
        assert.strictEqual(entries.length, 1);
        assert.ok(entries[0].textContent.includes("C died"));
    });

    it("two toggles restore original state", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);

        clickFilter(pane, "bond"); // off
        assert.strictEqual(getVisibleEntries(pane).length, 0);

        clickFilter(pane, "bond"); // on
        assert.strictEqual(getVisibleEntries(pane).length, 1);
    });

    it("enabling search filter shows search entries", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "search", text: "searching." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.renderTo(pane);

        assert.strictEqual(getVisibleEntries(pane).length, 1);
        clickFilter(pane, "search");
        assert.strictEqual(getVisibleEntries(pane).length, 2);
    });

    it("filter state survives external re-render (render loop)", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.renderTo(pane);

        clickFilter(pane, "bond");
        assert.strictEqual(getVisibleEntries(pane).length, 1);

        // Simulate render loop calling renderTo again
        GodmodeLog.renderTo(pane);
        assert.strictEqual(getVisibleEntries(pane).length, 1, "still filtered after re-render");
        assert.strictEqual(isFilterActive(pane, "bond"), false);
    });

    it("innerHTML replacement does not break subsequent mousedown", () => {
        // This is the exact bug scenario: render loop replaces innerHTML,
        // then user clicks a filter button. mousedown should still work
        // because delegation is on the parent, not the destroyed button.
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.renderTo(pane);

        // Simulate multiple render loop cycles (replacing innerHTML)
        GodmodeLog.renderTo(pane);
        GodmodeLog.renderTo(pane);
        GodmodeLog.renderTo(pane);

        // Now click — should still work
        clickFilter(pane, "bond");
        assert.strictEqual(isFilterActive(pane, "bond"), false);
        assert.strictEqual(getVisibleEntries(pane).length, 1);
    });

    it("multiple filters toggled independently", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.push({ tick: 3, day: 1, type: "group", text: "formed a group." });
        GodmodeLog.renderTo(pane);

        clickFilter(pane, "bond");
        assert.strictEqual(getVisibleEntries(pane).length, 2);

        clickFilter(pane, "death");
        assert.strictEqual(getVisibleEntries(pane).length, 1);
        assert.ok(getVisibleEntries(pane)[0].textContent.includes("formed a group"));
    });

    it("mousedown on log entry does not toggle anything", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);

        const entry = pane.querySelector(".gm-log-entry");
        entry.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
        assert.strictEqual(isFilterActive(pane, "bond"), true);
        assert.strictEqual(getVisibleEntries(pane).length, 1);
    });

    it("mousedown on tag span inside entry does not toggle", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);

        const tag = pane.querySelector(".gm-log-tag");
        tag.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
        assert.strictEqual(isFilterActive(pane, "bond"), true);
    });

    it("new events respect existing filters", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);
        clickFilter(pane, "bond");

        GodmodeLog.push({ tick: 2, day: 1, type: "bond", text: "C met D." });
        GodmodeLog.renderTo(pane);
        assert.strictEqual(getVisibleEntries(pane).length, 0);
    });

    it("empty log shows message", () => {
        GodmodeLog.renderTo(pane);
        assert.ok(pane.querySelector(".gm-log-empty"));
    });

    it("all filters off shows empty message", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);
        clickFilter(pane, "bond");
        assert.ok(pane.querySelector(".gm-log-empty"));
    });
});
