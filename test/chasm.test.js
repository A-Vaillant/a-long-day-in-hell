import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    GRAVITY, TERMINAL_VELOCITY, GRAB_BASE_CHANCE, GRAB_SPEED_PENALTY,
    GRAB_DAMAGE_SPEED_THRESHOLD, GRAB_FAIL_MAX_MORTALITY_HIT, GRAB_FAIL_SPEED_REDUCTION,
    LANDING_KILL_SPEED,
    defaultFallingState, fallTick, grabChance, attemptGrab, altitudeBand,
} from "../lib/chasm.core.ts";

// --- defaultFallingState ---

describe("defaultFallingState", () => {
    it("returns speed 0 and the given side", () => {
        const s = defaultFallingState(1);
        assert.strictEqual(s.speed, 0);
        assert.strictEqual(s.floorsToFall, 0);
        assert.strictEqual(s.side, 1);
    });
});

// --- fallTick ---

describe("fallTick", () => {
    it("accelerates by GRAVITY each tick", () => {
        const result = fallTick({ speed: 0 }, 100);
        assert.strictEqual(result.newSpeed, GRAVITY);
        assert.strictEqual(result.newFloor, 100 - GRAVITY);
        assert.strictEqual(result.landed, false);
        assert.strictEqual(result.fatal, false);
    });

    it("accumulates speed over multiple ticks", () => {
        let speed = 0;
        let floor = 1000;
        for (let i = 0; i < 5; i++) {
            const r = fallTick({ speed }, floor);
            speed = r.newSpeed;
            floor = r.newFloor;
        }
        assert.strictEqual(speed, 5);
        // Fell 1+2+3+4+5 = 15 floors
        assert.strictEqual(floor, 1000 - 15);
    });

    it("caps speed at TERMINAL_VELOCITY", () => {
        const result = fallTick({ speed: TERMINAL_VELOCITY }, 1000);
        assert.strictEqual(result.newSpeed, TERMINAL_VELOCITY);
        assert.strictEqual(result.newFloor, 1000 - TERMINAL_VELOCITY);
    });

    it("does not exceed terminal velocity when approaching it", () => {
        const result = fallTick({ speed: TERMINAL_VELOCITY - 1 }, 1000);
        assert.strictEqual(result.newSpeed, TERMINAL_VELOCITY);
    });

    it("detects landing at floor 0", () => {
        const result = fallTick({ speed: 5 }, 3);
        assert.strictEqual(result.newFloor, 0);
        assert.strictEqual(result.landed, true);
        assert.strictEqual(result.fatal, false);
    });

    it("floor never goes below 0", () => {
        const result = fallTick({ speed: 20 }, 5);
        assert.strictEqual(result.newFloor, 0);
        assert.strictEqual(result.landed, true);
    });

    it("marks fatal landing when speed >= LANDING_KILL_SPEED", () => {
        const result = fallTick({ speed: LANDING_KILL_SPEED - 1 }, 5);
        assert.strictEqual(result.landed, true);
        assert.strictEqual(result.fatal, true);
        // speed becomes LANDING_KILL_SPEED after acceleration
        assert.strictEqual(result.newSpeed, LANDING_KILL_SPEED);
    });

    it("marks fatal at terminal velocity", () => {
        const result = fallTick({ speed: TERMINAL_VELOCITY }, 10);
        assert.strictEqual(result.fatal, true);
    });

    it("non-fatal at low speed landing", () => {
        const result = fallTick({ speed: 1 }, 2);
        assert.strictEqual(result.newSpeed, 2);
        assert.strictEqual(result.landed, true);
        assert.strictEqual(result.fatal, false);
    });

    it("reaches floor 0 eventually from any height", () => {
        let speed = 0;
        let floor = 100000;
        let ticks = 0;
        while (floor > 0) {
            const r = fallTick({ speed }, floor);
            speed = r.newSpeed;
            floor = r.newFloor;
            ticks++;
            if (ticks > 10000) break;
        }
        assert.strictEqual(floor, 0);
        assert.ok(ticks < 10000, "should reach floor 0 in reasonable ticks");
    });
});

// --- grabChance ---

describe("grabChance", () => {
    it("returns GRAB_BASE_CHANCE at speed 0", () => {
        assert.strictEqual(grabChance(0), GRAB_BASE_CHANCE);
    });

    it("decreases with speed", () => {
        assert.ok(grabChance(10) < grabChance(5));
        assert.ok(grabChance(20) < grabChance(10));
    });

    it("returns ~5% at terminal velocity", () => {
        const c = grabChance(TERMINAL_VELOCITY);
        assert.ok(Math.abs(c - 0.05) < 0.001);
    });

    it("never goes below 0", () => {
        assert.strictEqual(grabChance(1000), 0);
        assert.strictEqual(grabChance(100), 0);
    });

    it("returns expected value at speed 5", () => {
        const expected = GRAB_BASE_CHANCE - 5 * GRAB_SPEED_PENALTY;
        assert.ok(Math.abs(grabChance(5) - expected) < 0.0001);
    });
});

// --- attemptGrab ---

describe("attemptGrab", () => {
    it("succeeds when roll is below chance", () => {
        // At speed 0, chance is 0.8. RNG returns 0.5 → success
        const fakeRng = { next() { return 0.5; } };
        const result = attemptGrab(0, fakeRng);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.mortalityHit, 0);
        assert.strictEqual(result.speedAfter, 0);
    });

    it("fails when roll is above chance — no damage at low speed", () => {
        // At speed 0, chance is 0.8. RNG returns 0.9 → fail
        const fakeRng = { next() { return 0.9; } };
        const result = attemptGrab(0, fakeRng);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.mortalityHit, 0, "no damage below speed threshold");
        assert.strictEqual(result.speedAfter, 0, "no speed change at low speed");
    });

    it("fails at high speed — takes max damage, loses speed", () => {
        const fakeRng = { next() { return 0.99; } };
        // At terminal velocity, chance is 5%. Roll 0.99 → fail with max damage.
        const result = attemptGrab(TERMINAL_VELOCITY, fakeRng);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.mortalityHit, GRAB_FAIL_MAX_MORTALITY_HIT);
        assert.strictEqual(result.speedAfter, Math.round(TERMINAL_VELOCITY * (1 - GRAB_FAIL_SPEED_REDUCTION)));
    });

    it("always fails at speed where chance is 0", () => {
        const fakeRng = { next() { return 0.0; } };
        // At very high speed, chance = 0. Roll of 0 is not < 0, so fail.
        const result = attemptGrab(1000, fakeRng);
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.mortalityHit, GRAB_FAIL_MAX_MORTALITY_HIT);
    });

    it("damage and speed reduction scale between threshold and terminal velocity", () => {
        const fakeRng = { next() { return 0.99; } };
        // Midpoint between threshold (10) and terminal (50) = 30
        const result = attemptGrab(30, fakeRng);
        assert.strictEqual(result.success, false);
        const expectedFraction = (30 - GRAB_DAMAGE_SPEED_THRESHOLD) / (TERMINAL_VELOCITY - GRAB_DAMAGE_SPEED_THRESHOLD);
        const expected = Math.round(expectedFraction * GRAB_FAIL_MAX_MORTALITY_HIT);
        assert.strictEqual(result.mortalityHit, expected);
        assert.ok(result.mortalityHit > 0 && result.mortalityHit < GRAB_FAIL_MAX_MORTALITY_HIT);
        assert.strictEqual(result.speedAfter, Math.round(30 * (1 - GRAB_FAIL_SPEED_REDUCTION)));
    });

    it("repeated failed grabs can decelerate to safe speed", () => {
        let speed = TERMINAL_VELOCITY;
        for (let i = 0; i < 20 && speed >= LANDING_KILL_SPEED; i++) {
            const fakeRng = { next() { return 0.99; } };
            const result = attemptGrab(speed, fakeRng);
            speed = result.speedAfter;
        }
        assert.ok(speed < LANDING_KILL_SPEED, "eventually slows below kill speed");
    });

    it("succeeds at boundary when roll equals 0 and chance > 0", () => {
        const fakeRng = { next() { return 0.0; } };
        const result = attemptGrab(5, fakeRng);
        assert.strictEqual(result.success, true);
    });
});

// --- altitudeBand ---

describe("altitudeBand", () => {
    it("returns 'bottom' at floor 0", () => {
        assert.strictEqual(altitudeBand(0), "bottom");
    });

    it("returns 'near' at low floors", () => {
        assert.strictEqual(altitudeBand(10), "near");
        assert.strictEqual(altitudeBand(20), "near");
    });

    it("returns 'low' at moderate floors", () => {
        assert.strictEqual(altitudeBand(100), "low");
        assert.strictEqual(altitudeBand(200), "low");
    });

    it("returns 'mid' at medium floors", () => {
        assert.strictEqual(altitudeBand(500), "mid");
        assert.strictEqual(altitudeBand(2000), "mid");
    });

    it("returns 'deep' at high floors", () => {
        assert.strictEqual(altitudeBand(5000), "deep");
        assert.strictEqual(altitudeBand(20000), "deep");
    });

    it("returns 'abyss' at extreme floors", () => {
        assert.strictEqual(altitudeBand(50000), "abyss");
        assert.strictEqual(altitudeBand(100000), "abyss");
    });

    it("bands are ordered by height", () => {
        const bands = [0, 10, 100, 500, 5000, 50000].map(altitudeBand);
        assert.deepStrictEqual(bands, ["bottom", "near", "low", "mid", "deep", "abyss"]);
    });
});
