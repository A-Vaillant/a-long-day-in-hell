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
            v.mortality  = d.mortality;
            v.despairing = d.despairing;
            v.dead       = d.dead;
        },

        _statsFromVars() {
            const v = State.variables;
            return {
                hunger: v.hunger, thirst: v.thirst, exhaustion: v.exhaustion,
                morale: v.morale, mortality: v.mortality,
                despairing: v.despairing, dead: v.dead,
            };
        },

        /** Apply a move/wait tick. Mutates State.variables in place. */
        onMove() {
            Object.assign(State.variables, core.survivalApplyMove(this._statsFromVars()));
        },

        /** Apply one sleep-hour. Mutates State.variables in place. */
        onSleep() {
            Object.assign(State.variables, core.survivalApplySleep(this._statsFromVars()));
        },

        /** Restore all stats (resurrection at dawn). */
        onResurrection() {
            Object.assign(State.variables, core.survivalApplyResurrection());
        },

        onEat()   { Object.assign(State.variables, core.survivalApplyEat(this._statsFromVars())); },
        onDrink() { Object.assign(State.variables, core.survivalApplyDrink(this._statsFromVars())); },

        severity(val) { return core.survivalSeverity(val); },

        showMortality() { return core.survivalShowMortality(this._statsFromVars()); },

        /** Returns array of warning strings for current state. */
        warnings() {
            return core.survivalWarnings(this._statsFromVars());
        },
    };
}());
