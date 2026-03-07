/* NPC wrapper — spawn, movement, deterioration, dialogue. */

import {
    DISPOSITIONS, spawnNPCs, moveNPCs, getNPCsAt, interactText, deteriorate,
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

        // Wave 3: mad cluster (Direites) — far away, pre-degraded
        const rng3 = PRNG.fork("npc:spawn:mad");
        const madCenter = {
            side: loc.side === 0 ? 1 : 0,
            position: loc.position + (rng3.next() < 0.5 ? -1 : 1) * (80 + Math.floor(rng3.next() * 40)),
            floor: Math.max(0, loc.floor + Math.round((rng3.next() - 0.5) * 30)),
        };
        const mad = spawnNPCs(madCenter, 4, TEXT.npc_names, rng3, {
            positionSpread: 2, floorSpread: 0, sameSide: true, idOffset: 12,
        });
        for (const n of mad) n.disposition = "mad";

        state.npcs = nearby.concat(scattered, mad);
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
