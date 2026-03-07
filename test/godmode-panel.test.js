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
            <div id="gm-npc-pane" class="gm-pane"></div>
        </div>
    </body></html>`);
    global.document = dom.window.document;
    return dom;
}

function makeNpc(overrides) {
    return {
        id: 0, name: "Soren", side: 0, position: 10, floor: 50,
        disposition: "calm", alive: true, lucidity: 80, hope: 60,
        personality: { openness: 0.7, agreeableness: 0.5, resilience: 0.3, sociability: 0.8, curiosity: 0.6 },
        bonds: [], groupId: null,
        ...overrides,
    };
}

function makeSnap(npcs) {
    return { day: 1, tick: 50, lightsOn: true, npcs: npcs || [makeNpc()] };
}

describe("GodmodePanel — NPC list", () => {
    beforeEach(() => {
        makeDOM();
        GodmodePanel.init({});
    });

    it("shows NPC list when no one is selected", () => {
        GodmodePanel.update(makeSnap(), null);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.querySelector(".gm-npc-list"));
        assert.ok(pane.innerHTML.includes("Soren"));
    });

    it("lists all NPCs", () => {
        const snap = makeSnap([
            makeNpc({ id: 0, name: "Soren" }),
            makeNpc({ id: 1, name: "Rachel" }),
            makeNpc({ id: 2, name: "Omar" }),
        ]);
        GodmodePanel.update(snap, null);
        const rows = document.querySelectorAll(".gm-npc-row");
        assert.strictEqual(rows.length, 3);
    });

    it("shows mini bars for lucidity and hope", () => {
        GodmodePanel.update(makeSnap(), null);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("gm-mini-bar"));
        assert.ok(pane.innerHTML.includes("luc"));
        assert.ok(pane.innerHTML.includes("hope"));
    });

    it("shows location for each NPC", () => {
        GodmodePanel.update(makeSnap(), null);
        const loc = document.querySelector(".gm-npc-row-loc");
        assert.ok(loc);
        assert.ok(loc.textContent.includes("W"));
        assert.ok(loc.textContent.includes("f50"));
    });

    it("dead NPCs are marked", () => {
        GodmodePanel.update(makeSnap([makeNpc({ alive: false })]), null);
        assert.ok(document.querySelector(".gm-npc-row-dead"));
    });

    it("sorts: mad first, dead last", () => {
        const snap = makeSnap([
            makeNpc({ id: 0, name: "Calm", disposition: "calm" }),
            makeNpc({ id: 1, name: "Mad", disposition: "mad" }),
            makeNpc({ id: 2, name: "Dead", disposition: "calm", alive: false }),
        ]);
        GodmodePanel.update(snap, null);
        const names = [...document.querySelectorAll(".gm-npc-row-name")].map(el => el.textContent);
        assert.strictEqual(names[0], "Mad");
        assert.strictEqual(names[2], "Dead");
    });

    it("fires onSelect callback when row clicked", () => {
        let selected = null;
        GodmodePanel.init({ onSelect: (id) => { selected = id; } });
        GodmodePanel.update(makeSnap(), null);
        const row = document.querySelector(".gm-npc-row");
        row.click();
        assert.strictEqual(selected, 0);
    });

    it("fires onCenter callback when location clicked", () => {
        let centered = null;
        GodmodePanel.init({ onCenter: (id) => { centered = id; } });
        GodmodePanel.update(makeSnap(), null);
        const loc = document.querySelector(".gm-npc-row-loc");
        loc.click();
        assert.strictEqual(centered, 0);
    });
});

describe("GodmodePanel — NPC detail", () => {
    beforeEach(() => {
        makeDOM();
        GodmodePanel.init({});
    });

    it("shows detail view when NPC selected", () => {
        GodmodePanel.update(makeSnap(), 0);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.querySelector(".gm-interior"));
        assert.ok(pane.innerHTML.includes("Soren"));
    });

    it("shows back button", () => {
        GodmodePanel.update(makeSnap(), 0);
        assert.ok(document.getElementById("gm-npc-back"));
    });

    it("fires onDeselect when back clicked", () => {
        let deselected = false;
        GodmodePanel.init({ onDeselect: () => { deselected = true; } });
        GodmodePanel.update(makeSnap(), 0);
        document.getElementById("gm-npc-back").click();
        assert.ok(deselected);
    });

    it("shows psychology bars", () => {
        GodmodePanel.update(makeSnap(), 0);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("lucidity"));
        assert.ok(pane.innerHTML.includes("hope"));
    });

    it("shows personality traits", () => {
        GodmodePanel.update(makeSnap(), 0);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("openness"));
        assert.ok(pane.innerHTML.includes("sociability"));
    });

    it("shows bonds", () => {
        const snap = makeSnap([makeNpc({
            bonds: [{ name: "Rachel", familiarity: 5, affinity: 3 }],
        })]);
        GodmodePanel.update(snap, 0);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("Rachel"));
    });

    it("shows clickable location", () => {
        let centered = null;
        GodmodePanel.init({ onCenter: (id) => { centered = id; } });
        GodmodePanel.update(makeSnap(), 0);
        const loc = document.querySelector(".gm-loc-link");
        assert.ok(loc);
        loc.click();
        assert.strictEqual(centered, 0);
    });
});
