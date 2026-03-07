import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";
import { SPAWN_CONFIG } from "../lib/npc.core.ts";

const TOTAL = SPAWN_CONFIG.wavesPerSide * 2 * SPAWN_CONFIG.npcsPerWave;
const PER_SIDE = SPAWN_CONFIG.wavesPerSide * SPAWN_CONFIG.npcsPerWave;

describe("NPC spawn system", () => {
    it(`spawns ${TOTAL} NPCs total (${SPAWN_CONFIG.wavesPerSide}×2 waves × ${SPAWN_CONFIG.npcsPerWave})`, () => {
        const game = bootGame();
        assert.strictEqual(game.state.npcs.length, TOTAL,
            `expected ${TOTAL} NPCs, got ${game.state.npcs.length}`);
    });

    it("all NPCs have unique IDs", () => {
        const game = bootGame();
        const ids = game.state.npcs.map(n => n.id);
        assert.strictEqual(new Set(ids).size, TOTAL);
    });

    it("all NPCs have unique combinatorial names (first + surname)", () => {
        const game = bootGame();
        const names = game.state.npcs.map(n => n.name);
        assert.strictEqual(new Set(names).size, TOTAL, `all ${TOTAL} names should be unique`);
        for (const name of names) {
            const parts = name.split(" ");
            assert.strictEqual(parts.length, 2,
                `name "${name}" should be "First Surname"`);
        }
    });

    it(`${PER_SIDE} NPCs on player side, ${PER_SIDE} on other side`, () => {
        const game = bootGame();
        const playerSide = game.state.side;
        const onPlayerSide = game.state.npcs.filter(n => n.side === playerSide);
        const onOtherSide = game.state.npcs.filter(n => n.side !== playerSide);
        assert.strictEqual(onPlayerSide.length, PER_SIDE,
            `expected ${PER_SIDE} on player side, got ${onPlayerSide.length}`);
        assert.strictEqual(onOtherSide.length, PER_SIDE,
            `expected ${PER_SIDE} on other side, got ${onOtherSide.length}`);
    });

    it("early waves are closer, later waves are farther", () => {
        const game = bootGame();
        const playerPos = game.state.position;
        const playerFloor = game.state.floor;

        const ppw = SPAWN_CONFIG.npcsPerWave;
        const earlyNpcs = game.state.npcs.filter(n => n.id < ppw);
        const lastWaveStart = TOTAL - ppw;
        const lateNpcs = game.state.npcs.filter(n => n.id >= lastWaveStart);

        const avgDist = (npcs) => {
            const total = npcs.reduce((sum, n) =>
                sum + Math.abs(n.position - playerPos) + Math.abs(n.floor - playerFloor), 0);
            return total / npcs.length;
        };

        const earlyDist = avgDist(earlyNpcs);
        const lateDist = avgDist(lateNpcs);
        assert.ok(lateDist > earlyDist,
            `late waves (avg dist ${lateDist.toFixed(1)}) should be farther than early (${earlyDist.toFixed(1)})`);
    });

    it("all NPCs start alive and calm", () => {
        const game = bootGame();
        for (const npc of game.state.npcs) {
            assert.strictEqual(npc.alive, true, `NPC ${npc.id} should be alive`);
            assert.strictEqual(npc.disposition, "calm", `NPC ${npc.id} should be calm`);
        }
    });

    it("no NPC has negative floor", () => {
        const game = bootGame();
        for (const npc of game.state.npcs) {
            assert.ok(npc.floor >= 0, `NPC ${npc.id} has floor ${npc.floor}`);
        }
    });
});
