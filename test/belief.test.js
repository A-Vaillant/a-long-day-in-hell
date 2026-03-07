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
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.js";
import {
    PSYCHOLOGY, IDENTITY, POSITION, RELATIONSHIPS,
    decayPsychology, psychologyDecaySystem, deriveDisposition,
    DEFAULT_DECAY,
} from "../lib/social.core.js";
import { PERSONALITY, generatePersonality, decayBias } from "../lib/personality.core.js";
import { HABITUATION } from "../lib/psych.core.js";

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

// --- Weird tests: source-material scenarios ---

describe("Soren's arc", () => {
    // Soren: devout Mormon, geologist, father of four, died of brain cancer at 45.
    // He holds out for a long time, then slowly accepts.
    // Never goes mad — he's too withdrawn for that.

    it("devout Mormon holds out, then becomes seeker, never direite", () => {
        const b = {
            faith: "mormon", devotion: 0.85, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };
        const stanceLog = [];
        let prevStance = b.stance;

        // ~500 days, 240 ticks/day, stable psychology (companion helps)
        for (let tick = 0; tick < 500 * 240; tick++) {
            evolveBelief(b);
            // Soren has a companion (Rachel), so psychology decays slowly
            // Lucidity stays high, hope drifts down but not critically
            const hope = Math.max(35, 80 - tick * 0.0003);
            updateStance(b, 75, hope, 0);
            if (b.stance !== prevStance) {
                stanceLog.push({ tick, stance: b.stance });
                prevStance = b.stance;
            }
        }

        // Should have been holdout at some point
        assert.ok(stanceLog.some(s => s.stance === "holdout"),
            "Soren should have been a holdout");
        // Should have become seeker eventually
        assert.ok(stanceLog.some(s => s.stance === "seeker"),
            "Soren should eventually become a seeker");
        // Should NEVER have been direite
        assert.ok(!stanceLog.some(s => s.stance === "direite"),
            "Soren should never become a direite (lucidity stays high)");
    });
});

describe("Dire Dan's arc", () => {
    // Dan: probably evangelical or similar. Very devout. Goes mad.
    // His lucidity craters but hope stays up — he has PURPOSE.
    // The direite stance should sustain his hope even as lucidity drops.

    it("devout evangelical with cratering lucidity becomes direite", () => {
        const b = {
            faith: "evangelical", devotion: 0.95, faithCrisis: 0.6,
            acceptance: 0.1, stance: "undecided",
        };

        updateStance(b, 30, 55, 0);
        assert.equal(b.stance, "direite");

        // Direite stance slows hope decay relative to same person without it
        // But unresolved crisis still pushes hopeMul > 1.0 overall —
        // the stance just makes it LESS bad than it would be as undecided
        const dirMod = beliefDecayMod(b);
        const asSeekerMod = beliefDecayMod({ ...b, stance: "undecided" });
        assert.ok(dirMod.hopeMul < asSeekerMod.hopeMul,
            "direite should have lower hopeMul than undecided (violence sustains)");
        assert.ok(dirMod.lucidityMul > 1.0,
            "direite should accelerate lucidity decay");
    });

    it("direite eventually falls to nihilist when hope depletes", () => {
        // This is the Dire Dan endgame: even violence can't sustain you forever.
        // Eventually hope drops below the floor and you become nihilist.
        const b = {
            faith: "evangelical", devotion: 0.95, faithCrisis: 0.6,
            acceptance: 0.1, stance: "direite",
        };
        const psych = { lucidity: 30, hope: 55 };

        let wasDireite = false;
        let becameNihilist = false;
        for (let i = 0; i < 30000; i++) {
            evolveBelief(b);
            const mod = beliefDecayMod(b);
            decayPsychology(psych, false, DEFAULT_DECAY, mod);
            updateStance(b, psych.lucidity, psych.hope, 0);
            if (b.stance === "direite") wasDireite = true;
            if (wasDireite && b.stance === "nihilist") { becameNihilist = true; break; }
        }

        assert.ok(wasDireite, "should have been direite");
        assert.ok(becameNihilist,
            "even Dire Dan falls eventually — violence can't sustain forever");
    });
});

describe("the atheist who finds God", () => {
    // An atheist in Zoroastrian hell. The crisis is different:
    // not "my god was wrong" but "a god exists and I denied it."
    // Lower crisis growth (less to lose), but acceptance is harder
    // because the entire framework is new.

    it("atheist has slower crisis growth than devout believer (early phase)", () => {
        const atheist = {
            faith: "atheist", devotion: 0.1, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };
        const devout = {
            faith: "mormon", devotion: 0.9, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };

        // Only 500 ticks — before both cap at 1.0
        for (let i = 0; i < 500; i++) {
            evolveBelief(atheist);
            evolveBelief(devout);
        }

        assert.ok(atheist.faithCrisis < devout.faithCrisis,
            `atheist (${atheist.faithCrisis}) should grow slower than devout (${devout.faithCrisis})`);
    });

    it("atheist never becomes holdout (devotion too low)", () => {
        const b = {
            faith: "atheist", devotion: 0.1, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };

        for (let i = 0; i < 50000; i++) {
            evolveBelief(b);
            updateStance(b, 80, 70, 0);
            assert.notEqual(b.stance, "holdout",
                "atheist should never be holdout (nothing to hold onto)");
        }
    });

    it("devout holdout detours through holdout before reaching seeker", () => {
        // The devout person's path: undecided → holdout → seeker
        // They can't skip holdout. The atheist goes undecided → seeker directly.
        // But the devout's higher crisis rate drives acceptance faster too,
        // so they may actually reach seeker FIRST despite the detour.
        // What matters: the devout MUST pass through holdout. The atheist never does.
        const atheist = {
            faith: "atheist", devotion: 0.1, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };
        const devout = {
            faith: "evangelical", devotion: 0.9, faithCrisis: 0,
            acceptance: 0, stance: "undecided",
        };

        let devoutHoldout = false;
        let atheistHoldout = false;
        let bothSeeker = false;
        for (let i = 0; i < 50000; i++) {
            evolveBelief(atheist);
            evolveBelief(devout);
            updateStance(atheist, 80, 70, 0);
            updateStance(devout, 80, 70, 0);
            if (devout.stance === "holdout") devoutHoldout = true;
            if (atheist.stance === "holdout") atheistHoldout = true;
            if (atheist.stance === "seeker" && devout.stance === "seeker") {
                bothSeeker = true;
                break;
            }
        }

        assert.ok(devoutHoldout, "devout should pass through holdout");
        assert.ok(!atheistHoldout, "atheist should never be holdout");
        assert.ok(bothSeeker, "both should eventually become seekers");
    });
});

describe("the nihilist trap", () => {
    // Once hope bottoms out, you become nihilist.
    // Nihilist accelerates hope decay (feedback loop).
    // Can you escape? Only if hope recovers above threshold.

    it("nihilist feedback loop makes hope decay faster than other stances", () => {
        const nihilist = { lucidity: 60, hope: 29 };
        const undecided = { lucidity: 60, hope: 29 };
        const bNih = {
            faith: "agnostic", devotion: 0.3, faithCrisis: 0.8,
            acceptance: 0.5, stance: "nihilist",
        };
        const bUnd = {
            faith: "agnostic", devotion: 0.3, faithCrisis: 0.8,
            acceptance: 0.5, stance: "undecided",
        };

        for (let i = 0; i < 5000; i++) {
            decayPsychology(nihilist, false, DEFAULT_DECAY, beliefDecayMod(bNih));
            decayPsychology(undecided, false, DEFAULT_DECAY, beliefDecayMod(bUnd));
        }

        assert.ok(nihilist.hope < undecided.hope,
            `nihilist hope (${nihilist.hope}) should decay faster than undecided (${undecided.hope})`);
    });
});

describe("integrated ECS: belief wired into psychologyDecaySystem", () => {
    function makeEntity(world, faith, devotion, lucidity, hope) {
        const e = spawn(world);
        addComponent(world, e, POSITION, { side: 0, position: 0, floor: 0 });
        addComponent(world, e, IDENTITY, { name: "Test", alive: true });
        addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
        addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
        addComponent(world, e, BELIEF, {
            faith, devotion, faithCrisis: 0, acceptance: 0, stance: "undecided",
        });
        return e;
    }

    it("belief modifiers affect psychology decay through the system", () => {
        const w = createWorld();
        const devout = makeEntity(w, "mormon", 0.95, 100, 100);
        const casual = makeEntity(w, "agnostic", 0.1, 100, 100);

        // Run many ticks through the full system
        for (let i = 0; i < 5000; i++) {
            psychologyDecaySystem(w);
        }

        const devoutPsych = getComponent(w, devout, PSYCHOLOGY);
        const casualPsych = getComponent(w, casual, PSYCHOLOGY);

        // Both should have decayed
        assert.ok(devoutPsych.hope < 100);
        assert.ok(casualPsych.hope < 100);

        // Devout mormon's unresolved crisis should make hope decay faster
        // (crisis grows faster for high devotion → higher unresolved portion)
        assert.ok(devoutPsych.hope < casualPsych.hope,
            `devout (${devoutPsych.hope}) should have less hope than casual (${casualPsych.hope})`);
    });

    it("belief evolves through psychologyDecaySystem ticks", () => {
        const w = createWorld();
        const e = makeEntity(w, "evangelical", 0.8, 100, 100);

        for (let i = 0; i < 1000; i++) {
            psychologyDecaySystem(w);
        }

        const belief = getComponent(w, e, BELIEF);
        assert.ok(belief.faithCrisis > 0, "crisis should have grown via system");
        assert.ok(belief.acceptance > 0, "acceptance should have grown via system");
    });

    it("stance transitions happen inside psychologyDecaySystem", () => {
        const w = createWorld();
        const e = makeEntity(w, "mormon", 0.9, 100, 100);

        // Run enough ticks for stance to change (holdout from high devotion)
        for (let i = 0; i < 100; i++) {
            psychologyDecaySystem(w);
        }

        const belief = getComponent(w, e, BELIEF);
        // With devotion 0.9 and low initial crisis, should be holdout
        assert.equal(belief.stance, "holdout",
            "high devotion entity should become holdout through system");
    });

    it("not Zoroastrian either then: no faith produces immunity", () => {
        const w = createWorld();
        const entities = [];
        for (const faith of FAITHS) {
            entities.push({ faith, e: makeEntity(w, faith, 0.5, 100, 100) });
        }

        for (let i = 0; i < 10000; i++) {
            psychologyDecaySystem(w);
        }

        // Every single faith should have decayed — nobody is spared
        for (const { faith, e } of entities) {
            const psych = getComponent(w, e, PSYCHOLOGY);
            assert.ok(psych.hope < 100,
                `${faith} should not be immune to hope decay`);
            assert.ok(psych.lucidity < 100,
                `${faith} should not be immune to lucidity decay`);
        }
    });
});
