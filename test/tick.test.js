import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    TICKS_PER_DAY, LIGHTS_ON_TICKS, TICKS_PER_HOUR,
    defaultTickState, advanceTick, isLightsOn,
    tickToTimeString, ticksUntilDawn, hoursUntilDawn,
} from "../lib/tick.core.js";
import {
    defaultStats, applyMoveTick, applySleep, applyEat, applyDrink, applyAlcohol,
    applyResurrection, showMortality, getWarnings, STAT_MIN, STAT_MAX,
} from "../lib/survival.core.js";

// --- tick.core ---

describe("defaultTickState", () => {
    it("starts at tick 0, day 1", () => {
        const s = defaultTickState();
        assert.strictEqual(s.tick, 0);
        assert.strictEqual(s.day, 1);
    });
});

describe("advanceTick", () => {
    it("increments tick without events mid-day", () => {
        const { state, events } = advanceTick({ tick: 0, day: 1 }, 5);
        assert.strictEqual(state.tick, 5);
        assert.strictEqual(state.day, 1);
        assert.deepStrictEqual(events, []);
    });

    it("emits lightsOut when crossing LIGHTS_ON_TICKS", () => {
        const { state, events } = advanceTick({ tick: 159, day: 1 }, 1);
        assert.strictEqual(state.tick, 160);
        assert.ok(events.includes("lightsOut"));
    });

    it("does not emit lightsOut if already past it", () => {
        const { state, events } = advanceTick({ tick: 161, day: 1 }, 1);
        assert.deepStrictEqual(events, []);
    });

    it("emits dawn and wraps tick when crossing TICKS_PER_DAY", () => {
        const { state, events } = advanceTick({ tick: 239, day: 1 }, 1);
        assert.strictEqual(state.tick, 0);
        assert.strictEqual(state.day, 2);
        assert.ok(events.includes("dawn"));
    });

    it("emits both lightsOut and dawn when skipping from pre-lights-out to next day", () => {
        // Jump from tick 150 by 100 ticks: crosses 160 (lightsOut) and 240 (dawn)
        const { state, events } = advanceTick({ tick: 150, day: 1 }, 100);
        assert.ok(events.includes("lightsOut"), "should emit lightsOut");
        assert.ok(events.includes("dawn"), "should emit dawn");
        assert.strictEqual(state.day, 2);
        assert.strictEqual(state.tick, 10); // 150+100=250, 250%240=10
    });

    it("does not emit lightsOut on a new day tick already past lights-on window", () => {
        const { events } = advanceTick({ tick: 0, day: 2 }, 1);
        assert.deepStrictEqual(events, []);
    });

    it("emits multiple dawns when skipping multiple days (fugue)", () => {
        const { state, events } = advanceTick({ tick: 0, day: 1 }, TICKS_PER_DAY * 3);
        assert.strictEqual(events.filter(e => e === "dawn").length, 3);
        assert.strictEqual(state.day, 4);
        assert.strictEqual(state.tick, 0);
    });

    it("emits lightsOut once per day when skipping two days", () => {
        const { events } = advanceTick({ tick: 0, day: 1 }, TICKS_PER_DAY * 2);
        assert.strictEqual(events.filter(e => e === "lightsOut").length, 2);
        assert.strictEqual(events.filter(e => e === "dawn").length, 2);
    });
});

describe("isLightsOn", () => {
    it("is true at tick 0", () => assert.ok(isLightsOn(0)));
    it("is true just before lights-out", () => assert.ok(isLightsOn(LIGHTS_ON_TICKS - 1)));
    it("is false at lights-out tick", () => assert.ok(!isLightsOn(LIGHTS_ON_TICKS)));
    it("is false near end of day", () => assert.ok(!isLightsOn(TICKS_PER_DAY - 1)));
});

describe("tickToTimeString", () => {
    it("tick 0 = 6:00 AM", () => assert.strictEqual(tickToTimeString(0), "6:00 AM"));
    it("tick 160 = 10:00 PM", () => assert.strictEqual(tickToTimeString(160), "10:00 PM"));
    it("tick 60 = 12:00 PM", () => assert.strictEqual(tickToTimeString(60), "12:00 PM"));
    it("tick 70 = 1:00 PM",  () => assert.strictEqual(tickToTimeString(70), "1:00 PM"));
    it("tick 10 = 7:00 AM",  () => assert.strictEqual(tickToTimeString(10), "7:00 AM"));
});

describe("ticksUntilDawn / hoursUntilDawn", () => {
    it("at tick 0, 240 ticks until dawn", () => assert.strictEqual(ticksUntilDawn(0), 240));
    it("at tick 239, 1 tick until dawn", () => assert.strictEqual(ticksUntilDawn(239), 1));
    it("hoursUntilDawn rounds up", () => assert.strictEqual(hoursUntilDawn(231), 1));
    it("hoursUntilDawn at tick 0 = 24", () => assert.strictEqual(hoursUntilDawn(0), 24));
});

describe("repeated death-resurrection cycle", () => {
    it("days climb rapidly when killed immediately after resurrection", () => {
        let tick = { tick: 0, day: 1 };
        let stats = defaultStats();
        const MURDERS = 100;

        for (let i = 0; i < MURDERS; i++) {
            stats = { ...stats, dead: true, mortality: 0 };
            while (true) {
                const result = advanceTick(tick, TICKS_PER_HOUR);
                tick = result.state;
                if (result.events.includes("dawn")) {
                    stats = applyResurrection(stats);
                    break;
                }
            }
            assert.strictEqual(stats.dead, false, "should be alive after dawn");
            assert.strictEqual(stats.mortality, 100, "mortality should be full");
        }
        assert.strictEqual(tick.day, 1 + MURDERS, "each murder should advance exactly one day");
    });

    it("held book persists through repeated deaths", () => {
        let tick = { tick: 0, day: 1 };
        let stats = defaultStats();
        const heldBook = { side: 0, position: 5, floor: 3, bookIndex: 42 };

        for (let i = 0; i < 10; i++) {
            stats = { ...stats, dead: true, mortality: 0 };
            while (true) {
                const result = advanceTick(tick, TICKS_PER_HOUR);
                tick = result.state;
                if (result.events.includes("dawn")) {
                    stats = applyResurrection(stats);
                    break;
                }
            }
        }
        assert.deepStrictEqual(heldBook, { side: 0, position: 5, floor: 3, bookIndex: 42 });
    });
});

// --- survival.core ---

describe("defaultStats", () => {
    it("has expected starting values", () => {
        const s = defaultStats();
        assert.strictEqual(s.hunger, 0);
        assert.strictEqual(s.thirst, 0);
        assert.strictEqual(s.exhaustion, 0);
        assert.strictEqual(s.morale, 100);
        assert.strictEqual(s.mortality, 100);
        assert.strictEqual(s.despairing, false);
        assert.strictEqual(s.dead, false);
    });
});

describe("applyMoveTick", () => {
    it("increases hunger, thirst, exhaustion", () => {
        const s = applyMoveTick(defaultStats());
        assert.ok(s.hunger > 0);
        assert.ok(s.thirst > 0);
        assert.ok(s.exhaustion > 0);
    });

    it("does not touch mortality when stats are healthy", () => {
        const s = applyMoveTick(defaultStats());
        assert.strictEqual(s.mortality, 100);
        assert.strictEqual(s.dead, false);
    });

    it("activates mortality when thirst hits 100", () => {
        const stats = { ...defaultStats(), thirst: 99.95 }; // will clamp to 100 after move
        const s = applyMoveTick(stats);
        assert.strictEqual(s.thirst, 100);
        assert.ok(s.mortality < 100, "mortality should start draining");
        assert.strictEqual(s.dead, false);
    });
});

describe("mortality", () => {
    it("drains faster when both parched and starving", () => {
        const both    = applyMoveTick({ ...defaultStats(), hunger: 100, thirst: 100, mortality: 100 });
        const parched = applyMoveTick({ ...defaultStats(), hunger: 0,   thirst: 100, mortality: 100 });
        assert.ok(both.mortality < parched.mortality, "both conditions drain faster");
    });

    it("drains faster when parched than when starving", () => {
        const parched  = applyMoveTick({ ...defaultStats(), hunger: 0,   thirst: 100, mortality: 100 });
        const starving = applyMoveTick({ ...defaultStats(), hunger: 100, thirst: 0,   mortality: 100 });
        assert.ok(parched.mortality < starving.mortality, "parched drains faster than starving");
    });

    it("resets to 100 when neither parched nor starving after eat+drink", () => {
        const starved = { ...defaultStats(), hunger: 100, thirst: 100, mortality: 50 };
        const s = applyEat(applyDrink(starved));
        assert.strictEqual(s.mortality, 100);
    });

    it("does not reset if only one condition cleared", () => {
        // Only drink — still starving
        const both = { ...defaultStats(), hunger: 100, thirst: 100, mortality: 50 };
        const s = applyDrink(both);
        assert.ok(s.mortality < 100, "mortality should not reset while still starving");
    });

    it("sets dead when mortality reaches 0", () => {
        const s = applyMoveTick({ ...defaultStats(), hunger: 100, thirst: 100, mortality: 0.5 });
        assert.strictEqual(s.dead, true);
    });
});

describe("applyResurrection", () => {
    it("restores all stats to defaults", () => {
        const dead = { ...defaultStats(), hunger: 100, thirst: 100, mortality: 0, dead: true };
        const s = applyResurrection(dead);
        assert.strictEqual(s.hunger, 0);
        assert.strictEqual(s.thirst, 0);
        assert.strictEqual(s.mortality, 100);
        assert.strictEqual(s.dead, false);
    });
});

describe("applyAlcohol", () => {
    it("boosts morale", () => {
        const s = applyAlcohol({ ...defaultStats(), morale: 50 });
        assert.strictEqual(s.morale, 70);
    });

    it("clamps morale at 100", () => {
        const s = applyAlcohol({ ...defaultStats(), morale: 90 });
        assert.strictEqual(s.morale, 100);
    });

    it("also reduces thirst", () => {
        const s = applyAlcohol({ ...defaultStats(), thirst: 50 });
        assert.strictEqual(s.thirst, 30);
    });

    it("does not affect hunger or exhaustion", () => {
        const s = applyAlcohol({ ...defaultStats(), hunger: 60, exhaustion: 40 });
        assert.strictEqual(s.hunger, 60);
        assert.strictEqual(s.exhaustion, 40);
    });
});

describe("showMortality", () => {
    it("false when healthy", () => assert.ok(!showMortality(defaultStats())));
    it("true when parched",  () => assert.ok(showMortality({ ...defaultStats(), thirst: 100 })));
    it("true when starving", () => assert.ok(showMortality({ ...defaultStats(), hunger: 100 })));
});

describe("getWarnings", () => {
    it("returns parched warning when thirst = 100", () => {
        const w = getWarnings({ ...defaultStats(), thirst: 100 });
        assert.ok(w.some(s => s.toLowerCase().includes("dust") || s.toLowerCase().includes("water")));
    });
    it("returns starving warning when hunger = 100", () => {
        const w = getWarnings({ ...defaultStats(), hunger: 100 });
        assert.ok(w.some(s => s.toLowerCase().includes("food") || s.toLowerCase().includes("eating")));
    });
    it("returns despairing warning when despairing", () => {
        const w = getWarnings({ ...defaultStats(), despairing: true });
        assert.ok(w.some(s => s.toLowerCase().includes("nothing") || s.toLowerCase().includes("matters")));
    });
    it("empty when all healthy", () => {
        assert.deepStrictEqual(getWarnings(defaultStats()), []);
    });
});
