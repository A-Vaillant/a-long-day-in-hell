/* Godmode event log — ring buffer of simulation events + filter state. */

const MAX_EVENTS = 200;
let events = [];

// Filter state: which event types to show. Search off by default.
const filters = {
    death: true,
    resurrection: true,
    disposition: true,
    bond: true,
    group: true,
    search: false,
    pilgrimage: true,
    escape: true,
};

export const GodmodeLog = {
    init() {
        events = [];
        // Reset filters to defaults
        filters.death = true;
        filters.resurrection = true;
        filters.disposition = true;
        filters.bond = true;
        filters.group = true;
        filters.search = false;
        filters.pilgrimage = true;
        filters.escape = true;
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

    /** Get most recent n events that pass current filters, newest first. */
    getFiltered(n) {
        const filtered = [];
        for (let i = events.length - 1; i >= 0 && filtered.length < n; i--) {
            if (filters[events[i].type]) filtered.push(events[i]);
        }
        return filtered;
    },

    /** Get all events. */
    getAll() {
        return events;
    },

    /** Toggle a filter type. Returns new state. */
    toggleFilter(type) {
        if (type in filters) {
            filters[type] = !filters[type];
        }
        return filters[type];
    },

    /** Check if a filter type is active. */
    isFilterOn(type) {
        return !!filters[type];
    },

    /** Get all filter states (read-only copy). */
    getFilters() {
        return { ...filters };
    },

    get length() {
        return events.length;
    },
};
