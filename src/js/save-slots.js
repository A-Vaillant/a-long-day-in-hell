/* Save slot management.
 *
 * Slot index stored in localStorage under SLOTS_KEY.
 * Each slot's state and event log are stored under keyed entries.
 * Legacy single-save (hell_save / hell_eventlog) is migrated on first access.
 *
 * Slot index shape:
 *   { slots: [{ id, seed, name, day, savedAt, godmoded, deaths }...], activeSlot: string|null }
 *
 * Storage keys:
 *   hell_slots           — the slot index
 *   hell_save_<id>       — state JSON for slot
 *   hell_eventlog_<id>   — event log for slot
 *
 * Legacy keys (migrated then removed):
 *   hell_save             — old single state
 *   hell_eventlog          — old single event log
 */

const SLOTS_KEY = "hell_slots";
const LEGACY_SAVE_KEY = "hell_save";
const LEGACY_LOG_KEY = "hell_eventlog";
const MAX_SLOTS = 10;

function saveKey(id) { return "hell_save_" + id; }
function logKey(id) { return "hell_eventlog_" + id; }

function generateSlotId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Load the slot index, migrating from legacy if needed. */
export function loadIndex() {
    try {
        const raw = localStorage.getItem(SLOTS_KEY);
        if (raw) return JSON.parse(raw);
    } catch (_) { /* corrupt index — rebuild */ }

    // Check for legacy single-save and migrate
    const legacySave = localStorage.getItem(LEGACY_SAVE_KEY);
    if (legacySave) {
        return migrateLegacy(legacySave);
    }

    return { slots: [], activeSlot: null };
}

/** Migrate a legacy single-save into slot 0. */
function migrateLegacy(legacySaveRaw) {
    const id = "legacy";
    // Move state
    localStorage.setItem(saveKey(id), legacySaveRaw);
    localStorage.removeItem(LEGACY_SAVE_KEY);

    // Move event log
    const legacyLog = localStorage.getItem(LEGACY_LOG_KEY);
    if (legacyLog) {
        localStorage.setItem(logKey(id), legacyLog);
        localStorage.removeItem(LEGACY_LOG_KEY);
    }

    // Build summary from the state
    let summary = { seed: "?", name: "?", day: 0, savedAt: 0, godmoded: false, deaths: 0 };
    try {
        const parsed = JSON.parse(legacySaveRaw);
        summary.seed = parsed.seed || "?";
        summary.name = (parsed.lifeStory && parsed.lifeStory.name) || "?";
        summary.day = parsed.day || 0;
        summary.savedAt = parsed._savedAt || 0;
        summary.godmoded = !!parsed.godmoded;
        summary.deaths = parsed.deaths || 0;
    } catch (_) { /* best effort */ }

    const index = {
        slots: [{ id, ...summary }],
        activeSlot: id,
    };
    saveIndex(index);
    return index;
}

/** Persist the slot index. */
export function saveIndex(index) {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(index));
}

/** Get slot metadata by id. */
export function getSlot(index, id) {
    return index.slots.find(s => s.id === id) || null;
}

/** Load a slot's raw state string. Returns null if missing. */
export function loadSlotRaw(id) {
    try {
        return localStorage.getItem(saveKey(id));
    } catch (_) { return null; }
}

/** Load a slot's raw event log string. Returns null if missing. */
export function loadSlotLogRaw(id) {
    try {
        return localStorage.getItem(logKey(id));
    } catch (_) { return null; }
}

/** Save state JSON string + event log string to a slot. Updates index metadata. */
export function saveToSlot(index, id, stateJson, logJson, meta) {
    localStorage.setItem(saveKey(id), stateJson);
    if (logJson != null) localStorage.setItem(logKey(id), logJson);

    const slot = getSlot(index, id);
    if (slot && meta) {
        Object.assign(slot, meta);
    }
    index.activeSlot = id;
    saveIndex(index);
}

/** Create a new slot. Returns the new slot id, or null if at capacity. */
export function createSlot(index, meta) {
    if (index.slots.length >= MAX_SLOTS) return null;
    const id = generateSlotId();
    index.slots.push({ id, ...meta });
    index.activeSlot = id;
    saveIndex(index);
    return id;
}

/** Delete a slot and its storage. */
export function deleteSlot(index, id) {
    index.slots = index.slots.filter(s => s.id !== id);
    if (index.activeSlot === id) {
        index.activeSlot = index.slots.length > 0 ? index.slots[0].id : null;
    }
    try {
        localStorage.removeItem(saveKey(id));
        localStorage.removeItem(logKey(id));
    } catch (_) { /* ignore */ }
    saveIndex(index);
}

/** Clear all slots and storage. Nuclear option. */
export function clearAll() {
    try {
        const index = loadIndex();
        for (const slot of index.slots) {
            localStorage.removeItem(saveKey(slot.id));
            localStorage.removeItem(logKey(slot.id));
        }
        localStorage.removeItem(SLOTS_KEY);
        // Also clean up any lingering legacy keys
        localStorage.removeItem(LEGACY_SAVE_KEY);
        localStorage.removeItem(LEGACY_LOG_KEY);
    } catch (_) { /* best effort */ }
}

export { MAX_SLOTS, saveKey, logKey };
