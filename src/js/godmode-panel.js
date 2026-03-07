/* Godmode panel — NPC list + detail view.
 * List: all NPCs with compact stat summary, clickable to select.
 * Detail: psychology, personality, relationships, narration.
 * Callbacks: onSelect(id), onCenter(id), onDeselect()
 */

let callbacks = {};

const TRAIT_LABELS = {
    openness: "openness",
    agreeableness: "agreeableness",
    resilience: "resilience",
    sociability: "sociability",
    curiosity: "curiosity",
};

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

const DISP_SHORT = {
    calm: "calm",
    anxious: "anx",
    mad: "mad",
    catatonic: "cat",
};

function miniBar(value, max, color) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    return '<div class="gm-mini-bar"><div class="gm-mini-bar-fill" style="width:' + pct +
        '%;background:' + color + '"></div></div>';
}

function bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, (value / max) * 100));
    const rounded = Math.round(value * 10) / 10;
    return '<div class="gm-bar"><div class="gm-bar-fill" style="width:' + pct +
        '%;background:' + color + '"></div></div>' +
        '<span class="gm-bar-num">' + rounded + '</span>';
}

function narrate(npc) {
    if (!npc.alive) return "They are dead. They will return at dawn.";

    const parts = [];

    if (npc.disposition === "calm") parts.push("They are unworried.");
    else if (npc.disposition === "anxious") parts.push("They are anxious.");
    else if (npc.disposition === "mad") parts.push("They have lost their mind.");
    else if (npc.disposition === "catatonic") parts.push("They have stopped moving.");

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

    // Belief
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

    if (npc.groupId !== null && npc.groupId !== undefined) {
        parts.push("They are traveling with others.");
    } else {
        parts.push("They are alone.");
    }

    return parts.join(" ");
}

function renderList(snap, pane) {
    let html = '<div class="gm-npc-list">';
    const sorted = snap.npcs.slice().sort((a, b) => {
        // Dead last, then by disposition severity, then name
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        const order = { mad: 0, anxious: 1, catatonic: 2, calm: 3 };
        const da = order[a.disposition] ?? 3;
        const db = order[b.disposition] ?? 3;
        if (da !== db) return da - db;
        return a.name.localeCompare(b.name);
    });

    for (const npc of sorted) {
        const dispClass = "gm-disp-" + npc.disposition;
        const dead = npc.alive ? "" : " gm-npc-row-dead";
        html += '<div class="gm-npc-row' + dead + '" data-npc-id="' + npc.id + '">';
        html += '<div class="gm-npc-row-top">';
        html += '<span class="gm-npc-row-name">' + esc(npc.name) + '</span>';
        html += '<span class="gm-npc-row-disp ' + dispClass + '">' + (DISP_SHORT[npc.disposition] || npc.disposition) + '</span>';
        if (!npc.alive) html += '<span class="gm-dead-tag">dead</span>';
        html += '</div>';
        html += '<div class="gm-npc-row-bars">';
        html += '<span class="gm-npc-row-label">luc</span>' + miniBar(npc.lucidity, 100, "#b8a878");
        html += '<span class="gm-npc-row-label">hope</span>' + miniBar(npc.hope, 100, "#6a8a5a");
        html += '</div>';
        html += '<div class="gm-npc-row-loc" data-center-id="' + npc.id + '">';
        html += (npc.side === 0 ? 'W' : 'E') + ' f' + npc.floor + ' s' + npc.position;
        html += '</div>';
        html += '</div>';
    }

    html += '</div>';
    pane.innerHTML = html;

    // Bind clicks
    pane.querySelectorAll(".gm-npc-row").forEach(function (row) {
        row.addEventListener("click", function (ev) {
            // Don't select if clicking the location link
            if (ev.target.closest("[data-center-id]")) return;
            const id = parseInt(row.dataset.npcId, 10);
            if (callbacks.onSelect) callbacks.onSelect(id);
        });
    });

    pane.querySelectorAll("[data-center-id]").forEach(function (el) {
        el.addEventListener("click", function (ev) {
            ev.stopPropagation();
            const id = parseInt(el.dataset.centerId, 10);
            if (callbacks.onCenter) callbacks.onCenter(id);
        });
    });
}

function renderDetail(npc, snap, pane) {
    let html = '<div class="gm-interior">';

    // Back button
    html += '<button class="gm-back" id="gm-npc-back">\u2190 all npcs</button>';

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
            if (bond.familiarity < 0.5) continue;
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

    // Location (clickable to center)
    html += '<div class="gm-section gm-location">';
    html += '<span>floor ' + npc.floor + '</span>';
    html += '<span class="gm-loc-link" data-center-id="' + npc.id + '">' +
        (npc.side === 0 ? 'west' : 'east') + ' \u00B7 seg ' + npc.position + '</span>';
    html += '</div>';

    html += '</div>';
    pane.innerHTML = html;

    // Bind back button
    document.getElementById("gm-npc-back").addEventListener("click", function () {
        if (callbacks.onDeselect) callbacks.onDeselect();
    });

    // Bind location click
    pane.querySelectorAll("[data-center-id]").forEach(function (el) {
        el.addEventListener("click", function () {
            const id = parseInt(el.dataset.centerId, 10);
            if (callbacks.onCenter) callbacks.onCenter(id);
        });
    });
}

export const GodmodePanel = {
    init(cbs) {
        callbacks = cbs || {};
    },

    update(snap, selectedId) {
        const pane = document.getElementById("gm-npc-pane");
        if (!pane) return;

        if (selectedId === null) {
            renderList(snap, pane);
        } else {
            const npc = snap.npcs.find(n => n.id === selectedId);
            if (!npc) {
                renderList(snap, pane);
                return;
            }
            renderDetail(npc, snap, pane);
        }
    },
};

function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
