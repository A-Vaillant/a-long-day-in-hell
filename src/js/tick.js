/* Tick wrapper — time advancement, light cycle, dawn/reset events. */

import {
    TICKS_PER_HOUR, defaultTickState, advanceTick, isLightsOn,
    isResetHour, tickToTimeString, hoursUntilDawn,
} from "../../lib/tick.core.js";
import { Surv } from "./survival.js";
import { Npc } from "./npc.js";
import { Events } from "./events.js";
import { Chasm } from "./chasm.js";
import { state } from "./state.js";

export const Tick = {
    init() {
        const d = defaultTickState();
        state.tick     = d.tick;
        state.day      = d.day;
        state.lightsOn = true;
    },
    advance(n) {
        const result = advanceTick({ tick: state.tick, day: state.day }, n);
        state.tick = result.state.tick;
        state.day  = result.state.day;
        state.lightsOn = isLightsOn(state.tick);

        // Freefall advances with time — n ticks of fall per n ticks of time
        if (state.falling) {
            for (let i = 0; i < n; i++) {
                if (!state.falling) break;
                Chasm.onTick();
            }
        }

        if (result.events.includes("resetHour")) {
            state.openBook = null;
            state.openPage = 0;
        }
        if (result.events.includes("dawn")) {
            if (state.dead) Surv.onResurrection();
            Npc.onDawn();
            if (state.nonsensePagesRead) {
                state.nonsensePagesRead = Math.floor(state.nonsensePagesRead / 2);
            }
        }
        return result.events;
    },
    onMove() {
        if (isResetHour(state.tick)) {
            this.onForcedSleep();
            return [];
        }
        const events = this.advance(1);
        Surv.onMove();
        Events.draw();
        return events;
    },
    onSleep() {
        while (!isResetHour(state.tick) && !state.dead) {
            this.advance(TICKS_PER_HOUR);
            Surv.onSleep();
        }
        if (!state.dead && isResetHour(state.tick)) {
            this.onForcedSleep();
        }
    },
    onForcedSleep() {
        while (!state.lightsOn || isResetHour(state.tick)) {
            const events = this.advance(TICKS_PER_HOUR);
            Surv.onSleep();
            if (events.includes("dawn")) break;
        }
    },
    /** Advance to next dawn — used for death. Time passes, fall continues. */
    advanceToDawn() {
        let safety = 0;
        while (safety < 300) {
            const events = this.advance(TICKS_PER_HOUR);
            safety++;
            if (events.includes("dawn")) break;
        }
    },
    getTimeString() { return tickToTimeString(state.tick); },
    getDayDisplay() { return "Day " + state.day; },
    hoursUntilDawn() { return hoursUntilDawn(state.tick); },
    getClockDisplay() {
        const year = String(state.day > 365 ? Math.floor(state.day / 365) : 0).padStart(7, "0");
        return "Year " + year + ", Day " + state.day + "\n" + tickToTimeString(state.tick);
    },
};
