/* Despairing wrapper — registers window.Despair.
 * Reads window.state, delegates to _DespairingCore.
 */
(function () {
    "use strict";
    var core = window._DespairingCore;

    window.Despair = {
        /** Apply ambient morale drain. Called from Surv.onMove(). */
        applyAmbientDrain: function () {
            state.morale = core.applyAmbientDrain(state.morale);
            if (state.morale <= 0) state.despairing = true;
        },

        /** Modify sleep recovery for despairing. Returns effective delta. */
        modifySleepRecovery: function (baseDelta) {
            return core.modifySleepRecovery(baseDelta, state.despairing);
        },

        /** Check and clear despairing if morale exceeds exit threshold. */
        checkExit: function () {
            if (state.despairing && core.shouldClearDespairing(state.morale)) {
                state.despairing = false;
            }
        },

        /** Corrupt a stat value for sidebar display. */
        corruptStatValue: function (trueValue) {
            if (!state.despairing) return trueValue;
            return core.corruptStatValue(trueValue, Math.random());
        },

        /** Whether a stat descriptor should show a wrong word. */
        shouldCorruptDescriptor: function () {
            if (!state.despairing) return false;
            return core.shouldCorruptDescriptor(Math.random());
        },

        /** Whether book reading is blocked right now. */
        isReadingBlocked: function () {
            return core.isReadingBlocked(state.despairing, Math.random());
        },

        /** Whether chasm jump skips confirmation. */
        chasmSkipsConfirm: function () {
            return core.chasmSkipsConfirm(state.despairing);
        },
    };
}());
