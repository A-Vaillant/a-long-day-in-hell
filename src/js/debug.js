/* Debug API — only active when State.variables.debug === true.
 * Exposed as setup.Debug (SugarCube) and window.Debug (for shot-scraper/console).
 *
 * Usage from browser console or tests:
 *   Debug.goToBook(0, 5, 10, 42)   → teleport + open book 42 at west/seg5/floor10
 *   Debug.goToLocation(1, 3, 7)    → teleport to east corridor, seg 3, floor 7
 *   Debug.getBookKey()             → "0:5:10:42" (current open book coords)
 *   Debug.getLocation()            → { side, position, floor }
 *   Debug.openPage(n)              → jump to page n of current open book
 *   Debug.setSeed(s)               → re-seed PRNG and restart (full reload)
 */

(function () {
    "use strict";

    const api = {
        goToLocation(side, position, floor) {
            State.variables.side     = side;
            State.variables.position = position;
            State.variables.floor    = floor;
            State.variables.mode     = "explore";
            Engine.play("Corridor");
        },

        goToBook(side, position, floor, bookIndex) {
            State.variables.side      = side;
            State.variables.position  = position;
            State.variables.floor     = floor;
            State.variables.openBook  = { side, position, floor, bookIndex };
            State.variables.openPage  = 0;
            State.variables.mode      = "shelf";
            Engine.play("Shelf Open Book");
        },

        openPage(n) {
            if (!State.variables.openBook) return "no book open";
            State.variables.openPage = n;
            Engine.play("Shelf Open Book");
        },

        getBookKey() {
            const b = State.variables.openBook;
            if (!b) return null;
            return `${b.side}:${b.position}:${b.floor}:${b.bookIndex}`;
        },

        getLocation() {
            return {
                side:     State.variables.side,
                position: State.variables.position,
                floor:    State.variables.floor,
            };
        },

        setSeed(seed) {
            const url = new URL(window.location.href);
            url.searchParams.set("seed", String(seed));
            window.location.href = url.toString();
        },

        // --- Time ---

        /** Set the current tick (0–239) without advancing day. */
        setTick(n) {
            State.variables.tick     = Math.max(0, Math.min(239, n));
            State.variables.lightsOn = State.variables.tick < 160;
            Engine.play(passage());
        },

        /** Set the current day number. */
        setDay(n) {
            State.variables.day = Math.max(1, n);
            Engine.play(passage());
        },

        /** Jump to just before lights-out (tick 155). */
        nearLightsOut() {
            this.setTick(155);
        },

        /** Jump to just before dawn (tick 235). */
        nearDawn() {
            this.setTick(235);
        },

        /** Get current time state. */
        getTime() {
            return {
                tick:     State.variables.tick,
                day:      State.variables.day,
                lightsOn: State.variables.lightsOn,
            };
        },

        // --- Survival ---

        /** Set a survival stat by name. */
        setStat(name, value) {
            const allowed = ["hunger", "thirst", "exhaustion", "morale", "mortality"];
            if (!allowed.includes(name)) return `unknown stat: ${name}`;
            State.variables[name] = Math.max(0, Math.min(100, value));
            Engine.play(passage());
        },

        /** Trigger Parched condition (thirst → 0). */
        triggerParched() { this.setStat("thirst", 0); },

        /** Trigger Starving condition (hunger → 0). */
        triggerStarving() { this.setStat("hunger", 0); },

        /** Get current survival stats. */
        getStats() {
            const v = State.variables;
            return {
                hunger:    v.hunger,
                thirst:    v.thirst,
                exhaustion: v.exhaustion,
                morale:    v.morale,
                mortality: v.mortality,
                despairing: v.despairing,
                dead:      v.dead,
            };
        },
    };

    setup.Debug = api;
    window.Debug = api;
}());
