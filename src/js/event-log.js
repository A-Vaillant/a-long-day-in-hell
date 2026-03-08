/* Objective event log — the ground truth of what happened in the simulation.
 *
 * Godmode subscribes to everything. Other modules (Memory, narrative) are
 * filtered subsets. This is the append-only record.
 *
 * Entry shape: { tick, day, type, text, npcIds: number[], position? }
 *
 * TODO: will need serialization/deserialization for save/load.
 * The unbounded growth here is intentional for now and will need
 * to be addressed alongside the saves menu.
 */

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

/** Reset (new game / test teardown). */
export function resetLog() {
    log.length = 0;
}
