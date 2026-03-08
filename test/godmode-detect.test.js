import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { detectEvents, resetDetectState } from "../src/js/godmode-detect.js";

function makeNpc(overrides) {
    return {
        id: 0, name: "Alice", side: 0, position: 0, floor: 100,
        disposition: "calm", alive: true, lucidity: 100, hope: 100,
        personality: null, bonds: [], groupId: null, falling: null,
        free: false, components: {},
        ...overrides,
    };
}

function makeSnap(npcs, overrides) {
    return { npcs, day: 1, tick: 10, lightsOn: true, ...overrides };
}

describe("detectEvents", () => {
    beforeEach(() => resetDetectState());

    it("returns empty for identical snapshots", () => {
        const npc = makeNpc();
        const snap = makeSnap([npc]);
        const events = detectEvents(snap, snap);
        assert.strictEqual(events.length, 0);
    });

    it("returns empty for null inputs", () => {
        assert.deepStrictEqual(detectEvents(null, null), []);
        assert.deepStrictEqual(detectEvents(null, makeSnap([])), []);
        assert.deepStrictEqual(detectEvents(makeSnap([]), null), []);
    });

    it("detects death", () => {
        const prev = makeSnap([makeNpc({ alive: true })]);
        const curr = makeSnap([makeNpc({ alive: false })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "death");
        assert.ok(events[0].text.includes("Alice"));
        assert.ok(events[0].text.includes("died"));
    });

    it("detects resurrection", () => {
        const prev = makeSnap([makeNpc({ alive: false })]);
        const curr = makeSnap([makeNpc({ alive: true })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "resurrection");
        assert.ok(events[0].text.includes("dawn"));
    });

    it("detects disposition change", () => {
        const prev = makeSnap([makeNpc({ disposition: "calm" })]);
        const curr = makeSnap([makeNpc({ disposition: "anxious" })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "disposition");
        assert.ok(events[0].text.includes("anxious"));
    });

    it("does not emit disposition change for dead NPCs", () => {
        const prev = makeSnap([makeNpc({ disposition: "calm", alive: false })]);
        const curr = makeSnap([makeNpc({ disposition: "dead", alive: false })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 0);
    });

    it("detects new bond (familiarity crosses 1.0)", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", bonds: [] }),
            makeNpc({ id: 1, name: "Bob", bonds: [] }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", bonds: [{ name: "Bob", familiarity: 1.5, affinity: 0.5 }] }),
            makeNpc({ id: 1, name: "Bob", bonds: [{ name: "Alice", familiarity: 1.5, affinity: 0.5 }] }),
        ]);
        const events = detectEvents(prev, curr);
        // Only one event (alphabetically first emits)
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "bond");
        assert.ok(events[0].text.includes("Alice"));
        assert.ok(events[0].text.includes("Bob"));
    });

    it("does not duplicate bond event for reverse pair", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Zara", bonds: [] }),
            makeNpc({ id: 1, name: "Amy", bonds: [] }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Zara", bonds: [{ name: "Amy", familiarity: 2, affinity: 1 }] }),
            makeNpc({ id: 1, name: "Amy", bonds: [{ name: "Zara", familiarity: 2, affinity: 1 }] }),
        ]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.ok(events[0].text.startsWith("Amy"), "alphabetically first name emits");
    });

    it("does not emit bond for already-known NPC", () => {
        const existingBond = { name: "Bob", familiarity: 5, affinity: 2 };
        const prev = makeSnap([makeNpc({ bonds: [existingBond] })]);
        const curr = makeSnap([makeNpc({ bonds: [{ ...existingBond, familiarity: 6 }] })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 0);
    });

    it("detects group formation", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 7 }),
            makeNpc({ id: 1, name: "Bob", groupId: 7 }),
        ]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "group");
        assert.ok(events[0].text.includes("Alice"));
        assert.ok(events[0].text.includes("Bob"));
        assert.ok(events[0].text.includes("formed a group"));
    });

    it("does not duplicate group event (only lowest id emits)", () => {
        const prev = makeSnap([
            makeNpc({ id: 5, name: "Eve", groupId: null }),
            makeNpc({ id: 2, name: "Charlie", groupId: null }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 5, name: "Eve", groupId: 3 }),
            makeNpc({ id: 2, name: "Charlie", groupId: 3 }),
        ]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1, "exactly one group event");
    });

    it("handles multiple events in one tick", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", disposition: "calm", alive: true, bonds: [] }),
            makeNpc({ id: 1, name: "Bob", alive: true }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", disposition: "anxious", alive: true,
                bonds: [{ name: "Bob", familiarity: 2, affinity: 1 }] }),
            makeNpc({ id: 1, name: "Bob", alive: false }),
        ]);
        const events = detectEvents(prev, curr);
        const types = events.map(e => e.type);
        assert.ok(types.includes("disposition"), "has disposition event");
        assert.ok(types.includes("death"), "has death event");
        assert.ok(types.includes("bond"), "has bond event");
    });

    // --- Deduplication tests ---

    it("does not re-report bond when familiarity fluctuates", () => {
        const prev1 = makeSnap([makeNpc({ id: 0, name: "Alice", bonds: [] })]);
        const curr1 = makeSnap([makeNpc({ id: 0, name: "Alice",
            bonds: [{ name: "Bob", familiarity: 1.5, affinity: 0.5 }] })]);
        const events1 = detectEvents(prev1, curr1);
        assert.strictEqual(events1.length, 1);
        assert.strictEqual(events1[0].type, "bond");

        // Familiarity drops below 1 then comes back
        const prev2 = makeSnap([makeNpc({ id: 0, name: "Alice",
            bonds: [{ name: "Bob", familiarity: 0.8, affinity: 0.3 }] })]);
        const curr2 = makeSnap([makeNpc({ id: 0, name: "Alice",
            bonds: [{ name: "Bob", familiarity: 1.2, affinity: 0.5 }] })]);
        const events2 = detectEvents(prev2, curr2);
        const bondEvents = events2.filter(e => e.type === "bond");
        assert.strictEqual(bondEvents.length, 0, "bond should not re-fire");
    });

    it("does not re-report group when group IDs flicker", () => {
        const prev1 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
        ]);
        const curr1 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 5 }),
            makeNpc({ id: 1, name: "Bob", groupId: 5 }),
        ]);
        const events1 = detectEvents(prev1, curr1);
        assert.strictEqual(events1.length, 1);
        assert.strictEqual(events1[0].type, "group");

        // Group dissolves and reforms (flicker)
        const prev2 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
        ]);
        const curr2 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 9 }),
            makeNpc({ id: 1, name: "Bob", groupId: 9 }),
        ]);
        const events2 = detectEvents(prev2, curr2);
        const groupEvents = events2.filter(e => e.type === "group");
        assert.strictEqual(groupEvents.length, 0, "group should not re-fire for same members");
    });

    it("reports group with different members as new", () => {
        const prev1 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
            makeNpc({ id: 2, name: "Charlie", groupId: null }),
        ]);
        const curr1 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 5 }),
            makeNpc({ id: 1, name: "Bob", groupId: 5 }),
            makeNpc({ id: 2, name: "Charlie", groupId: null }),
        ]);
        detectEvents(prev1, curr1); // Alice+Bob group reported

        // Now Alice+Charlie form a group (different members)
        const prev2 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 2, name: "Charlie", groupId: null }),
        ]);
        const curr2 = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 3 }),
            makeNpc({ id: 2, name: "Charlie", groupId: 3 }),
        ]);
        const events2 = detectEvents(prev2, curr2);
        const groupEvents = events2.filter(e => e.type === "group");
        assert.strictEqual(groupEvents.length, 1, "new member combo should fire");
    });

    // --- Group dissolution ---

    it("detects group dissolution after formation was reported", () => {
        // First: form the group
        const before = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
        ]);
        const formed = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 5 }),
            makeNpc({ id: 1, name: "Bob", groupId: 5 }),
        ]);
        const formEvents = detectEvents(before, formed);
        assert.strictEqual(formEvents.filter(e => e.type === "group").length, 1, "formation reported");

        // Then: dissolve
        const dissolved = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
        ]);
        const events = detectEvents(formed, dissolved);
        const groupEvents = events.filter(e => e.type === "group");
        assert.strictEqual(groupEvents.length, 1);
        assert.ok(groupEvents[0].text.includes("broke apart"));
        assert.ok(groupEvents[0].text.includes("Alice"));
        assert.ok(groupEvents[0].text.includes("Bob"));
    });

    it("does not emit dissolution without prior formation", () => {
        // Group exists in prev but was never reported as formed
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: 5 }),
            makeNpc({ id: 1, name: "Bob", groupId: 5 }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", groupId: null }),
            makeNpc({ id: 1, name: "Bob", groupId: null }),
        ]);
        const events = detectEvents(prev, curr);
        const groupEvents = events.filter(e => e.type === "group" && e.text.includes("broke apart"));
        assert.strictEqual(groupEvents.length, 0, "no dissolution without prior formation");
    });

    it("does not duplicate dissolution (only lowest id emits)", () => {
        // Form first
        detectEvents(
            makeSnap([
                makeNpc({ id: 1, name: "Alice", groupId: null }),
                makeNpc({ id: 3, name: "Charlie", groupId: null }),
            ]),
            makeSnap([
                makeNpc({ id: 1, name: "Alice", groupId: 2 }),
                makeNpc({ id: 3, name: "Charlie", groupId: 2 }),
            ])
        );
        // Then dissolve
        const events = detectEvents(
            makeSnap([
                makeNpc({ id: 3, name: "Charlie", groupId: 2 }),
                makeNpc({ id: 1, name: "Alice", groupId: 2 }),
            ]),
            makeSnap([
                makeNpc({ id: 3, name: "Charlie", groupId: null }),
                makeNpc({ id: 1, name: "Alice", groupId: null }),
            ])
        );
        const groupEvents = events.filter(e => e.type === "group");
        assert.strictEqual(groupEvents.length, 1, "only one dissolution event");
    });

    it("does not emit dissolution when only one member leaves", () => {
        // Form first
        detectEvents(
            makeSnap([
                makeNpc({ id: 0, name: "Alice", groupId: null }),
                makeNpc({ id: 1, name: "Bob", groupId: null }),
            ]),
            makeSnap([
                makeNpc({ id: 0, name: "Alice", groupId: 5 }),
                makeNpc({ id: 1, name: "Bob", groupId: 5 }),
            ])
        );
        // Alice leaves but Bob stays
        const events = detectEvents(
            makeSnap([
                makeNpc({ id: 0, name: "Alice", groupId: 5 }),
                makeNpc({ id: 1, name: "Bob", groupId: 5 }),
            ]),
            makeSnap([
                makeNpc({ id: 0, name: "Alice", groupId: null }),
                makeNpc({ id: 1, name: "Bob", groupId: 5 }),
            ])
        );
        const groupEvents = events.filter(e => e.type === "group" && e.text.includes("broke apart"));
        assert.strictEqual(groupEvents.length, 0);
    });

    // --- npcIds field ---

    it("events include npcIds array", () => {
        const prev = makeSnap([makeNpc({ id: 7, name: "Alice", alive: true })]);
        const curr = makeSnap([makeNpc({ id: 7, name: "Alice", alive: false })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.deepStrictEqual(events[0].npcIds, [7]);
    });

    it("group formation includes all member ids", () => {
        const prev = makeSnap([
            makeNpc({ id: 2, name: "Alice", groupId: null }),
            makeNpc({ id: 5, name: "Bob", groupId: null }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 2, name: "Alice", groupId: 1 }),
            makeNpc({ id: 5, name: "Bob", groupId: 1 }),
        ]);
        const events = detectEvents(prev, curr);
        const groupEv = events.find(e => e.type === "group");
        assert.ok(groupEv);
        assert.ok(groupEv.npcIds.includes(2));
        assert.ok(groupEv.npcIds.includes(5));
    });

    it("bond event includes both NPC ids", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", bonds: [] }),
            makeNpc({ id: 1, name: "Bob", bonds: [] }),
        ]);
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", bonds: [{ name: "Bob", familiarity: 1.5, affinity: 0.5 }] }),
            makeNpc({ id: 1, name: "Bob", bonds: [{ name: "Alice", familiarity: 1.5, affinity: 0.5 }] }),
        ]);
        const events = detectEvents(prev, curr);
        const bondEv = events.find(e => e.type === "bond");
        assert.ok(bondEv);
        assert.ok(bondEv.npcIds.includes(0));
        assert.ok(bondEv.npcIds.includes(1));
    });

    it("resetDetectState clears dedup history", () => {
        const prev = makeSnap([makeNpc({ id: 0, name: "Alice", bonds: [] })]);
        const curr = makeSnap([makeNpc({ id: 0, name: "Alice",
            bonds: [{ name: "Bob", familiarity: 1.5, affinity: 0.5 }] })]);
        detectEvents(prev, curr);
        resetDetectState();
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.filter(e => e.type === "bond").length, 1,
            "bond should fire again after reset");
    });

    // --- Chasm events ---

    it("detects NPC jumping into chasm", () => {
        const prev = makeSnap([makeNpc({ falling: null })]);
        const curr = makeSnap([makeNpc({ falling: { speed: 1 } })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "chasm");
        assert.ok(events[0].text.includes("chasm"));
    });

    it("detects NPC catching a railing", () => {
        const prev = makeSnap([makeNpc({ falling: { speed: 10 }, floor: 50 })]);
        const curr = makeSnap([makeNpc({ falling: null, floor: 42 })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "chasm");
        assert.ok(events[0].text.includes("railing"));
        assert.ok(events[0].text.includes("42"));
    });

    it("does not emit railing event for dead NPC", () => {
        const prev = makeSnap([makeNpc({ falling: { speed: 10 }, alive: true })]);
        const curr = makeSnap([makeNpc({ falling: null, alive: false })]);
        const events = detectEvents(prev, curr);
        // Should get death event but not railing
        const types = events.map(e => e.type);
        assert.ok(types.includes("death"));
        assert.ok(!events.some(e => e.text.includes("railing")));
    });

    it("death and resurrection are not deduplicated", () => {
        const prev1 = makeSnap([makeNpc({ alive: true })]);
        const curr1 = makeSnap([makeNpc({ alive: false })]);
        detectEvents(prev1, curr1); // first death

        const prev2 = makeSnap([makeNpc({ alive: false })]);
        const curr2 = makeSnap([makeNpc({ alive: true })]);
        detectEvents(prev2, curr2); // resurrection

        // Second death should still fire
        const events = detectEvents(prev1, curr1);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "death");
    });

    // --- Free (escape) events ---

    it("does not emit death for free NPC", () => {
        const prev = makeSnap([makeNpc({ alive: true, free: true })]);
        const curr = makeSnap([makeNpc({ alive: false, free: true })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.filter(e => e.type === "death").length, 0);
    });

    it("does not emit resurrection for free NPC", () => {
        const prev = makeSnap([makeNpc({ alive: false, free: true })]);
        const curr = makeSnap([makeNpc({ alive: true, free: true })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.filter(e => e.type === "resurrection").length, 0);
    });

    it("detects escape (free transition)", () => {
        const prev = makeSnap([makeNpc({ free: false })]);
        const curr = makeSnap([makeNpc({ free: true })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "escape");
        assert.ok(events[0].text.includes("FREE"));
    });

    // --- Pilgrimage events ---

    it("detects pilgrimage start", () => {
        const prev = makeSnap([makeNpc({
            components: { intent: { behavior: "explore" } },
        })]);
        const curr = makeSnap([makeNpc({
            components: { intent: { behavior: "pilgrimage" } },
        })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "pilgrimage");
        assert.ok(events[0].text.includes("pilgrimage"));
    });

    it("does not emit pilgrimage for non-transition", () => {
        const prev = makeSnap([makeNpc({
            components: { intent: { behavior: "pilgrimage" } },
        })]);
        const curr = makeSnap([makeNpc({
            components: { intent: { behavior: "pilgrimage" } },
        })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.filter(e => e.type === "pilgrimage").length, 0);
    });

    // --- Book found events ---

    it("detects hasBook change", () => {
        const prev = makeSnap([makeNpc({
            components: { knowledge: { hasBook: false } },
        })]);
        const curr = makeSnap([makeNpc({
            components: { knowledge: { hasBook: true } },
        })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "pilgrimage");
        assert.ok(events[0].text.includes("found their book"));
    });

    // --- Search events ---

    it("does not emit event when no words found", () => {
        const prev = makeSnap([makeNpc({
            components: { searching: { active: false, bestScore: 0 } },
        })]);
        const curr = makeSnap([makeNpc({
            components: { searching: { active: true, bestScore: 0 } },
        })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 0, "no words found = no event");
    });

    it("detects word find (bestScore increases)", () => {
        const prev = makeSnap([makeNpc({
            components: { searching: { active: true, bestScore: 0, bestWords: [] } },
        })]);
        const curr = makeSnap([makeNpc({
            components: { searching: { active: true, bestScore: 1, bestWords: ["hope"] } },
        })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].type, "search");
        assert.ok(events[0].text.includes("\u201chope\u201d"));
    });

    it("reports multiple words", () => {
        const prev = makeSnap([makeNpc({
            components: { searching: { active: true, bestScore: 1, bestWords: ["hope"] } },
        })]);
        const curr = makeSnap([makeNpc({
            components: { searching: { active: true, bestScore: 3, bestWords: ["hell", "fire", "dark"] } },
        })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.length, 1);
        assert.ok(events[0].text.includes("\u201chell fire dark\u201d"));
    });

    it("does not emit when bestScore unchanged", () => {
        const prev = makeSnap([makeNpc({
            components: { searching: { active: true, bestScore: 2 } },
        })]);
        const curr = makeSnap([makeNpc({
            components: { searching: { active: true, bestScore: 2 } },
        })]);
        const events = detectEvents(prev, curr);
        assert.strictEqual(events.filter(e => e.type === "search").length, 0);
    });

    // --- All event types have correct type field ---

    it("all events have day, tick, type, text fields", () => {
        const prev = makeSnap([
            makeNpc({ id: 0, name: "Alice", alive: true, disposition: "calm", free: false,
                bonds: [], groupId: null,
                components: {
                    searching: { active: false, bestScore: 0 },
                    intent: { behavior: "explore" },
                    knowledge: { hasBook: false },
                },
            }),
        ], { day: 3, tick: 50 });
        const curr = makeSnap([
            makeNpc({ id: 0, name: "Alice", alive: false, disposition: "anxious", free: false,
                bonds: [{ name: "Bob", familiarity: 2, affinity: 1 }],
                groupId: null,
                components: {
                    searching: { active: true, bestScore: 0.2 },
                    intent: { behavior: "pilgrimage" },
                    knowledge: { hasBook: true },
                },
            }),
        ], { day: 3, tick: 50 });
        const events = detectEvents(prev, curr);
        for (const ev of events) {
            assert.ok("day" in ev, "event missing day: " + JSON.stringify(ev));
            assert.ok("tick" in ev, "event missing tick: " + JSON.stringify(ev));
            assert.ok("type" in ev, "event missing type: " + JSON.stringify(ev));
            assert.ok("text" in ev, "event missing text: " + JSON.stringify(ev));
            assert.strictEqual(ev.day, 3);
            assert.strictEqual(ev.tick, 50);
        }
        assert.ok(events.length >= 4, "expected at least 4 events, got " + events.length);
    });
});
