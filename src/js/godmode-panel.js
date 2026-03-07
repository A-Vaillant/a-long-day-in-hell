/* Godmode panel — NPC list + detail view.
 * List: all NPCs with compact stat summary, clickable to select.
 * Detail: auto-populated from ECS components via renderer registry.
 * Callbacks: onSelect(id), onCenter(id), onDeselect()
 */

let callbacks = {};
let lastHtml = "";
let possessCallback = null;
let jumpCallback = null;
let visionCallback = null;
let lastRenderTime = 0;
const RENDER_THROTTLE_MS = 400;

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
    inspired: "insp",
};

const TIPS = {
    lucidity: "Mental clarity. Low lucidity → madness, violence.",
    hope: "Will to continue. Low hope → catatonia, shutdown.",
    hunger: "Food need. Accumulates over time. Death at 100.",
    thirst: "Water need. Accumulates faster than hunger. Death at 100.",
    exhaustion: "Fatigue. Auto-sleeps at rest areas when high.",
    bookIndex: "Which book in the gallery they're currently examining (0–191).",
    ticksSearched: "How many ticks spent searching at this position.",
    patience: "Search stamina. Higher for patient, open NPCs. Shown as progress bar.",
    "prior faith": "Religion in life. Determines how hard the Zoroastrian revelation hits.",
    devotion: "How devout they were in life. Higher = harder the faith crisis.",
    "faith crisis": "How far their prior faith has crumbled. Grows over time.",
    faithCrisis: "How far their prior faith has crumbled. Grows over time.",
    acceptance: "How much they've accepted the Zoroastrian reality of this place.",
    stance: "Current worldview forged by hell.",
    undecided: "Haven't committed to a worldview yet.",
    seeker: "Accepted the rules. Searching for their book with purpose.",
    direite: "God spoke — scourge them. Meaning through violence.",
    nihilist: "Nothing means anything. Precursor to catatonia.",
    holdout: "Clinging to prior faith. \"This is a test from God.\"",
    temperament: "Stress response. Withdrawn (0) ↔ volatile (1). Volatile → madness. Withdrawn → despair.",
    pace: "Tolerance for staying put. Patient (0) ↔ restless (1).",
    openness: "How readily they let people in. Guarded (0) ↔ open (1).",
    outlook: "How they frame being here. Accepting (0) ↔ resistant (1).",
    fam: "Familiarity — time spent together. Grows with proximity.",
    aff: "Affinity — how they feel about each other. Can go negative.",
    calm: "Functional. Lucidity and hope both adequate.",
    anxious: "Strained. Lucidity or hope dropping.",
    mad: "Lucidity collapsed. Erratic, potentially violent.",
    catatonic: "Hope collapsed. Unresponsive. May not recover.",
    inspired: "Divinely inspired. On a pilgrimage to find their book.",
    witnessChasm: "Saw someone jump into the chasm. Devastating at first.",
    beingKilled: "Died and came back. Terrifying, then routine.",
    companionMad: "A companion went mad. Personal. Slow to numb.",
    beingDismissed: "Abandoned or rejected. Pure hope damage.",
    witnessAttack: "Saw violence. Goes numb fastest.",
    committingViolence: "Killed someone. Costs clarity and hope.",
};

function tip(label) {
    const desc = TIPS[label];
    if (!desc) return '<span>' + esc(label) + '</span>';
    return '<span class="gm-tip" data-tip="' + esc(desc) + '">' + esc(label) + '</span>';
}

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

// --- Component renderer registry ---
// Each renderer: (comp, npc, snap) => html string (a gm-section)
// Order array controls display order; unlisted components render last via fallback.

const COMPONENT_ORDER = ["psychology", "intent", "knowledge", "needs", "sleep", "belief", "personality", "searching", "relationships", "group", "habituation"];

const componentRenderers = {
    psychology(comp) {
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">psychology</div>';
        if (comp.lucidity !== undefined)
            html += '<div class="gm-stat">' + tip("lucidity") + bar(comp.lucidity, 100, "#b8a878") + '</div>';
        if (comp.hope !== undefined)
            html += '<div class="gm-stat">' + tip("hope") + bar(comp.hope, 100, "#6a8a5a") + '</div>';
        html += '</div>';
        return html;
    },

    needs(comp) {
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">needs</div>';
        if (comp.hunger !== undefined)
            html += '<div class="gm-stat">' + tip("hunger") + bar(comp.hunger, 100, "#c49530") + '</div>';
        if (comp.thirst !== undefined)
            html += '<div class="gm-stat">' + tip("thirst") + bar(comp.thirst, 100, "#4a8ab0") + '</div>';
        if (comp.exhaustion !== undefined)
            html += '<div class="gm-stat">' + tip("exhaustion") + bar(comp.exhaustion, 100, "#7a6050") + '</div>';
        html += '</div>';
        return html;
    },

    personality(comp) {
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">personality</div>';
        for (const key in comp) {
            if (typeof comp[key] === "number") {
                html += '<div class="gm-stat">' + tip(key) +
                    bar(comp[key], 1, "#7a7060") + '</div>';
            }
        }
        html += '</div>';
        return html;
    },

    belief(comp) {
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">belief</div>';
        if (comp.faith !== undefined) {
            const label = FAITH_LABELS[comp.faith] || comp.faith;
            html += '<div class="gm-stat">' + tip("prior faith") + '<span class="gm-bar-num">' + esc(label) + '</span></div>';
        }
        if (comp.devotion !== undefined)
            html += '<div class="gm-stat">' + tip("devotion") + bar(comp.devotion, 1, "#b8a878") + '</div>';
        if (comp.faithCrisis !== undefined)
            html += '<div class="gm-stat">' + tip("faith crisis") + bar(comp.faithCrisis, 1, "#c49530") + '</div>';
        if (comp.acceptance !== undefined)
            html += '<div class="gm-stat">' + tip("acceptance") + bar(comp.acceptance, 1, "#6a8a5a") + '</div>';
        if (comp.stance !== undefined) {
            const label = STANCE_LABELS[comp.stance] || comp.stance;
            const color = STANCE_COLORS[comp.stance] || "#888";
            html += '<div class="gm-stat">' + tip("stance") + '<span class="gm-bar-num gm-tip" data-tip="' + esc(TIPS[comp.stance] || "") + '" style="color:' + color + '">' + esc(label) + '</span></div>';
        }
        // Render any other belief fields generically
        for (const key in comp) {
            if (["faith", "devotion", "faithCrisis", "acceptance", "stance"].includes(key)) continue;
            const val = comp[key];
            if (typeof val === "number") {
                html += '<div class="gm-stat">' + tip(key) + bar(val, 1, "#c49530") + '</div>';
            } else if (typeof val === "string") {
                html += '<div class="gm-stat">' + tip(key) + '<span class="gm-bar-num">' + esc(val) + '</span></div>';
            }
        }
        html += '</div>';
        return html;
    },

    intent(comp) {
        const BEHAVIOR_LABELS = {
            idle: "Idle",
            explore: "Exploring",
            seek_rest: "Seeking rest",
            search: "Searching books",
            return_home: "Heading home",
            wander_mad: "Wandering (mad)",
            pilgrimage: "Pilgrimage",
        };
        const BEHAVIOR_COLORS = {
            idle: "#888",
            explore: "#b8a878",
            seek_rest: "#4a8ab0",
            search: "#6a8a5a",
            return_home: "#c49530",
            wander_mad: "#9a2a2a",
            pilgrimage: "#d4a0e0",
        };
        const label = BEHAVIOR_LABELS[comp.behavior] || comp.behavior;
        const color = BEHAVIOR_COLORS[comp.behavior] || "#888";
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">behavior</div>';
        html += '<div class="gm-stat"><span class="gm-tip" data-tip="Current goal. Chosen by utility scoring each tick.">intent</span>';
        html += '<span class="gm-bar-num" style="color:' + color + '">' + esc(label) + '</span></div>';
        if (comp.cooldown > 0) {
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Ticks before the arbiter can switch behaviors.">cooldown</span>';
            html += '<span class="gm-bar-num">' + comp.cooldown + '</span></div>';
        }
        html += '</div>';
        return html;
    },

    knowledge(comp, npc) {
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">knowledge</div>';
        // Book location
        const bc = comp.lifeStory && comp.lifeStory.bookCoords;
        if (bc) {
            const bookLoc = (bc.side === 0 ? 'W' : 'E') + ' f' + bc.floor + ' s' + bc.position + ' #' + bc.bookIndex;
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Where this NPC\'s book actually is.">book</span>';
            html += '<span class="gm-bar-num">' + esc(bookLoc) + '</span></div>';
            // Distance
            const dFloor = Math.abs(npc.floor - bc.floor);
            const dPos = Math.abs(npc.position - bc.position);
            const sameSide = npc.side === bc.side;
            const dist = dPos + dFloor + (sameSide ? 0 : dFloor + 1);
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Approximate travel distance in moves (position + floor + chasm crossing).">distance</span>';
            html += '<span class="gm-bar-num">' + dist + ' moves</span></div>';
        }
        // Vision status
        if (comp.bookVision) {
            const vl = (comp.bookVision.side === 0 ? 'W' : 'E') + ' f' + comp.bookVision.floor + ' s' + comp.bookVision.position;
            const color = comp.visionAccurate ? "#6a8a5a" : "#9a2a2a";
            const label = comp.visionAccurate ? "divine vision" : "false vision";
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Revealed destination. Green = accurate, red = false.">' + label + '</span>';
            html += '<span class="gm-bar-num" style="color:' + color + '">' + esc(vl) + '</span></div>';
        } else {
            html += '<div class="gm-stat"><span>vision</span><span class="gm-bar-num" style="color:#666">none</span></div>';
        }
        if (comp.escaped) {
            html += '<div class="gm-stat"><span>status</span><span class="gm-bar-num" style="color:#6a8a5a">escaped!</span></div>';
        }
        html += '</div>';
        return html;
    },

    sleep(comp) {
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">sleep</div>';
        if (comp.nomadic) {
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="No fixed home. Sleeps wherever they end up.">lifestyle</span>';
            html += '<span class="gm-bar-num" style="color:#c49530">nomadic</span></div>';
        } else {
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Rest area this NPC returns to each night.">home</span>';
            html += '<span class="gm-bar-num">seg ' + comp.homeRestArea + '</span></div>';
            if (comp.awayStreak > 0) {
                html += '<div class="gm-stat"><span class="gm-tip" data-tip="Nights slept away from home. Home shifts after ' + 3 + '.">away streak</span>';
                html += '<span class="gm-bar-num">' + comp.awayStreak + '</span></div>';
            }
        }
        if (comp.asleep) {
            html += '<div class="gm-stat"><span>status</span>';
            html += '<span class="gm-bar-num" style="color:#6a8a5a">sleeping';
            if (comp.bedIndex !== null) html += ' (bed ' + comp.bedIndex + ')';
            html += '</span></div>';
            if (comp.coSleepers && comp.coSleepers.length > 0) {
                html += '<div class="gm-stat"><span class="gm-tip" data-tip="Sharing a bedroom. Familiarity grows overnight.">with</span>';
                html += '<span class="gm-bar-num">' + comp.coSleepers.length + ' other' + (comp.coSleepers.length > 1 ? 's' : '') + '</span></div>';
            }
        }
        html += '</div>';
        return html;
    },

    searching(comp) {
        // Hide if never searched and not active
        if (!comp.active && comp.bestScore <= 0 && comp.ticksSearched <= 0) return "";
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">searching</div>';
        if (comp.active) {
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Currently examining a book for legible text.">status</span>';
            html += '<span class="gm-bar-num" style="color:#6a8a5a">reading book ' + comp.bookIndex + '</span></div>';
            html += '<div class="gm-stat">' + tip("patience") +
                bar(comp.ticksSearched, comp.patience, "#b8a878") + '</div>';
        }
        if (comp.bestScore > 0) {
            const pct = Math.round(comp.bestScore * 100);
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Best legibility score found. English prose scores ~35-55%.">best find</span>';
            html += '<span class="gm-bar-num">' + pct + '% coherent</span></div>';
        }
        html += '</div>';
        return html;
    },

    relationships(comp, npc) {
        if (!npc.bonds || npc.bonds.length === 0) return "";
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">relationships</div>';
        const sorted = npc.bonds.slice().sort((a, b) => b.familiarity - a.familiarity);
        for (const bond of sorted) {
            if (bond.familiarity < 0.5) continue;
            html += '<div class="gm-bond">';
            html += '<span class="gm-bond-name">' + esc(bond.name) + '</span>';
            html += '<span class="gm-bond-fam gm-tip" data-tip="' + esc(TIPS.fam) + '">fam ' + Math.round(bond.familiarity) + '</span>';
            html += '<span class="gm-bond-aff gm-tip ' + (bond.affinity >= 0 ? 'gm-aff-pos' : 'gm-aff-neg') + '" data-tip="' + esc(TIPS.aff) + '">' +
                'aff ' + (bond.affinity >= 0 ? '+' : '') + Math.round(bond.affinity) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        return html;
    },

    group(comp, npc, snap) {
        if (comp.groupId === null || comp.groupId === undefined) return "";
        const groupMates = snap.npcs.filter(n => n.groupId === comp.groupId && n.id !== npc.id);
        if (groupMates.length === 0) return "";
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">group</div>';
        for (const mate of groupMates) {
            html += '<div class="gm-group-member gm-disp-' + mate.disposition + '">' +
                esc(mate.name) + '</div>';
        }
        html += '</div>';
        return html;
    },

    // Movement internals — not useful to display
    movement() { return ""; },

    habituation(comp) {
        if (!comp.exposures || Object.keys(comp.exposures).length === 0) return "";
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">habituation</div>';
        for (const name in comp.exposures) {
            const val = comp.exposures[name];
            if (typeof val === "number") {
                html += '<div class="gm-stat">' + tip(name) +
                    bar(val, 10, "#6a6050") + '</div>';
            } else if (typeof val === "object" && val !== null) {
                html += '<div class="gm-stat">' + tip(name) +
                    '<span class="gm-bar-num">' + esc(JSON.stringify(val)) + '</span></div>';
            }
        }
        html += '</div>';
        return html;
    },
};

function renderComponentFallback(key, comp) {
    let html = '<div class="gm-section">';
    html += '<div class="gm-section-title">' + esc(key) + '</div>';
    for (const field in comp) {
        const val = comp[field];
        if (typeof val === "number") {
            const max = val > 1 ? 100 : 1;
            html += '<div class="gm-stat">' + tip(field) +
                bar(val, max, "#6a6050") + '</div>';
        } else if (typeof val === "string") {
            html += '<div class="gm-stat">' + tip(field) +
                '<span class="gm-bar-num">' + esc(val) + '</span></div>';
        } else if (typeof val === "boolean") {
            html += '<div class="gm-stat">' + tip(field) +
                '<span class="gm-bar-num">' + (val ? "yes" : "no") + '</span></div>';
        } else if (val !== null && val !== undefined) {
            html += '<div class="gm-stat">' + tip(field) +
                '<span class="gm-bar-num gm-bar-num-wrap">' + esc(JSON.stringify(val)) + '</span></div>';
        }
    }
    html += '</div>';
    return html;
}

function narrate(npc) {
    if (!npc.alive) return "They are dead. They will return at dawn.";

    const parts = [];

    if (npc.disposition === "calm") parts.push("They are unworried.");
    else if (npc.disposition === "anxious") parts.push("They are anxious.");
    else if (npc.disposition === "mad") parts.push("They have lost their mind.");
    else if (npc.disposition === "catatonic") parts.push("They have stopped moving.");
    else if (npc.disposition === "inspired") parts.push("They have seen where their book is.");

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
    const belief = npc.components && npc.components.belief;
    if (belief) {
        const b = belief;
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

    // Intent
    const intent = npc.components && npc.components.intent;
    if (intent) {
        if (intent.behavior === "search") parts.push("They are browsing bookshelves.");
        else if (intent.behavior === "return_home") parts.push("They are heading home for the night.");
        else if (intent.behavior === "seek_rest") parts.push("They need to rest.");
        else if (intent.behavior === "wander_mad") parts.push("They are wandering erratically.");
        else if (intent.behavior === "pilgrimage") parts.push("They are on a pilgrimage to find their book.");
    }

    // Sleep
    const sleep = npc.components && npc.components.sleep;
    if (sleep && sleep.asleep) {
        if (sleep.coSleepers && sleep.coSleepers.length > 0) {
            parts.push("They are sleeping among others.");
        } else {
            parts.push("They are sleeping alone.");
        }
    }

    if (npc.groupId !== null && npc.groupId !== undefined) {
        parts.push("They are traveling with others.");
    } else if (!sleep || !sleep.asleep) {
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
    if (html !== lastHtml) {
        pane.innerHTML = html;
        lastHtml = html;
    }
}

function renderDetail(npc, snap, pane) {
    let html = '<div class="gm-interior">';

    // Back button
    html += '<button class="gm-back" id="gm-npc-back">\u2190 all npcs</button>';

    // Identity (always present, from flat fields)
    html += '<div class="gm-section gm-identity">';
    html += '<div class="gm-name">' + esc(npc.name) + '</div>';
    html += '<div class="gm-disp gm-disp-' + npc.disposition + ' gm-tip" data-tip="' + esc(TIPS[npc.disposition] || "") + '">' + npc.disposition + '</div>';
    if (!npc.alive) html += '<div class="gm-dead-tag">dead</div>';
    if (npc.falling) html += '<div class="gm-dead-tag" style="color:#e0b040">falling (spd ' + Math.round(npc.falling.speed) + ')</div>';
    // Location (right below name)
    html += '<div class="gm-loc-inline"><span class="gm-loc-link" data-center-id="' + npc.id + '">' +
        (npc.side === 0 ? 'west' : 'east') + ' \u00B7 seg ' + npc.position + ' \u00B7 floor ' + npc.floor + '</span></div>';
    html += '</div>';

    // Possess / Jump / Vision buttons
    html += '<div class="gm-section gm-actions">';
    if (npc.alive) {
        html += '<button class="gm-btn" id="gm-possess" data-npc-id="' + npc.id + '">possess</button>';
        if (npc.floor > 0 && !npc.falling) {
            html += '<button class="gm-btn" id="gm-npc-jump" data-npc-id="' + npc.id + '">push into chasm</button>';
        }
        const k = npc.components && npc.components.knowledge;
        if (k && !k.bookVision && !k.escaped) {
            html += '<button class="gm-btn" id="gm-grant-vision" data-npc-id="' + npc.id + '">grant vision</button>';
        }
    }
    html += '</div>';

    // Auto-render ECS components
    const comps = npc.components || {};
    const rendered = new Set();

    // Render in preferred order first
    for (const key of COMPONENT_ORDER) {
        if (!comps[key]) continue;
        rendered.add(key);
        const renderer = componentRenderers[key];
        if (renderer) {
            html += renderer(comps[key], npc, snap);
        } else {
            html += renderComponentFallback(key, comps[key]);
        }
    }

    // Render any remaining components not in the order list
    for (const key in comps) {
        if (rendered.has(key)) continue;
        const renderer = componentRenderers[key];
        if (renderer) {
            html += renderer(comps[key], npc, snap);
        } else {
            html += renderComponentFallback(key, comps[key]);
        }
    }

    // Narration
    html += '<div class="gm-section gm-monologue">';
    html += '<div class="gm-thought">' + esc(narrate(npc)) + '</div>';
    html += '</div>';

    html += '</div>';
    if (html !== lastHtml) {
        pane.innerHTML = html;
        lastHtml = html;
    }
}

export const GodmodePanel = {
    init(cbs) {
        callbacks = cbs || {};
        lastHtml = "";
        possessCallback = cbs.onPossess || null;
        jumpCallback = cbs.onJump || null;
        visionCallback = cbs.onVision || null;

        // Event delegation — survives innerHTML rebuilds
        const pane = document.getElementById("gm-npc-pane");
        if (pane) {
            pane.addEventListener("click", function (ev) {
                // Back button
                if (ev.target.closest("#gm-npc-back")) {
                    if (callbacks.onDeselect) callbacks.onDeselect();
                    return;
                }

                // Possess button
                if (ev.target.closest("#gm-possess")) {
                    const id = parseInt(ev.target.closest("#gm-possess").dataset.npcId, 10);
                    if (possessCallback) possessCallback(id);
                    return;
                }

                // Jump button
                if (ev.target.closest("#gm-npc-jump")) {
                    const id = parseInt(ev.target.closest("#gm-npc-jump").dataset.npcId, 10);
                    if (jumpCallback) jumpCallback(id);
                    return;
                }

                // Grant vision button
                if (ev.target.closest("#gm-grant-vision")) {
                    const id = parseInt(ev.target.closest("#gm-grant-vision").dataset.npcId, 10);
                    if (visionCallback) visionCallback(id);
                    return;
                }

                // Location link (center on NPC)
                const locEl = ev.target.closest("[data-center-id]");
                if (locEl) {
                    const id = parseInt(locEl.dataset.centerId, 10);
                    if (callbacks.onCenter) callbacks.onCenter(id);
                    return;
                }

                // NPC row (select NPC)
                const row = ev.target.closest("[data-npc-id]");
                if (row) {
                    const id = parseInt(row.dataset.npcId, 10);
                    if (callbacks.onSelect) callbacks.onSelect(id);
                }
            });
        }
    },

    update(snap, selectedId, force) {
        const pane = document.getElementById("gm-npc-pane");
        if (!pane) return;

        // Throttle DOM updates so clicks aren't swallowed at high tick rates
        const now = performance.now();
        if (!force && now - lastRenderTime < RENDER_THROTTLE_MS) return;
        lastRenderTime = now;

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
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
