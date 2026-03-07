/* Godmode event log — ring buffer of simulation events. */

const MAX_EVENTS = 200;
let events = [];

export const GodmodeLog = {
    init() {
        events = [];
    },

    push(event) {
        events.push(event);
        if (events.length > MAX_EVENTS) {
            events = events.slice(events.length - MAX_EVENTS);
        }
    },

    /** Get the most recent n events, newest first. */
    getRecent(n) {
        const start = Math.max(0, events.length - n);
        return events.slice(start).reverse();
    },

    /** Get all events. */
    getAll() {
        return events;
    },

    get length() {
        return events.length;
    },
};
