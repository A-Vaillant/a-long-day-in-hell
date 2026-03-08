/* Chasm wrapper — freefall state mutations on window.state. */

import {
    fallTick, attemptGrab, defaultFallingState, grabChance, altitudeBand,
    LANDING_KILL_SPEED,
} from "../../lib/chasm.core.ts";
import { PRNG } from "./prng.js";
import { state } from "./state.js";
import { Surv } from "./survival.js";

export const Chasm = {
    jump(side) {
        state.falling = defaultFallingState(side);
    },

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

    grab(quicknessBonus = 0) {
        const rng = PRNG.fork("grab:" + state.floor + ":" + state.tick);
        const result = attemptGrab(state.falling.speed, rng, quicknessBonus);
        if (result.success) {
            state.falling = null;
            return { success: true, mortalityHit: 0 };
        }
        state.falling.speed = result.speedAfter;
        state.mortality = Math.max(0, state.mortality - result.mortalityHit);
        if (state.mortality <= 0) Surv.kill("trauma");
        return { success: false, mortalityHit: result.mortalityHit };
    },

    throwBook() {
        state.heldBook = null;
    },

    getGrabChance(quicknessBonus = 0) {
        return grabChance(state.falling.speed, quicknessBonus);
    },

    getAltitude(floor) {
        return altitudeBand(Number(floor !== undefined ? floor : state.floor));
    },
};
