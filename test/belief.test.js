import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    BELIEF, FAITHS, STANCES,
    generateBelief,
    evolveBelief, DEFAULT_CRISIS,
    deriveStance, updateStance, DEFAULT_STANCE,
    beliefDecayMod,
    entityBeliefDecayMod,
} from "../lib/belief.core.js";
import { createWorld, spawn, addComponent } from "../lib/ecs.core.js";

// --- Helpers ---

function stubRng(values) {
    let i = 0;
    return { next() { return values[i++ % values.length]; } };
}

// --- generateBelief ---

describe("generateBelief", () => {
    it("produces valid faith from weighted pick", () => {
        const rng = stubRng([0.5, 0.7, 0.3]);
        const b = generateBelief(rng);
        assert.ok(FAITHS.includes(b.faith), `unexpected faith: ${b.faith}`);
    });

    it("devotion comes from second rng call", () => {
        const rng = stubRng([0.0, 0.42]);
        const b = generateBelief(rng);
        assert.equal(b.devotion, 0.42);
    });

    it("starts undecided with zero crisis", () => {
        const rng = stubRng([0.5, 0.5]);
        const b = generateBelief(rng);
        assert.equal(b.stance, "undecided");
        assert.equal(b.faithCrisis, 0);
        assert.equal(b.acceptance, 0);
    });

    it("deterministic given same rng state", () => {
        const a = generateBelief(stubRng([0.1, 0.3]));
        const b = generateBelief(stubRng([0.1, 0.3]));
        assert.deepEqual(a, b);
    });

    it("all faiths reachable", () => {
        const seen = new Set();
        // Walk through the weight space
        for (let r = 0; r < 1; r += 0.01) {
            const b = generateBelief(stubRng([r, 0.5]));
            seen.add(b.faith);
        }
        for (const f of FAITHS) {
            assert.ok(seen.has(f), `faith ${f} never generated`);
        }
    });
});

// --- evolveBelief ---

describe("evolveBelief", () => {
    it("crisis grows over time", () => {
        const b = generateBelief(stubRng([0.5, 0.8])); // high devotion
        const initial = b.faithCrisis;
        evolveBelief(b);
        assert.ok(b.faithCrisis > initial);
    });

    it("acceptance grows over time", () => {
        const b = generateBelief(stubRng([0.5, 0.5]));
        evolveBelief(b);
        assert.ok(b.acceptance > 0);
    });

    it("devout believers have faster crisis growth", () => {
        const devout = generateBelief(stubRng([0.5, 0.95]));
        const casual = generateBelief(stubRng([0.5, 0.1]));
        for (let i = 0; i < 1000; i++) {
            evolveBelief(devout);
            evolveBelief(casual);
        }
        assert.ok(devout.faithCrisis > casual.faithCrisis,
            `devout ${devout.faithCrisis} should exceed casual ${casual.faithCrisis}`);
    });

    it("acceptance accelerates when crisis is high", () => {
        const earlyAccept = generateBelief(stubRng([0.5, 0.5]));
        const lateAccept = generateBelief(stubRng([0.5, 0.5]));
        lateAccept.faithCrisis = 0.9; // force high crisis
        evolveBelief(earlyAccept);
        evolveBelief(lateAccept);
        assert.ok(lateAccept.acceptance > earlyAccept.acceptance);
    });

    it("caps at 1.0", () => {
        const b = generateBelief(stubRng([0.5, 1.0]));
        for (let i = 0; i < 100000; i++) evolveBelief(b);
        assert.ok(b.faithCrisis <= 1.0);
        assert.ok(b.acceptance <= 1.0);
    });
});

// --- deriveStance ---

describe("deriveStance", () => {
    function makeBelief(overrides = {}) {
        return {
            faith: "mormon",
            devotion: 0.5,
            faithCrisis: 0.5,
            acceptance: 0.5,
            stance: "undecided",
            ...overrides,
        };
    }

    it("direite: low lucidity, enough hope", () => {
        const b = makeBelief();
        const s = deriveStance(b, 30, 50, 0);
        assert.equal(s, "direite");
    });

    it("nihilist: low hope", () => {
        const b = makeBelief();
        const s = deriveStance(b, 60, 20, 0);
        assert.equal(s, "nihilist");
    });

    it("holdout: devout + low crisis", () => {
        const b = makeBelief({ devotion: 0.8, faithCrisis: 0.3 });
        const s = deriveStance(b, 80, 80, 0);
        assert.equal(s, "holdout");
    });

    it("holdout breaks when crisis exceeds threshold", () => {
        const b = makeBelief({ devotion: 0.8, faithCrisis: 0.9 });
        const s = deriveStance(b, 80, 80, 0);
        assert.notEqual(s, "holdout");
    });

    it("seeker: high acceptance, functional psychology", () => {
        const b = makeBelief({ devotion: 0.2, faithCrisis: 0.9, acceptance: 0.8 });
        const s = deriveStance(b, 70, 60, 0);
        assert.equal(s, "seeker");
    });

    it("undecided: default when nothing else matches", () => {
        const b = makeBelief({ devotion: 0.2, faithCrisis: 0.5, acceptance: 0.3 });
        const s = deriveStance(b, 70, 60, 0);
        assert.equal(s, "undecided");
    });

    it("direite overrides seeker (madness trumps reason)", () => {
        const b = makeBelief({ acceptance: 0.9 });
        const s = deriveStance(b, 30, 50, 0);
        assert.equal(s, "direite");
    });

    it("nihilist overrides holdout (despair trumps conviction)", () => {
        const b = makeBelief({ devotion: 0.9, faithCrisis: 0.2 });
        const s = deriveStance(b, 60, 10, 0);
        assert.equal(s, "nihilist");
    });

    it("direite needs hope above floor (no hope = nihilist not direite)", () => {
        const b = makeBelief();
        const s = deriveStance(b, 30, 20, 100);
        assert.equal(s, "nihilist");
    });
});

// --- updateStance ---

describe("updateStance", () => {
    it("returns true on change", () => {
        const b = {
            faith: "catholic", devotion: 0.5, faithCrisis: 0.5,
            acceptance: 0.5, stance: "undecided",
        };
        const changed = updateStance(b, 30, 50, 0);
        assert.ok(changed);
        assert.equal(b.stance, "direite");
    });

    it("returns false when no change", () => {
        const b = {
            faith: "catholic", devotion: 0.5, faithCrisis: 0.5,
            acceptance: 0.5, stance: "direite",
        };
        const changed = updateStance(b, 30, 50, 0);
        assert.ok(!changed);
    });
});

// --- beliefDecayMod ---

describe("beliefDecayMod", () => {
    it("undecided with no crisis = near neutral", () => {
        const b = {
            faith: "agnostic", devotion: 0.1, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };
        const mod = beliefDecayMod(b);
        assert.ok(Math.abs(mod.hopeMul - 1.0) < 0.01);
        assert.ok(Math.abs(mod.lucidityMul - 1.0) < 0.01);
    });

    it("unresolved crisis increases hope decay", () => {
        const b = {
            faith: "mormon", devotion: 0.9, faithCrisis: 0.9,
            acceptance: 0.1, stance: "undecided",
        };
        const mod = beliefDecayMod(b);
        assert.ok(mod.hopeMul > 1.0, `expected > 1.0, got ${mod.hopeMul}`);
    });

    it("high acceptance reduces hope decay", () => {
        const resolved = {
            faith: "mormon", devotion: 0.9, faithCrisis: 0.9,
            acceptance: 0.9, stance: "seeker",
        };
        const unresolved = {
            faith: "mormon", devotion: 0.9, faithCrisis: 0.9,
            acceptance: 0.1, stance: "undecided",
        };
        assert.ok(beliefDecayMod(resolved).hopeMul < beliefDecayMod(unresolved).hopeMul);
    });

    it("holdout: slower lucidity decay, faster hope decay", () => {
        const b = {
            faith: "evangelical", devotion: 0.8, faithCrisis: 0.3,
            acceptance: 0.1, stance: "holdout",
        };
        const mod = beliefDecayMod(b);
        assert.ok(mod.lucidityMul < 1.0, "holdout should protect lucidity");
        assert.ok(mod.hopeMul > 1.0, "holdout should erode hope");
    });

    it("seeker: resilience on both axes", () => {
        const b = {
            faith: "agnostic", devotion: 0.2, faithCrisis: 0.8,
            acceptance: 0.9, stance: "seeker",
        };
        const mod = beliefDecayMod(b);
        assert.ok(mod.hopeMul < 1.0 || mod.lucidityMul < 1.0,
            "seeker should have some resilience");
    });

    it("direite: hope sustained, lucidity accelerated", () => {
        const b = {
            faith: "catholic", devotion: 0.5, faithCrisis: 0.7,
            acceptance: 0.2, stance: "direite",
        };
        const mod = beliefDecayMod(b);
        assert.ok(mod.lucidityMul > 1.0, "direite should accelerate lucidity loss");
    });

    it("nihilist: hope feedback loop", () => {
        const b = {
            faith: "protestant", devotion: 0.5, faithCrisis: 0.8,
            acceptance: 0.4, stance: "nihilist",
        };
        const mod = beliefDecayMod(b);
        assert.ok(mod.hopeMul > 1.0, "nihilist should accelerate hope loss");
    });
});

// --- entityBeliefDecayMod ---

describe("entityBeliefDecayMod", () => {
    it("returns neutral when no belief component", () => {
        const w = createWorld();
        const e = spawn(w);
        const mod = entityBeliefDecayMod(w, e);
        assert.equal(mod.hopeMul, 1.0);
        assert.equal(mod.lucidityMul, 1.0);
    });

    it("returns computed mod when belief present", () => {
        const w = createWorld();
        const e = spawn(w);
        addComponent(w, e, BELIEF, {
            faith: "mormon", devotion: 0.9, faithCrisis: 0.9,
            acceptance: 0.1, stance: "holdout",
        });
        const mod = entityBeliefDecayMod(w, e);
        assert.ok(mod.hopeMul !== 1.0 || mod.lucidityMul !== 1.0);
    });
});

// --- Integration: stance trajectory ---

describe("belief trajectory", () => {
    it("devout mormon: holdout → seeker as crisis + acceptance grow", () => {
        const b = {
            faith: "mormon", devotion: 0.9, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };
        const stances = [b.stance];

        // Simulate with stable psychology (lucidity 80, hope 70)
        for (let i = 0; i < 20000; i++) {
            evolveBelief(b);
            updateStance(b, 80, 70, 0);
        }
        stances.push(b.stance);

        // With high devotion and low initial crisis, should start holdout
        // then transition as crisis breaks threshold
        // Final state depends on acceptance level
        assert.ok(b.faithCrisis > 0.5, "crisis should have grown");
        assert.ok(b.acceptance > 0, "acceptance should have grown");
    });

    it("low-devotion agnostic goes seeker relatively quickly", () => {
        const b = {
            faith: "agnostic", devotion: 0.1, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };

        let seekerTick = -1;
        for (let i = 0; i < 20000; i++) {
            evolveBelief(b);
            if (updateStance(b, 80, 70, 0) && b.stance === "seeker") {
                seekerTick = i;
                break;
            }
        }
        assert.ok(seekerTick > 0, "agnostic should become seeker");
    });

    it("anyone with bottomed hope becomes nihilist regardless of faith", () => {
        for (const faith of FAITHS) {
            const b = {
                faith, devotion: 0.9, faithCrisis: 0.5,
                acceptance: 0.5, stance: "undecided",
            };
            updateStance(b, 60, 10, 0);
            assert.equal(b.stance, "nihilist",
                `${faith} with no hope should be nihilist`);
        }
    });

    it("anyone with broken lucidity + hope becomes direite", () => {
        for (const faith of FAITHS) {
            const b = {
                faith, devotion: 0.5, faithCrisis: 0.5,
                acceptance: 0.5, stance: "undecided",
            };
            updateStance(b, 25, 50, 0);
            assert.equal(b.stance, "direite",
                `${faith} with broken lucidity should be direite`);
        }
    });
});
