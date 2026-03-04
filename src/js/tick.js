/* SugarCube wrapper for TickCore — registers setup.Tick.
 * Reads/writes State.variables directly so time persists in save state.
 */
(function () {
    "use strict";
    const core = window._TickCore;

    setup.Tick = {
        /** Initialize tick state on a new game (call from StoryInit). */
        init() {
            const d = core.defaultTickState();
            const v = State.variables;
            v.tick     = d.tick;
            v.day      = d.day;
            v.lightsOn = true;
        },

        /**
         * Advance time by n ticks. Fires boundary effects and returns the
         * event list so callers can react (e.g. redirect to sleep passage).
         *
         * @param {number} n
         * @returns {string[]} events — "lightsOut" | "dawn"
         */
        advance(n) {
            const v = State.variables;
            const { state, events } = core.advanceTick({ tick: v.tick, day: v.day }, n);
            v.tick = state.tick;
            v.day  = state.day;
            v.lightsOn = core.isLightsOn(v.tick);

            if (events.includes("dawn") && v.dead) {
                setup.Survival.onResurrection();
            }

            return events;
        },

        /**
         * Advance one tick and apply a move action to survival stats.
         * Returns events from tick advance.
         */
        onMove() {
            const events = this.advance(1);
            setup.Survival.onMove();
            return events;
        },

        /**
         * Sleep until rested (exhaustion = 100) or until lights-out,
         * whichever comes first. Each sleep-hour costs TICKS_PER_HOUR ticks.
         * Returns when done.
         */
        onSleep() {
            const v = State.variables;
            const TICKS_PER_HOUR = core.TICKS_PER_HOUR;
            const LIGHTS_OFF     = core.LIGHTS_ON_TICKS;

            while (v.exhaustion < 100 && v.tick < LIGHTS_OFF) {
                this.advance(TICKS_PER_HOUR);
                setup.Survival.onSleep();
            }

            // If lights just went out mid-sleep, finish the night
            if (!v.lightsOn) {
                this.onForcedSleep();
            }
        },

        /**
         * Forced sleep: advance from lights-out to dawn, applying sleep-hour
         * effects for each remaining hour of darkness.
         */
        onForcedSleep() {
            const v = State.variables;
            while (!v.lightsOn) {
                const events = this.advance(core.TICKS_PER_HOUR);
                setup.Survival.onSleep();
                if (events.includes("dawn")) break;
            }
        },

        /** Current time as a display string, e.g. "10:40 PM". */
        getTimeString() {
            return core.tickToTimeString(State.variables.tick);
        },

        /** "Day N" display string. */
        getDayDisplay() {
            return "Day " + State.variables.day;
        },

        /** Whole hours remaining until dawn. */
        hoursUntilDawn() {
            return core.hoursUntilDawn(State.variables.tick);
        },

        /** Full clock line matching the text's format: "Year 0000000, Day N\nH:MM AM". */
        getClockDisplay() {
            const v = State.variables;
            const year = String(v.day > 365 ? Math.floor(v.day / 365) : 0).padStart(7, "0");
            return `Year ${year}, Day ${v.day}\n${core.tickToTimeString(v.tick)}`;
        },
    };
}());
