import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSimulation } from "../lib/simulator.core.ts";
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";

describe("simulator mercy kiosk", () => {
    // Book at position 5 (gallery in first segment).
    // Left kiosk = position 0, right kiosk = position 17 (GALLERIES_PER_SEGMENT).
    const G = BigInt(GALLERIES_PER_SEGMENT);
    const targetBookOverride = { side: 0, position: 5n, floor: 100n, bookIndex: 3 };

    it("grants morale boost when player arrives at mercy kiosk", () => {
        let moved = false;
        const sim = createSimulation({
            seed: "mercy-test",
            maxDays: 1,
            startLoc: { side: 0, position: 1n, floor: 100n },
            startNearBook: false,
            startMorale: 50,
            targetBookOverride,
            strategy: {
                name: "mercy-seeker",
                decide(gs) {
                    if (!moved && gs.position === 1n) { moved = true; return { type: "move", dir: "left" }; }
                    return { type: "wait" };
                },
            },
        });
        assert.strictEqual(sim.state().stats.morale, 50, "morale starts at 50");
        sim.run();
        assert.strictEqual(sim.state()._mercyKiosks["left"], true,
            "should have detected left mercy kiosk");
        // Morale set to 100, minus ambient drain over 1 day (~8 pts).
        assert.ok(sim.state().stats.morale > 85,
            `morale should be near 100 after mercy (got ${sim.state().stats.morale})`);
    });

    it("does not grant mercy boost at non-adjacent kiosk", () => {
        // Kiosk at position 2*G (=34) is NOT adjacent to book at position 5
        const sim = createSimulation({
            seed: "mercy-test-no",
            maxDays: 1,
            startLoc: { side: 0, position: 2n * G + 1n, floor: 100n },
            startNearBook: false,
            startMorale: 50,
            targetBookOverride,
            strategy: {
                name: "non-mercy",
                decide(gs) {
                    if (gs.position !== 2n * G) return { type: "move", dir: "left" };
                    return { type: "wait" };
                },
            },
        });
        sim.run();
        assert.ok(sim.state().stats.morale <= 50,
            "morale should not increase at non-adjacent kiosk");
        assert.strictEqual(sim.state()._mercyKiosks["left"], undefined);
        assert.strictEqual(sim.state()._mercyKiosks["right"], undefined);
    });

    it("grants mercy boost only once per kiosk side", () => {
        let visits = 0;
        const sim = createSimulation({
            seed: "mercy-once",
            maxDays: 2,
            startLoc: { side: 0, position: 1n, floor: 100n },
            startNearBook: false,
            startMorale: 30,
            targetBookOverride,
            strategy: {
                name: "bouncer",
                decide(gs) {
                    if (gs.position === 0n) { visits++; return { type: "move", dir: "right" }; }
                    if (gs.position === 1n && visits < 3) return { type: "move", dir: "left" };
                    return { type: "wait" };
                },
            },
        });
        sim.run();
        assert.strictEqual(sim.state()._mercyKiosks["left"], true);
        // Mercy fills to 100. Ambient drain over 2 days should bring it below 100.
        assert.ok(sim.state().stats.morale < 100,
            `morale ${sim.state().stats.morale} should be below 100 after drain`);
    });
});
