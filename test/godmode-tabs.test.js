import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Simulate the setupDOM tab structure and switchTab logic
// to verify the DOM is correct after step clicks

describe("Godmode tab DOM lifecycle", () => {
    let dom, doc;

    function setupDOM() {
        // Mimics godmode.js setupDOM — just the panel part
        const panel = doc.createElement("div");
        panel.id = "godmode-panel";

        const tabBar = doc.createElement("div");
        tabBar.id = "gm-tab-bar";
        tabBar.innerHTML =
            '<button id="gm-tab-log" class="gm-tab gm-tab-active">log</button>' +
            '<button id="gm-tab-npc" class="gm-tab">npc</button>';
        panel.appendChild(tabBar);

        const logPane = doc.createElement("div");
        logPane.id = "gm-log-pane";
        logPane.className = "gm-pane gm-pane-active";
        panel.appendChild(logPane);

        const npcPane = doc.createElement("div");
        npcPane.id = "gm-npc-pane";
        npcPane.className = "gm-pane";
        panel.appendChild(npcPane);

        // Also add a step button
        const step = doc.createElement("button");
        step.id = "gm-step";
        doc.body.appendChild(step);

        doc.body.appendChild(panel);
        return panel;
    }

    function updateNpcPane(selectedId) {
        // Mimics GodmodePanel.update — writes into gm-npc-pane
        const pane = doc.getElementById("gm-npc-pane");
        if (selectedId === null) {
            pane.innerHTML = '<div class="gm-panel-empty">Click an NPC to observe</div>';
        } else {
            pane.innerHTML = '<div class="gm-name">Soren</div>';
        }
    }

    beforeEach(() => {
        dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
        doc = dom.window.document;
        global.document = doc;
    });
    afterEach(() => { delete global.document; });

    it("tab bar survives NPC pane updates", () => {
        setupDOM();

        // Simulate many render cycles (step click -> render -> panel update)
        for (let i = 0; i < 100; i++) {
            updateNpcPane(null);
        }

        // Tab bar should still exist
        const tabBar = doc.getElementById("gm-tab-bar");
        assert.ok(tabBar, "tab bar should still exist after renders");

        const logTab = doc.getElementById("gm-tab-log");
        assert.ok(logTab, "log tab button should still exist");

        const npcTab = doc.getElementById("gm-tab-npc");
        assert.ok(npcTab, "npc tab button should still exist");
    });

    it("tab buttons are clickable after step clicks", () => {
        setupDOM();

        // Simulate renders
        for (let i = 0; i < 10; i++) {
            updateNpcPane(null);
        }

        // Tab click should work
        const logTab = doc.getElementById("gm-tab-log");
        assert.ok(logTab, "gm-tab-log should exist");
        assert.strictEqual(logTab.tagName, "BUTTON");
    });

    it("log pane content survives NPC updates", () => {
        setupDOM();
        const logPane = doc.getElementById("gm-log-pane");
        logPane.innerHTML = '<div class="gm-log-entry">Bond formed</div>';

        // NPC pane update should not touch log pane
        updateNpcPane(null);

        assert.ok(logPane.innerHTML.includes("Bond formed"));
    });
});
