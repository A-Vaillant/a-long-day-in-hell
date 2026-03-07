/* Godmode event log — ring buffer, filters, and log rendering. */

function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const MAX_EVENTS = 200;
let events = [];
let onSelectNpc = null;  // callback(id) when NPC name clicked

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

export const LOG_COLORS = {
    bond: "#b8a878",
    disposition: "#c49530",
    death: "#9a2a2a",
    resurrection: "#6a8a5a",
    group: "#7a8ab8",
    pilgrimage: "#d4a0e0",
    escape: "#60d060",
    search: "#8a7a60",
};

export const LOG_FILTER_LABELS = {
    death: "death",
    resurrection: "rez",
    disposition: "disp",
    bond: "bond",
    group: "group",
    search: "search",
    pilgrimage: "pilgrim",
    escape: "escape",
};

export const GodmodeLog = {
    init(selectCallback) {
        events = [];
        onSelectNpc = selectCallback || null;
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

    /**
     * Render filter bar HTML.
     * Reads current filter state from this module.
     */
    renderFilters() {
        let html = '<div class="gm-log-filters">';
        for (const type in LOG_FILTER_LABELS) {
            const active = filters[type];
            const color = LOG_COLORS[type] || "#b8a878";
            html += '<button class="gm-log-filter' + (active ? ' gm-log-filter-on' : '') +
                '" data-filter="' + type + '" style="color:' + (active ? color : '#3a3428') +
                '" title="' + type + '">' + LOG_FILTER_LABELS[type] + '</button>';
        }
        html += '</div>';
        return html;
    },

    /**
     * Render full log pane HTML (filters + entries).
     * Writes directly to the element with id "gm-log-pane".
     * @param {HTMLElement} el
     * @param {Array} [npcs] — current NPC list for name→id mapping
     */
    renderTo(el, npcs) {
        if (!el) return;
        // Build name→id map for clickable names
        const nameToId = new Map();
        if (npcs) {
            for (const n of npcs) nameToId.set(n.name, n.id);
        }

        const recent = this.getFiltered(100);
        let html = this.renderFilters();
        let count = 0;
        for (const ev of recent) {
            const color = LOG_COLORS[ev.type] || "#b8a878";
            const mins = (ev.tick / 240) * 24 * 60 + 6 * 60;
            const hh = String(Math.floor(mins / 60) % 24).padStart(2, "0");
            const mm = String(Math.floor(mins % 60)).padStart(2, "0");
            const tag = LOG_FILTER_LABELS[ev.type] || ev.type;
            let text = esc(ev.text);
            // Wrap NPC names in clickable spans
            if (ev.npcIds && ev.npcIds.length > 0) {
                for (const id of ev.npcIds) {
                    // Find name: check nameToId reverse, or scan npcs
                    let name = null;
                    for (const [n, nid] of nameToId) {
                        if (nid === id) { name = n; break; }
                    }
                    if (name) {
                        const escaped = esc(name);
                        text = text.replace(escaped,
                            '<span class="gm-log-name" data-npc-id="' + id + '">' + escaped + '</span>');
                    }
                }
            }
            html += '<div class="gm-log-entry" style="color:' + color + '">' +
                '<span class="gm-log-time">d' + (ev.day - 1) + ' ' + hh + ':' + mm + '</span>' +
                '<span class="gm-log-tag">[' + tag + ']</span> ' +
                text + '</div>';
            count++;
        }
        if (count === 0) {
            html += '<div class="gm-log-empty">No events yet.</div>';
        }
        el.innerHTML = html;
    },

    /**
     * Wire filter toggle delegation on a container element.
     * Uses mousedown instead of click because the render loop
     * replaces innerHTML every frame — if the element is destroyed
     * between mousedown and mouseup, the click event never fires.
     */
    wireFilterClicks(el) {
        el.addEventListener("mousedown", function (ev) {
            const btn = ev.target.closest("[data-filter]");
            if (!btn) return;
            ev.preventDefault();
            const type = btn.getAttribute("data-filter");
            GodmodeLog.toggleFilter(type);
            GodmodeLog.renderTo(el);
        });
        // NPC name clicks in log entries
        el.addEventListener("mousedown", function (ev) {
            const nameEl = ev.target.closest("[data-npc-id]");
            if (!nameEl || nameEl.closest("[data-filter]")) return;
            const id = parseInt(nameEl.getAttribute("data-npc-id"), 10);
            if (!isNaN(id) && onSelectNpc) {
                ev.preventDefault();
                onSelectNpc(id);
            }
        });
    },
};
