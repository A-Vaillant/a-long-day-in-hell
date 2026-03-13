/**
 * Personality disposition trajectory — cosmic-scale decay simulations.
 * These run 50k simulated days and belong in test:slow.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    decayBias,
} from "../../lib/personality.core.ts";
import {
    decayPsychology,
    DEFAULT_DECAY,
} from "../../lib/social.core.ts";
import { TICKS_PER_DAY } from "../../lib/scale.core.ts";

function makePerson(t, p, o, out) {
    return { temperament: t, pace: p, openness: o, outlook: out };
}

describe("personality disposition trajectory", () => {
    it("volatile person goes mad before catatonic", () => {
        const psych = { lucidity: 100, hope: 100 };
        const bias = decayBias(makePerson(1.0, 0.5, 0.5, 0.5));
        let hitMad = false;
        let hitCatatonic = false;
        let madDay = 0;
        let catDay = 0;

        // Cosmic scale: needs thousands of days
        for (let day = 0; day < 50000; day++) {
            for (let t = 0; t < TICKS_PER_DAY; t++) {
                decayPsychology(psych, false, DEFAULT_DECAY, bias);
            }
            if (psych.lucidity <= 40 && !hitMad) { hitMad = true; madDay = day; }
            if (psych.hope <= 15 && !hitCatatonic) { hitCatatonic = true; catDay = day; }
            if (hitMad && hitCatatonic) break;
        }

        assert.ok(hitMad, "volatile should eventually go mad");
        assert.ok(hitCatatonic, "volatile should eventually go catatonic");
        assert.ok(madDay < catDay, "volatile should go mad before catatonic");
    });

    it("withdrawn person goes catatonic before mad", () => {
        const psych = { lucidity: 100, hope: 100 };
        const bias = decayBias(makePerson(0.0, 0.5, 0.5, 0.5));
        let hitMad = false;
        let hitCatatonic = false;
        let madDay = 0;
        let catDay = 0;

        // Cosmic scale: needs thousands of days
        for (let day = 0; day < 50000; day++) {
            for (let t = 0; t < TICKS_PER_DAY; t++) {
                decayPsychology(psych, false, DEFAULT_DECAY, bias);
            }
            if (psych.lucidity <= 40 && !hitMad) { hitMad = true; madDay = day; }
            if (psych.hope <= 15 && !hitCatatonic) { hitCatatonic = true; catDay = day; }
            if (hitMad && hitCatatonic) break;
        }

        assert.ok(hitCatatonic, "withdrawn should eventually go catatonic");
        assert.ok(hitMad, "withdrawn should eventually go mad");
        assert.ok(catDay < madDay, "withdrawn should go catatonic before mad");
    });
});
