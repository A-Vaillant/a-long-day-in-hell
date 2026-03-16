/* Survival wrapper — hunger, thirst, exhaustion, morale, mortality. */

import {
    defaultStats, applySleep, applyResurrection, severity, getWarnings, showMortality,
    describeFromTable, canSleep,
} from "../../lib/survival.core.ts";
import { Despair } from "./despairing.js";
import { state } from "./state.js";

function statsFromState() {
    return {
        hunger: state.hunger, thirst: state.thirst, exhaustion: state.exhaustion,
        morale: state.morale, mortality: state.mortality,
        despairing: state.despairing, dead: state.dead,
    };
}

export const Surv = {
    init() {
        const d = defaultStats();
        state.hunger     = d.hunger;
        state.thirst     = d.thirst;
        state.exhaustion = d.exhaustion;
        state.morale     = d.morale;
        state.mortality  = d.mortality;
        state.despairing = d.despairing;
        state.dead       = d.dead;
    },
    onSleep(inBedroom) {
        const moraleBefore = state.morale;
        Object.assign(state, applySleep(statsFromState(), !!inBedroom));
        if (state.despairing) {
            const baseDelta = state.morale - moraleBefore;
            if (baseDelta > 0) {
                const effective = Despair.modifySleepRecovery(baseDelta);
                state.morale = Math.max(0, moraleBefore + effective);
            }
        }
        Despair.checkExit();
    },
    onResurrection() {
        Object.assign(state, applyResurrection(statsFromState()));
        state.deathCause = null;
    },
    canSleep() { return canSleep(state.exhaustion, state.lightsOn, state.tick); },
    kill(cause) {
        state.dead = true;
        state.deaths = (state.deaths || 0) + 1;
        state.deathCause = cause || "unknown";
    },
    severity(val) { return severity(val); },
    showMortality() { return showMortality(statsFromState()); },
    warnings() { return getWarnings(statsFromState()); },
    describeRising(val) {
        return describeFromTable(val, TEXT.stats.rising);
    },
    describeMorale(val) {
        return describeFromTable(100 - val, TEXT.stats.morale);
    },
};
