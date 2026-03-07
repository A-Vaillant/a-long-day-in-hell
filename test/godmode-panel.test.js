import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { GodmodePanel } from "../src/js/godmode-panel.js";

function makeDOM() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="godmode-panel">
            <div id="gm-tab-bar">
                <button id="gm-tab-log" class="gm-tab gm-tab-active">log</button>
                <button id="gm-tab-npc" class="gm-tab">npc</button>
            </div>
            <div id="gm-log-pane" class="gm-pane gm-pane-active"></div>
            <div id="gm-npc-pane" class="gm-pane">
                <div class="gm-panel-empty">Click an NPC to observe</div>
            </div>
        </div>
    </body></html>`);
    global.document = dom.window.document;
    return dom;
}

function makeSnap(overrides) {
    return {
        day: 1, tick: 50, lightsOn: true,
        npcs: [{
            id: 0, name: "Soren", side: 0, position: 10, floor: 50,
            disposition: "calm", alive: true, lucidity: 80, hope: 60,
            personality: { openness: 0.7, agreeableness: 0.5, resilience: 0.3, sociability: 0.8, curiosity: 0.6 },
            bonds: [], groupId: null,
            ...overrides,
        }],
    };
}

describe("GodmodePanel (tabbed)", () => {
    let dom;

    beforeEach(() => {
        dom = makeDOM();
        GodmodePanel.init();
    });

    it("tab bar exists with two tabs", () => {
        const tabs = document.querySelectorAll(".gm-tab");
        assert.strictEqual(tabs.length, 2);
        assert.strictEqual(tabs[0].textContent, "log");
        assert.strictEqual(tabs[1].textContent, "npc");
    });

    it("log pane starts active", () => {
        const logPane = document.getElementById("gm-log-pane");
        assert.ok(logPane.className.includes("gm-pane-active"));
    });

    it("npc pane starts inactive", () => {
        const npcPane = document.getElementById("gm-npc-pane");
        assert.ok(!npcPane.className.includes("gm-pane-active"));
    });

    it("update writes NPC data to npc pane, not log pane", () => {
        const snap = makeSnap();
        GodmodePanel.update(snap, 0);

        const npcPane = document.getElementById("gm-npc-pane");
        assert.ok(npcPane.innerHTML.includes("Soren"));

        const logPane = document.getElementById("gm-log-pane");
        assert.ok(!logPane.innerHTML.includes("Soren"));
    });

    it("update with null selectedId shows empty message in npc pane", () => {
        GodmodePanel.update(makeSnap(), null);
        const npcPane = document.getElementById("gm-npc-pane");
        assert.ok(npcPane.innerHTML.includes("Click an NPC to observe"));
    });

    it("shows disposition", () => {
        GodmodePanel.update(makeSnap({ disposition: "anxious" }), 0);
        const npcPane = document.getElementById("gm-npc-pane");
        assert.ok(npcPane.innerHTML.includes("anxious"));
        assert.ok(npcPane.innerHTML.includes("gm-disp-anxious"));
    });

    it("shows bonds when present", () => {
        const snap = makeSnap({
            bonds: [{ name: "Rachel", familiarity: 5, affinity: 3 }],
        });
        GodmodePanel.update(snap, 0);
        const npcPane = document.getElementById("gm-npc-pane");
        assert.ok(npcPane.innerHTML.includes("Rachel"));
        assert.ok(npcPane.innerHTML.includes("fam 5"));
    });

    it("shows dead tag when not alive", () => {
        GodmodePanel.update(makeSnap({ alive: false }), 0);
        const npcPane = document.getElementById("gm-npc-pane");
        assert.ok(npcPane.innerHTML.includes("gm-dead-tag"));
    });

    it("shows group members", () => {
        const snap = {
            day: 1, tick: 50, lightsOn: true,
            npcs: [
                { id: 0, name: "Soren", side: 0, position: 10, floor: 50, disposition: "calm", alive: true, lucidity: 80, hope: 60, personality: null, bonds: [], groupId: 1 },
                { id: 1, name: "Rachel", side: 0, position: 10, floor: 50, disposition: "calm", alive: true, lucidity: 90, hope: 70, personality: null, bonds: [], groupId: 1 },
            ],
        };
        GodmodePanel.update(snap, 0);
        const npcPane = document.getElementById("gm-npc-pane");
        assert.ok(npcPane.innerHTML.includes("Rachel"));
        assert.ok(npcPane.innerHTML.includes("gm-group-member"));
    });
});
