import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Inline replacer/reviver matching engine.js implementation
function replacer(key, value) {
    if (typeof value === 'bigint') return { __bigint: value.toString() };
    if (value instanceof Set) return { __set: Array.from(value) };
    if (value instanceof Map) return { __map: Array.from(value.entries()) };
    return value;
}
function reviver(key, value) {
    if (value && typeof value === 'object') {
        if ('__bigint' in value) return BigInt(value.__bigint);
        if ('__set' in value) return new Set(value.__set);
        if ('__map' in value) return new Map(value.__map);
    }
    return value;
}

describe("Set/Map JSON round-trip", () => {
    it("Set survives JSON round-trip", () => {
        const obj = { data: new Set(["a", "b", "c"]) };
        const json = JSON.stringify(obj, replacer);
        const result = JSON.parse(json, reviver);
        assert.ok(result.data instanceof Set);
        assert.equal(result.data.size, 3);
        assert.ok(result.data.has("a"));
        assert.ok(result.data.has("b"));
        assert.ok(result.data.has("c"));
    });

    it("empty Set round-trips", () => {
        const obj = { data: new Set() };
        const json = JSON.stringify(obj, replacer);
        const result = JSON.parse(json, reviver);
        assert.ok(result.data instanceof Set);
        assert.equal(result.data.size, 0);
    });

    it("Map survives JSON round-trip", () => {
        const obj = { data: new Map([["key1", 42], ["key2", 99]]) };
        const json = JSON.stringify(obj, replacer);
        const result = JSON.parse(json, reviver);
        assert.ok(result.data instanceof Map);
        assert.equal(result.data.get("key1"), 42);
        assert.equal(result.data.get("key2"), 99);
        assert.equal(result.data.size, 2);
    });

    it("empty Map round-trips", () => {
        const obj = { data: new Map() };
        const json = JSON.stringify(obj, replacer);
        const result = JSON.parse(json, reviver);
        assert.ok(result.data instanceof Map);
        assert.equal(result.data.size, 0);
    });

    it("nested Set inside Map value round-trips", () => {
        const inner = new Set(["x", "y"]);
        const obj = { data: new Map([["progress", inner]]) };
        const json = JSON.stringify(obj, replacer);
        const result = JSON.parse(json, reviver);
        assert.ok(result.data instanceof Map);
        const restored = result.data.get("progress");
        assert.ok(restored instanceof Set);
        assert.ok(restored.has("x"));
        assert.ok(restored.has("y"));
    });

    it("BigInt + Set + Map coexist in one object", () => {
        const obj = {
            position: 12345678901234567890n,
            searched: new Set(["seg1", "seg2"]),
            exposures: new Map([["death", 3], ["chasm", 1]]),
        };
        const json = JSON.stringify(obj, replacer);
        const result = JSON.parse(json, reviver);
        assert.equal(result.position, 12345678901234567890n);
        assert.ok(result.searched instanceof Set);
        assert.equal(result.searched.size, 2);
        assert.ok(result.exposures instanceof Map);
        assert.equal(result.exposures.get("death"), 3);
    });

    it("Map with numeric-ish string keys round-trips", () => {
        // Bond maps keyed by NPC id (serialized as string keys in bondsByNpcId)
        const obj = { bonds: new Map([[0, { familiarity: 5 }], [7, { familiarity: 12 }]]) };
        const json = JSON.stringify(obj, replacer);
        const result = JSON.parse(json, reviver);
        assert.ok(result.bonds instanceof Map);
        assert.equal(result.bonds.get(0).familiarity, 5);
        assert.equal(result.bonds.get(7).familiarity, 12);
    });
});

describe("ECS component snapshot shape", () => {
    it("psychology snapshot has expected fields", () => {
        const snapshot = { lucidity: 75, hope: 40 };
        const json = JSON.stringify(snapshot, replacer);
        const result = JSON.parse(json, reviver);
        assert.equal(result.lucidity, 75);
        assert.equal(result.hope, 40);
    });

    it("habituation with Map<string, number> exposures round-trips", () => {
        const snapshot = {
            exposures: new Map([["death", 3], ["chasm", 1], ["pilgrimageFailure", 0]]),
        };
        const json = JSON.stringify(snapshot, replacer);
        const result = JSON.parse(json, reviver);
        assert.ok(result.exposures instanceof Map);
        assert.equal(result.exposures.get("death"), 3);
        assert.equal(result.exposures.get("chasm"), 1);
        assert.equal(result.exposures.get("pilgrimageFailure"), 0);
    });

    it("relationship bonds keyed by NPC id survive round-trip", () => {
        const snapshot = {
            bondsByNpcId: {
                "3": { familiarity: 10, affinity: 0.5, lastEncounter: 1440, encounters: 5 },
                "-1": { familiarity: 2, affinity: 0.1, lastEncounter: 720, encounters: 1 },
            },
        };
        const json = JSON.stringify(snapshot, replacer);
        const result = JSON.parse(json, reviver);
        assert.equal(result.bondsByNpcId["3"].familiarity, 10);
        assert.equal(result.bondsByNpcId["-1"].encounters, 1);
    });

    it("memory entries with Set fields survive round-trip", () => {
        const snapshot = {
            entries: [
                { id: 0, type: "bookVision", tick: 100, weight: 1.0, coords: { side: 0, position: 5n, floor: 10n } },
                { id: 1, type: "searchProgress", tick: 200, weight: 0.8, searched: new Set(["s0:5:10", "s0:6:10"]) },
            ],
            capacity: 32,
            nextId: 2,
        };
        const json = JSON.stringify(snapshot, replacer);
        const result = JSON.parse(json, reviver);
        assert.equal(result.entries.length, 2);
        assert.equal(result.entries[0].coords.position, 5n);
        assert.ok(result.entries[1].searched instanceof Set);
        assert.equal(result.entries[1].searched.size, 2);
        assert.equal(result.nextId, 2);
    });
});
