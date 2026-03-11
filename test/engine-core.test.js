import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createBoundaryRegistry, processTime } from "../lib/engine.core.ts";

describe("createBoundaryRegistry", () => {
    it("fires registered handler", () => {
        const reg = createBoundaryRegistry();
        let fired = false;
        reg.on("dawn", () => { fired = true; });
        reg.fire("dawn");
        assert.ok(fired);
    });

    it("fires multiple handlers in order", () => {
        const reg = createBoundaryRegistry();
        const order = [];
        reg.on("dawn", () => order.push("a"));
        reg.on("dawn", () => order.push("b"));
        reg.fire("dawn");
        assert.deepStrictEqual(order, ["a", "b"]);
    });

    it("does nothing for unknown events", () => {
        const reg = createBoundaryRegistry();
        reg.fire("nonexistent"); // should not throw
    });

    it("isolates handler errors", () => {
        const reg = createBoundaryRegistry();
        const order = [];
        reg.on("dawn", () => { throw new Error("boom"); });
        reg.on("dawn", () => order.push("survived"));
        reg.fire("dawn");
        assert.deepStrictEqual(order, ["survived"]);
    });

    it("supports multiple event types independently", () => {
        const reg = createBoundaryRegistry();
        const results = [];
        reg.on("dawn", () => results.push("dawn"));
        reg.on("lightsOut", () => results.push("lightsOut"));
        reg.fire("dawn");
        assert.deepStrictEqual(results, ["dawn"]);
        reg.fire("lightsOut");
        assert.deepStrictEqual(results, ["dawn", "lightsOut"]);
    });
});

describe("processTime", () => {
    let reg;

    beforeEach(() => {
        reg = createBoundaryRegistry();
    });

    it("advances ticks and returns result", () => {
        const result = processTime({ tick: 0, day: 1 }, 10, reg);
        assert.equal(result.finalTick, 10);
        assert.equal(result.finalDay, 1);
        assert.equal(result.days, 0);
        assert.deepStrictEqual(result.tickEvents, []);
    });

    it("fires lightsOut when crossing tick 960", () => {
        const events = [];
        reg.on("lightsOut", () => events.push("lightsOut"));
        const result = processTime({ tick: 955, day: 1 }, 10, reg);
        assert.deepStrictEqual(events, ["lightsOut"]);
        assert.ok(result.tickEvents.includes("lightsOut"));
    });

    it("fires dawn when crossing tick 1440", () => {
        const events = [];
        reg.on("dawn", () => events.push("dawn"));
        const result = processTime({ tick: 1435, day: 1 }, 10, reg);
        assert.ok(events.includes("dawn"));
        assert.equal(result.finalDay, 2);
        assert.equal(result.days, 1);
    });

    it("fires resetHour when crossing tick 1380", () => {
        const events = [];
        reg.on("resetHour", () => events.push("resetHour"));
        processTime({ tick: 1375, day: 1 }, 10, reg);
        assert.deepStrictEqual(events, ["resetHour"]);
    });

    it("fires events in order for full day skip", () => {
        const events = [];
        reg.on("lightsOut", () => events.push("lightsOut"));
        reg.on("resetHour", () => events.push("resetHour"));
        reg.on("dawn", () => events.push("dawn"));
        processTime({ tick: 0, day: 1 }, 1440, reg);
        assert.deepStrictEqual(events, ["lightsOut", "resetHour", "dawn"]);
    });

    it("fires one dawn event for multi-day request (clamped to 2400 < 2*1440)", () => {
        // MAX_ADVANCE_TICKS=2400 < 2*1440=2880 → request for 2 days clamps to 1 dawn
        const dawnCount = { n: 0 };
        reg.on("dawn", () => dawnCount.n++);
        const result = processTime({ tick: 0, day: 1 }, 2880, reg);
        assert.equal(dawnCount.n, 1);
        assert.equal(result.days, 1);
        assert.equal(result.finalDay, 2);
    });

    it("clamps to minimum of 1", () => {
        const result = processTime({ tick: 0, day: 1 }, 0, reg);
        assert.equal(result.finalTick, 1);
    });

    it("clamps to maximum of 2400 ticks (~1.67 days)", () => {
        const dawnCount = { n: 0 };
        reg.on("dawn", () => dawnCount.n++);
        const result = processTime({ tick: 0, day: 1 }, 99999, reg);
        // MAX_ADVANCE_TICKS=2400; 2400/1440=1.67 days → 1 dawn
        assert.equal(dawnCount.n, 1);
        assert.equal(result.days, 1);
    });

    it("handler errors do not stop event processing", () => {
        const events = [];
        reg.on("lightsOut", () => { throw new Error("fail"); });
        reg.on("dawn", () => events.push("dawn"));
        processTime({ tick: 0, day: 1 }, 1440, reg);
        assert.deepStrictEqual(events, ["dawn"]);
    });
});
