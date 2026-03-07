/* Godmode panel — interior view of selected NPC.
 * Shows psychology, personality, relationships, inner monologue.
 */

const TRAIT_LABELS = {
    openness: "openness",
    agreeableness: "agreeableness",
    resilience: "resilience",
    sociability: "sociability",
    curiosity: "curiosity",
};

function bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    const rounded = Math.round(value * 10) / 10;
    return '<div class="gm-bar"><div class="gm-bar-fill" style="width:' + pct +
        '%;background:' + color + '"></div></div>' +
        '<span class="gm-bar-num">' + rounded + '</span>';
}

const FAITH_LABELS = {
    mormon: "Mormon",
    catholic: "Catholic",
    protestant: "Protestant",
    evangelical: "Evangelical",
    jewish: "Jewish",
    muslim: "Muslim",
    hindu: "Hindu",
    buddhist: "Buddhist",
    atheist: "atheist",
    agnostic: "agnostic",
};

const STANCE_LABELS = {
    undecided: "undecided",
    seeker: "Seeker",
    direite: "Direite",
    nihilist: "nihilist",
    holdout: "holdout",
};

const STANCE_COLORS = {
    undecided: "#888",
    seeker: "#6a8a5a",
    direite: "#9a2a2a",
    nihilist: "#666",
    holdout: "#b8a878",
};

function narrate(npc) {
    if (!npc.alive) return "They are dead. They will return at dawn.";

    const parts = [];

    // Disposition
    if (npc.disposition === "calm") parts.push("They are unworried.");
    else if (npc.disposition === "anxious") parts.push("They are anxious.");
    else if (npc.disposition === "mad") parts.push("They have lost their mind.");
    else if (npc.disposition === "catatonic") parts.push("They have stopped moving.");

    // Belief narration
    if (npc.belief) {
        const b = npc.belief;
        if (b.stance === "holdout") {
            parts.push("They still believe this is a test from God.");
        } else if (b.stance === "seeker") {
            parts.push("They have accepted the rules. They are looking for their book.");
        } else if (b.stance === "direite") {
            parts.push("They believe God demands scourging.");
        } else if (b.stance === "nihilist") {
            parts.push("They have stopped believing in anything.");
        } else if (b.faithCrisis > 0.5 && b.acceptance < 0.3) {
            parts.push("Their faith is crumbling.");
        }
    }

    // Social
    if (npc.bonds.length === 0) {
        parts.push("They know no one.");
    } else {
        const close = npc.bonds.filter(b => b.affinity > 5);
        if (close.length > 0) {
            parts.push("They are close with " + close.map(b => b.name).join(", ") + ".");
        } else {
            parts.push("They have met " + npc.bonds.length + " " + (npc.bonds.length === 1 ? "person" : "people") + ".");
        }
    }

    // Group
    if (npc.groupId !== null && npc.groupId !== undefined) {
        parts.push("They are traveling with others.");
    } else {
        parts.push("They are alone.");
    }

    return parts.join(" ");
}

export const GodmodePanel = {
    init() {
        // Panel DOM already created by godmode.js setupDOM
    },

    update(snap, selectedId) {
        const pane = document.getElementById("gm-npc-pane");
        if (!pane) return;

        if (selectedId === null) {
            pane.innerHTML = '<div class="gm-panel-empty">Click an NPC to observe</div>';
            return;
        }

        const npc = snap.npcs.find(n => n.id === selectedId);
        if (!npc) {
            pane.innerHTML = '<div class="gm-panel-empty">NPC not found</div>';
            return;
        }

        let html = '<div class="gm-interior">';

        // Identity
        html += '<div class="gm-section gm-identity">';
        html += '<div class="gm-name">' + esc(npc.name) + '</div>';
        html += '<div class="gm-disp gm-disp-' + npc.disposition + '">' + npc.disposition + '</div>';
        if (!npc.alive) html += '<div class="gm-dead-tag">dead</div>';
        html += '</div>';

        // Psychology
        html += '<div class="gm-section">';
        html += '<div class="gm-section-title">psychology</div>';
        html += '<div class="gm-stat"><span>lucidity</span>' + bar(npc.lucidity, 100, "#b8a878") + '</div>';
        html += '<div class="gm-stat"><span>hope</span>' + bar(npc.hope, 100, "#6a8a5a") + '</div>';
        html += '</div>';

        // Belief
        if (npc.belief) {
            html += '<div class="gm-section">';
            html += '<div class="gm-section-title">belief</div>';
            const b = npc.belief;
            const faithLabel = FAITH_LABELS[b.faith] || b.faith;
            const stanceLabel = STANCE_LABELS[b.stance] || b.stance;
            const stanceColor = STANCE_COLORS[b.stance] || "#888";
            html += '<div class="gm-stat"><span>prior faith</span><span class="gm-bar-num">' + esc(faithLabel) + '</span></div>';
            html += '<div class="gm-stat"><span>devotion</span>' + bar(b.devotion, 1, "#b8a878") + '</div>';
            html += '<div class="gm-stat"><span>faith crisis</span>' + bar(b.faithCrisis, 1, "#c49530") + '</div>';
            html += '<div class="gm-stat"><span>acceptance</span>' + bar(b.acceptance, 1, "#6a8a5a") + '</div>';
            html += '<div class="gm-stat"><span>stance</span><span class="gm-bar-num" style="color:' + stanceColor + '">' + esc(stanceLabel) + '</span></div>';
            html += '</div>';
        }

        // Personality
        if (npc.personality) {
            html += '<div class="gm-section">';
            html += '<div class="gm-section-title">personality</div>';
            for (const key in TRAIT_LABELS) {
                if (npc.personality[key] !== undefined) {
                    html += '<div class="gm-stat"><span>' + TRAIT_LABELS[key] + '</span>' +
                        bar(npc.personality[key], 1, "#7a7060") + '</div>';
                }
            }
            html += '</div>';
        }

        // Relationships
        if (npc.bonds.length > 0) {
            html += '<div class="gm-section">';
            html += '<div class="gm-section-title">relationships</div>';
            const sorted = npc.bonds.slice().sort((a, b) => b.familiarity - a.familiarity);
            for (const bond of sorted) {
                if (bond.familiarity < 0.5) continue; // skip trivial
                html += '<div class="gm-bond">';
                html += '<span class="gm-bond-name">' + esc(bond.name) + '</span>';
                html += '<span class="gm-bond-fam">fam ' + Math.round(bond.familiarity) + '</span>';
                html += '<span class="gm-bond-aff ' + (bond.affinity >= 0 ? 'gm-aff-pos' : 'gm-aff-neg') + '">' +
                    'aff ' + (bond.affinity >= 0 ? '+' : '') + Math.round(bond.affinity) + '</span>';
                html += '</div>';
            }
            html += '</div>';
        }

        // Group
        if (npc.groupId !== null && npc.groupId !== undefined) {
            const groupMates = snap.npcs.filter(n => n.groupId === npc.groupId && n.id !== npc.id);
            if (groupMates.length > 0) {
                html += '<div class="gm-section">';
                html += '<div class="gm-section-title">group</div>';
                for (const mate of groupMates) {
                    html += '<div class="gm-group-member gm-disp-' + mate.disposition + '">' +
                        esc(mate.name) + '</div>';
                }
                html += '</div>';
            }
        }

        // Narration
        html += '<div class="gm-section gm-monologue">';
        html += '<div class="gm-thought">' + esc(narrate(npc)) + '</div>';
        html += '</div>';

        // Location
        html += '<div class="gm-section gm-location">';
        html += '<span>floor ' + npc.floor + '</span>';
        html += '<span>' + (npc.side === 0 ? 'west' : 'east') + ' · seg ' + npc.position + '</span>';
        html += '</div>';

        html += '</div>';
        pane.innerHTML = html;
    },
};

function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
