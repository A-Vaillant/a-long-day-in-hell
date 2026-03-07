/* Tick wrapper — time advancement, light cycle, dawn/reset events.
   Uses Engine's boundary registry for event handlers. */

import {
    TICKS_PER_HOUR, defaultTickState, advanceTick, isLightsOn,
    isResetHour, tickToTimeString, hoursUntilDawn,
} from "../../lib/tick.core.ts";
import { Surv } from "./survival.js";
import { Npc } from "./npc.js";
import { Events } from "./events.js";
import { Chasm } from "./chasm.js";
import { Social } from "./social.js";
import { state } from "./state.js";
import { Engine } from "./engine.js";

export const Tick = {
    init() {
        const d = defaultTickState();
        state.tick     = d.tick;
        state.day      = d.day;
        state.lightsOn = true;
    },

    /** Register boundary handlers on the Engine registry. Called once at boot. */
    registerBoundaryHandlers() {
        Engine.onBoundary("resetHour", function () {
            state.openBook = null;
            state.openPage = 0;
        });
        Engine.onBoundary("lightsOut", function () {
            Social.onLightsOut();
        });
        Engine.onBoundary("dawn", function () {
            if (state.dead) Surv.onResurrection();
            Npc.onDawn();
            Social.onDawn();
            if (state.nonsensePagesRead) {
                state.nonsensePagesRead = Math.floor(state.nonsensePagesRead / 2);
            }
        });
    },

    /**
     * Advance time by n ticks. Updates state, fires boundary handlers
     * through the registry. Does NOT use batch mode — safe to call
     * from within goto() / enter() / loops.
     */
    advance(n) {
        const result = advanceTick({ tick: state.tick, day: state.day }, n);
        state.tick = result.state.tick;
        state.day  = result.state.day;
        state.lightsOn = isLightsOn(state.tick);

        // Fire boundary handlers through the registry
        for (const event of result.events) {
            Engine._boundary.fire(event);
        }

        // Social physics tick — batch: run systems once with n-scaled effects
        Social.onTick(n);

        // Freefall advances with time — n ticks of fall per n ticks of time
        if (state.falling) {
            for (let i = 0; i < n; i++) {
                if (!state.falling) break;
                Chasm.onTick();
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
