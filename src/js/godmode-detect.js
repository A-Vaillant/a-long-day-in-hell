/* Event detection — compare two snapshots and return new events.
 * Tracks already-reported bonds and groups to avoid duplicates from
 * stateless group IDs and fluctuating familiarity.
 */

const reportedBonds = new Set();   // "id1:id2" pairs (lower id first)
const reportedGroups = new Set();  // "id1,id2,..." sorted member sets

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

        // Group formed (gained a groupId) — deduplicate by member set
        if (old.groupId === null && npc.groupId !== null) {
            const mates = curr.npcs.filter(n =>
                n.id !== npc.id && n.groupId === npc.groupId &&
                prevById.get(n.id) && prevById.get(n.id).groupId === null
            );
            if (mates.length > 0 && npc.id < Math.min(...mates.map(m => m.id))) {
                const memberKey = [npc.id, ...mates.map(m => m.id)].sort((a, b) => a - b).join(",");
                if (!reportedGroups.has(memberKey)) {
                    reportedGroups.add(memberKey);
                    const names = [npc.name, ...mates.map(m => m.name)];
                    events.push({ tick: curr.tick, day: curr.day, type: "group",
                        text: names.join(" and ") + " formed a group." });
                }
            }
        }

        // Started falling (jumped into chasm)
        if (!old.falling && npc.falling) {
            events.push({ tick: curr.tick, day: curr.day, type: "death",
                text: npc.name + " jumped into the chasm." });
        }

        // Stopped falling (grabbed railing or landed)
        if (old.falling && !npc.falling && npc.alive) {
            events.push({ tick: curr.tick, day: curr.day, type: "resurrection",
                text: npc.name + " caught a railing at floor " + npc.floor + "." });
        }

        // New bond (familiarity crossed 1.0 threshold) — deduplicate by pair
        for (const bond of npc.bonds) {
            if (bond.familiarity >= 1) {
                const pairKey = npc.name < bond.name ? npc.name + ":" + bond.name : bond.name + ":" + npc.name;
                if (!reportedBonds.has(pairKey)) {
                    reportedBonds.add(pairKey);
                    if (npc.name < bond.name) {
                        events.push({ tick: curr.tick, day: curr.day, type: "bond",
                            text: npc.name + " met " + bond.name + "." });
                    }
                }
            }
        }
    }

    return events;
}
