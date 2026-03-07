/* Per-NPC narrative log — accumulates prose fragments as events happen.
 *
 * Each NPC gets a chronological story built from simulation events.
 * Fragments are short sentences with context from the snapshot state.
 * Called from godmode.js after event detection.
 */

// npcId → [ { day, tick, text } ]
const stories = new Map();

function dayTime(day, tick) {
    const mins = (tick / 240) * 24 * 60 + 6 * 60;
    const hh = Math.floor(mins / 60) % 24;
    const mm = Math.floor(mins % 60);
    return "Day " + (day - 1) + ", " +
        String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}

function add(npcId, day, tick, text) {
    if (!stories.has(npcId)) stories.set(npcId, []);
    stories.get(npcId).push({ day, tick, text });
}

function sideName(side) { return side === 0 ? "west" : "east"; }
function locStr(npc) {
    return sideName(npc.side) + " corridor, floor " + npc.floor + ", segment " + npc.position;
}

/**
 * Process detected events and snapshot state into narrative fragments.
 * Call after detectEvents() each tick/batch.
 */
export function narrateEvents(events, snap) {
    const npcById = new Map(snap.npcs.map(n => [n.id, n]));

    for (const ev of events) {
        // Find which NPC this event is about by matching name
        const npc = snap.npcs.find(n => ev.text.startsWith(n.name));
        if (!npc) continue;

        const d = ev.day;
        const t = ev.tick;

        switch (ev.type) {
            case "death":
                if (ev.text.includes("chasm")) {
                    add(npc.id, d, t, npc.name + " threw themselves into the chasm from floor " + npc.floor + ".");
                } else {
                    const needs = npc.components && npc.components.needs;
                    if (needs) {
                        const cause = needs.thirst >= 95 ? "of thirst" :
                                     needs.hunger >= 95 ? "of starvation" :
                                     needs.exhaustion >= 95 ? "of exhaustion" : "";
                        add(npc.id, d, t, npc.name + " died" + (cause ? " " + cause : "") +
                            " at " + locStr(npc) + ".");
                    } else {
                        add(npc.id, d, t, npc.name + " died at " + locStr(npc) + ".");
                    }
                }
                break;

            case "resurrection":
                if (ev.text.includes("railing")) {
                    add(npc.id, d, t, npc.name + " caught a railing and pulled themselves up at floor " + npc.floor + ".");
                } else {
                    add(npc.id, d, t, npc.name + " woke at dawn, alive again.");
                }
                break;

            case "disposition": {
                const disp = npc.disposition;
                if (disp === "anxious") {
                    add(npc.id, d, t, npc.name + " grew anxious. Hope: " + Math.round(npc.hope) + ", lucidity: " + Math.round(npc.lucidity) + ".");
                } else if (disp === "mad") {
                    add(npc.id, d, t, npc.name + " lost their mind.");
                } else if (disp === "catatonic") {
                    add(npc.id, d, t, npc.name + " stopped moving. They stare at nothing.");
                } else if (disp === "calm") {
                    add(npc.id, d, t, npc.name + " calmed down.");
                } else if (disp === "inspired") {
                    add(npc.id, d, t, npc.name + " is inspired — a purpose burns in them.");
                }
                break;
            }

            case "bond": {
                // Find the other person's name from the event text
                const match = ev.text.match(/met (.+)\./);
                if (match) {
                    const otherName = match[1];
                    const other = snap.npcs.find(n => n.name === otherName);
                    const where = other && other.side === npc.side && other.floor === npc.floor
                        ? " at " + locStr(npc)
                        : "";
                    add(npc.id, d, t, npc.name + " met " + otherName + where + ".");
                    // Add to the other person's story too
                    if (other) {
                        add(other.id, d, t, otherName + " met " + npc.name + where + ".");
                    }
                }
                break;
            }

            case "group": {
                const match = ev.text.match(/(.+) formed a group\./);
                if (match) {
                    const names = match[1].split(" and ");
                    for (const name of names) {
                        const member = snap.npcs.find(n => n.name === name.trim());
                        if (member) {
                            const others = names.filter(n => n.trim() !== name.trim()).join(" and ");
                            add(member.id, d, t, name.trim() + " began traveling with " + others + ".");
                        }
                    }
                }
                break;
            }

            case "pilgrimage":
                if (ev.text.includes("began")) {
                    const know = npc.components && npc.components.knowledge;
                    if (know && know.bookVision) {
                        const v = know.bookVision;
                        add(npc.id, d, t, npc.name + " set out on a pilgrimage to " +
                            sideName(v.side) + " corridor, floor " + v.floor + ", segment " + v.position + ".");
                    } else {
                        add(npc.id, d, t, npc.name + " set out on a pilgrimage.");
                    }
                } else if (ev.text.includes("found their book")) {
                    add(npc.id, d, t, npc.name + " found their book at " + locStr(npc) + ".");
                }
                break;

            case "escape":
                add(npc.id, d, t, npc.name + " submitted their book at the slot and walked through. They are free.");
                break;

            case "search":
                // Only narrate legible finds, not "started searching"
                if (ev.text.includes("legible")) {
                    add(npc.id, d, t, npc.name + " found a partially legible book at " + locStr(npc) + ".");
                }
                break;
        }
    }
}

/** Get the narrative for a single NPC. Returns array of { day, tick, text }. */
export function getNpcNarrative(npcId) {
    return stories.get(npcId) || [];
}

/** Reset all narratives. */
export function resetNarratives() {
    stories.clear();
}
