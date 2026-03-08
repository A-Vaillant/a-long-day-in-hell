/**
 * Spawn simulation scenarios — verify emergent behavior from initial conditions.
 *
 * These tests set up specific population configurations and run the ECS
 * social physics forward, checking that expectations about psychological
 * decay, social pressure, and companion effects hold.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createWorld, spawn, addComponent, getComponent,
} from "../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, AI,
    deriveDisposition,
    psychologyDecaySystem,
    relationshipSystem,
    groupFormationSystem,
    socialPressureSystem,
    buildLocationIndex,
} from "../lib/social.core.ts";
import { PERSONALITY, generatePersonality, applySideBias, SIDE_PROFILES, compatibility } from "../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../lib/belief.core.ts";
import { HABITUATION } from "../lib/psych.core.ts";
import { NEEDS } from "../lib/needs.core.ts";
import { STATS, generateStats } from "../lib/stats.core.ts";
import { seedFromString } from "../lib/prng.core.ts";

// --- Helpers ---

function makeNpc(world, opts = {}) {
    const {
        name = "Npc",
        side = 0, position = 0, floor = 0,
        lucidity = 100, hope = 100,
        seed = "test",
        id = 0,
        biasPlayerSide = null, // null = no bias, true/false = apply side bias
    } = opts;
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name, alive: true, free: false });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, e, HABITUATION, { exposures: new Map() });
    addComponent(world, e, NEEDS, { hunger: 0, thirst: 0, exhaustion: 0 });
    addComponent(world, e, AI, {});

    const persRng = seedFromString(seed + ":pers:" + id);
    const pers = generatePersonality(persRng);
    if (biasPlayerSide !== null) {
        applySideBias(pers, biasPlayerSide);
    }
    addComponent(world, e, PERSONALITY, pers);

    const beliefRng = seedFromString(seed + ":belief:" + id);
    addComponent(world, e, BELIEF, generateBelief(beliefRng));

    const statsRng = seedFromString(seed + ":stats:" + id);
    addComponent(world, e, STATS, generateStats(statsRng));

    return e;
}

function runTicks(world, n) {
    for (let t = 0; t < n; t++) {
        const prebuilt = buildLocationIndex(world);
        relationshipSystem(world, t, undefined, prebuilt);
        psychologyDecaySystem(world);
        groupFormationSystem(world, undefined, prebuilt);
        socialPressureSystem(world);
    }
}

function getDisposition(world, entity) {
    const psych = getComponent(world, entity, PSYCHOLOGY);
    const ident = getComponent(world, entity, IDENTITY);
    return deriveDisposition(psych, ident.alive);
}

function getPsych(world, entity) {
    return getComponent(world, entity, PSYCHOLOGY);
}

// --- Scenario 1: Volatile personalities → madness epidemic ---

describe("Scenario: volatile personalities trend toward madness", () => {
    it("chaotic-biased NPCs lose more lucidity than calm-biased NPCs", () => {
        // Two separate worlds to isolate the comparison (no cross-side pressure)
        const chaoticWorld = createWorld();
        const calmWorld = createWorld();
        const COUNT = 20;
        const TICKS = 200000;
        const BATCH = 2000;

        const chaoticEnts = [];
        for (let i = 0; i < COUNT; i++) {
            chaoticEnts.push(makeNpc(chaoticWorld, {
                name: "Chaotic-" + i, id: i, seed: "volatile",
                position: i * 100, // isolated
                biasPlayerSide: false,
            }));
        }

        const calmEnts = [];
        for (let i = 0; i < COUNT; i++) {
            calmEnts.push(makeNpc(calmWorld, {
                name: "Calm-" + i, id: i, seed: "volatile",
                position: i * 100, // isolated
                biasPlayerSide: true,
            }));
        }

        for (let t = 0; t < TICKS; t += BATCH) {
            psychologyDecaySystem(chaoticWorld, undefined, BATCH);
            psychologyDecaySystem(calmWorld, undefined, BATCH);
        }

        const avgLuc = (world, ents) =>
            ents.reduce((s, e) => s + getPsych(world, e).lucidity, 0) / ents.length;
        const avgHope = (world, ents) =>
            ents.reduce((s, e) => s + getPsych(world, e).hope, 0) / ents.length;

        const chaoticLuc = avgLuc(chaoticWorld, chaoticEnts);
        const calmLuc = avgLuc(calmWorld, calmEnts);
        const chaoticHope = avgHope(chaoticWorld, chaoticEnts);
        const calmHope = avgHope(calmWorld, calmEnts);

        // Chaotic side should have lost more total psychology
        const chaoticTotal = (100 - chaoticLuc) + (100 - chaoticHope);
        const calmTotal = (100 - calmLuc) + (100 - calmHope);

        assert.ok(chaoticTotal > calmTotal,
            `chaotic total loss ${chaoticTotal.toFixed(1)} (luc=${chaoticLuc.toFixed(1)}, hope=${chaoticHope.toFixed(1)}) ` +
            `should exceed calm total loss ${calmTotal.toFixed(1)} (luc=${calmLuc.toFixed(1)}, hope=${calmHope.toFixed(1)})`);
    });

    it("far-side (seeker) bias accelerates decay compared to no bias", () => {
        const extremeWorld = createWorld();
        const extremeEnts = [];
        for (let i = 0; i < 20; i++) {
            extremeEnts.push(makeNpc(extremeWorld, {
                name: "Extreme-" + i, id: i, seed: "extreme-bias",
                position: i * 100, // isolated
                biasPlayerSide: false, // far side = seekers (volatile, restless)
            }));
        }

        const controlWorld = createWorld();
        const controlEnts = [];
        for (let i = 0; i < 20; i++) {
            controlEnts.push(makeNpc(controlWorld, {
                name: "Control-" + i, id: i, seed: "extreme-bias",
                position: i * 100,
                biasPlayerSide: null, // no bias at all
            }));
        }

        const TICKS = 200000;
        const BATCH = 2000;
        for (let t = 0; t < TICKS; t += BATCH) {
            psychologyDecaySystem(extremeWorld, undefined, BATCH);
            psychologyDecaySystem(controlWorld, undefined, BATCH);
        }

        const avgLuc = (world, ents) =>
            ents.reduce((s, e) => s + getPsych(world, e).lucidity, 0) / ents.length;

        const extremeLuc = avgLuc(extremeWorld, extremeEnts);
        const controlLuc = avgLuc(controlWorld, controlEnts);

        assert.ok(extremeLuc < controlLuc,
            `far-side avg lucidity ${extremeLuc.toFixed(1)} should be lower than ` +
            `unbiased ${controlLuc.toFixed(1)}`);
    });
});

// --- Scenario 2: Companions slow decay ---

describe("Scenario: companions slow psychological decay", () => {
    it("bonded co-located NPCs retain more hope than isolated NPCs", () => {
        const world = createWorld();

        // Pair: two NPCs at same location who will build bonds
        const paired1 = makeNpc(world, { name: "Paired-A", id: 0, seed: "pair", position: 0 });
        const paired2 = makeNpc(world, { name: "Paired-B", id: 1, seed: "pair", position: 0 });

        // Loner: isolated NPC far away
        const loner = makeNpc(world, { name: "Loner", id: 2, seed: "pair", position: 500 });

        // Run simulation — paired NPCs build bonds, then all decay
        const TICKS = 40000;
        const BATCH = 500;
        for (let t = 0; t < TICKS; t += BATCH) {
            const prebuilt = buildLocationIndex(world);
            relationshipSystem(world, t, undefined, prebuilt, BATCH);
            psychologyDecaySystem(world, undefined, BATCH);
            groupFormationSystem(world, undefined, prebuilt);
        }

        const pairedHope = Math.min(
            getPsych(world, paired1).hope,
            getPsych(world, paired2).hope,
        );
        const lonerHope = getPsych(world, loner).hope;

        assert.ok(pairedHope > lonerHope,
            `paired hope ${pairedHope.toFixed(1)} should be higher than loner hope ${lonerHope.toFixed(1)}`);
    });

    it("bonded co-located NPCs retain more lucidity than isolated NPCs", () => {
        const world = createWorld();

        // Use same id so they get identical personalities → max compatibility
        const paired1 = makeNpc(world, { name: "Duo-A", id: 10, seed: "lucid", position: 0 });
        const paired2 = makeNpc(world, { name: "Duo-B", id: 10, seed: "lucid", position: 0 });
        const loner = makeNpc(world, { name: "Solo", id: 10, seed: "lucid", position: 500 });

        const TICKS = 40000;
        const BATCH = 500;
        for (let t = 0; t < TICKS; t += BATCH) {
            const prebuilt = buildLocationIndex(world);
            relationshipSystem(world, t, undefined, prebuilt, BATCH);
            psychologyDecaySystem(world, undefined, BATCH);
            groupFormationSystem(world, undefined, prebuilt);
        }

        const pairedLucidity = Math.min(
            getPsych(world, paired1).lucidity,
            getPsych(world, paired2).lucidity,
        );
        const lonerLucidity = getPsych(world, loner).lucidity;

        assert.ok(pairedLucidity > lonerLucidity,
            `paired lucidity ${pairedLucidity.toFixed(1)} should be higher than loner lucidity ${lonerLucidity.toFixed(1)}`);
    });
});

// --- Scenario 3: Mad prophet contagion ---

describe("Scenario: mad prophet contagion via social pressure", () => {
    it("mad NPC erodes lucidity of nearby calm NPCs", () => {
        const world = createWorld();

        // Mad prophet at position 0
        const prophet = makeNpc(world, {
            name: "Prophet", id: 0, seed: "contagion",
            position: 0, lucidity: 10, hope: 50, // mad (lucidity < 40)
        });

        // Nearby calm NPCs within shout range (default 6 segments)
        const nearby = [];
        for (let i = 0; i < 5; i++) {
            nearby.push(makeNpc(world, {
                name: "Near-" + i, id: i + 1, seed: "contagion",
                position: i + 1, // positions 1-5, within shout range
            }));
        }

        // Far away control NPCs outside shout range
        const far = [];
        for (let i = 0; i < 5; i++) {
            far.push(makeNpc(world, {
                name: "Far-" + i, id: i + 10, seed: "contagion",
                position: 50 + i, // way outside shout range
            }));
        }

        // Record initial lucidity
        const nearbyInitial = nearby.map(e => getPsych(world, e).lucidity);
        const farInitial = far.map(e => getPsych(world, e).lucidity);

        // Run social pressure (no relationship/decay — isolate the effect)
        const TICKS = 5000;
        for (let t = 0; t < TICKS; t++) {
            socialPressureSystem(world);
        }

        const nearbyFinal = nearby.map(e => getPsych(world, e).lucidity);
        const farFinal = far.map(e => getPsych(world, e).lucidity);

        // Nearby NPCs should have lost lucidity
        const nearbyLoss = nearbyInitial.map((init, i) => init - nearbyFinal[i]);
        const farLoss = farInitial.map((init, i) => init - farFinal[i]);

        const avgNearbyLoss = nearbyLoss.reduce((a, b) => a + b, 0) / nearbyLoss.length;
        const avgFarLoss = farLoss.reduce((a, b) => a + b, 0) / farLoss.length;

        assert.ok(avgNearbyLoss > 5,
            `nearby NPCs should lose significant lucidity, lost avg ${avgNearbyLoss.toFixed(1)}`);
        assert.strictEqual(avgFarLoss, 0,
            `far NPCs should be unaffected, lost avg ${avgFarLoss.toFixed(1)}`);
    });

    it("multiple mad NPCs compound the pressure", () => {
        const world = createWorld();

        // 3 mad prophets at position 0
        for (let i = 0; i < 3; i++) {
            makeNpc(world, {
                name: "Prophet-" + i, id: i, seed: "multi-mad",
                position: 0, lucidity: 10, hope: 50,
            });
        }

        // Victim nearby
        const victim = makeNpc(world, {
            name: "Victim", id: 10, seed: "multi-mad", position: 2,
        });

        // Control: same setup but only 1 prophet
        const world2 = createWorld();
        makeNpc(world2, {
            name: "Prophet-0", id: 0, seed: "single-mad",
            position: 0, lucidity: 10, hope: 50,
        });
        const control = makeNpc(world2, {
            name: "Control", id: 10, seed: "single-mad", position: 2,
        });

        const TICKS = 3000;
        for (let t = 0; t < TICKS; t++) {
            socialPressureSystem(world);
            socialPressureSystem(world2);
        }

        const victimLoss = 100 - getPsych(world, victim).lucidity;
        const controlLoss = 100 - getPsych(world2, control).lucidity;

        assert.ok(victimLoss > controlLoss,
            `3 prophets should cause more damage (${victimLoss.toFixed(1)}) than 1 (${controlLoss.toFixed(1)})`);
    });
});

// --- Scenario 4: Isolation accelerates breakdown ---

describe("Scenario: isolation accelerates psychological breakdown", () => {
    it("isolated NPCs lose more lucidity than clustered NPCs", () => {
        // World with isolated NPCs
        const isoWorld = createWorld();
        const isolated = [];
        for (let i = 0; i < 10; i++) {
            isolated.push(makeNpc(isoWorld, {
                name: "Iso-" + i, id: i, seed: "isolation",
                position: i * 100, // far apart, no one in hearing range
            }));
        }

        // World with clustered NPCs
        const cluWorld = createWorld();
        const clustered = [];
        for (let i = 0; i < 10; i++) {
            clustered.push(makeNpc(cluWorld, {
                name: "Clu-" + i, id: i, seed: "isolation",
                position: 0, // all co-located — same seed so same personalities
            }));
        }

        // Run both for the same duration
        const TICKS = 60000;
        const BATCH = 1000;
        for (let t = 0; t < TICKS; t += BATCH) {
            psychologyDecaySystem(isoWorld, undefined, BATCH);

            const prebuilt = buildLocationIndex(cluWorld);
            relationshipSystem(cluWorld, t, undefined, prebuilt, BATCH);
            psychologyDecaySystem(cluWorld, undefined, BATCH);
            groupFormationSystem(cluWorld, undefined, prebuilt);
        }

        const avgLuc = (world, ents) =>
            ents.reduce((s, e) => s + getPsych(world, e).lucidity, 0) / ents.length;

        const isoLuc = avgLuc(isoWorld, isolated);
        const cluLuc = avgLuc(cluWorld, clustered);

        assert.ok(isoLuc < cluLuc,
            `isolated avg lucidity ${isoLuc.toFixed(1)} should be lower than ` +
            `clustered ${cluLuc.toFixed(1)}`);
    });

    it("isolated NPCs have lower hope than clustered NPCs", () => {
        const isoWorld = createWorld();
        const isolated = [];
        for (let i = 0; i < 10; i++) {
            isolated.push(makeNpc(isoWorld, {
                name: "Iso-" + i, id: i, seed: "hope-iso",
                position: i * 100,
            }));
        }

        const cluWorld = createWorld();
        const clustered = [];
        for (let i = 0; i < 10; i++) {
            clustered.push(makeNpc(cluWorld, {
                name: "Clu-" + i, id: i, seed: "hope-clu",
                position: 0,
            }));
        }

        const TICKS = 40000;
        const BATCH = 1000;
        for (let t = 0; t < TICKS; t += BATCH) {
            psychologyDecaySystem(isoWorld, undefined, BATCH);

            const prebuilt = buildLocationIndex(cluWorld);
            relationshipSystem(cluWorld, t, undefined, prebuilt, BATCH);
            psychologyDecaySystem(cluWorld, undefined, BATCH);
            groupFormationSystem(cluWorld, undefined, prebuilt);
        }

        const isoAvgHope = isolated.reduce((s, e) => s + getPsych(isoWorld, e).hope, 0) / isolated.length;
        const cluAvgHope = clustered.reduce((s, e) => s + getPsych(cluWorld, e).hope, 0) / clustered.length;

        assert.ok(cluAvgHope > isoAvgHope,
            `clustered avg hope ${cluAvgHope.toFixed(1)} should be higher than isolated ${isoAvgHope.toFixed(1)}`);
    });
});

// --- Scenario 5: Corridor personality divergence ---

describe("Scenario: WEST settlers vs EAST seekers", () => {
    function makePopulation(count, isPlayerSide) {
        const pop = [];
        for (let i = 0; i < count; i++) {
            const rng = seedFromString("corridor-pop:" + i);
            const pers = generatePersonality(rng);
            applySideBias(pers, isPlayerSide);
            pop.push(pers);
        }
        return pop;
    }

    function avg(pop, trait) {
        return pop.reduce((s, p) => s + p[trait], 0) / pop.length;
    }

    it("settlers are calmer than seekers (lower temperament)", () => {
        const settlers = makePopulation(50, true);
        const seekers = makePopulation(50, false);
        const settlerTemp = avg(settlers, "temperament");
        const seekerTemp = avg(seekers, "temperament");
        assert.ok(settlerTemp < seekerTemp,
            `settler temperament ${settlerTemp.toFixed(2)} should be lower than seeker ${seekerTemp.toFixed(2)}`);
        assert.ok(seekerTemp - settlerTemp > 0.2,
            `gap should be substantial: ${(seekerTemp - settlerTemp).toFixed(2)}`);
    });

    it("settlers are more patient than seekers (lower pace)", () => {
        const settlers = makePopulation(50, true);
        const seekers = makePopulation(50, false);
        const settlerPace = avg(settlers, "pace");
        const seekerPace = avg(seekers, "pace");
        assert.ok(settlerPace < seekerPace,
            `settler pace ${settlerPace.toFixed(2)} should be lower than seeker ${seekerPace.toFixed(2)}`);
    });

    it("seekers are more open than settlers", () => {
        const settlers = makePopulation(50, true);
        const seekers = makePopulation(50, false);
        const settlerOpen = avg(settlers, "openness");
        const seekerOpen = avg(seekers, "openness");
        assert.ok(seekerOpen > settlerOpen,
            `seeker openness ${seekerOpen.toFixed(2)} should exceed settler ${settlerOpen.toFixed(2)}`);
    });

    it("seekers are more resistant than settlers (higher outlook)", () => {
        const settlers = makePopulation(50, true);
        const seekers = makePopulation(50, false);
        const settlerOut = avg(settlers, "outlook");
        const seekerOut = avg(seekers, "outlook");
        assert.ok(seekerOut > settlerOut,
            `seeker outlook ${seekerOut.toFixed(2)} should exceed settler ${settlerOut.toFixed(2)}`);
    });

    it("same-side compatibility higher than cross-side", () => {
        const settlers = makePopulation(30, true);
        const seekers = makePopulation(30, false);

        // Same-side compatibility (settlers with settlers)
        let sameSideSum = 0, sameSideCount = 0;
        for (let i = 0; i < settlers.length; i++) {
            for (let j = i + 1; j < settlers.length; j++) {
                sameSideSum += compatibility(settlers[i], settlers[j]);
                sameSideCount++;
            }
        }

        // Cross-side compatibility (settlers with seekers)
        let crossSum = 0, crossCount = 0;
        for (let i = 0; i < settlers.length; i++) {
            for (let j = 0; j < seekers.length; j++) {
                crossSum += compatibility(settlers[i], seekers[j]);
                crossCount++;
            }
        }

        const sameSideAvg = sameSideSum / sameSideCount;
        const crossAvg = crossSum / crossCount;

        assert.ok(sameSideAvg > crossAvg,
            `same-side compat ${sameSideAvg.toFixed(3)} should exceed cross-side ${crossAvg.toFixed(3)}`);
    });

    it("corridors break differently: seekers lose lucidity, settlers lose hope", () => {
        const seekerWorld = createWorld();
        const settlerWorld = createWorld();
        const COUNT = 20;
        const seekerEnts = [];
        const settlerEnts = [];

        for (let i = 0; i < COUNT; i++) {
            seekerEnts.push(makeNpc(seekerWorld, {
                name: "Seeker-" + i, id: i, seed: "corridor",
                position: i * 100, biasPlayerSide: false,
            }));
            settlerEnts.push(makeNpc(settlerWorld, {
                name: "Settler-" + i, id: i, seed: "corridor",
                position: i * 100, biasPlayerSide: true,
            }));
        }

        const TICKS = 200000;
        const BATCH = 2000;
        for (let t = 0; t < TICKS; t += BATCH) {
            psychologyDecaySystem(seekerWorld, undefined, BATCH);
            psychologyDecaySystem(settlerWorld, undefined, BATCH);
        }

        const avgPsych = (world, ents) => {
            const luc = ents.reduce((s, e) => s + getPsych(world, e).lucidity, 0) / ents.length;
            const hope = ents.reduce((s, e) => s + getPsych(world, e).hope, 0) / ents.length;
            return { luc, hope };
        };

        const seeker = avgPsych(seekerWorld, seekerEnts);
        const settler = avgPsych(settlerWorld, settlerEnts);

        // Seekers: volatile + resistant → lose lucidity faster (trend toward madness)
        assert.ok(seeker.luc < settler.luc,
            `seeker lucidity ${seeker.luc.toFixed(1)} should be lower than settler ${settler.luc.toFixed(1)}`);
        // Settlers: withdrawn + patient → lose hope faster (trend toward catatonia)
        assert.ok(settler.hope < seeker.hope,
            `settler hope ${settler.hope.toFixed(1)} should be lower than seeker ${seeker.hope.toFixed(1)}`);
    });
});
