#!/usr/bin/env node
/** Run simulation scenarios and dump metrics as JSON to stdout.
 *  Usage: node scripts/sim-metrics.js [--runs N] [--days N]
 */

import { createSimulation, strategies, runScenario } from "../lib/simulator.core.js";

const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
}

const RUNS = arg("runs", 20);
const MAX_DAYS = arg("days", 100);

const output = {};

// --- 1. Win path: targeted (omniscient) vs systematic (blind search) ---
{
    const targetedResults = [];
    const systematicResults = [];
    for (let i = 0; i < RUNS; i++) {
        const tSim = createSimulation({
            seed: "win:" + i,
            maxDays: MAX_DAYS * 3,
            strategy: strategies.targeted(),
            placement: "gaussian",
        });
        const tR = tSim.run();
        targetedResults.push({ seed: i, won: tR.won, day: tR.day, deaths: tR.deaths, moves: tR.totalMoves });

        const sSim = createSimulation({
            seed: "win:" + i,
            maxDays: MAX_DAYS * 3,
            strategy: strategies.systematic(),
            placement: "gaussian",
        });
        const sR = sSim.run();
        systematicResults.push({ seed: i, won: sR.won, day: sR.day, deaths: sR.deaths, moves: sR.totalMoves, booksRead: sR.booksRead });
    }
    output.targeted = targetedResults;
    output.systematic_win = systematicResults;
}

// --- 2. Survival curves: stat trajectories over time ---
{
    const dayData = [];
    const sim = createSimulation({
        seed: "survival-curve",
        maxDays: 30,
        strategy: strategies.survivalOnly(),
        onDay: (gs) => {
            dayData.push({
                day: gs.day,
                hunger: gs.stats.hunger,
                thirst: gs.stats.thirst,
                exhaustion: gs.stats.exhaustion,
                morale: gs.stats.morale,
                mortality: gs.stats.mortality,
            });
        },
    });
    sim.run();
    output.survivalCurve = dayData;
}

// --- 3. Neglectful death timeline ---
{
    const results = [];
    for (let i = 0; i < RUNS; i++) {
        const deathDays = [];
        const sim = createSimulation({
            seed: "neglect:" + i,
            maxDays: 30,
            maxDeaths: 20,
            strategy: strategies.neglectful(),
            onDeath: (gs) => deathDays.push(gs.day),
        });
        const r = sim.run();
        results.push({ seed: i, deaths: r.deaths, firstDeath: deathDays[0] || null, deathDays });
    }
    output.neglectful = results;
}

// --- 4. Random walk exploration over time ---
{
    const snapshots = [];
    let lastDay = 0;
    const sim = createSimulation({
        seed: "explore-curve",
        maxDays: 50,
        strategy: strategies.randomWalk({ readChance: 0.15 }),
        onDay: (gs) => {
            snapshots.push({
                day: gs.day,
                segmentsVisited: gs.segmentsVisited,
                booksRead: gs.booksRead,
                morale: gs.stats.morale,
            });
        },
    });
    sim.run();
    output.exploration = snapshots;
}

// --- 5. NPC population over time ---
{
    const snapshots = [];
    const sim = createSimulation({
        seed: "npc-pop-curve",
        maxDays: 80,
        npcCount: 8,
        strategy: strategies.survivalOnly(),
        onDay: (gs) => {
            const alive = gs.npcs.filter(n => n.alive).length;
            const dispositions = {};
            for (const n of gs.npcs) {
                const k = n.alive ? n.disposition : "dead";
                dispositions[k] = (dispositions[k] || 0) + 1;
            }
            snapshots.push({ day: gs.day, alive, ...dispositions });
        },
    });
    sim.run();
    output.npcPopulation = snapshots;
}

// --- 6. Morale trajectories: different playstyles ---
// All strategies that actually MOVE (ambient drain only fires on move/wait ticks).
{
    const styles = [
        { name: "walker (no reading)", factory: () => strategies.randomWalk({ readChance: 0, eatAt: 60, drinkAt: 60, sleepAt: 75 }) },
        { name: "heavy reader", factory: () => strategies.randomWalk({ readChance: 0.5, eatAt: 60, drinkAt: 60, sleepAt: 75 }) },
        { name: "systematic", factory: () => strategies.systematic({ eatAt: 60, drinkAt: 60, sleepAt: 75 }) },
        { name: "neglectful", factory: () => strategies.neglectful() },
    ];
    const moraleCurves = {};
    for (const style of styles) {
        const dayData = [];
        const sim = createSimulation({
            seed: "morale-" + style.name,
            maxDays: 30,
            strategy: style.factory(),
            onDay: (gs) => dayData.push({ day: gs.day, morale: gs.stats.morale, despairing: gs.despairing }),
        });
        sim.run();
        moraleCurves[style.name] = dayData;
    }
    output.moraleCurves = moraleCurves;
}

// --- 7. Systematic search: books read per day ---
{
    const dayData = [];
    const sim = createSimulation({
        seed: "systematic-rate",
        maxDays: 20,
        strategy: strategies.systematic(),
        onDay: (gs) => {
            dayData.push({ day: gs.day, booksRead: gs.booksRead, segmentsVisited: gs.segmentsVisited });
        },
    });
    sim.run();
    output.systematicRate = dayData;
}

console.log(JSON.stringify(output));
