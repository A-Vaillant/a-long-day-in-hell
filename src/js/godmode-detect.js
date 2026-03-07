/* Event detection — compare two snapshots and return new events. */

/**
 * Compare two godmode snapshots and return an array of events.
 * @param {object} prev - previous snapshot { npcs, day, tick }
 * @param {object} curr - current snapshot { npcs, day, tick }
 * @returns {Array<{ tick, day, type, text }>}
 */
export function detectEvents(prev, curr) {
    if (!prev || !curr) return [];
    const events = [];
    const prevById = new Map(prev.npcs.map(n => [n.id, n]));

    for (const npc of curr.npcs) {
        const old = prevById.get(npc.id);
        if (!old) continue;

        // Death
        if (old.alive && !npc.alive) {
            events.push({ tick: curr.tick, day: curr.day, type: "death",
                text: npc.name + " died." });
        }

        // Resurrection
        if (!old.alive && npc.alive) {
            events.push({ tick: curr.tick, day: curr.day, type: "resurrection",
                text: npc.name + " returned at dawn." });
        }

        // Disposition change
        if (old.disposition !== npc.disposition && old.alive && npc.alive) {
            events.push({ tick: curr.tick, day: curr.day, type: "disposition",
                text: npc.name + " became " + npc.disposition + "." });
        }

        // Group formed (gained a groupId)
        if (old.groupId === null && npc.groupId !== null) {
            const mates = curr.npcs.filter(n =>
                n.id !== npc.id && n.groupId === npc.groupId &&
                prevById.get(n.id) && prevById.get(n.id).groupId === null
            );
            // Only emit once per group (lowest id emits)
            if (mates.length > 0 && npc.id < Math.min(...mates.map(m => m.id))) {
                const names = [npc.name, ...mates.map(m => m.name)];
                events.push({ tick: curr.tick, day: curr.day, type: "group",
                    text: names.join(" and ") + " formed a group." });
            }
        }

        // New bond (familiarity crossed 1.0 threshold)
        const oldBondNames = new Set(old.bonds.filter(b => b.familiarity >= 1).map(b => b.name));
        for (const bond of npc.bonds) {
            if (bond.familiarity >= 1 && !oldBondNames.has(bond.name)) {
                if (npc.name < bond.name) {
                    events.push({ tick: curr.tick, day: curr.day, type: "bond",
                        text: npc.name + " met " + bond.name + "." });
                }
            }
        }
    }

    return events;
}
