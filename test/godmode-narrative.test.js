import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { narrateEvents, getNpcNarrative, resetNarratives } from "../src/js/godmode-narrative.js";

function makeNpc(overrides) {
    return {
        id: 0, name: "Alice", side: 0, position: 5, floor: 10,
        disposition: "calm", alive: true, hope: 70, lucidity: 80,
        bonds: [], groupId: null, free: false, components: {},
        ...overrides,
    };
}

function makeSnap(npcs, overrides) {
    return { npcs, day: 1, tick: 10, lightsOn: true, ...overrides };
}

describe("narrateEvents", () => {
    beforeEach(() => resetNarratives());

    it("death generates narrative with location", () => {
        const npc = makeNpc({ components: { needs: { thirst: 30, hunger: 20, exhaustion: 10 } } });
        const snap = makeSnap([npc]);
        narrateEvents([{ tick: 10, day: 1, type: "death", text: "Alice died." }], snap);
        const story = getNpcNarrative(0);
        assert.strictEqual(story.length, 1);
        assert.ok(story[0].text.includes("Alice died"));
        assert.ok(story[0].text.includes("west corridor"));
        assert.ok(story[0].text.includes("floor 10"));
    });

    it("death from thirst includes cause", () => {
        const npc = makeNpc({ components: { needs: { thirst: 100, hunger: 20, exhaustion: 10 } } });
        const snap = makeSnap([npc]);
        narrateEvents([{ tick: 10, day: 1, type: "death", text: "Alice died." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("thirst"));
    });

    it("death from hunger includes cause", () => {
        const npc = makeNpc({ components: { needs: { thirst: 10, hunger: 99, exhaustion: 10 } } });
        const snap = makeSnap([npc]);
        narrateEvents([{ tick: 10, day: 1, type: "death", text: "Alice died." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("starvation"));
    });

    it("chasm jump generates chasm narrative", () => {
        const npc = makeNpc({ floor: 50 });
        const snap = makeSnap([npc]);
        narrateEvents([{ tick: 10, day: 1, type: "death", text: "Alice jumped into the chasm." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("chasm"));
        assert.ok(story[0].text.includes("floor 50"));
    });

    it("resurrection generates narrative", () => {
        const snap = makeSnap([makeNpc()]);
        narrateEvents([{ tick: 10, day: 1, type: "resurrection", text: "Alice returned at dawn." }], snap);
        const story = getNpcNarrative(0);
        assert.strictEqual(story.length, 1);
        assert.ok(story[0].text.includes("alive again"));
    });

    it("railing catch generates narrative", () => {
        const snap = makeSnap([makeNpc({ floor: 42 })]);
        narrateEvents([{ tick: 10, day: 1, type: "resurrection", text: "Alice caught a railing at floor 42." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("railing"));
    });

    it("disposition change generates narrative", () => {
        const snap = makeSnap([makeNpc({ disposition: "anxious", hope: 30, lucidity: 40 })]);
        narrateEvents([{ tick: 10, day: 1, type: "disposition", text: "Alice became anxious." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("anxious"));
        assert.ok(story[0].text.includes("Hope:"));
    });

    it("mad disposition generates narrative", () => {
        const snap = makeSnap([makeNpc({ disposition: "mad" })]);
        narrateEvents([{ tick: 10, day: 1, type: "disposition", text: "Alice became mad." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("lost their mind"));
    });

    it("bond adds to both NPCs' stories", () => {
        const snap = makeSnap([
            makeNpc({ id: 0, name: "Alice", side: 0, floor: 10 }),
            makeNpc({ id: 1, name: "Bob", side: 0, floor: 10 }),
        ]);
        narrateEvents([{ tick: 10, day: 1, type: "bond", text: "Alice met Bob." }], snap);
        const aliceStory = getNpcNarrative(0);
        const bobStory = getNpcNarrative(1);
        assert.strictEqual(aliceStory.length, 1);
        assert.strictEqual(bobStory.length, 1);
        assert.ok(aliceStory[0].text.includes("Alice met Bob"));
        assert.ok(bobStory[0].text.includes("Bob met Alice"));
    });

    it("group adds to all members' stories", () => {
        const snap = makeSnap([
            makeNpc({ id: 0, name: "Alice" }),
            makeNpc({ id: 1, name: "Bob" }),
        ]);
        narrateEvents([{ tick: 10, day: 1, type: "group", text: "Alice and Bob formed a group." }], snap);
        const aliceStory = getNpcNarrative(0);
        const bobStory = getNpcNarrative(1);
        assert.strictEqual(aliceStory.length, 1);
        assert.strictEqual(bobStory.length, 1);
        assert.ok(aliceStory[0].text.includes("traveling with"));
        assert.ok(bobStory[0].text.includes("traveling with"));
    });

    it("pilgrimage start generates narrative", () => {
        const snap = makeSnap([makeNpc({
            components: { knowledge: { bookVision: { side: 1, floor: 5, position: 20 } } },
        })]);
        narrateEvents([{ tick: 10, day: 1, type: "pilgrimage", text: "Alice began a pilgrimage." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("pilgrimage"));
        assert.ok(story[0].text.includes("east corridor"));
        assert.ok(story[0].text.includes("floor 5"));
    });

    it("pilgrimage start without vision omits destination", () => {
        const snap = makeSnap([makeNpc({ components: { knowledge: {} } })]);
        narrateEvents([{ tick: 10, day: 1, type: "pilgrimage", text: "Alice began a pilgrimage." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("pilgrimage"));
        assert.ok(!story[0].text.includes("corridor"));
    });

    it("found book generates narrative", () => {
        const snap = makeSnap([makeNpc()]);
        narrateEvents([{ tick: 10, day: 1, type: "pilgrimage", text: "Alice found their book!" }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("found their book"));
    });

    it("escape generates narrative", () => {
        const snap = makeSnap([makeNpc({ free: true })]);
        narrateEvents([{ tick: 10, day: 1, type: "escape", text: "Alice submitted their book and is FREE." }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("free"));
    });

    it("search word find generates narrative", () => {
        const snap = makeSnap([makeNpc()]);
        narrateEvents([{ tick: 10, day: 1, type: "search", text: "Alice found a word in a book!" }], snap);
        const story = getNpcNarrative(0);
        assert.ok(story[0].text.includes("found words"));
    });

    it("accumulates multiple events chronologically", () => {
        const snap = makeSnap([makeNpc({ disposition: "anxious", hope: 30, lucidity: 40 })]);
        narrateEvents([
            { tick: 10, day: 1, type: "disposition", text: "Alice became anxious." },
        ], snap);
        narrateEvents([
            { tick: 20, day: 1, type: "death", text: "Alice died." },
        ], makeSnap([makeNpc({ alive: false, components: { needs: { thirst: 10, hunger: 10, exhaustion: 10 } } })]));
        const story = getNpcNarrative(0);
        assert.strictEqual(story.length, 2);
        assert.ok(story[0].tick < story[1].tick);
    });

    it("getNpcNarrative returns empty for unknown NPC", () => {
        assert.deepStrictEqual(getNpcNarrative(999), []);
    });

    it("resetNarratives clears all stories", () => {
        const snap = makeSnap([makeNpc()]);
        narrateEvents([{ tick: 10, day: 1, type: "escape", text: "Alice submitted their book and is FREE." }], snap);
        assert.strictEqual(getNpcNarrative(0).length, 1);
        resetNarratives();
        assert.strictEqual(getNpcNarrative(0).length, 0);
    });
});
