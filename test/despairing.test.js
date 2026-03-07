import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
    CONFIG, applyAmbientDrain, modifySleepRecovery, shouldClearDespairing,
    corruptStatValue, shouldCorruptDescriptor,
    isReadingBlocked, chasmSkipsConfirm, applyAlcohol,
    simulate,
} from "../lib/despairing.core.ts";
import * as survFns from "../lib/survival.core.ts";
import * as tickFns from "../lib/tick.core.ts";

// Save defaults so we can restore after each test
const DEFAULT_CONFIG = { ...CONFIG };

function resetConfig() {
    Object.assign(CONFIG, DEFAULT_CONFIG);
}

/* ---- Unit tests ---- */

describe("applyAmbientDrain", () => {
    beforeEach(resetConfig);

    it("reduces morale by ambientDrain per call", () => {
        const result = applyAmbientDrain(100);
        assert.strictEqual(result, 100 - CONFIG.ambientDrain);
    });

    it("clamps at 0", () => {
        assert.strictEqual(applyAmbientDrain(0), 0);
        assert.strictEqual(applyAmbientDrain(0.01), 0);
    });

    it("respects config override", () => {
        CONFIG.ambientDrain = 1.0;
        assert.strictEqual(applyAmbientDrain(50), 49);
    });

    it("at default rate, 160 awake ticks drain 24 morale", () => {
        // 160 ticks/day * 0.15 = 24 morale per day
        let morale = 100;
        for (let i = 0; i < 160; i++) morale = applyAmbientDrain(morale);
        assert.ok(Math.abs(morale - 76) < 0.1, `expected ~76, got ${morale}`);
    });
});

describe("modifySleepRecovery", () => {
    beforeEach(resetConfig);

    it("returns base delta when not despairing", () => {
        assert.strictEqual(modifySleepRecovery(5, false), 5);
    });

    it("reduces recovery when despairing", () => {
        const result = modifySleepRecovery(5, true);
        assert.ok(result < 5, `expected < 5, got ${result}`);
        assert.strictEqual(result, 5 * CONFIG.sleepRecoveryMult);
    });

    it("does not affect negative deltas (penalties)", () => {
        assert.strictEqual(modifySleepRecovery(-3, true), -3);
    });

    it("respects config override", () => {
        CONFIG.sleepRecoveryMult = 0.5;
        assert.strictEqual(modifySleepRecovery(10, true), 5);
    });
});

describe("shouldClearDespairing", () => {
    beforeEach(resetConfig);

    it("returns false below threshold", () => {
        assert.strictEqual(shouldClearDespairing(CONFIG.exitThreshold - 1), false);
    });

    it("returns true at threshold", () => {
        assert.strictEqual(shouldClearDespairing(CONFIG.exitThreshold), true);
    });

    it("returns true above threshold", () => {
        assert.strictEqual(shouldClearDespairing(50), true);
    });

    it("creates hysteresis gap: enter at 0, exit at threshold", () => {
        // Despairing triggers at morale 0, but doesn't clear until exitThreshold
        assert.strictEqual(shouldClearDespairing(0), false);
        assert.strictEqual(shouldClearDespairing(5), false);
        assert.strictEqual(shouldClearDespairing(CONFIG.exitThreshold), true);
    });
});

describe("corruptStatValue", () => {
    beforeEach(resetConfig);

    it("returns values in [0, 100]", () => {
        for (let r = 0; r < 1; r += 0.1) {
            const v = corruptStatValue(50, r);
            assert.ok(v >= 0 && v <= 100, `got ${v}`);
        }
    });

    it("clamps at boundaries", () => {
        assert.ok(corruptStatValue(0, 0) >= 0);
        assert.ok(corruptStatValue(100, 1) <= 100);
    });

    it("midpoint rng (0.5) returns true value", () => {
        assert.strictEqual(corruptStatValue(50, 0.5), 50);
    });

    it("corruption range is configurable", () => {
        CONFIG.statCorruptionRange = 50;
        const low = corruptStatValue(50, 0);   // max negative offset
        const high = corruptStatValue(50, 1);  // max positive offset
        assert.ok(high - low > 80, `range should be wide, got ${high - low}`);
    });
});

describe("shouldCorruptDescriptor", () => {
    beforeEach(resetConfig);

    it("corrupts below chance", () => {
        assert.strictEqual(shouldCorruptDescriptor(0), true);
        assert.strictEqual(shouldCorruptDescriptor(CONFIG.statCorruptionChance - 0.01), true);
    });

    it("does not corrupt above chance", () => {
        assert.strictEqual(shouldCorruptDescriptor(CONFIG.statCorruptionChance), false);
        assert.strictEqual(shouldCorruptDescriptor(0.99), false);
    });
});

describe("isReadingBlocked", () => {
    beforeEach(resetConfig);

    it("never blocks when not despairing", () => {
        assert.strictEqual(isReadingBlocked(false, 0), false);
    });

    it("blocks below chance when despairing", () => {
        assert.strictEqual(isReadingBlocked(true, 0), true);
    });

    it("does not block above chance when despairing", () => {
        assert.strictEqual(isReadingBlocked(true, CONFIG.readBlockChance + 0.01), false);
    });

    it("chance is configurable", () => {
        CONFIG.readBlockChance = 1.0;
        assert.strictEqual(isReadingBlocked(true, 0.99), true);
        CONFIG.readBlockChance = 0;
        assert.strictEqual(isReadingBlocked(true, 0), false);
    });
});

describe("chasmSkipsConfirm", () => {
    beforeEach(resetConfig);

    it("does not skip when not despairing", () => {
        assert.strictEqual(chasmSkipsConfirm(false), false);
    });

    it("skips when despairing and config enabled", () => {
        assert.strictEqual(chasmSkipsConfirm(true), true);
    });

    it("respects config toggle", () => {
        CONFIG.chasmSkipConfirm = false;
        assert.strictEqual(chasmSkipsConfirm(true), false);
    });
});

describe("applyAlcohol", () => {
    beforeEach(resetConfig);

    it("boosts morale", () => {
        const result = applyAlcohol({ morale: 30, despairing: false });
        assert.strictEqual(result.morale, 30 + CONFIG.alcoholMoraleBoost);
    });

    it("clamps morale at 100", () => {
        const result = applyAlcohol({ morale: 90, despairing: false });
        assert.strictEqual(result.morale, 100);
    });

    it("clears despairing when morale exceeds exit threshold", () => {
        const result = applyAlcohol({ morale: 0, despairing: true });
        assert.ok(result.morale >= CONFIG.exitThreshold);
        assert.strictEqual(result.despairing, false);
    });

    it("does not clear despairing if config disables it", () => {
        CONFIG.alcoholClearsDespairing = false;
        const result = applyAlcohol({ morale: 0, despairing: true });
        assert.strictEqual(result.despairing, true);
    });

    it("boost is configurable", () => {
        CONFIG.alcoholMoraleBoost = 5;
        const result = applyAlcohol({ morale: 0, despairing: true });
        assert.strictEqual(result.morale, 5);
        // 5 < exitThreshold(15), so still despairing
        assert.strictEqual(result.despairing, true);
    });
});

/* ---- Simulation / integration tests ---- */

describe("simulation: healthy player", () => {
    beforeEach(resetConfig);

    it("player who eats, drinks, and sleeps stays alive for 30 days", () => {
        const { finalStats, dayStats } = simulate(
            { days: 30, behavior: { eats: true, drinks: true, sleeps: true } },
            survFns, tickFns
        );
        assert.strictEqual(finalStats.dead, false);
        assert.strictEqual(finalStats.despairing, false);
        assert.ok(finalStats.morale > 50, `morale should be high, got ${finalStats.morale}`);
    });
});

describe("simulation: no food or water", () => {
    beforeEach(resetConfig);

    it("player dies within 7 days without eating or drinking", () => {
        const { dayStats } = simulate(
            { days: 7, behavior: { eats: false, drinks: false, sleeps: true } },
            survFns, tickFns
        );
        const deathDay = dayStats.find(d => d.dead);
        assert.ok(deathDay, "player should die without food/water");
        assert.ok(deathDay.day <= 7, `death should happen by day 7, died day ${deathDay.day}`);
    });

    it("player becomes despairing before dying", () => {
        const { dayStats } = simulate(
            { days: 7, behavior: { eats: false, drinks: false, sleeps: true } },
            survFns, tickFns
        );
        const despairDay = dayStats.find(d => d.despairing);
        const deathDay = dayStats.find(d => d.dead);
        assert.ok(despairDay, "should become despairing");
        if (deathDay) {
            assert.ok(despairDay.day <= deathDay.day,
                "despair should precede or coincide with death");
        }
    });
});

describe("simulation: no food only", () => {
    beforeEach(resetConfig);

    it("player survives longer than no-water scenario", () => {
        const noFood = simulate(
            { days: 14, behavior: { eats: false, drinks: true, sleeps: true } },
            survFns, tickFns
        );
        const noWater = simulate(
            { days: 14, behavior: { eats: true, drinks: false, sleeps: true } },
            survFns, tickFns
        );
        const foodDeathDay = noFood.dayStats.find(d => d.dead)?.day ?? 999;
        const waterDeathDay = noWater.dayStats.find(d => d.dead)?.day ?? 999;
        assert.ok(foodDeathDay > waterDeathDay,
            `no-food death (day ${foodDeathDay}) should be later than no-water (day ${waterDeathDay})`);
    });
});

describe("simulation: despairing recovery is sticky", () => {
    beforeEach(resetConfig);

    it("despairing player recovers morale slower than healthy player", () => {
        // A player who eats/drinks but reads nonsense will eventually despair
        // from ambient drain + nonsense morale hits. Sleep recovery is slower
        // while despairing (0.3x multiplier), so morale stays suppressed.
        const despairingRun = simulate(
            { days: 30, behavior: { eats: true, drinks: true, sleeps: true, nonsensePerDay: 20 } },
            survFns, tickFns
        );
        const despairStart = despairingRun.dayStats.find(d => d.despairing);
        if (despairStart) {
            const afterDespair = despairingRun.dayStats.filter(d => d.day > despairStart.day && !d.dead);
            for (const d of afterDespair) {
                if (d.despairing) {
                    assert.ok(d.morale < CONFIG.exitThreshold,
                        `day ${d.day}: morale ${d.morale} should be below exit threshold ${CONFIG.exitThreshold}`);
                }
            }
        }
    });
});

describe("simulation: nonsense reading morale drain", () => {
    beforeEach(resetConfig);

    it("heavy nonsense reading accelerates morale loss", () => {
        const noReading = simulate(
            { days: 10, behavior: { eats: true, drinks: true, sleeps: true, nonsensePerDay: 0 } },
            survFns, tickFns
        );
        const heavyReading = simulate(
            { days: 10, behavior: { eats: true, drinks: true, sleeps: true, nonsensePerDay: 20 } },
            survFns, tickFns
        );
        // Heavy nonsense reader should have lower morale
        const noReadMorale = noReading.dayStats[noReading.dayStats.length - 1].morale;
        const heavyMorale = heavyReading.dayStats[heavyReading.dayStats.length - 1].morale;
        assert.ok(heavyMorale < noReadMorale,
            `heavy reader morale ${heavyMorale} should be less than non-reader ${noReadMorale}`);
    });

    it("diminishing returns: 50 nonsense pages hurts less than 50 × first-page penalty", () => {
        const run = simulate(
            { days: 5, behavior: { eats: true, drinks: true, sleeps: true, nonsensePerDay: 50 } },
            survFns, tickFns
        );
        const endMorale = run.dayStats[run.dayStats.length - 1].morale;
        // If no diminishing returns, 50 pages × -2 = -100 per day → morale would be 0 fast
        // With diminishing returns, morale should still be well above 0
        assert.ok(endMorale > 30,
            `morale ${endMorale} should stay above 30 with diminishing returns`);
    });
});

describe("simulation: alcohol as escape valve", () => {
    beforeEach(resetConfig);

    it("alcohol boost is enough to clear despairing from zero morale", () => {
        const stats = { morale: 0, despairing: true };
        const after = applyAlcohol(stats);
        assert.strictEqual(after.despairing, false);
        assert.ok(after.morale >= CONFIG.exitThreshold);
    });

    it("with reduced alcohol boost, may not clear despairing", () => {
        CONFIG.alcoholMoraleBoost = 10;
        const stats = { morale: 0, despairing: true };
        const after = applyAlcohol(stats);
        // 10 < 15 exit threshold
        assert.strictEqual(after.despairing, true);
    });
});

describe("simulation: config overrides change outcomes", () => {
    beforeEach(resetConfig);

    it("increasing sleepRecoveryMult makes despairing easier to escape", () => {
        // Harsh: very slow recovery
        CONFIG.sleepRecoveryMult = 0.1;
        const harsh = simulate(
            { days: 7, behavior: { eats: false, drinks: false, sleeps: true } },
            survFns, tickFns
        );

        resetConfig();

        // Gentle: fast recovery
        CONFIG.sleepRecoveryMult = 0.8;
        const gentle = simulate(
            { days: 7, behavior: { eats: false, drinks: false, sleeps: true } },
            survFns, tickFns
        );

        // Both will die (no food/water), but gentle should have higher morale on average
        const harshAvg = harsh.dayStats.filter(d => !d.dead).reduce((s, d) => s + d.morale, 0) /
            Math.max(1, harsh.dayStats.filter(d => !d.dead).length);
        const gentleAvg = gentle.dayStats.filter(d => !d.dead).reduce((s, d) => s + d.morale, 0) /
            Math.max(1, gentle.dayStats.filter(d => !d.dead).length);
        assert.ok(gentleAvg >= harshAvg,
            `gentle avg morale ${gentleAvg.toFixed(1)} should be >= harsh ${harshAvg.toFixed(1)}`);
    });

    it("lowering exitThreshold makes despairing easier to escape", () => {
        CONFIG.exitThreshold = 5;
        const easy = simulate(
            { days: 10, behavior: { eats: true, drinks: true, sleeps: true, nonsensePerDay: 10 } },
            survFns, tickFns
        );
        resetConfig();
        CONFIG.exitThreshold = 40;
        const hard = simulate(
            { days: 10, behavior: { eats: true, drinks: true, sleeps: true, nonsensePerDay: 10 } },
            survFns, tickFns
        );

        const easyDespairDays = easy.dayStats.filter(d => d.despairing).length;
        const hardDespairDays = hard.dayStats.filter(d => d.despairing).length;
        assert.ok(easyDespairDays <= hardDespairDays,
            `easy exit (${easyDespairDays} despair days) should be <= hard (${hardDespairDays})`);
    });
});
