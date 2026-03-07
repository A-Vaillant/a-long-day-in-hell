import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    spawnNPCs,
    moveNPCs,
    getNPCsAt,
    interactText,
    deteriorate,
    DISPOSITIONS,
} from "../lib/npc.core.ts";

// --- helpers ---

function stubRng(values) {
    let i = 0;
    return { next() { return values[i++ % values.length]; } };
}

const TEST_NAMES = ["Alpha", "Bravo", "Charlie", "Delta", "Echo",
                    "Foxtrot", "Golf", "Hotel", "India", "Juliet"];
const TEST_DIALOGUE = {
    calm:      ["calm line 0", "calm line 1", "calm line 2"],
    anxious:   ["anxious line 0", "anxious line 1"],
    mad:       ["mad line 0", "mad line 1"],
    catatonic: ["catatonic line 0"],
    dead:      ["dead line 0", "dead line 1"],
};

const playerLoc = { side: 0, position: 0, floor: 10 };

// --- DISPOSITIONS ---

describe("DISPOSITIONS", () => {
    it("has four stages in degradation order", () => {
        assert.deepStrictEqual(DISPOSITIONS, ["calm", "anxious", "mad", "catatonic"]);
    });
});

// --- spawnNPCs ---

describe("spawnNPCs", () => {
    it("spawns requested number of NPCs", () => {
        const rng = stubRng([0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35,
                             0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35,
                             0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35,
                             0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35]);
        const npcs = spawnNPCs(playerLoc, 8, TEST_NAMES, rng);
        assert.strictEqual(npcs.length, 8);
    });

    it("every NPC has required fields", () => {
        const rng = stubRng([0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35,
                             0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35,
                             0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35]);
        const npcs = spawnNPCs(playerLoc, 3, TEST_NAMES, rng);
        for (const npc of npcs) {
            assert.ok(typeof npc.id === "number");
            assert.ok(typeof npc.name === "string" && npc.name.length > 0);
            assert.ok(TEST_NAMES.includes(npc.name), "name should come from provided list");
            assert.ok(typeof npc.side === "number");
            assert.ok(typeof npc.position === "number");
            assert.ok(typeof npc.floor === "number");
            assert.ok(DISPOSITIONS.includes(npc.disposition));
            assert.strictEqual(npc.disposition, "calm", "all start calm");
            assert.strictEqual(npc.alive, true);
            assert.strictEqual(npc.daysMet, 0);
            assert.strictEqual(npc.lastSeenDay, 0);
        }
    });

    it("NPCs spawn near player (within reasonable range)", () => {
        const rng = stubRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
                             0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
        const npcs = spawnNPCs(playerLoc, 5, TEST_NAMES, rng);
        for (const npc of npcs) {
            const dist = Math.abs(npc.position - playerLoc.position) +
                         Math.abs(npc.floor - playerLoc.floor);
            assert.ok(dist < 100, `NPC too far from player: dist=${dist}`);
        }
    });

    it("unique IDs", () => {
        const rng = stubRng([0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35,
                             0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35,
                             0.5, 0.3, 0.7, 0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.35]);
        const npcs = spawnNPCs(playerLoc, 8, TEST_NAMES, rng);
        const ids = npcs.map(n => n.id);
        assert.strictEqual(new Set(ids).size, ids.length);
    });
});

// --- getNPCsAt ---

describe("getNPCsAt", () => {
    const npcs = [
        { id: 0, name: "A", side: 0, position: 5, floor: 10, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 },
        { id: 1, name: "B", side: 0, position: 5, floor: 10, disposition: "anxious", alive: true, daysMet: 0, lastSeenDay: 0 },
        { id: 2, name: "C", side: 1, position: 5, floor: 10, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 },
        { id: 3, name: "D", side: 0, position: 5, floor: 10, disposition: "calm", alive: false, daysMet: 0, lastSeenDay: 0 },
    ];

    it("returns NPCs at matching location", () => {
        const at = getNPCsAt(npcs, 0, 5, 10);
        assert.strictEqual(at.length, 3, "includes dead NPCs at location");
    });

    it("returns empty array when none present", () => {
        const at = getNPCsAt(npcs, 1, 99, 0);
        assert.strictEqual(at.length, 0);
    });

    it("filters by all three coordinates", () => {
        const at = getNPCsAt(npcs, 1, 5, 10);
        assert.strictEqual(at.length, 1);
        assert.strictEqual(at[0].name, "C");
    });
});

// --- moveNPCs ---

describe("moveNPCs", () => {
    it("returns new array (immutable)", () => {
        const npcs = [
            { id: 0, name: "A", side: 0, position: 5, floor: 10, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 },
        ];
        const rng = stubRng([0.5, 0.5]);
        const moved = moveNPCs(npcs, rng);
        assert.notStrictEqual(moved, npcs);
    });

    it("dead NPCs do not move", () => {
        const npcs = [
            { id: 0, name: "A", side: 0, position: 5, floor: 10, disposition: "calm", alive: false, daysMet: 0, lastSeenDay: 0 },
        ];
        const rng = stubRng([0.0]);
        const moved = moveNPCs(npcs, rng);
        assert.strictEqual(moved[0].position, 5);
        assert.strictEqual(moved[0].floor, 10);
    });

    it("catatonic NPCs do not move", () => {
        const npcs = [
            { id: 0, name: "A", side: 0, position: 5, floor: 10, disposition: "catatonic", alive: true, daysMet: 0, lastSeenDay: 0 },
        ];
        const rng = stubRng([0.0]);
        const moved = moveNPCs(npcs, rng);
        assert.strictEqual(moved[0].position, 5);
    });

    it("living non-catatonic NPCs may change position", () => {
        const npcs = [
            { id: 0, name: "A", side: 0, position: 50, floor: 10, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 },
        ];
        const rng = stubRng([0.0, 0.0]);
        const moved = moveNPCs(npcs, rng);
        const posChanged = moved[0].position !== 50;
        const floorChanged = moved[0].floor !== 10;
        assert.ok(posChanged || floorChanged, "NPC should move");
    });

    it("floor never goes below 0", () => {
        const npcs = [
            { id: 0, name: "A", side: 0, position: 5, floor: 0, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 },
        ];
        const rng = stubRng([0.0, 0.0]);
        const moved = moveNPCs(npcs, rng);
        assert.ok(moved[0].floor >= 0);
    });
});

// --- deteriorate ---

describe("deteriorate", () => {
    it("calm NPC stays calm on early days", () => {
        const npc = { id: 0, name: "A", side: 0, position: 0, floor: 0, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 };
        const rng = stubRng([0.9]);
        const result = deteriorate(npc, 5, rng);
        assert.strictEqual(result.disposition, "calm");
    });

    it("disposition degrades over time with bad rolls", () => {
        const npc = { id: 0, name: "A", side: 0, position: 0, floor: 0, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 };
        const rng = stubRng([0.0]);
        const result = deteriorate(npc, 100, rng);
        const idx = DISPOSITIONS.indexOf(result.disposition);
        assert.ok(idx > 0, "should have deteriorated past calm");
    });

    it("catatonic NPCs can die", () => {
        const npc = { id: 0, name: "A", side: 0, position: 0, floor: 0, disposition: "catatonic", alive: true, daysMet: 0, lastSeenDay: 0 };
        const rng = stubRng([0.0]);
        const result = deteriorate(npc, 200, rng);
        assert.strictEqual(result.alive, false);
    });

    it("dead NPCs stay dead", () => {
        const npc = { id: 0, name: "A", side: 0, position: 0, floor: 0, disposition: "catatonic", alive: false, daysMet: 0, lastSeenDay: 0 };
        const rng = stubRng([0.5]);
        const result = deteriorate(npc, 300, rng);
        assert.strictEqual(result.alive, false);
    });
});

// --- interactText ---

describe("interactText", () => {
    it("returns a non-empty string for each disposition", () => {
        for (const disp of DISPOSITIONS) {
            const npc = { id: 0, name: "Test", side: 0, position: 0, floor: 0, disposition: disp, alive: true, daysMet: 0, lastSeenDay: 0 };
            const rng = stubRng([0.5]);
            const text = interactText(npc, TEST_DIALOGUE, rng);
            assert.ok(typeof text === "string" && text.length > 0, `empty text for disposition: ${disp}`);
        }
    });

    it("returns a string for dead NPCs", () => {
        const npc = { id: 0, name: "Test", side: 0, position: 0, floor: 0, disposition: "calm", alive: false, daysMet: 0, lastSeenDay: 0 };
        const rng = stubRng([0.5]);
        const text = interactText(npc, TEST_DIALOGUE, rng);
        assert.ok(typeof text === "string" && text.length > 0);
    });

    it("returns empty string for unknown disposition", () => {
        const npc = { id: 0, name: "Test", side: 0, position: 0, floor: 0, disposition: "inspired", alive: true, daysMet: 0, lastSeenDay: 0 };
        const rng = stubRng([0.5]);
        const text = interactText(npc, TEST_DIALOGUE, rng);
        assert.strictEqual(text, "");
    });

    it("different RNG values can produce different text", () => {
        const npc = { id: 0, name: "Test", side: 0, position: 0, floor: 0, disposition: "calm", alive: true, daysMet: 0, lastSeenDay: 0 };
        const texts = new Set();
        for (let i = 0; i < 10; i++) {
            const rng = stubRng([i / 10]);
            texts.add(interactText(npc, TEST_DIALOGUE, rng));
        }
        assert.ok(texts.size > 1, "should have some variety");
    });
});
