import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyMoveTick, applySleep, applyEat, applyDrink, defaultStats } from "../lib/survival.core.ts";

describe("hunger/thirst monotonic progression", () => {
    it("hunger increases monotonically over 200 move ticks", () => {
        let stats = defaultStats();
        for (let i = 0; i < 200; i++) {
            const prev = stats.hunger;
            stats = applyMoveTick(stats);
            assert.ok(stats.hunger >= prev,
                `tick ${i}: hunger went from ${prev} to ${stats.hunger}`);
        }
        assert.ok(stats.hunger > 0, "hunger should have increased");
    });

    it("thirst increases monotonically over 200 move ticks", () => {
        let stats = defaultStats();
        for (let i = 0; i < 200; i++) {
            const prev = stats.thirst;
            stats = applyMoveTick(stats);
            assert.ok(stats.thirst >= prev,
                `tick ${i}: thirst went from ${prev} to ${stats.thirst}`);
        }
        assert.ok(stats.thirst > 0, "thirst should have increased");
    });

    it("hunger decreases on eat, then resumes climbing", () => {
        let stats = defaultStats();
        for (let i = 0; i < 100; i++) stats = applyMoveTick(stats);
        const before = stats.hunger;
        assert.ok(before > 0, "should be hungry after 100 ticks");

        stats = applyEat(stats);
        assert.ok(stats.hunger < before, "eating should reduce hunger");

        const afterEat = stats.hunger;
        for (let i = 0; i < 50; i++) {
            const prev = stats.hunger;
            stats = applyMoveTick(stats);
            assert.ok(stats.hunger >= prev, `post-eat tick ${i}: hunger regressed`);
        }
        assert.ok(stats.hunger > afterEat, "hunger should climb again after eating");
    });

    it("thirst decreases on drink, then resumes climbing", () => {
        let stats = defaultStats();
        for (let i = 0; i < 100; i++) stats = applyMoveTick(stats);
        const before = stats.thirst;
        assert.ok(before > 0, "should be thirsty after 100 ticks");

        stats = applyDrink(stats);
        assert.ok(stats.thirst < before, "drinking should reduce thirst");

        const afterDrink = stats.thirst;
        for (let i = 0; i < 50; i++) {
            const prev = stats.thirst;
            stats = applyMoveTick(stats);
            assert.ok(stats.thirst >= prev, `post-drink tick ${i}: thirst regressed`);
        }
        assert.ok(stats.thirst > afterDrink, "thirst should climb again after drinking");
    });

    it("sleep increases hunger and thirst slightly", () => {
        let stats = defaultStats();
        for (let i = 0; i < 50; i++) stats = applyMoveTick(stats);
        const hungerBefore = stats.hunger;
        const thirstBefore = stats.thirst;

        stats = applySleep(stats);
        assert.ok(stats.hunger >= hungerBefore, "sleep should not reduce hunger");
        assert.ok(stats.thirst >= thirstBefore, "sleep should not reduce thirst");
    });

    it("mortality only drains when parched or starving", () => {
        let stats = defaultStats();
        // 100 ticks: not yet at 100 hunger/thirst
        for (let i = 0; i < 100; i++) stats = applyMoveTick(stats);
        assert.strictEqual(stats.mortality, 100, "mortality stays 100 when not critical");

        // Push to parched
        stats.thirst = 100;
        stats = applyMoveTick(stats);
        assert.ok(stats.mortality < 100, "mortality drains when parched");
    });

    it("dehydration kills within expected timeframe", () => {
        let stats = defaultStats();
        stats.thirst = 100; // start parched
        let ticks = 0;
        while (!stats.dead && ticks < 500) {
            stats = applyMoveTick(stats);
            ticks++;
        }
        assert.ok(stats.dead, "should die from dehydration");
        // 0.83/tick drain rate, 100 mortality -> ~120 ticks (~0.5 days)
        assert.ok(ticks < 200, `death took ${ticks} ticks, expected < 200`);
        assert.ok(ticks > 50, `death too fast at ${ticks} ticks`);
    });

    it("starvation kills within expected timeframe", () => {
        let stats = defaultStats();
        stats.hunger = 100; // start starving
        let ticks = 0;
        while (!stats.dead && ticks < 500) {
            stats = applyMoveTick(stats);
            ticks++;
        }
        assert.ok(stats.dead, "should die from starvation");
        // 0.42/tick drain rate, 100 mortality -> ~238 ticks (~1 day)
        assert.ok(ticks < 350, `death took ${ticks} ticks, expected < 350`);
        assert.ok(ticks > 100, `death too fast at ${ticks} ticks`);
    });
});
