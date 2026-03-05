/* Chasm wrapper — freefall state mutations on window.state. */

import {
    fallTick, attemptGrab, defaultFallingState, grabChance,
} from "../../lib/chasm.core.js";
import { PRNG } from "./prng.js";
import { state } from "./state.js";
import { Tick } from "./tick.js";
import { Surv } from "./survival.js";

export const Chasm = {
    jump(side) {
        state.falling = defaultFallingState(side);
    },

    tick() {
        const f = state.falling;
        const prevFloor = state.floor;
        const result = fallTick(f, state.floor);

        state.floor = result.newFloor;
        f.speed = result.newSpeed;

        // Time/survival pass while falling
        Tick.onMove();

        const floorsDescended = prevFloor - state.floor;

        if (result.landed && result.fatal) {
            state.falling = null;
            Surv.kill("chasm");
            return { landed: true, fatal: true, floorsDescended };
        }
        if (result.landed) {
            state.falling = null;
            return { landed: true, fatal: false, floorsDescended };
        }
        return { landed: false, fatal: false, floorsDescended };
    },

    grab() {
        const rng = PRNG.fork("grab:" + state.floor + ":" + state.tick);
        const result = attemptGrab(state.falling.speed, rng);
        if (result.success) {
            state.falling = null;
            return { success: true, mortalityHit: 0 };
        }
        state.mortality = Math.max(0, state.mortality - result.mortalityHit);
        if (state.mortality <= 0) Surv.kill("chasm");
        return { success: false, mortalityHit: result.mortalityHit };
    },

    throwBook() {
        state.heldBook = null;
    },

    getGrabChance() {
        return grabChance(state.falling.speed);
    },
};
