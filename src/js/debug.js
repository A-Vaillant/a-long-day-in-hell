/* Debug API — for console / shot-scraper use. */

import { state } from "./state.js";
import { Engine } from "./engine.js";

export const Debug = {
    goToLocation(side, position, floor) {
        state.side     = side;
        state.position = position;
        state.floor    = floor;
        Engine.goto("Corridor");
    },
    goToBook(side, position, floor, bookIndex) {
        state.side      = side;
        state.position  = position;
        state.floor     = floor;
        state.openBook  = { side, position, floor, bookIndex };
        state.openPage  = 0;
        Engine.goto("Shelf Open Book");
    },
    openPage(n) {
        if (!state.openBook) return "no book open";
        state.openPage = n;
        Engine.goto("Shelf Open Book");
    },
    getBookKey() {
        const b = state.openBook;
        if (!b) return null;
        return b.side + ":" + b.position + ":" + b.floor + ":" + b.bookIndex;
    },
    getLocation() {
        return { side: state.side, position: state.position, floor: state.floor };
    },
    setSeed(seed) {
        const url = new URL(window.location.href);
        url.searchParams.set("seed", String(seed));
        window.location.href = url.toString();
    },
    setTick(n) {
        state.tick     = Math.max(0, Math.min(239, n));
        state.lightsOn = state.tick < 160;
        Engine.goto(state.screen);
    },
    setDay(n) {
        state.day = Math.max(1, n);
        Engine.goto(state.screen);
    },
    nearLightsOut() { this.setTick(155); },
    nearDawn() { this.setTick(235); },
    getTime() {
        return { tick: state.tick, day: state.day, lightsOn: state.lightsOn };
    },
    setStat(name, value) {
        const allowed = ["hunger", "thirst", "exhaustion", "morale", "mortality"];
        if (allowed.indexOf(name) === -1) return "unknown stat: " + name;
        state[name] = Math.max(0, Math.min(100, value));
        Engine.goto(state.screen);
    },
    triggerParched() { this.setStat("thirst", 0); },
    triggerStarving() { this.setStat("hunger", 0); },
    getStats() {
        return {
            hunger: state.hunger, thirst: state.thirst, exhaustion: state.exhaustion,
            morale: state.morale, mortality: state.mortality,
            despairing: state.despairing, dead: state.dead,
        };
    },
};
