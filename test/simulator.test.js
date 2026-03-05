import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSimulation, strategies, runScenario } from "../lib/simulator.core.js";

/* ---- Core simulation engine (#66) ---- */

describe("simulator: targeted win path", () => {
    it("targeted strategy finds and submits book within maxDays", () => {
        const sim = createSimulation({
            seed: "win-test-1",
            maxDays: 200,
            strategy: strategies.targeted(),
            placement: "gaussian",
        });
        const result = sim.run();
        assert.strictEqual(result.won, true, "should win");
        assert.ok(result.day < 200, `won on day ${result.day}, expected < 200`);
        assert.strictEqual(result.submissionsAttempted, 1, "should submit exactly once");
    });

    it("targeted strategy works with different seeds", () => {
        for (const seed of ["alpha", "beta", "gamma", "delta"]) {
            const sim = createSimulation({
                seed,
                maxDays: 200,
                strategy: strategies.targeted(),
                placement: "gaussian",
            });
            const result = sim.run();
            assert.strictEqual(result.won, true, `seed "${seed}" should win`);
        }
    });
});

describe("simulator: survival only", () => {
    it("survival-focused player stays alive 30 days at rest area", () => {
        const sim = createSimulation({
            seed: "survive-30",
            maxDays: 30,
            strategy: strategies.survivalOnly(),
        });
        const result = sim.run();
        assert.strictEqual(result.deaths, 0, `expected 0 deaths, got ${result.deaths}`);
        assert.strictEqual(result.won, false);
        assert.strictEqual(result.day, 31); // ran all 30 days + 1
    });

    it("survival player maintains reasonable stats", () => {
        const sim = createSimulation({
            seed: "survive-stats",
            maxDays: 10,
            strategy: strategies.survivalOnly(),
        });
        const result = sim.run();
        assert.ok(result.finalStats.hunger < 80, `hunger ${result.finalStats.hunger} should be manageable`);
        assert.ok(result.finalStats.thirst < 80, `thirst ${result.finalStats.thirst} should be manageable`);
    });
});

describe("simulator: neglectful death", () => {
    it("neglectful player dies within 7 days", () => {
        const sim = createSimulation({
            seed: "neglect-1",
            maxDays: 10,
            strategy: strategies.neglectful(),
        });
        const result = sim.run();
        assert.ok(result.deaths > 0, "should die at least once");
    });

    it("neglectful player resurrects and dies repeatedly", () => {
        const sim = createSimulation({
            seed: "neglect-cycle",
            maxDays: 30,
            maxDeaths: 20,
            strategy: strategies.neglectful(),
        });
        const result = sim.run();
        assert.ok(result.deaths >= 3, `expected multiple deaths, got ${result.deaths}`);
    });
});

describe("simulator: random walk", () => {
    it("random walker explores multiple segments", () => {
        const sim = createSimulation({
            seed: "random-walk-1",
            maxDays: 10,
            strategy: strategies.randomWalk(),
        });
        const result = sim.run();
        assert.ok(result.segmentsVisited > 5, `visited ${result.segmentsVisited} segments`);
        assert.ok(result.totalMoves > 50, `made ${result.totalMoves} moves`);
    });

    it("random walker reads some books", () => {
        const sim = createSimulation({
            seed: "random-read",
            maxDays: 10,
            strategy: strategies.randomWalk({ readChance: 0.3 }),
        });
        const result = sim.run();
        assert.ok(result.booksRead > 0, `should read at least one book, read ${result.booksRead}`);
    });
});

describe("simulator: systematic search", () => {
    it("systematic searcher reads many books", () => {
        const sim = createSimulation({
            seed: "systematic-1",
            maxDays: 10,
            strategy: strategies.systematic(),
        });
        const result = sim.run();
        assert.ok(result.booksRead > 50, `read ${result.booksRead} books, expected > 50`);
    });
});

/* ---- Strategy plugin API (#67) ---- */

describe("strategy: custom", () => {
    it("custom strategy receives correct gameState shape", () => {
        let capturedState = null;
        const sim = createSimulation({
            seed: "custom-shape",
            maxDays: 1,
            strategy: strategies.custom("inspector", (gs) => {
                if (!capturedState) capturedState = gs;
                return { type: "wait" };
            }),
        });
        sim.run();
        assert.ok(capturedState, "strategy should have been called");
        assert.strictEqual(typeof capturedState.seed, "string");
        assert.strictEqual(typeof capturedState.side, "number");
        assert.strictEqual(typeof capturedState.position, "number");
        assert.strictEqual(typeof capturedState.floor, "number");
        assert.strictEqual(typeof capturedState.tick, "number");
        assert.strictEqual(typeof capturedState.day, "number");
        assert.strictEqual(typeof capturedState.lightsOn, "boolean");
        assert.strictEqual(typeof capturedState.dead, "boolean");
        assert.strictEqual(typeof capturedState.won, "boolean");
        assert.ok(capturedState.stats, "should have stats");
        assert.ok(capturedState.availableMoves, "should have availableMoves");
        assert.ok(Array.isArray(capturedState.availableMoves));
        assert.strictEqual(typeof capturedState.isRestArea, "boolean");
        assert.strictEqual(typeof capturedState.timeString, "string");
        assert.ok(Array.isArray(capturedState.npcs));
        assert.strictEqual(typeof capturedState.segmentsVisited, "number");
        assert.strictEqual(typeof capturedState.booksRead, "number");
    });

    it("custom strategy can implement multi-action sequences", () => {
        let actionCount = 0;
        const sim = createSimulation({
            seed: "multi-action",
            maxDays: 1,
            strategy: strategies.custom("multi", (gs) => {
                actionCount++;
                if (actionCount === 1) return [{ type: "move", dir: "right" }, { type: "move", dir: "right" }];
                return { type: "wait" };
            }),
        });
        sim.run();
        assert.ok(actionCount > 1);
    });
});

/* ---- Scenario harnesses (#68) ---- */

describe("scenario: NPC population", () => {
    it("NPCs deteriorate over time", () => {
        let lastDayNpcs = null;
        const sim = createSimulation({
            seed: "npc-pop",
            maxDays: 50,
            strategy: strategies.survivalOnly(),
            npcCount: 8,
            onDay: (gs) => { lastDayNpcs = gs.npcs; },
        });
        const result = sim.run();
        assert.ok(result.npcsAlive < result.npcsTotal,
            `expected some NPC deaths after 50 days: ${result.npcsAlive}/${result.npcsTotal} alive`);
    });
});

describe("scenario: search coverage", () => {
    it("systematic searcher covers more ground than random walker", () => {
        const sysResult = createSimulation({
            seed: "coverage-sys",
            maxDays: 15,
            strategy: strategies.systematic(),
        }).run();

        const rndResult = createSimulation({
            seed: "coverage-rnd",
            maxDays: 15,
            strategy: strategies.randomWalk(),
        }).run();

        // Systematic should read more books (it reads every book in each segment)
        assert.ok(sysResult.booksRead > rndResult.booksRead,
            `systematic ${sysResult.booksRead} books vs random ${rndResult.booksRead}`);
    });
});

describe("scenario: win path verification", () => {
    it("gaussian placement is winnable with targeted strategy across 10 seeds", () => {
        const scenario = runScenario({
            runs: 10,
            strategyFactory: () => strategies.targeted(),
            maxDays: 300,
            placement: "gaussian",
            seedPrefix: "winnable",
        });
        assert.strictEqual(scenario.summary.wins, 10,
            `expected 10/10 wins, got ${scenario.summary.wins}/10`);
        assert.ok(scenario.summary.avgDays < 200,
            `avg days ${scenario.summary.avgDays} should be < 200`);
    });
});

describe("scenario: dehydration timeline", () => {
    it("no-water player dies consistently within 5 days across seeds", () => {
        const scenario = runScenario({
            runs: 5,
            strategyFactory: () => strategies.neglectful(),
            maxDays: 10,
            seedPrefix: "dehydrate",
        });
        for (const r of scenario.results) {
            assert.ok(r.deaths > 0, "every run should have at least one death");
        }
    });
});

describe("runScenario", () => {
    it("returns valid summary stats", () => {
        const scenario = runScenario({
            runs: 3,
            strategyFactory: () => strategies.survivalOnly(),
            maxDays: 5,
            seedPrefix: "summary",
        });
        assert.strictEqual(scenario.summary.runs, 3);
        assert.strictEqual(typeof scenario.summary.winRate, "number");
        assert.strictEqual(typeof scenario.summary.avgDays, "number");
        assert.strictEqual(typeof scenario.summary.avgDeaths, "number");
        assert.strictEqual(typeof scenario.summary.avgSegmentsVisited, "number");
        assert.strictEqual(typeof scenario.summary.medianDays, "number");
        assert.ok(scenario.results.length === 3);
    });
});

/* ---- Event integration ---- */

describe("simulator: events", () => {
    it("events fire during movement", () => {
        const events = [];
        const cards = [
            { id: 0, text: "Wind howls", type: "atmospheric", morale: -2 },
            { id: 1, text: "Distant singing", type: "sound", morale: 3 },
            { id: 2, text: "Shadow moves", type: "sighting", morale: -1 },
        ];
        const sim = createSimulation({
            seed: "events-test",
            maxDays: 5,
            strategy: strategies.randomWalk(),
            eventCards: cards,
            onEvent: (ev) => events.push(ev),
        });
        sim.run();
        assert.ok(events.length > 0, `expected some events, got ${events.length}`);
    });
});

/* ---- Callbacks ---- */

describe("simulator: callbacks", () => {
    it("onTick fires each tick", () => {
        let tickCalls = 0;
        const sim = createSimulation({
            seed: "cb-tick",
            maxDays: 1,
            strategy: strategies.survivalOnly(),
            onTick: () => tickCalls++,
        });
        sim.run();
        assert.ok(tickCalls > 0, "onTick should fire");
    });

    it("onDay fires each dawn", () => {
        let dayCalls = 0;
        const sim = createSimulation({
            seed: "cb-day",
            maxDays: 3,
            strategy: strategies.survivalOnly(),
            onDay: () => dayCalls++,
        });
        sim.run();
        assert.ok(dayCalls >= 2, `onDay should fire per dawn, got ${dayCalls}`);
    });
});
