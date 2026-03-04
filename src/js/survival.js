/* SugarCube wrapper for SurvivalCore — registers setup.Survival.
 * Reads/writes State.variables directly so stats persist in save state.
 */
(function () {
    "use strict";
    const core = window._SurvivalCore;

    setup.Survival = {
        /** Initialize stats on a new game (call from StoryInit). */
        init() {
            const d = core.survivalDefaults();
            const v = State.variables;
            v.hunger     = d.hunger;
            v.thirst     = d.thirst;
            v.exhaustion = d.exhaustion;
            v.morale     = d.morale;
            v.despairing = d.despairing;
        },

        /** Apply a move/wait tick. Mutates State.variables in place. */
        onMove() {
            const v = State.variables;
            const next = core.survivalApplyMove({
                hunger: v.hunger, thirst: v.thirst,
                exhaustion: v.exhaustion, morale: v.morale, despairing: v.despairing,
            });
            Object.assign(v, next);
        },

        /** Apply a sleep rest. Mutates State.variables in place. */
        onSleep() {
            const v = State.variables;
            const next = core.survivalApplySleep({
                hunger: v.hunger, thirst: v.thirst,
                exhaustion: v.exhaustion, morale: v.morale, despairing: v.despairing,
            });
            Object.assign(v, next);
        },

        onEat()   { const v = State.variables; Object.assign(v, core.survivalApplyEat(v)); },
        onDrink() { const v = State.variables; Object.assign(v, core.survivalApplyDrink(v)); },

        severity(val) { return core.survivalSeverity(val); },

        /** Returns array of warning strings for current state. */
        warnings() {
            const v = State.variables;
            return core.survivalWarnings({
                hunger: v.hunger, thirst: v.thirst,
                exhaustion: v.exhaustion, morale: v.morale, despairing: v.despairing,
            });
        },
    };
}());
