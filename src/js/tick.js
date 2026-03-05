/* Tick wrapper — registers window.Tick.
 * Reads/writes window.state directly.
 */
(function () {
    "use strict";
    var core = window._TickCore;

    window.Tick = {
        init: function () {
            var d = core.defaultTickState();
            state.tick     = d.tick;
            state.day      = d.day;
            state.lightsOn = true;
        },

        advance: function (n) {
            var result = core.advanceTick({ tick: state.tick, day: state.day }, n);
            state.tick = result.state.tick;
            state.day  = result.state.day;
            state.lightsOn = core.isLightsOn(state.tick);

            if (result.events.includes("resetHour")) {
                // Close any open book — you're falling asleep
                state.openBook = null;
                state.openPage = 0;
                // heldBook persists (you're touching it)
            }

            if (result.events.includes("dawn")) {
                if (state.dead) Surv.onResurrection();
                if (typeof Npc !== "undefined") Npc.onDawn();
            }

            return result.events;
        },

        onMove: function () {
            if (core.isResetHour(state.tick)) {
                this.onForcedSleep();
                return [];
            }
            var events = this.advance(1);
            Surv.onMove();
            if (typeof Events !== "undefined") Events.draw();
            return events;
        },

        onSleep: function () {
            // Sleep hour-by-hour until reset hour
            while (!core.isResetHour(state.tick) && !state.dead) {
                this.advance(core.TICKS_PER_HOUR);
                Surv.onSleep();
            }
            // Reset hour: forced sleep through dawn (skip if dead — death screen handles it)
            if (!state.dead && core.isResetHour(state.tick)) {
                this.onForcedSleep();
            }
        },

        onForcedSleep: function () {
            while (!state.lightsOn || core.isResetHour(state.tick)) {
                var events = this.advance(core.TICKS_PER_HOUR);
                Surv.onSleep();
                if (events.includes("dawn")) break;
            }
        },

        getTimeString: function () {
            return core.tickToTimeString(state.tick);
        },

        getDayDisplay: function () {
            return "Day " + state.day;
        },

        hoursUntilDawn: function () {
            return core.hoursUntilDawn(state.tick);
        },

        getClockDisplay: function () {
            var year = String(state.day > 365 ? Math.floor(state.day / 365) : 0).padStart(7, "0");
            return "Year " + year + ", Day " + state.day + "\n" + core.tickToTimeString(state.tick);
        },
    };
}());
