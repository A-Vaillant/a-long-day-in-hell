/* Despairing wrapper — morale corruption and despair effects. */

import {
    applyAmbientDrain, modifySleepRecovery, shouldClearDespairing,
    corruptStatValue as _corruptStatValue, shouldCorruptDescriptor as _shouldCorruptDescriptor,
    isReadingBlocked as _isReadingBlocked, chasmSkipsConfirm as _chasmSkipsConfirm,
} from "../../lib/despairing.core.js";
import { state } from "./state.js";

export const Despair = {
    applyAmbientDrain() {
        state.morale = applyAmbientDrain(state.morale);
        if (state.morale <= 0) state.despairing = true;
    },
    modifySleepRecovery(baseDelta) {
        return modifySleepRecovery(baseDelta, state.despairing);
    },
    checkExit() {
        if (state.despairing && shouldClearDespairing(state.morale)) {
            state.despairing = false;
        }
    },
    corruptStatValue(trueValue, statLabel) {
        if (!state.despairing) return trueValue;
        var rng = seedFromString("corrupt:" + state.tick + ":" + state.day + ":" + (statLabel || ""));
        return _corruptStatValue(trueValue, rng.next());
    },
    shouldCorruptDescriptor() {
        if (!state.despairing) return false;
        return _shouldCorruptDescriptor(Math.random());
    },
    isReadingBlocked() {
        return _isReadingBlocked(state.despairing, Math.random());
    },
    chasmSkipsConfirm() {
        return _chasmSkipsConfirm(state.despairing);
    },
};
