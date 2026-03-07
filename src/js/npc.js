/* NPC wrapper — spawn, movement, deterioration, dialogue. */

import {
    DISPOSITIONS, spawnNPCs, moveNPCs, getNPCsAt, interactText, deteriorate,
} from "../../lib/npc.core.js";
import { PRNG } from "./prng.js";
import { state } from "./state.js";

export const Npc = {
    DISPOSITIONS,
    getNPCsAt,

    init() {
        const rng = PRNG.fork("npc:spawn");
        const loc = { side: state.side, position: state.position, floor: state.floor };
        state.npcs = spawnNPCs(loc, 8, TEXT.npc_names, rng);
    },
    onDawn() {
        const moveRng = PRNG.fork("npc:move:" + state.day);
        state.npcs = moveNPCs(state.npcs, moveRng);
        // Disposition now derived from ECS psychology (Social.onTick),
        // old deteriorate() removed — decay is continuous, not daily dice.
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
