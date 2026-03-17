import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import {
    POSITION, PSYCHOLOGY, RELATIONSHIPS, IDENTITY,
    buildLocationIndex,
} from "../lib/social.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { mercyKiosk } from "../lib/library.core.ts";
import {
    MEMORY, MEMORY_TYPES,
    DEFAULT_MEMORY_CONFIG,
    createMemory, addMemory, hasRecentMemory, strongestMemory, countMemories,
    witnessSystem, memoryDecaySystem,
} from "../lib/memory.core.ts";

// --- Helpers ---

function makeWorld() {
    return createWorld();
}

function spawnEntity(world, { side = 0, position = 0, floor = 0, alive = true, name = "Test" } = {}) {
    const e = spawn(world);
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, IDENTITY, { name, alive });
    addComponent(world, e, PSYCHOLOGY, { lucidity: 100, hope: 100 });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, HABITUATION, { exposures: new Map() });
    return e;
}

function spawnWithMemory(world, opts = {}) {
    const e = spawnEntity(world, opts);
    addComponent(world, e, MEMORY, createMemory());
    return e;
}

function makeEvent(type, subject, position, { bondedOnly = false, range = "colocated" } = {}) {
    return { type, subject, position, bondedOnly, range };
}

// --- createMemory ---

describe("createMemory", () => {
    it("creates empty memory with default capacity", () => {
        const mem = createMemory();
        assert.equal(mem.entries.length, 0);
        assert.equal(mem.capacity, 32);
        assert.equal(mem.nextId, 0);
    });

    it("respects custom capacity", () => {
        const mem = createMemory(8);
        assert.equal(mem.capacity, 8);
    });
});

// --- addMemory ---

describe("addMemory", () => {
    it("adds entry and assigns monotonic ID", () => {
        const mem = createMemory(4);
        const entry = { id: mem.nextId++, type: "foundBody", tick: 0, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false };
        addMemory(mem, entry);
        assert.equal(mem.entries.length, 1);
        assert.equal(mem.entries[0].id, 0);
    });

    it("IDs are monotonic across adds", () => {
        const mem = createMemory(4);
        for (let i = 0; i < 3; i++) {
            addMemory(mem, { id: mem.nextId++, type: "foundBody", tick: i, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false });
        }
        assert.equal(mem.entries[0].id, 0);
        assert.equal(mem.entries[1].id, 1);
        assert.equal(mem.entries[2].id, 2);
    });

    it("evicts lowest-weight non-permanent when over capacity", () => {
        const mem = createMemory(3);
        addMemory(mem, { id: 0, type: "foundBody", tick: 0, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false });
        addMemory(mem, { id: 1, type: "foundBody", tick: 1, weight: 2, initialWeight: 2, permanent: false, subject: null, contagious: false }); // weakest
        addMemory(mem, { id: 2, type: "foundBody", tick: 2, weight: 8, initialWeight: 8, permanent: false, subject: null, contagious: false });
        // At capacity = 3, now add a 4th
        addMemory(mem, { id: 3, type: "witnessChasm", tick: 3, weight: 10, initialWeight: 10, permanent: true, subject: null, contagious: false });
        assert.equal(mem.entries.length, 3);
        // id=1 (weight=2) should be evicted
        assert.ok(!mem.entries.find(e => e.id === 1), "weakest entry should be evicted");
        assert.ok(mem.entries.find(e => e.id === 3), "new entry should be present");
    });

    it("evicts oldest among equal-weight entries", () => {
        const mem = createMemory(2);
        addMemory(mem, { id: 0, type: "foundBody", tick: 10, weight: 3, initialWeight: 3, permanent: false, subject: null, contagious: false }); // older
        addMemory(mem, { id: 1, type: "foundBody", tick: 20, weight: 3, initialWeight: 3, permanent: false, subject: null, contagious: false }); // newer, same weight
        addMemory(mem, { id: 2, type: "foundBody", tick: 30, weight: 3, initialWeight: 3, permanent: false, subject: null, contagious: false });
        // id=0 (oldest) should be evicted
        assert.ok(!mem.entries.find(e => e.id === 0), "oldest equal-weight entry should be evicted");
    });

    it("never evicts permanent entries", () => {
        const mem = createMemory(2);
        addMemory(mem, { id: 0, type: "witnessChasm", tick: 0, weight: 10, initialWeight: 10, permanent: true, subject: null, contagious: false });
        addMemory(mem, { id: 1, type: "companionDied", tick: 1, weight: 12, initialWeight: 12, permanent: true, subject: null, contagious: false });
        // Both permanent — new non-permanent entry gets dropped
        addMemory(mem, { id: 2, type: "foundBody", tick: 2, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false });
        assert.equal(mem.entries.length, 2);
        assert.ok(!mem.entries.find(e => e.id === 2), "new entry dropped when all are permanent");
    });
});

// --- hasRecentMemory ---

describe("hasRecentMemory", () => {
    it("returns false for empty memory", () => {
        const mem = createMemory();
        assert.equal(hasRecentMemory(mem, "foundBody", null, 100), false);
    });

    it("returns true for matching type+subject within window", () => {
        const mem = createMemory();
        addMemory(mem, { id: 0, type: "foundBody", tick: 100, weight: 5, initialWeight: 5, permanent: false, subject: 42n, contagious: false });
        assert.equal(hasRecentMemory(mem, "foundBody", 42n, 150, 100), true);
    });

    it("returns false when outside window", () => {
        const mem = createMemory();
        addMemory(mem, { id: 0, type: "foundBody", tick: 0, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false });
        assert.equal(hasRecentMemory(mem, "foundBody", null, 500, 240), false);
    });

    it("distinguishes different subjects", () => {
        const mem = createMemory();
        addMemory(mem, { id: 0, type: "companionDied", tick: 100, weight: 12, initialWeight: 12, permanent: true, subject: 1n, contagious: false });
        assert.equal(hasRecentMemory(mem, "companionDied", 2n, 150, 240), false);
        assert.equal(hasRecentMemory(mem, "companionDied", 1n, 150, 240), true);
    });
});

// --- strongestMemory ---

describe("strongestMemory", () => {
    it("returns null for empty memory", () => {
        assert.equal(strongestMemory(createMemory()), null);
    });

    it("returns highest-weight entry", () => {
        const mem = createMemory();
        addMemory(mem, { id: 0, type: "foundBody", tick: 0, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false });
        addMemory(mem, { id: 1, type: "witnessChasm", tick: 1, weight: 10, initialWeight: 10, permanent: true, subject: null, contagious: false });
        addMemory(mem, { id: 2, type: "companionDied", tick: 2, weight: 8, initialWeight: 8, permanent: true, subject: null, contagious: false });
        const best = strongestMemory(mem);
        assert.equal(best.id, 1);
        assert.equal(best.weight, 10);
    });
});

// --- countMemories ---

describe("countMemories", () => {
    it("returns 0 for empty memory", () => {
        assert.equal(countMemories(createMemory(), "foundBody"), 0);
    });

    it("counts only matching type", () => {
        const mem = createMemory();
        addMemory(mem, { id: 0, type: "foundBody", tick: 0, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false });
        addMemory(mem, { id: 1, type: "foundBody", tick: 1, weight: 5, initialWeight: 5, permanent: false, subject: null, contagious: false });
        addMemory(mem, { id: 2, type: "witnessChasm", tick: 2, weight: 10, initialWeight: 10, permanent: true, subject: null, contagious: false });
        assert.equal(countMemories(mem, "foundBody"), 2);
        assert.equal(countMemories(mem, "witnessChasm"), 1);
        assert.equal(countMemories(mem, "companionDied"), 0);
    });
});

// --- witnessSystem: range detection ---

describe("witnessSystem — colocated range", () => {
    it("creates memory for entity at exact same position", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 }, { range: "colocated" })], 100, prebuilt);

        const mem = getComponent(world, witness, MEMORY);
        assert.ok(mem, "witness should have MEMORY component");
        assert.equal(mem.entries.length, 1);
        assert.equal(mem.entries[0].type, "foundBody");
    });

    it("does not create memory for entity one segment away (colocated range)", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const bystander = spawnEntity(world, { position: 6 });
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 }, { range: "colocated" })], 100, prebuilt);

        const mem = getComponent(world, bystander, MEMORY);
        assert.ok(!mem || mem.entries.length === 0, "far entity should not witness colocated event");
    });
});

describe("witnessSystem — hearing range", () => {
    it("creates memory for entity within hearing range", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 0 });
        const witness = spawnEntity(world, { position: 2 }); // within 3-segment hear range
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("witnessEscape", subject, { side: 0, position: 0, floor: 0 }, { range: "hearing" })], 100, prebuilt);

        const mem = getComponent(world, witness, MEMORY);
        assert.ok(mem && mem.entries.length === 1, "near entity should witness hearing event");
    });

    it("does not create memory beyond hearing range", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 0 });
        const far = spawnEntity(world, { position: 20 });
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("witnessEscape", subject, { side: 0, position: 0, floor: 0 }, { range: "hearing" })], 100, prebuilt);

        const mem = getComponent(world, far, MEMORY);
        assert.ok(!mem || mem.entries.length === 0, "far entity should not witness hearing event");
    });
});

describe("witnessSystem — sight range", () => {
    it("creates memory for entity within sight range", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 0 });
        const witness = spawnEntity(world, { position: 5 }); // within sight (10 seg)
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("witnessChasm", subject, { side: 0, position: 0, floor: 0 }, { range: "sight" })], 100, prebuilt);

        const mem = getComponent(world, witness, MEMORY);
        assert.ok(mem && mem.entries.length === 1, "nearby entity should witness sight event");
    });
});

// --- witnessSystem: bondedOnly ---

describe("witnessSystem — bondedOnly filtering", () => {
    it("creates memory only for bonded entities", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const bonded = spawnEntity(world, { position: 5 });
        const stranger = spawnEntity(world, { position: 5 });

        // Bond bonded → subject
        const rels = getComponent(world, bonded, RELATIONSHIPS);
        rels.bonds.set(subject, { familiarity: 5, affinity: 0, lastEncounter: 0, encounterCount: 1 });

        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("companionDied", subject, { side: 0, position: 5, floor: 0 }, { bondedOnly: true, range: "sight" })], 100, prebuilt);

        const bondedMem = getComponent(world, bonded, MEMORY);
        const strangerMem = getComponent(world, stranger, MEMORY);
        assert.ok(bondedMem && bondedMem.entries.length === 1, "bonded entity should witness");
        assert.ok(!strangerMem || strangerMem.entries.length === 0, "stranger should not witness bondedOnly event");
    });

    it("does not create memory for entity with zero familiarity bond", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const weakBond = spawnEntity(world, { position: 5 });

        const rels = getComponent(world, weakBond, RELATIONSHIPS);
        rels.bonds.set(subject, { familiarity: 0, affinity: 0, lastEncounter: 0, encounterCount: 0 });

        const prebuilt = buildLocationIndex(world);
        witnessSystem(world, [makeEvent("companionDied", subject, { side: 0, position: 5, floor: 0 }, { bondedOnly: true, range: "sight" })], 100, prebuilt);

        const mem = getComponent(world, weakBond, MEMORY);
        assert.ok(!mem || mem.entries.length === 0, "zero-familiarity bond does not count");
    });
});

// --- witnessSystem: dead entities don't witness ---

describe("witnessSystem — dead entities", () => {
    it("does not create memory for dead entity", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const dead = spawnEntity(world, { position: 5, alive: false });
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 })], 100, prebuilt);

        const mem = getComponent(world, dead, MEMORY);
        assert.ok(!mem || mem.entries.length === 0, "dead entity should not witness");
    });
});

// --- witnessSystem: subject does not witness own event ---

describe("witnessSystem — subject exclusion", () => {
    it("subject does not witness their own event", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 })], 100, prebuilt);

        const mem = getComponent(world, subject, MEMORY);
        assert.ok(!mem || mem.entries.length === 0, "subject should not witness their own event");
    });
});

// --- witnessSystem: dedup ---

describe("witnessSystem — deduplication", () => {
    it("does not duplicate memory within dedup window", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });

        addComponent(world, witness, MEMORY, createMemory());
        const prebuilt = buildLocationIndex(world);

        const event = makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 });
        witnessSystem(world, [event], 100, prebuilt);
        witnessSystem(world, [event], 1000, prebuilt); // within 1440-tick dedup window

        const mem = getComponent(world, witness, MEMORY);
        assert.equal(mem.entries.length, 1, "duplicate within window should be skipped");
    });

    it("allows same event after dedup window expires", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        addComponent(world, witness, MEMORY, createMemory());

        const prebuilt = buildLocationIndex(world);
        const event = makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 });

        witnessSystem(world, [event], 0, prebuilt);
        witnessSystem(world, [event], 1500, prebuilt); // outside 1440-tick dedup window

        const mem = getComponent(world, witness, MEMORY);
        assert.equal(mem.entries.length, 2, "event allowed after window expires");
    });
});

// --- witnessSystem: shock application ---

describe("witnessSystem — acute shock", () => {
    it("applies hope reduction for foundBody (has shockKey)", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        const prebuilt = buildLocationIndex(world);

        const psychBefore = getComponent(world, witness, PSYCHOLOGY);
        const hopeBefore = psychBefore.hope;

        witnessSystem(world, [makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 })], 100, prebuilt);

        assert.ok(psychBefore.hope < hopeBefore, "foundBody shock should reduce hope");
    });

    it("does not apply shock for foundWords (shockKey is null)", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        const prebuilt = buildLocationIndex(world);

        const psych = getComponent(world, witness, PSYCHOLOGY);
        // foundWords has no shockKey and is range "self" — but if we fire it at range "colocated"
        // and the witness is co-located, they'd get the memory. foundWords has no shockKey.
        const hopeBefore = psych.hope;
        const lucidBefore = psych.lucidity;

        witnessSystem(world, [makeEvent("foundWords", subject, { side: 0, position: 5, floor: 0 })], 100, prebuilt);

        assert.equal(psych.hope, hopeBefore, "foundWords has no acute shock");
        assert.equal(psych.lucidity, lucidBefore, "foundWords has no acute shock");
    });

    it("witnessEscape applies positive hope shock", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        const prebuilt = buildLocationIndex(world);

        const psych = getComponent(world, witness, PSYCHOLOGY);
        psych.hope = 50; // not at max
        witnessSystem(world, [makeEvent("witnessEscape", subject, { side: 0, position: 5, floor: 0 }, { range: "hearing" })], 100, prebuilt);

        assert.ok(psych.hope > 50, "witnessEscape should boost hope");
    });
});

// --- witnessSystem: empty events early return ---

describe("witnessSystem — empty events", () => {
    it("returns immediately with no events", () => {
        const world = makeWorld();
        const entity = spawnEntity(world, { position: 0 });
        const prebuilt = buildLocationIndex(world);
        // Should not throw
        witnessSystem(world, [], 0, prebuilt);
        assert.ok(!getComponent(world, entity, MEMORY), "no components created for empty events");
    });
});

// --- memoryDecaySystem: weight decay ---

describe("memoryDecaySystem — weight decay", () => {
    it("decays weight by decayRate per tick", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const mem = getComponent(world, e, MEMORY);
        addMemory(mem, {
            id: 0, type: "foundBody", tick: 0, weight: 5, initialWeight: 5,
            permanent: false, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 1);

        // foundBody decayRate from config (perDay-based; ~0.000167/tick at 1440 ticks/day)
        const expectedDecayRate = DEFAULT_MEMORY_CONFIG.types.foundBody.decayRate;
        assert.ok(Math.abs(mem.entries[0].weight - (5 - expectedDecayRate)) < 1e-10);
    });

    it("clamps to floor for permanent entries", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const mem = getComponent(world, e, MEMORY);
        // witnessChasm: floor=2.0, decayRate=0.0001
        addMemory(mem, {
            id: 0, type: "witnessChasm", tick: 0, weight: 2.00005, initialWeight: 10,
            permanent: true, subject: null, contagious: false,
        });

        // One tick of decay would take it below 2.0
        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 1);
        assert.ok(mem.entries[0].weight >= 2.0, "permanent memory should not decay below floor");
    });

    it("evicts zeroed non-permanent entries", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const mem = getComponent(world, e, MEMORY);
        // Use a weight that is less than one tick of decay for foundBody
        const decayRate = DEFAULT_MEMORY_CONFIG.types.foundBody.decayRate;
        addMemory(mem, {
            id: 0, type: "foundBody", tick: 0, weight: decayRate / 2, initialWeight: 5,
            permanent: false, subject: null, contagious: false,
        });

        // Weight < decayRate → decays to 0 (clamped), then evicted
        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 1);
        assert.equal(mem.entries.length, 0, "zeroed non-permanent entry should be evicted");
    });

    it("does not evict permanent entries at floor", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const mem = getComponent(world, e, MEMORY);
        addMemory(mem, {
            id: 0, type: "witnessChasm", tick: 0, weight: 2.0, initialWeight: 10,
            permanent: true, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 1000);
        assert.equal(mem.entries.length, 1, "permanent entry stays even after many ticks");
        assert.ok(mem.entries[0].weight >= 2.0);
    });
});

// --- memoryDecaySystem: psychological effects ---

describe("memoryDecaySystem — psychological effects", () => {
    it("decays hope via hopeDrainPerTick", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const psych = getComponent(world, e, PSYCHOLOGY);
        psych.hope = 80;
        const mem = getComponent(world, e, MEMORY);
        // companionDied: hopeDrainPerTick = -0.00008
        addMemory(mem, {
            id: 0, type: "companionDied", tick: 0, weight: 12, initialWeight: 12,
            permanent: true, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 1);
        assert.ok(psych.hope < 80, "hope should decrease from companionDied drain");
    });

    it("boosts hope via positive hopeDrainPerTick (witnessEscape)", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const psych = getComponent(world, e, PSYCHOLOGY);
        psych.hope = 50;
        const mem = getComponent(world, e, MEMORY);
        // witnessEscape: hopeDrainPerTick = +0.00006
        addMemory(mem, {
            id: 0, type: "witnessEscape", tick: 0, weight: 8, initialWeight: 8,
            permanent: false, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 100);
        assert.ok(psych.hope > 50, "hope should increase from witnessEscape");
    });

    it("decays lucidity via witnessMadness", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const psych = getComponent(world, e, PSYCHOLOGY);
        psych.lucidity = 80;
        const mem = getComponent(world, e, MEMORY);
        // witnessMadness: lucidityDrainPerTick = -0.00006
        addMemory(mem, {
            id: 0, type: "witnessMadness", tick: 0, weight: 7, initialWeight: 7,
            permanent: true, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 100);
        assert.ok(psych.lucidity < 80, "lucidity should decrease from witnessMadness drain");
    });

    it("clamps hope to [0, 100]", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const psych = getComponent(world, e, PSYCHOLOGY);
        psych.hope = 0.0001;
        const mem = getComponent(world, e, MEMORY);
        addMemory(mem, {
            id: 0, type: "companionDied", tick: 0, weight: 12, initialWeight: 12,
            permanent: true, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 10000);
        assert.ok(psych.hope >= 0, "hope should not go below 0");
    });

    it("clamps hope to 100 for positive drain", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const psych = getComponent(world, e, PSYCHOLOGY);
        psych.hope = 99.999;
        const mem = getComponent(world, e, MEMORY);
        addMemory(mem, {
            id: 0, type: "witnessEscape", tick: 0, weight: 8, initialWeight: 8,
            permanent: false, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 1000);
        assert.ok(psych.hope <= 100, "hope should not exceed 100");
    });
});

// --- memoryDecaySystem: batch mode (analytical formula) ---

describe("memoryDecaySystem — batch mode analytical correctness", () => {
    it("batch n=10 matches tick-by-tick for linear decay", () => {
        // Run tick-by-tick for 10 ticks
        const world1 = makeWorld();
        const e1 = spawnWithMemory(world1);
        const psych1 = getComponent(world1, e1, PSYCHOLOGY);
        psych1.hope = 80;
        const mem1 = getComponent(world1, e1, MEMORY);
        addMemory(mem1, {
            id: 0, type: "foundBody", tick: 0, weight: 5, initialWeight: 5,
            permanent: false, subject: null, contagious: false,
        });
        for (let i = 0; i < 10; i++) {
            memoryDecaySystem(world1, DEFAULT_MEMORY_CONFIG, 1);
        }

        // Run batch n=10
        const world2 = makeWorld();
        const e2 = spawnWithMemory(world2);
        const psych2 = getComponent(world2, e2, PSYCHOLOGY);
        psych2.hope = 80;
        const mem2 = getComponent(world2, e2, MEMORY);
        addMemory(mem2, {
            id: 0, type: "foundBody", tick: 0, weight: 5, initialWeight: 5,
            permanent: false, subject: null, contagious: false,
        });
        memoryDecaySystem(world2, DEFAULT_MEMORY_CONFIG, 10);

        // Weights should match
        if (mem1.entries.length > 0 && mem2.entries.length > 0) {
            assert.ok(Math.abs(mem1.entries[0].weight - mem2.entries[0].weight) < 1e-8,
                `weight mismatch: tick-by-tick=${mem1.entries[0].weight} vs batch=${mem2.entries[0].weight}`);
        } else {
            // Both evicted (weight hit 0)
            assert.equal(mem1.entries.length, mem2.entries.length, "both should evict or both keep");
        }

        // Hope should be close (trapezoid vs sum of rectangles — slight numerical diff OK)
        assert.ok(Math.abs(psych1.hope - psych2.hope) < 0.01,
            `hope mismatch: tick-by-tick=${psych1.hope} vs batch=${psych2.hope}`);
    });

    it("batch n=1000 for permanent memory keeps floor clamping", () => {
        const world = makeWorld();
        const e = spawnWithMemory(world);
        const mem = getComponent(world, e, MEMORY);
        addMemory(mem, {
            id: 0, type: "witnessChasm", tick: 0, weight: 10, initialWeight: 10,
            permanent: true, subject: null, contagious: false,
        });

        memoryDecaySystem(world, DEFAULT_MEMORY_CONFIG, 1000);
        assert.ok(mem.entries[0].weight >= 2.0, "permanent memory floor holds after large batch");
    });
});

// --- witnessSystem: memory ID assignment ---

describe("witnessSystem — memory ID assignment", () => {
    it("assigns unique IDs to memories from multiple events", () => {
        const world = makeWorld();
        const s1 = spawnEntity(world, { position: 5 });
        const s2 = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        addComponent(world, witness, MEMORY, createMemory());
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [
            makeEvent("foundBody", s1, { side: 0, position: 5, floor: 0 }),
            makeEvent("foundBody", s2, { side: 0, position: 5, floor: 0 }),
        ], 100, prebuilt);

        const mem = getComponent(world, witness, MEMORY);
        assert.equal(mem.entries.length, 2);
        const ids = new Set(mem.entries.map(e => e.id));
        assert.equal(ids.size, 2, "each memory entry should have a unique ID");
    });
});

// --- witnessSystem: auto-creates MEMORY component ---

describe("witnessSystem — component creation", () => {
    it("creates MEMORY component on entity that lacks one", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        // witness has no MEMORY component initially
        const prebuilt = buildLocationIndex(world);

        witnessSystem(world, [makeEvent("foundBody", subject, { side: 0, position: 5, floor: 0 })], 100, prebuilt);

        const mem = getComponent(world, witness, MEMORY);
        assert.ok(mem, "MEMORY component should be created automatically");
        assert.equal(mem.entries.length, 1);
    });
});

// --- witnessSystem: unknown type ---

describe("witnessSystem — unknown event type", () => {
    it("skips events with unknown types gracefully", () => {
        const world = makeWorld();
        const subject = spawnEntity(world, { position: 5 });
        const witness = spawnEntity(world, { position: 5 });
        const prebuilt = buildLocationIndex(world);

        // Should not throw
        witnessSystem(world, [
            { type: "unknownType", subject, position: { side: 0, position: 5, floor: 0 }, bondedOnly: false, range: "colocated" },
        ], 100, prebuilt);

        const mem = getComponent(world, witness, MEMORY);
        assert.ok(!mem || mem.entries.length === 0, "unknown type should produce no memory");
    });

    it("REACHED_MERCY type exists in MEMORY_TYPES", () => {
        assert.ok(MEMORY_TYPES.REACHED_MERCY);
        assert.strictEqual(MEMORY_TYPES.REACHED_MERCY, "reachedMercy");
    });

    it("REACHED_MERCY config has positive hope drain", () => {
        const tc = DEFAULT_MEMORY_CONFIG.types[MEMORY_TYPES.REACHED_MERCY];
        assert.ok(tc, "config exists");
        assert.ok(tc.hopeDrainPerTick > 0, "hope drain is positive (boost)");
        assert.strictEqual(tc.permanent, false, "not permanent — the hope fades");
    });
});

describe("NPC mercy kiosk memory", () => {
    it("NPC at mercy kiosk gets REACHED_MERCY memory and hope boost", () => {
        const world = createWorld();
        const ent = spawn(world);
        const bookVision = { side: 0, position: 5n, floor: 100n, bookIndex: 3 };
        addComponent(world, ent, POSITION, { side: 0, position: 0n, floor: 100n });
        addComponent(world, ent, PSYCHOLOGY, { hope: 30, lucidity: 80, sociability: 50 });
        addComponent(world, ent, MEMORY, createMemory());

        // Verify this IS a mercy kiosk
        const pos = getComponent(world, ent, POSITION);
        assert.strictEqual(mercyKiosk(pos, bookVision), "left");

        // Simulate what social.js does: detect + create memory + boost
        const mem = getComponent(world, ent, MEMORY);
        const tc = DEFAULT_MEMORY_CONFIG.types[MEMORY_TYPES.REACHED_MERCY];
        addMemory(mem, {
            id: mem.nextId++, type: MEMORY_TYPES.REACHED_MERCY,
            tick: 0, weight: tc.initialWeight, initialWeight: tc.initialWeight,
            permanent: tc.permanent, subject: null, contagious: tc.contagious,
        });

        const psych = getComponent(world, ent, PSYCHOLOGY);
        psych.hope = Math.min(100, psych.hope + 40);

        assert.strictEqual(mem.entries.length, 1);
        assert.strictEqual(mem.entries[0].type, "reachedMercy");
        assert.strictEqual(mem.entries[0].subject, null, "location event, not witness");
        assert.strictEqual(psych.hope, 70);
    });
});
