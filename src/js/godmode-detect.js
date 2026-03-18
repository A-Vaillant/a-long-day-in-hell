/* Event detection — compare two snapshots and return new events.
 * Tracks already-reported bonds and groups to avoid duplicates from
 * stateless group IDs and fluctuating familiarity.
 */

const reportedBonds = new Set();        // "id1:id2" pairs (lower id first)
const reportedPilgrimages = new Set(); // npc IDs that already logged "began a pilgrimage"
const reportedGroups = new Set();       // "id1,id2,..." sorted member sets
const reportedDissolutions = new Set(); // "id1,id2,..." sorted member sets

export function detectEvents(prev, curr) {
    if (!prev || !curr) return [];
    const events = [];
    const prevById = new Map(prev.npcs.map(n => [n.id, n]));

    for (const npc of curr.npcs) {
        const old = prevById.get(npc.id);
        if (!old) continue;

        // Resurrection (skip FREE entities — they don't come back)
        // NOTE: death/disposition/chasm/search/escape are emitted directly from social.js
        if (!old.alive && npc.alive && !npc.free) {
            events.push({ tick: curr.tick, day: curr.day, type: "resurrection",
                text: npc.name + " returned at dawn.", npcIds: [npc.id] });
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
                    reportedDissolutions.delete(memberKey); // allow future dissolution report
                    const names = [npc.name, ...mates.map(m => m.name)];
                    const ids = [npc.id, ...mates.map(m => m.id)];
                    events.push({ tick: curr.tick, day: curr.day, type: "group",
                        text: names.join(" and ") + " formed a group.", npcIds: ids });
                }
            }
        }

        // Group dissolved (had a groupId, now null) — deduped
        if (old.groupId !== null && npc.groupId === null) {
            const formerMates = prev.npcs.filter(n =>
                n.id !== npc.id && n.groupId === old.groupId
            );
            // Only lowest-id former member emits the event
            if (formerMates.length > 0 && npc.id < Math.min(...formerMates.map(m => m.id))) {
                // Check that at least one mate also lost group membership
                const disbanded = formerMates.filter(m => {
                    const currM = curr.npcs.find(c => c.id === m.id);
                    return currM && currM.groupId === null;
                });
                if (disbanded.length > 0) {
                    const memberKey = [npc.id, ...disbanded.map(m => m.id)].sort((a, b) => a - b).join(",");
                    // Only report if this group was previously reported as formed,
                    // and hasn't already been reported as dissolved
                    if (reportedGroups.has(memberKey) && !reportedDissolutions.has(memberKey)) {
                        reportedDissolutions.add(memberKey);
                        const names = [npc.name, ...disbanded.map(m => m.name)];
                        const ids = [npc.id, ...disbanded.map(m => m.id)];
                        events.push({ tick: curr.tick, day: curr.day, type: "group",
                            text: names.join(" and ") + "\u2019s group broke apart.", npcIds: ids });
                    }
                }
            }
        }

        // Started pilgrimage (dedup — only log once per NPC)
        const oldIntent = old.components && old.components.intent;
        const newIntent = npc.components && npc.components.intent;
        if (oldIntent && newIntent && oldIntent.behavior !== "pilgrimage" && newIntent.behavior === "pilgrimage"
            && !reportedPilgrimages.has(npc.id)) {
            reportedPilgrimages.add(npc.id);
            events.push({ tick: curr.tick, day: curr.day, type: "pilgrimage",
                text: npc.name + " began a pilgrimage.", npcIds: [npc.id] });
        }

        // Found their book / pilgrimage failed — check Memory entries first, Knowledge as fallback
        const oldMem = old.components && old.components.memory;
        const newMem = npc.components && npc.components.memory;
        const oldKnow = old.components && old.components.knowledge;
        const newKnow = npc.components && npc.components.knowledge;

        // Helper: find bookVision entry in a serialized memory component
        const getBookVisionEntry = (mem) =>
            (mem && mem.entries && mem.entries.find(e => e.type === "bookVision")) ?? null;

        const oldVision = getBookVisionEntry(oldMem);
        const newVision = getBookVisionEntry(newMem);

        // Found their book: bookVision state transitioned to "found"
        const foundViaMemory = oldVision && newVision &&
            oldVision.state !== "found" && newVision.state === "found";
        const foundViaKnowledge = !foundViaMemory &&
            oldKnow && newKnow && !oldKnow.hasBook && newKnow.hasBook;
        if (foundViaMemory || foundViaKnowledge) {
            events.push({ tick: curr.tick, day: curr.day, type: "pilgrimage",
                text: npc.name + " found their book!", npcIds: [npc.id] });
        }

        // Pilgrimage failed: bookVision state → "exhausted", or pilgrimageFailure memory appeared,
        // or Knowledge.pilgrimageExhausted flipped (legacy fallback)
        const exhaustedViaMemory = oldVision && newVision &&
            oldVision.state !== "exhausted" && newVision.state === "exhausted";
        const failureEntryAppearedInMemory = !exhaustedViaMemory && newMem && newMem.entries &&
            newMem.entries.some(e => e.type === "pilgrimageFailure") &&
            (!oldMem || !oldMem.entries || !oldMem.entries.some(e => e.type === "pilgrimageFailure"));
        const exhaustedViaKnowledge = !exhaustedViaMemory && !failureEntryAppearedInMemory &&
            oldKnow && newKnow && !oldKnow.pilgrimageExhausted && newKnow.pilgrimageExhausted;
        if (exhaustedViaMemory || failureEntryAppearedInMemory || exhaustedViaKnowledge) {
            events.push({ tick: curr.tick, day: curr.day, type: "pilgrimage",
                text: npc.name + "\u2019s pilgrimage ended in silence. The books were noise.", npcIds: [npc.id] });
        }

        // New bond (familiarity crossed 1.0 threshold) — deduplicate by pair
        const oldBondNames = new Set(old.bonds.filter(b => b.familiarity >= 1).map(b => b.name));
        for (const bond of npc.bonds) {
            if (bond.familiarity >= 1 && !oldBondNames.has(bond.name) && npc.name < bond.name) {
                const pairKey = npc.name + ":" + bond.name;
                if (!reportedBonds.has(pairKey)) {
                    reportedBonds.add(pairKey);
                    // Find the other NPC's id
                    const other = curr.npcs.find(n => n.name === bond.name);
                    const ids = other ? [npc.id, other.id] : [npc.id];
                    events.push({ tick: curr.tick, day: curr.day, type: "bond",
                        text: npc.name + " met " + bond.name + ".", npcIds: ids });
                }
            }
        }
    }

    return events;
}

/** Reset dedup state (for tests). */
export function resetDetectState() {
    reportedBonds.clear();
    reportedPilgrimages.clear();
    reportedGroups.clear();
    reportedDissolutions.clear();
}
