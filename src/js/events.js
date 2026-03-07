/* Events wrapper — event deck draw and initialization. */

import { createDeck, drawEvent } from "../../lib/events.core.ts";
import { PRNG } from "./prng.js";
import { state } from "./state.js";

export const Events = {
    cards: null, // set at init from TEXT
    createDeck,
    drawEvent,

    draw() {
        const cards = this.cards || TEXT.events;
        const rng = PRNG.fork("event:" + state.tick + ":" + state.day);
        const result = drawEvent(state.eventDeck || [], cards, rng);
        state.eventDeck = result.deck;
        if (result.event) {
            state.lastEvent = result.event;
            if (result.event.morale) {
                state.morale = Math.max(0, Math.min(100, state.morale + result.event.morale));
            }
        } else {
            state.lastEvent = null;
        }
        return result.event;
    },

    init() {
        this.cards = TEXT.events;
        const rng = PRNG.fork("eventdeck:init");
        state.eventDeck = createDeck(this.cards.length, rng);
        state.lastEvent = null;
    },
};
