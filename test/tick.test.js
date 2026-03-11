import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    TICKS_PER_DAY, LIGHTS_ON_TICKS, TICKS_PER_HOUR,
    defaultTickState, advanceTick, isLightsOn,
    tickToTimeString, ticksUntilDawn, hoursUntilDawn,
} from "../lib/tick.core.ts";
import {
    defaultStats, applyMoveTick, applySleep, applyEat, applyDrink, applyAlcohol,
    applyResurrection, showMortality, getWarnings, canSleep,
    STAT_MIN, STAT_MAX, SLEEP_EXHAUSTION_THRESHOLD, NEAR_BEDTIME_TICK,
} from "../lib/survival.core.ts";

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
        const { state, events } = advanceTick({ tick: 959, day: 1 }, 1);
        assert.strictEqual(state.tick, 960);
        assert.ok(events.includes("lightsOut"));
    });

    it("does not emit lightsOut if already past it", () => {
        const { state, events } = advanceTick({ tick: 961, day: 1 }, 1);
        assert.deepStrictEqual(events, []);
    });

    it("emits dawn and wraps tick when crossing TICKS_PER_DAY", () => {
        const { state, events } = advanceTick({ tick: 1439, day: 1 }, 1);
        assert.strictEqual(state.tick, 0);
        assert.strictEqual(state.day, 2);
        assert.ok(events.includes("dawn"));
    });

    it("emits both lightsOut and dawn when skipping from pre-lights-out to next day", () => {
        // Jump from tick 900 by 600 ticks: crosses 960 (lightsOut) and 1440 (dawn)
        const { state, events } = advanceTick({ tick: 900, day: 1 }, 600);
        assert.ok(events.includes("lightsOut"), "should emit lightsOut");
        assert.ok(events.includes("dawn"), "should emit dawn");
        assert.strictEqual(state.day, 2);
        assert.strictEqual(state.tick, 60); // 900+600=1500, 1500%1440=60
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
    it("tick 960 = 10:00 PM", () => assert.strictEqual(tickToTimeString(960), "10:00 PM"));
    it("tick 360 = 12:00 PM", () => assert.strictEqual(tickToTimeString(360), "12:00 PM"));
    it("tick 420 = 1:00 PM",  () => assert.strictEqual(tickToTimeString(420), "1:00 PM"));
    it("tick 60 = 7:00 AM",   () => assert.strictEqual(tickToTimeString(60), "7:00 AM"));
});

describe("ticksUntilDawn / hoursUntilDawn", () => {
    it("at tick 0, 1440 ticks until dawn", () => assert.strictEqual(ticksUntilDawn(0), 1440));
    it("at tick 1439, 1 tick until dawn", () => assert.strictEqual(ticksUntilDawn(1439), 1));
    it("hoursUntilDawn rounds up", () => assert.strictEqual(hoursUntilDawn(1381), 1));
    it("hoursUntilDawn at tick 0 = 24", () => assert.strictEqual(hoursUntilDawn(0), 24));
});

describe("repeated death-resurrection cycle", () => {
    it("days climb rapidly when killed immediately after resurrection", () => {
        let tick = { tick: 0, day: 1 };
        let stats = defaultStats();
        const MURDERS = 100;

        for (let i = 0; i < MURDERS; i++) {
            stats = { ...stats, dead: true, mortality: 0 };
            let safety = 0;
            while (safety++ < 100) {
                const result = advanceTick(tick, TICKS_PER_HOUR);
                tick = result.state;
                if (result.events.includes("dawn")) {
                    stats = applyResurrection(stats);
                    break;
                }
            }
            assert.ok(safety <= 100, "dawn should arrive within 100 hour-steps");
            assert.strictEqual(stats.dead, false, "should be alive after dawn");
            assert.strictEqual(stats.mortality, 100, "mortality should be full");
        }
        assert.strictEqual(tick.day, 1 + MURDERS, "each murder should advance exactly one day");
    });

    it("held book persists through repeated deaths", () => {
        let tick = { tick: 0, day: 1 };
        let stats = defaultStats();
        const heldBook = { side: 0, position: 5n, floor: 3n, bookIndex: 42 };

        for (let i = 0; i < 10; i++) {
            stats = { ...stats, dead: true, mortality: 0 };
            let safety = 0;
            while (safety++ < 100) {
                const result = advanceTick(tick, TICKS_PER_HOUR);
                tick = result.state;
                if (result.events.includes("dawn")) {
                    stats = applyResurrection(stats);
                    break;
                }
            }
            assert.ok(safety <= 100, "dawn should arrive within 100 hour-steps");
        }
        assert.deepStrictEqual(heldBook, { side: 0, position: 5n, floor: 3n, bookIndex: 42 });
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
        const stats = { ...defaultStats(), thirst: 99.999 }; // will clamp to 100 after move
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
        // mortality drains per tick at MORTALITY_BOTH rate; use a value just above 0
        // that will drop to 0 or below after one move tick
        const s = applyMoveTick({ ...defaultStats(), hunger: 100, thirst: 100, mortality: 0.01 });
        assert.strictEqual(s.dead, true);
    });
});

describe("applyResurrection", () => {
    it("restores physical stats but preserves morale", () => {
        const dead = { ...defaultStats(), hunger: 100, thirst: 100, morale: 30, despairing: false, mortality: 0, dead: true };
        const s = applyResurrection(dead);
        assert.strictEqual(s.hunger, 0);
        assert.strictEqual(s.thirst, 0);
        assert.strictEqual(s.mortality, 100);
        assert.strictEqual(s.dead, false);
        assert.strictEqual(s.morale, 30, "morale preserved through death");
        assert.strictEqual(s.despairing, false);
    });
    it("preserves despairing through death", () => {
        const dead = { ...defaultStats(), morale: 0, despairing: true, mortality: 0, dead: true };
        const s = applyResurrection(dead);
        assert.strictEqual(s.morale, 0);
        assert.strictEqual(s.despairing, true, "despairing carries through resurrection");
    });
});

describe("canSleep", () => {
    it("blocks sleep when not exhausted", () => {
        assert.strictEqual(canSleep(0), false);
        assert.strictEqual(canSleep(SLEEP_EXHAUSTION_THRESHOLD - 1), false);
    });
    it("allows sleep at threshold", () => {
        assert.strictEqual(canSleep(SLEEP_EXHAUSTION_THRESHOLD), true);
    });
    it("allows sleep above threshold", () => {
        assert.strictEqual(canSleep(100), true);
    });
    it("allows sleep when lights off regardless of exhaustion", () => {
        assert.strictEqual(canSleep(0, false), true);
        assert.strictEqual(canSleep(SLEEP_EXHAUSTION_THRESHOLD - 1, false), true);
    });
    it("still requires exhaustion when lights on", () => {
        assert.strictEqual(canSleep(0, true), false);
        assert.strictEqual(canSleep(SLEEP_EXHAUSTION_THRESHOLD, true), true);
    });
    it("allows sleep near bedtime regardless of exhaustion", () => {
        assert.strictEqual(canSleep(0, true, NEAR_BEDTIME_TICK), true);
        assert.strictEqual(canSleep(0, true, NEAR_BEDTIME_TICK + 5), true);
    });
    it("blocks sleep before bedtime window without exhaustion", () => {
        assert.strictEqual(canSleep(0, true, NEAR_BEDTIME_TICK - 1), false);
        assert.strictEqual(canSleep(0, true, 0), false);
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
