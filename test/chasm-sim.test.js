import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSimulation, strategies } from "../lib/simulator.core.ts";
import * as ChasmCore from "../lib/chasm.core.ts";
import * as Surv from "../lib/survival.core.ts";
import * as Tick from "../lib/tick.core.ts";

/**
 * Simulate a freefall manually using core modules.
 * The simulator doesn't have jump/grab actions yet, so we wire it by hand.
 */

describe("chasm simulation: freefall from height", () => {
    it("falling from floor 100 reaches floor 0", () => {
        let floor = 100;
        let speed = 0;
        let ticks = 0;

        while (floor > 0) {
            const r = ChasmCore.fallTick({ speed }, floor);
            floor = r.newFloor;
            speed = r.newSpeed;
            ticks++;
        }

        assert.strictEqual(floor, 0);
        assert.ok(ticks > 0);
        assert.ok(speed >= ChasmCore.LANDING_KILL_SPEED, "should be fatal speed from floor 100");
    });

    it("falling from floor 5 at low speed is survivable", () => {
        // Start at speed 0, fall from floor 5
        // tick 1: speed 1, floor 4
        // tick 2: speed 2, floor 2
        // tick 3: speed 3, floor 0 — landed, speed 3 < 10, not fatal
        let floor = 5;
        let speed = 0;
        let result;

        while (floor > 0) {
            result = ChasmCore.fallTick({ speed }, floor);
            floor = result.newFloor;
            speed = result.newSpeed;
        }

        assert.strictEqual(result.landed, true);
        assert.strictEqual(result.fatal, false);
    });

    it("survival stats deplete during freefall", () => {
        let stats = Surv.defaultStats();
        let tickState = Tick.defaultTickState();
        const initialThirst = stats.thirst;
        const initialHunger = stats.hunger;

        // Simulate 50 ticks of falling (just survival, no actual fall physics)
        for (let i = 0; i < 50; i++) {
            stats = Surv.applyMoveTick(stats);
            const adv = Tick.advanceTick(tickState, 1);
            tickState = adv.state;
        }

        assert.ok(stats.thirst > initialThirst, "thirst increased");
        assert.ok(stats.hunger > initialHunger, "hunger increased");
        assert.ok(stats.exhaustion > 0, "exhaustion increased");
    });

    it("multi-day freefall: die and resurrect mid-air", () => {
        // Start starving and parched — mortality drains quickly
        let stats = { ...Surv.defaultStats(), thirst: 100, hunger: 100 };
        let tickState = Tick.defaultTickState();
        let floor = 100000;
        let speed = 0;
        let deaths = 0;
        let ticks = 0;

        while (ticks < 2000 && deaths < 3) {
            // Fall tick
            const fall = ChasmCore.fallTick({ speed }, floor);
            floor = fall.newFloor;
            speed = fall.newSpeed;

            if (fall.landed) break;

            // Survival tick
            stats = Surv.applyMoveTick(stats);

            // Time tick
            const adv = Tick.advanceTick(tickState, 1);
            tickState = adv.state;

            // Dawn resurrection
            if (adv.events.includes("dawn") && stats.dead) {
                stats = Surv.applyResurrection(stats);
                deaths++;
            }

            ticks++;
        }

        assert.ok(deaths >= 1, "died at least once during fall, deaths=" + deaths);
        assert.ok(floor < 100000, "descended from starting floor");
    });

    it("grab attempt at low speed usually succeeds", () => {
        // At speed 3, grab chance = 0.8 - 3*0.015 = 0.755
        let successes = 0;
        const trials = 100;

        for (let i = 0; i < trials; i++) {
            // Fake RNG that returns i/trials
            const rng = { next() { return i / trials; } };
            const r = ChasmCore.attemptGrab(3, rng);
            if (r.success) successes++;
        }

        // ~75.5% success rate
        assert.ok(successes > 60, "most grabs succeed at low speed, got " + successes);
        assert.ok(successes < 90, "not all grabs succeed, got " + successes);
    });

    it("grab attempt at terminal velocity almost always fails", () => {
        let successes = 0;
        const trials = 100;

        for (let i = 0; i < trials; i++) {
            const rng = { next() { return i / trials; } };
            const r = ChasmCore.attemptGrab(ChasmCore.TERMINAL_VELOCITY, rng);
            if (r.success) successes++;
        }

        // 5% chance at terminal velocity
        assert.ok(successes <= 10, "very few grabs succeed at terminal velocity, got " + successes);
    });

    it("full freefall scenario: jump, fall, grab, land", () => {
        let floor = 500;
        let speed = 0;
        let grabbed = false;
        let ticks = 0;

        // Fall until speed is manageable, then grab
        while (floor > 0 && ticks < 1000) {
            const fall = ChasmCore.fallTick({ speed }, floor);
            floor = fall.newFloor;
            speed = fall.newSpeed;
            ticks++;

            if (fall.landed) break;

            // Try to grab once speed stabilizes at a low-ish value
            // (This won't happen naturally — speed only increases.
            //  Test the mechanic with a guaranteed-success RNG at tick 5)
            if (ticks === 5) {
                const rng = { next() { return 0.0; } };
                const grab = ChasmCore.attemptGrab(speed, rng);
                if (grab.success) {
                    grabbed = true;
                    break;
                }
            }
        }

        assert.strictEqual(grabbed, true, "successfully grabbed railing");
        assert.ok(floor > 0, "stopped above floor 0");
        assert.ok(floor < 500, "descended some floors");
    });

    it("time-to-ground scales with starting floor", () => {
        function ticksToGround(startFloor) {
            let floor = startFloor;
            let speed = 0;
            let t = 0;
            while (floor > 0) {
                const r = ChasmCore.fallTick({ speed }, floor);
                floor = r.newFloor;
                speed = r.newSpeed;
                t++;
            }
            return t;
        }

        const t100 = ticksToGround(100);
        const t10000 = ticksToGround(10000);
        const t100000 = ticksToGround(100000);

        assert.ok(t10000 > t100, "10k takes longer than 100");
        assert.ok(t100000 > t10000, "100k takes longer than 10k");

        // At terminal velocity (50 floors/tick), 100k floors takes ~2000 ticks minimum
        // That's ~200 hours = ~8.3 days of game time
        assert.ok(t100000 > 1900, "100k floor fall takes significant time: " + t100000 + " ticks");
    });
});
