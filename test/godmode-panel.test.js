import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { GodmodePanel } from "../src/js/godmode-panel.js";

function makeDOM() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
        <div id="godmode-panel">
            <div id="gm-tab-bar">
                <button id="gm-tab-log" class="gm-tab gm-tab-active">log</button>
                <button id="gm-tab-npc" class="gm-tab">npc</button>
                <button id="gm-tab-grp" class="gm-tab">grp</button>
            </div>
            <div id="gm-log-pane" class="gm-pane gm-pane-active"></div>
            <div id="gm-npc-pane" class="gm-pane"></div>
            <div id="gm-grp-pane" class="gm-pane"></div>
        </div>
    </body></html>`);
    global.document = dom.window.document;
    return dom;
}

function makeNpc(overrides) {
    return {
        id: 0, name: "Soren", side: 0, position: 10n, floor: 50n,
        disposition: "calm", alive: true, lucidity: 80, hope: 60,
        bonds: [], groupId: null,
        components: {
            psychology: { lucidity: 80, hope: 60 },
            personality: { temperament: 0.5, pace: 0.3, openness: 0.7, outlook: 0.6 },
        },
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
    afterEach(() => { delete global.document; });

    it("shows NPC list when no one is selected", () => {
        GodmodePanel.update(makeSnap(), null, true);
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
        GodmodePanel.update(snap, null, true);
        const rows = document.querySelectorAll(".gm-npc-row");
        assert.strictEqual(rows.length, 3);
    });

    it("shows mini bars for lucidity and hope", () => {
        GodmodePanel.update(makeSnap(), null, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("gm-mini-bar"));
        assert.ok(pane.innerHTML.includes("luc"));
        assert.ok(pane.innerHTML.includes("hope"));
    });

    it("shows location for each NPC", () => {
        GodmodePanel.update(makeSnap(), null, true);
        const loc = document.querySelector(".gm-npc-row-loc");
        assert.ok(loc);
        assert.ok(loc.textContent.includes("W"));
        assert.ok(loc.textContent.includes("f50"));
    });

    it("dead NPCs are marked", () => {
        GodmodePanel.update(makeSnap([makeNpc({ alive: false })]), null, true);
        assert.ok(document.querySelector(".gm-npc-row-dead"));
    });

    it("sorts: mad first, dead last", () => {
        const snap = makeSnap([
            makeNpc({ id: 0, name: "Calm", disposition: "calm" }),
            makeNpc({ id: 1, name: "Mad", disposition: "mad" }),
            makeNpc({ id: 2, name: "Dead", disposition: "calm", alive: false }),
        ]);
        GodmodePanel.update(snap, null, true);
        const names = [...document.querySelectorAll(".gm-npc-row-name")].map(el => el.textContent);
        assert.strictEqual(names[0], "Mad");
        assert.strictEqual(names[2], "Dead");
    });

    it("fires onSelect callback when row clicked", () => {
        let selected = null;
        GodmodePanel.init({ onSelect: (id) => { selected = id; } });
        GodmodePanel.update(makeSnap(), null, true);
        const row = document.querySelector(".gm-npc-row");
        row.click();
        assert.strictEqual(selected, 0);
    });

    it("fires onCenter callback when location clicked", () => {
        let centered = null;
        GodmodePanel.init({ onCenter: (id) => { centered = id; } });
        GodmodePanel.update(makeSnap(), null, true);
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
    afterEach(() => { delete global.document; });

    it("shows detail view when NPC selected", () => {
        GodmodePanel.update(makeSnap(), 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.querySelector(".gm-interior"));
        assert.ok(pane.innerHTML.includes("Soren"));
    });

    it("shows back button", () => {
        GodmodePanel.update(makeSnap(), 0, true);
        assert.ok(document.getElementById("gm-npc-back"));
    });

    it("fires onDeselect when back clicked", () => {
        let deselected = false;
        GodmodePanel.init({ onDeselect: () => { deselected = true; } });
        GodmodePanel.update(makeSnap(), 0, true);
        document.getElementById("gm-npc-back").click();
        assert.ok(deselected);
    });

    it("shows psychology bars", () => {
        GodmodePanel.update(makeSnap(), 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("lucidity"));
        assert.ok(pane.innerHTML.includes("hope"));
    });

    it("shows personality traits", () => {
        GodmodePanel.update(makeSnap(), 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("openness"));
        assert.ok(pane.innerHTML.includes("temperament"));
    });

    it("shows bonds", () => {
        const bonds = [{ name: "Rachel", familiarity: 5, affinity: 3 }];
        const snap = makeSnap([makeNpc({
            bonds,
            components: {
                psychology: { lucidity: 80, hope: 60 },
                relationships: { bonds },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("Rachel"));
    });

    it("auto-renders unknown ECS components via fallback", () => {
        const snap = makeSnap([makeNpc({
            components: {
                psychology: { lucidity: 80, hope: 60 },
                mysticism: { aura: 0.42, alignment: "chaotic" },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("mysticism"), "section title");
        assert.ok(pane.innerHTML.includes("aura"), "numeric field");
        assert.ok(pane.innerHTML.includes("chaotic"), "string field");
    });

    it("shows clickable location", () => {
        let centered = null;
        GodmodePanel.init({ onCenter: (id) => { centered = id; } });
        GodmodePanel.update(makeSnap(), 0, true);
        const loc = document.querySelector(".gm-loc-link");
        assert.ok(loc);
        loc.click();
        assert.strictEqual(centered, 0);
    });
});

describe("GodmodePanel — Knowledge section", () => {
    beforeEach(() => {
        makeDOM();
        GodmodePanel.init({});
    });
    afterEach(() => { delete global.document; });

    it("shows searched segment count with map button", () => {
        const snap = makeSnap([makeNpc({
            components: {
                psychology: { lucidity: 80, hope: 60 },
                knowledge: {
                    lifeStory: { bookCoords: { side: 0, position: 20n, floor: 60n, bookIndex: 42 } },
                    bookVision: null, visionAccurate: true, hasBook: false,
                    searchedSegments: ["0:10:50", "0:11:50", "0:12:50"],
                    bestScore: 0, bestWords: [],
                },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("3 segments"), "should show segment count");
        assert.ok(pane.querySelector(".gm-search-map-btn"), "should have map button");
    });

    it("hides searched row when no segments searched", () => {
        const snap = makeSnap([makeNpc({
            components: {
                psychology: { lucidity: 80, hope: 60 },
                knowledge: {
                    lifeStory: { bookCoords: { side: 0, position: 20n, floor: 60n, bookIndex: 42 } },
                    bookVision: null, visionAccurate: true, hasBook: false,
                    searchedSegments: [],
                    bestScore: 0, bestWords: [],
                },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(!pane.innerHTML.includes("segment"), "should not show segment count");
        assert.ok(!pane.querySelector(".gm-search-map-btn"), "should not have map button");
    });

    it("shows lifetime best find with words", () => {
        const snap = makeSnap([makeNpc({
            components: {
                psychology: { lucidity: 80, hope: 60 },
                knowledge: {
                    lifeStory: { bookCoords: { side: 0, position: 20n, floor: 60n, bookIndex: 42 } },
                    bookVision: null, visionAccurate: true, hasBook: false,
                    searchedSegments: ["0:10:50"],
                    bestScore: 3, bestWords: ["hope", "fire", "dark"],
                },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("best find"), "should show best find label");
        assert.ok(pane.innerHTML.includes("hope fire dark"), "should show actual words");
    });

    it("hides best find when bestScore is 0", () => {
        const snap = makeSnap([makeNpc({
            components: {
                psychology: { lucidity: 80, hope: 60 },
                knowledge: {
                    lifeStory: { bookCoords: { side: 0, position: 20n, floor: 60n, bookIndex: 42 } },
                    bookVision: null, visionAccurate: true, hasBook: false,
                    searchedSegments: [],
                    bestScore: 0, bestWords: [],
                },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(!pane.innerHTML.includes("best find"), "should not show best find");
    });
});

describe("GodmodePanel — Searching section", () => {
    beforeEach(() => {
        makeDOM();
        GodmodePanel.init({});
    });
    afterEach(() => { delete global.document; });

    it("shows searching section when actively reading", () => {
        const snap = makeSnap([makeNpc({
            components: {
                psychology: { lucidity: 80, hope: 60 },
                searching: { active: true, bookIndex: 42, ticksSearched: 3, patience: 10, bestScore: 0, bestWords: [] },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(pane.innerHTML.includes("reading book 42"), "should show active book index");
    });

    it("hides searching section when not active", () => {
        const snap = makeSnap([makeNpc({
            components: {
                psychology: { lucidity: 80, hope: 60 },
                searching: { active: false, bookIndex: 0, ticksSearched: 0, patience: 10, bestScore: 2, bestWords: ["hope", "fire"] },
            },
        })]);
        GodmodePanel.update(snap, 0, true);
        const pane = document.getElementById("gm-npc-pane");
        assert.ok(!pane.innerHTML.includes("reading book"), "should not show searching when inactive");
        // Best find should NOT be in searching section (it's in knowledge now)
        assert.ok(!pane.innerHTML.includes("hope fire"), "searching section should not show best find");
    });
});

// Helper: NPC with a knowledge component containing a life story
function makeNpcWithKnowledge(storyText, bookCoords, npcOverrides) {
    const bc = bookCoords || { side: 0, position: 100n, floor: 5n, bookIndex: 3 };
    return makeNpc({
        ...npcOverrides,
        components: {
            psychology: { lucidity: 80, hope: 60 },
            personality: { temperament: 0.5, pace: 0.3, openness: 0.7, outlook: 0.6 },
            knowledge: {
                lifeStory: {
                    name: "Test NPC",
                    storyText: storyText,
                    bookCoords: bc,
                },
                bookVision: null,
                visionAccurate: false,
                hasBook: false,
            },
        },
    });
}

describe("GodmodePanel — Damnation", () => {
    beforeEach(() => {
        makeDOM();
        GodmodePanel.init({});
    });
    afterEach(() => { delete global.document; });

    it("shows [?] button when NPC has knowledge component", () => {
        const npc = makeNpcWithKnowledge("Short text.");
        GodmodePanel.update(makeSnap([npc]), 0, true);
        const btn = document.querySelector(".gm-calc-dist");
        assert.ok(btn, "should have [?] button");
        assert.strictEqual(btn.textContent, "[?]");
    });

    it("clicking [?] with damned NPC shows DAMNED message", () => {
        const prose = "Your name was Rosa Ingram. You were a librarian, from Portland. You died of heart failure. Before you died, you were thinking about the garden.";
        const npc = makeNpcWithKnowledge(prose);
        GodmodePanel.update(makeSnap([npc]), 0, true);
        const btn = document.querySelector(".gm-calc-dist");
        btn.click();
        assert.ok(btn.textContent.includes("DAMNED"), `expected DAMNED, got: ${btn.textContent}`);
        assert.ok(btn.textContent.includes("edge"));
    });

    it("clicking [?] with in-bounds NPC shows distance in moves", () => {
        const shortText = "You were born.";
        const bc = { side: 0, position: 200n, floor: 10n, bookIndex: 0 };
        const npc = makeNpcWithKnowledge(shortText, bc, { side: 0, position: 100n, floor: 5n });
        GodmodePanel.update(makeSnap([npc]), 0, true);
        const btn = document.querySelector(".gm-calc-dist");
        btn.click();
        assert.ok(btn.textContent.includes("moves"), `expected moves, got: ${btn.textContent}`);
        assert.ok(!btn.textContent.includes("DAMNED"));
    });

    it("in-bounds distance is correct arithmetic", () => {
        const shortText = "You were born.";
        const bc = { side: 0, position: 200n, floor: 10n, bookIndex: 0 };
        const npc = makeNpcWithKnowledge(shortText, bc, { side: 0, position: 100n, floor: 5n });
        GodmodePanel.update(makeSnap([npc]), 0, true);
        const btn = document.querySelector(".gm-calc-dist");
        btn.click();
        assert.ok(btn.textContent.includes("105"), `expected 105, got: ${btn.textContent}`);
    });

    it("[?] becomes non-clickable after calculation", () => {
        const prose = "Your name was Rosa Ingram. You were a librarian, from Portland. You died of heart failure.";
        const npc = makeNpcWithKnowledge(prose);
        GodmodePanel.update(makeSnap([npc]), 0, true);
        const btn = document.querySelector(".gm-calc-dist");
        btn.click();
        assert.strictEqual(btn.style.cursor, "default");
    });
});

describe("GodmodePanel — Groups tab", () => {
    beforeEach(() => {
        makeDOM();
        GodmodePanel.init({});
    });
    afterEach(() => { delete global.document; });

    it("shows empty message when no groups exist", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: null }),
        ]));
        const pane = document.getElementById("gm-grp-pane");
        assert.ok(pane.innerHTML.includes("No groups yet"));
    });

    it("shows group card when NPCs share a groupId", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: 1 }),
            makeNpc({ id: 1, name: "Rachel", groupId: 1 }),
        ]));
        const pane = document.getElementById("gm-grp-pane");
        assert.ok(pane.querySelector(".gm-grp-card"), "has group card");
        assert.ok(pane.innerHTML.includes("Soren"));
        assert.ok(pane.innerHTML.includes("Rachel"));
        assert.ok(pane.innerHTML.includes("2 members"));
    });

    it("shows multiple groups separately", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: 1 }),
            makeNpc({ id: 1, name: "Rachel", groupId: 1 }),
            makeNpc({ id: 2, name: "Omar", groupId: 2 }),
            makeNpc({ id: 3, name: "Leila", groupId: 2 }),
        ]));
        const cards = document.querySelectorAll(".gm-grp-card");
        assert.strictEqual(cards.length, 2);
    });

    it("excludes NPCs with null groupId", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: 1 }),
            makeNpc({ id: 1, name: "Rachel", groupId: 1 }),
            makeNpc({ id: 2, name: "Loner", groupId: null }),
        ]));
        const pane = document.getElementById("gm-grp-pane");
        assert.ok(!pane.innerHTML.includes("Loner"));
    });

    it("shows location for group", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: 1, side: 0, floor: 50n, position: 10n }),
            makeNpc({ id: 1, name: "Rachel", groupId: 1, side: 0, floor: 50n, position: 10n }),
        ]));
        const loc = document.querySelector(".gm-grp-loc");
        assert.ok(loc);
        assert.ok(loc.textContent.includes("W"));
        assert.ok(loc.textContent.includes("f50"));
    });

    it("marks dead members", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: 1, alive: true }),
            makeNpc({ id: 1, name: "Rachel", groupId: 1, alive: false }),
        ]));
        const pane = document.getElementById("gm-grp-pane");
        assert.ok(pane.innerHTML.includes("dead"));
    });

    it("members have data-npc-id for click targeting", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 7, name: "Soren", groupId: 1 }),
            makeNpc({ id: 8, name: "Rachel", groupId: 1 }),
        ]));
        const members = document.querySelectorAll(".gm-grp-member");
        assert.strictEqual(members.length, 2);
        const ids = [...members].map(m => m.getAttribute("data-npc-id"));
        assert.ok(ids.includes("7"));
        assert.ok(ids.includes("8"));
    });

    it("returns to empty when groups dissolve", () => {
        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: 1 }),
            makeNpc({ id: 1, name: "Rachel", groupId: 1 }),
        ]));
        assert.ok(document.querySelector(".gm-grp-card"));

        GodmodePanel.updateGroups(makeSnap([
            makeNpc({ id: 0, name: "Soren", groupId: null }),
            makeNpc({ id: 1, name: "Rachel", groupId: null }),
        ]));
        const pane = document.getElementById("gm-grp-pane");
        assert.ok(pane.innerHTML.includes("No groups yet"));
        assert.ok(!pane.querySelector(".gm-grp-card"));
    });
});
