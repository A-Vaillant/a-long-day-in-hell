/* Objective event log — the ground truth of what happened in the simulation.
 *
 * Godmode subscribes to everything. Other modules (Memory, narrative) are
 * filtered subsets. This is the append-only record.
 *
 * Entry shape: { tick, day, type, text, npcIds: number[], position? }
 *
 * Stored separately from state (hell_eventlog) to avoid bloating the main
 * save JSON. Unbounded growth is intentional; prune via cap on load if needed.
 */

const LOG_KEY = "hell_eventlog";
// Cap restore to most recent N entries to guard against runaway log size.
const RESTORE_CAP = 10000;

const log = [];

/** Append one or more events to the log. */
export function appendEvents(events) {
    for (const ev of events) {
        log.push(ev);
    }
}

/** All events, chronological. */
export function getAll() {
    return log;
}

/** Events involving a specific NPC id. */
export function getForNpc(npcId) {
    return log.filter(ev => ev.npcIds && ev.npcIds.includes(npcId));
}

/** Total event count (for save metadata display). */
export function count() {
    return log.length;
}

/** Reset (new game / test teardown). */
export function resetLog() {
    log.length = 0;
}

/** Persist log to localStorage. Called by Engine.save(). */
export function saveLog() {
    try {
        localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch (e) {
        if (e instanceof DOMException && e.name === "QuotaExceededError") {
            // Trim oldest half and retry once
            try {
                const trimmed = log.slice(Math.floor(log.length / 2));
                localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
            } catch (_) { /* give up silently */ }
        }
    }
}

/** Restore log from localStorage. Called by Engine during load. */
export function loadLog() {
    log.length = 0;
    try {
        const raw = localStorage.getItem(LOG_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        // Cap to most recent entries
        const entries = parsed.length > RESTORE_CAP
            ? parsed.slice(parsed.length - RESTORE_CAP)
            : parsed;
        for (const ev of entries) log.push(ev);
    } catch (_) { /* corrupt save — start fresh */ }
}

/** Clear persisted log (new game). Called by Engine.clearSave(). */
export function clearLog() {
    log.length = 0;
    try { localStorage.removeItem(LOG_KEY); } catch (_) { /* ignore */ }
}
