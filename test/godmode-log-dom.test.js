/**
 * DOM integration tests for godmode log filters.
 * Uses jsdom + the REAL GodmodeLog.renderTo / wireFilterClicks code paths.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { GodmodeLog, LOG_FILTER_LABELS } from "../src/js/godmode-log.js";

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

describe("godmode log DOM integration (real code path)", () => {
    let dom, document, pane;

    beforeEach(() => {
        GodmodeLog.init();
        dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
        document = dom.window.document;
        pane = document.createElement("div");
        pane.id = "gm-log-pane";
        document.body.appendChild(pane);

        // Wire the REAL click handler from GodmodeLog
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

    it("clicking filter button toggles it off and hides entries", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.renderTo(pane);

        assert.strictEqual(getVisibleEntries(pane).length, 2);
        assert.strictEqual(isFilterActive(pane, "bond"), true);

        // Click bond filter button
        getFilterButton(pane, "bond").click();

        assert.strictEqual(isFilterActive(pane, "bond"), false);
        const entries = getVisibleEntries(pane);
        assert.strictEqual(entries.length, 1);
        assert.ok(entries[0].textContent.includes("C died"));
    });

    it("clicking filter button twice restores original state", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);

        getFilterButton(pane, "bond").click(); // off
        assert.strictEqual(getVisibleEntries(pane).length, 0);

        getFilterButton(pane, "bond").click(); // on
        assert.strictEqual(getVisibleEntries(pane).length, 1);
    });

    it("clicking search filter enables it and shows search entries", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "search", text: "searching." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.renderTo(pane);

        assert.strictEqual(getVisibleEntries(pane).length, 1); // search hidden
        getFilterButton(pane, "search").click();
        assert.strictEqual(getVisibleEntries(pane).length, 2);
    });

    it("filter state survives external re-render", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.renderTo(pane);

        getFilterButton(pane, "bond").click(); // toggle off
        assert.strictEqual(getVisibleEntries(pane).length, 1);

        // Simulate the render loop calling renderTo again
        GodmodeLog.renderTo(pane);
        assert.strictEqual(getVisibleEntries(pane).length, 1, "still filtered after re-render");
        assert.strictEqual(isFilterActive(pane, "bond"), false);
    });

    it("multiple filters toggled independently", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.push({ tick: 2, day: 1, type: "death", text: "C died." });
        GodmodeLog.push({ tick: 3, day: 1, type: "group", text: "formed a group." });
        GodmodeLog.renderTo(pane);
        assert.strictEqual(getVisibleEntries(pane).length, 3);

        getFilterButton(pane, "bond").click();
        assert.strictEqual(getVisibleEntries(pane).length, 2);

        getFilterButton(pane, "death").click();
        assert.strictEqual(getVisibleEntries(pane).length, 1);
        assert.ok(getVisibleEntries(pane)[0].textContent.includes("formed a group"));
    });

    it("clicking a log entry does not toggle anything", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);

        pane.querySelector(".gm-log-entry").click();
        assert.strictEqual(isFilterActive(pane, "bond"), true);
        assert.strictEqual(getVisibleEntries(pane).length, 1);
    });

    it("clicking the tag span inside an entry does not toggle", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);

        pane.querySelector(".gm-log-tag").click();
        assert.strictEqual(isFilterActive(pane, "bond"), true);
    });

    it("new events respect existing filters", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);
        getFilterButton(pane, "bond").click();

        GodmodeLog.push({ tick: 2, day: 1, type: "bond", text: "C met D." });
        GodmodeLog.renderTo(pane);
        assert.strictEqual(getVisibleEntries(pane).length, 0);
    });

    it("empty log shows 'No events yet' message", () => {
        GodmodeLog.renderTo(pane);
        assert.ok(pane.querySelector(".gm-log-empty"));
        assert.ok(pane.textContent.includes("No events"));
    });

    it("all filters off shows empty message", () => {
        GodmodeLog.push({ tick: 1, day: 1, type: "bond", text: "A met B." });
        GodmodeLog.renderTo(pane);
        getFilterButton(pane, "bond").click();
        assert.ok(pane.querySelector(".gm-log-empty"));
    });
});
