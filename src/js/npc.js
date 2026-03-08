/* NPC wrapper — spawn, movement, deterioration, dialogue. */

import {
    DISPOSITIONS, SPAWN_CONFIG, spawnNPCs, getNPCsAt, interactText,
} from "../../lib/npc.core.ts";
import { PRNG } from "./prng.js";
import { state } from "./state.js";

export const Npc = {
    DISPOSITIONS,
    getNPCsAt,

    init() {
        const loc = { side: state.side, position: state.position, floor: state.floor };
        const otherSide = state.side === 0 ? 1 : 0;
        const sc = SPAWN_CONFIG;
        const WAVES = sc.wavesPerSide * 2;

        // Combine first + last names via PRNG for deterministic variety
        const nameRng = PRNG.fork("npc:names");
        const firsts = TEXT.npc_first_names;
        const lasts = TEXT.npc_surnames;
        const totalNeeded = sc.npcsPerWave * WAVES;
        const names = [];
        const usedPairs = new Set();
        for (let i = 0; i < totalNeeded; i++) {
            let fi, li, key;
            do {
                fi = Math.floor(nameRng.next() * firsts.length);
                li = Math.floor(nameRng.next() * lasts.length);
                key = fi + ":" + li;
            } while (usedPairs.has(key));
            usedPairs.add(key);
            names.push(firsts[fi] + " " + lasts[li]);
        }

        const allNpcs = [];
        let id = 0;

        for (let w = 0; w < WAVES; w++) {
            const isPlayerSide = w < sc.wavesPerSide;
            const rng = PRNG.fork("npc:spawn:w" + w);
            const spread = sc.baseSpread + w * sc.spreadPerWave;
            const floorSpread = Math.min(sc.baseFloorSpread + w * sc.floorSpreadPerWave, sc.maxFloorSpread);
            const waveNames = names.slice(w * sc.npcsPerWave, (w + 1) * sc.npcsPerWave);
            const wave = spawnNPCs(loc, sc.npcsPerWave, waveNames, rng, {
                positionSpread: spread,
                floorSpread,
                sameSide: true,
                idOffset: id,
            });
            for (const npc of wave) {
                npc.side = isPlayerSide ? state.side : otherSide;
            }
            allNpcs.push(...wave);
            id += sc.npcsPerWave;
        }

        state.npcs = allNpcs;
    },
    onDawn() {
        // Movement is now per-tick via ECS (movementSystem in Social.onTick).
        // Disposition derived from ECS psychology (Social.onTick).
    },
    here() {
        if (!state.npcs) return [];
        return getNPCsAt(state.npcs, state.side, state.position, state.floor);
    },
    talk(npc) {
        const rng = PRNG.fork("npc:talk:" + npc.id + ":" + state.day);
        return interactText(npc, TEXT.npc_dialogue, rng);
    },
};
