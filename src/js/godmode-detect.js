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

        // Death (but not if they escaped — that's a separate event)
        if (old.alive && !npc.alive && !npc.free) {
            events.push({ tick: curr.tick, day: curr.day, type: "death",
                text: npc.name + " died." });
        }

        // Resurrection (skip FREE entities — they don't come back)
        if (!old.alive && npc.alive && !npc.free) {
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

        // Started searching
        const oldSearch = old.components && old.components.searching;
        const newSearch = npc.components && npc.components.searching;
        if (oldSearch && newSearch) {
            if (!oldSearch.active && newSearch.active) {
                events.push({ tick: curr.tick, day: curr.day, type: "search",
                    text: npc.name + " started searching bookshelves." });
            }
            // Found legible text (bestScore increased past threshold)
            if (newSearch.bestScore > 0.10 && (!oldSearch.bestScore || newSearch.bestScore > oldSearch.bestScore + 0.05)) {
                const pct = Math.round(newSearch.bestScore * 100);
                events.push({ tick: curr.tick, day: curr.day, type: "search",
                    text: npc.name + " found something legible (" + pct + "% coherent)." });
            }
        }

        // Started pilgrimage
        const oldIntent = old.components && old.components.intent;
        const newIntent = npc.components && npc.components.intent;
        if (oldIntent && newIntent && oldIntent.behavior !== "pilgrimage" && newIntent.behavior === "pilgrimage") {
            events.push({ tick: curr.tick, day: curr.day, type: "pilgrimage",
                text: npc.name + " began a pilgrimage." });
        }

        // Found their book (hasBook changed)
        const oldKnow = old.components && old.components.knowledge;
        const newKnow = npc.components && npc.components.knowledge;
        if (oldKnow && newKnow && !oldKnow.hasBook && newKnow.hasBook) {
            events.push({ tick: curr.tick, day: curr.day, type: "pilgrimage",
                text: npc.name + " found their book!" });
        }

        // Escaped (submitted book — FREE)
        if (!old.free && npc.free) {
            events.push({ tick: curr.tick, day: curr.day, type: "escape",
                text: npc.name + " submitted their book and is FREE." });
        }

        // New bond (familiarity crossed 1.0 threshold) — deduplicate by pair
        const oldBondNames = new Set(old.bonds.filter(b => b.familiarity >= 1).map(b => b.name));
        for (const bond of npc.bonds) {
            if (bond.familiarity >= 1 && !oldBondNames.has(bond.name) && npc.name < bond.name) {
                const pairKey = npc.name + ":" + bond.name;
                if (!reportedBonds.has(pairKey)) {
                    reportedBonds.add(pairKey);
                    events.push({ tick: curr.tick, day: curr.day, type: "bond",
                        text: npc.name + " met " + bond.name + "." });
                }
            }
        }
    }

    return events;
}

/** Reset dedup state (for tests). */
export function resetDetectState() {
    reportedBonds.clear();
    reportedGroups.clear();
}
