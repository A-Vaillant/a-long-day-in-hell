/* NPC wrapper — spawn, movement, deterioration, dialogue. */

import {
    DISPOSITIONS, spawnNPCs, getNPCsAt, interactText,
} from "../../lib/npc.core.ts";
import { PRNG } from "./prng.js";
import { state } from "./state.js";

export const Npc = {
    DISPOSITIONS,
    getNPCsAt,

    init() {
        const loc = { side: state.side, position: state.position, floor: state.floor };

        // Wave 1: nearby group — everyone arrives together at the sign
        const rng1 = PRNG.fork("npc:spawn:near");
        const nearby = spawnNPCs(loc, 8, TEXT.npc_names, rng1, {
            positionSpread: 3, floorSpread: 0, sameSide: true, idOffset: 0,
        });

        // Wave 2: scattered loners — already wandered off
        const rng2 = PRNG.fork("npc:spawn:scattered");
        const scattered = spawnNPCs(loc, 4, TEXT.npc_names, rng2, {
            positionSpread: 50, floorSpread: 15, sameSide: false, idOffset: 8,
        });

        state.npcs = nearby.concat(scattered);
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
