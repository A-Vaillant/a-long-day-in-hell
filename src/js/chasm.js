/* Chasm wrapper — freefall state mutations on window.state. */

import {
    fallTick, grabChance, altitudeBand,
    LANDING_KILL_SPEED,
} from "../../lib/chasm.core.ts";
import { state } from "./state.js";
import { Surv } from "./survival.js";

export const Chasm = {
    /** Advance one tick of freefall. Called by Tick.advance when state.falling is set. */
    onTick() {
        const f = state.falling;
        if (!f) return null;
        const prevFloor = state.floor;
        const result = fallTick(f, Number(state.floor));

        state.floor = BigInt(result.newFloor);
        f.speed = result.newSpeed;

        if (result.landed) {
            state.falling = null;
            if (result.fatal) Surv.kill("gravity");
        }
        return {
            landed: result.landed,
            fatal: result.fatal,
            floorsDescended: prevFloor - state.floor,
        };
    },

    getGrabChance(quicknessBonus = 0) {
        return grabChance(state.falling.speed, quicknessBonus);
    },

    getAltitude(floor) {
        return altitudeBand(Number(floor !== undefined ? floor : state.floor));
    },
};
