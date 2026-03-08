/* Godmode panel — NPC list + detail view.
 * List: all NPCs with compact stat summary, clickable to select.
 * Detail: auto-populated from ECS components via renderer registry.
 * Callbacks: onSelect(id), onCenter(id), onDeselect()
 */

import { getNpcNarrative } from "./godmode-narrative.js";

let callbacks = {};
let lastHtml = "";
let lastGrpHtml = "";
let lastRenderTime = 0;
const RENDER_THROTTLE_MS = 400;
let powersOpen = false;
let lastSnap = null;

// Powers registry: { key, label, available(npc), action(npcId) }
// Populated in init() from callbacks.
const powers = [];

// NPC list disposition filters — all on by default
const npcFilters = { calm: true, anxious: true, mad: true, catatonic: true, inspired: true, dead: true };

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
    escaped: "FREE",
};

// Narrative copy loaded from content/godmode.json via window.TEXT
function gm() { return (typeof TEXT !== "undefined" && TEXT.godmode) || {}; }
function TIPS() { return gm().tips || {}; }

function tip(label) {
    const desc = TIPS()[label];
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

const COMPONENT_ORDER = ["psychology", "stats", "intent", "knowledge", "needs", "sleep", "belief", "personality", "searching", "relationships", "group", "habituation"];

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

    stats(comp) {
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">stats</div>';
        html += '<div class="gm-stat">' + tip("endurance") + bar(comp.endurance, 18, "#8a6a4a") + '</div>';
        html += '<div class="gm-stat">' + tip("influence") + bar(comp.influence, 18, "#6a5a8a") + '</div>';
        html += '<div class="gm-stat">' + tip("quickness") + bar(comp.quickness, 18, "#4a7a6a") + '</div>';
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
            html += '<div class="gm-stat">' + tip("stance") + '<span class="gm-bar-num gm-tip" data-tip="' + esc(TIPS()[comp.stance] || "") + '" style="color:' + color + '">' + esc(label) + '</span></div>';
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

    intent(comp, npc, snap) {
        const BEHAVIOR_COLORS = {
            idle: "#888",
            explore: "#b8a878",
            seek_rest: "#4a8ab0",
            search: "#6a8a5a",
            return_home: "#c49530",
            wander_mad: "#9a2a2a",
            pilgrimage: "#d4a0e0",
            socialize: "#7ab0a0",
        };
        const labels = gm().behavior_labels || {};
        // Show "Asleep" when idle during lights-off
        const asleep = comp.behavior === "idle" && snap && !snap.lightsOn && npc && npc.alive;
        const label = asleep ? (labels.asleep || "Asleep") : (labels[comp.behavior] || comp.behavior);
        const color = asleep ? "#6a3a6a" : (BEHAVIOR_COLORS[comp.behavior] || "#888");
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">behavior</div>';
        html += '<div class="gm-stat">' + tip("intent");
        html += '<span class="gm-bar-num" style="color:' + color + '">' + esc(label) + '</span></div>';
        if (comp.cooldown > 0) {
            html += '<div class="gm-stat">' + tip("cooldown");
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
        if (comp.hasBook) {
            html += '<div class="gm-stat"><span>book</span><span class="gm-bar-num" style="color:#60d060">found!</span></div>';
        }
        // Searched segments
        const searched = comp.searchedSegments;
        const segCount = Array.isArray(searched) ? searched.length : 0;
        if (segCount > 0) {
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Number of library segments this NPC has finished searching. Shared via conversation.">searched</span>';
            html += '<span class="gm-bar-num">' + segCount + ' segment' + (segCount !== 1 ? 's' : '') +
                ' <button class="gm-btn gm-search-map-btn" data-npc-id="' + npc.id + '">map</button></span></div>';
        }
        // Lifetime best find
        if (comp.bestScore > 0) {
            const wordStr = comp.bestWords && comp.bestWords.length > 0
                ? '"' + comp.bestWords.join(" ") + '"'
                : (comp.bestScore === 1 ? "1 word" : comp.bestScore + " words");
            html += '<div class="gm-stat"><span class="gm-tip" data-tip="Best words found on a single page across all searches.">best find</span>';
            html += '<span class="gm-bar-num" style="color:#6a8a5a">' + wordStr + '</span></div>';
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
            const h = comp.home;
            html += '<span class="gm-bar-num">' + (h.side === 0 ? 'W' : 'E') + ' f' + h.floor + ' s' + h.position + '</span></div>';
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
        // Only show when actively reading
        if (!comp.active) return "";
        let html = '<div class="gm-section">';
        html += '<div class="gm-section-title">searching</div>';
        html += '<div class="gm-stat"><span class="gm-tip" data-tip="Currently examining a book for words.">status</span>';
        html += '<span class="gm-bar-num" style="color:#6a8a5a">reading book ' + comp.bookIndex + '</span></div>';
        html += '<div class="gm-stat">' + tip("patience") +
            bar(comp.ticksSearched, comp.patience, "#b8a878") + '</div>';
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
            html += '<span class="gm-bond-name">' + esc(bond.name) + (bond.isPlayer ? ' <span class="gm-player-tag">you</span>' : '') + '</span>';
            html += '<span class="gm-bond-fam gm-tip" data-tip="' + esc(TIPS().fam) + '">fam ' + Math.round(bond.familiarity) + '</span>';
            html += '<span class="gm-bond-aff gm-tip ' + (bond.affinity >= 0 ? 'gm-aff-pos' : 'gm-aff-neg') + '" data-tip="' + esc(TIPS().aff) + '">' +
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

// --- Search coverage map overlay ---

function showSearchMap(npcId) {
    const snap = lastSnap;
    if (!snap) return;
    const npc = snap.npcs.find(n => n.id === npcId);
    if (!npc) return;
    const k = npc.components && npc.components.knowledge;
    if (!k) return;
    const segs = k.searchedSegments || [];
    if (segs.length === 0) return;

    // Parse segment keys "side:position:floor"
    const parsed = segs.map(s => {
        const [side, pos, floor] = s.split(":").map(Number);
        return { side, pos, floor };
    });

    // Separate by side
    const bySide = [
        parsed.filter(p => p.side === 0),
        parsed.filter(p => p.side === 1),
    ];

    // Compute bounds across all segments + NPC position + book vision
    const allPos = parsed.map(p => p.pos);
    const allFloor = parsed.map(p => p.floor);
    allPos.push(npc.position);
    allFloor.push(npc.floor);
    if (k.bookVision) {
        allPos.push(k.bookVision.position);
        allFloor.push(k.bookVision.floor);
    }
    if (k.lifeStory && k.lifeStory.bookCoords) {
        allPos.push(k.lifeStory.bookCoords.position);
        allFloor.push(k.lifeStory.bookCoords.floor);
    }

    const minPos = Math.min(...allPos) - 2;
    const maxPos = Math.max(...allPos) + 2;
    const minFloor = Math.min(...allFloor) - 2;
    const maxFloor = Math.max(...allFloor) + 2;

    const cols = maxPos - minPos + 1;
    const rows = maxFloor - minFloor + 1;

    // Build sets for fast lookup
    const searchedSets = [new Set(), new Set()];
    for (const p of parsed) {
        searchedSets[p.side].add(p.pos + ":" + p.floor);
    }

    // Create overlay
    const pane = document.getElementById("gm-npc-pane");
    if (!pane) return;

    const overlay = document.createElement("div");
    overlay.className = "gm-search-map-overlay";

    // Header
    const header = document.createElement("div");
    header.className = "gm-search-map-header";
    header.innerHTML = '<span>' + esc(npc.name) + ' — search coverage (' +
        segs.length + ' segment' + (segs.length !== 1 ? 's' : '') + ')</span>' +
        '<button class="gm-btn gm-search-map-close">\u00D7</button>';
    overlay.appendChild(header);

    // Determine if we show both sides or just one
    const hasBoth = bySide[0].length > 0 && bySide[1].length > 0;
    const sidesToShow = hasBoth ? [0, 1] : (bySide[0].length > 0 ? [0] : [1]);

    // Canvas sizing
    const CELL = Math.max(3, Math.min(12, Math.floor(280 / Math.max(cols, rows))));
    const GAP = hasBoth ? 8 : 0;
    const corridorW = cols * CELL;
    const canvasW = hasBoth ? corridorW * 2 + GAP : corridorW;
    const canvasH = rows * CELL;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    canvas.style.width = canvasW + "px";
    canvas.style.height = canvasH + "px";
    overlay.appendChild(canvas);

    // Legend
    const legend = document.createElement("div");
    legend.className = "gm-search-map-legend";
    legend.innerHTML =
        '<span class="gm-sml-searched"></span> searched ' +
        '<span class="gm-sml-npc"></span> location ' +
        '<span class="gm-sml-book"></span> book';
    overlay.appendChild(legend);

    pane.appendChild(overlay);

    // Render
    const ctx = canvas.getContext("2d");

    for (const sideIdx of sidesToShow) {
        const offsetX = hasBoth && sideIdx === 1 ? corridorW + GAP : 0;
        const searched = searchedSets[sideIdx];

        // Background
        ctx.fillStyle = "#0d0b08";
        ctx.fillRect(offsetX, 0, corridorW, canvasH);

        // Grid lines
        ctx.strokeStyle = "#1a1710";
        ctx.lineWidth = 0.5;
        for (let c = 0; c <= cols; c++) {
            const x = offsetX + c * CELL;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvasH); ctx.stroke();
        }
        for (let r = 0; r <= rows; r++) {
            const y = r * CELL;
            ctx.beginPath(); ctx.moveTo(offsetX, y); ctx.lineTo(offsetX + corridorW, y); ctx.stroke();
        }

        // Searched cells
        ctx.fillStyle = "#3a5a3a";
        for (let p = minPos; p <= maxPos; p++) {
            for (let f = minFloor; f <= maxFloor; f++) {
                if (searched.has(p + ":" + f)) {
                    const cx = offsetX + (p - minPos) * CELL;
                    const cy = (maxFloor - f) * CELL; // flip Y
                    ctx.fillRect(cx, cy, CELL, CELL);
                }
            }
        }

        // NPC position
        if (npc.side === sideIdx) {
            const nx = offsetX + (npc.position - minPos) * CELL + CELL / 2;
            const ny = (maxFloor - npc.floor) * CELL + CELL / 2;
            ctx.fillStyle = "#d4c898";
            ctx.beginPath();
            ctx.arc(nx, ny, Math.max(2, CELL / 2.5), 0, Math.PI * 2);
            ctx.fill();
        }

        // Book location
        const bc = k.lifeStory && k.lifeStory.bookCoords;
        if (bc && bc.side === sideIdx) {
            const bx = offsetX + (bc.position - minPos) * CELL + CELL / 2;
            const by = (maxFloor - bc.floor) * CELL + CELL / 2;
            ctx.fillStyle = "#60d060";
            ctx.beginPath();
            ctx.arc(bx, by, Math.max(2, CELL / 2.5), 0, Math.PI * 2);
            ctx.fill();
        }

        // Vision location (if different from book)
        if (k.bookVision && k.bookVision.side === sideIdx) {
            const vx = offsetX + (k.bookVision.position - minPos) * CELL + CELL / 2;
            const vy = (maxFloor - k.bookVision.floor) * CELL + CELL / 2;
            ctx.strokeStyle = k.visionAccurate ? "#60d060" : "#d04040";
            ctx.lineWidth = 1.5;
            const r = Math.max(2, CELL / 2.5);
            ctx.beginPath();
            ctx.moveTo(vx - r, vy - r); ctx.lineTo(vx + r, vy + r);
            ctx.moveTo(vx + r, vy - r); ctx.lineTo(vx - r, vy + r);
            ctx.stroke();
        }

        // Side label
        if (hasBoth) {
            ctx.fillStyle = "#6a6050";
            ctx.font = "9px 'Share Tech Mono', monospace";
            ctx.textAlign = "center";
            ctx.fillText(sideIdx === 0 ? "W" : "E", offsetX + corridorW / 2, 9);
        }
    }

    // Chasm gap
    if (hasBoth) {
        ctx.fillStyle = "#1a1408";
        ctx.fillRect(corridorW, 0, GAP, canvasH);
    }

    // Close handler
    overlay.querySelector(".gm-search-map-close").addEventListener("click", function () {
        overlay.remove();
    });
}

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
    const n = gm().narrate || {};
    if (!npc.alive) return n.dead || "";

    const parts = [];
    const disp = (n.disposition || {})[npc.disposition];
    if (disp) parts.push(disp);

    if (npc.bonds.length === 0) {
        parts.push(n.bonds_none || "");
    } else {
        const close = npc.bonds.filter(b => b.affinity > 5);
        if (close.length > 0) {
            parts.push((n.bonds_close || "").replace("{names}", close.map(b => b.name).join(", ")));
        } else if (npc.bonds.length === 1) {
            parts.push(n.bonds_met_one || "");
        } else {
            parts.push((n.bonds_met || "").replace("{count}", npc.bonds.length));
        }
    }

    // Belief
    const belief = npc.components && npc.components.belief;
    if (belief) {
        const stanceText = (n.stance || {})[belief.stance];
        if (stanceText) {
            parts.push(stanceText);
        } else if (belief.faithCrisis > 0.5 && belief.acceptance < 0.3) {
            parts.push(n.faith_crumbling || "");
        }
    }

    // Intent
    const intent = npc.components && npc.components.intent;
    if (intent) {
        const intentText = (n.intent || {})[intent.behavior];
        if (intentText) parts.push(intentText);
    }

    // Sleep
    const sleep = npc.components && npc.components.sleep;
    if (sleep && sleep.asleep) {
        if (sleep.coSleepers && sleep.coSleepers.length > 0) {
            parts.push(n.sleep_others || "");
        } else {
            parts.push(n.sleep_alone || "");
        }
    }

    if (npc.groupId !== null && npc.groupId !== undefined) {
        parts.push(n.traveling || "");
    } else if (!sleep || !sleep.asleep) {
        parts.push(n.alone || "");
    }

    return parts.join(" ");
}

const DISP_FILTER_COLORS = {
    calm: "#c8b888", anxious: "#d4a540", mad: "#c44040",
    catatonic: "#666666", inspired: "#c8a0e0", dead: "#444444",
};

function renderNpcFilters() {
    let html = '<div class="gm-npc-filters">';
    for (const key in npcFilters) {
        const on = npcFilters[key];
        const color = DISP_FILTER_COLORS[key] || "#888";
        html += '<button class="gm-log-filter' + (on ? ' gm-log-filter-on' : '') +
            '" data-npc-filter="' + key + '" style="color:' + (on ? color : '#3a3428') +
            '">' + key + '</button>';
    }
    html += '</div>';
    return html;
}

function npcPassesFilter(npc) {
    if (!npc.alive) return npcFilters.dead;
    return npcFilters[npc.disposition] !== false;
}

function renderList(snap, pane) {
    let html = renderNpcFilters();
    html += '<div class="gm-npc-list">';
    const sorted = snap.npcs.slice().sort((a, b) => {
        // Dead last, then by disposition severity, then name
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        const order = { mad: 0, anxious: 1, catatonic: 2, calm: 3 };
        const da = order[a.disposition] ?? 3;
        const db = order[b.disposition] ?? 3;
        if (da !== db) return da - db;
        return a.name.localeCompare(b.name);
    });

    let count = 0;
    for (const npc of sorted) {
        if (!npcPassesFilter(npc)) continue;
        count++;
        const dispClass = "gm-disp-" + npc.disposition;
        const dead = npc.alive ? "" : " gm-npc-row-dead";
        html += '<div class="gm-npc-row' + dead + '" data-npc-id="' + npc.id + '">';
        html += '<div class="gm-npc-row-top">';
        html += '<span class="gm-npc-row-name">' + esc(npc.name) + '</span>';
        if (npc.isPlayer) html += '<span class="gm-player-tag">you</span>';
        html += '<span class="gm-npc-row-disp ' + dispClass + '">' + (DISP_SHORT[npc.disposition] || npc.disposition) + '</span>';
        const isEscaped = npc.free;
        if (!npc.alive) html += '<span class="gm-dead-tag" style="' + (isEscaped ? 'color:#60d060;font-style:normal' : '') + '">' + (isEscaped ? 'FREE' : 'dead') + '</span>';
        html += '</div>';
        html += '<div class="gm-npc-row-bars">';
        html += '<span class="gm-npc-row-label">luc</span>' + miniBar(npc.lucidity, 100, "#b8a878");
        html += '<span class="gm-npc-row-label">hope</span>' + miniBar(npc.hope, 100, "#6a8a5a");
        html += '</div>';
        html += '<div class="gm-npc-row-loc" data-center-id="' + npc.id + '">';
        html += (npc.falling ? 'chasm' : (npc.side === 0 ? 'W' : 'E')) + ' f' + npc.floor + ' s' + npc.position;
        html += '</div>';
        html += '</div>';
    }

    if (count === 0) {
        html += '<div class="gm-panel-empty">No matching NPCs.</div>';
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
    html += '<div class="gm-name">' + esc(npc.name) + (npc.isPlayer ? ' <span class="gm-player-tag">you</span>' : '') + '</div>';
    html += '<div class="gm-disp gm-disp-' + npc.disposition + ' gm-tip" data-tip="' + esc(TIPS()[npc.disposition] || "") + '">' + npc.disposition + '</div>';
    const isEscaped = npc.free;
    if (!npc.alive) html += '<div class="gm-dead-tag" style="' + (isEscaped ? 'color:#60d060;font-style:normal' : '') + '">' + (isEscaped ? 'FREE' : 'dead') + '</div>';
    if (npc.falling) html += '<div class="gm-dead-tag" style="color:#e0b040">falling (spd ' + Math.round(npc.falling.speed) + ')</div>';
    // Location (right below name)
    const locSide = npc.falling ? 'chasm' : (npc.side === 0 ? 'west' : 'east');
    html += '<div class="gm-loc-inline"><span class="gm-loc-link" data-center-id="' + npc.id + '">' +
        locSide + ' \u00B7 seg ' + npc.position + ' \u00B7 floor ' + npc.floor + '</span></div>';
    html += '</div>';

    // Possess + powers dropdown
    html += '<div class="gm-section gm-actions">';
    if (npc.alive) {
        html += '<button class="gm-btn" id="gm-possess" data-npc-id="' + npc.id + '">possess</button>';
        // Powers dropdown
        const available = powers.filter(p => p.available(npc));
        if (available.length > 0) {
            html += '<div class="gm-powers-wrap">';
            html += '<button class="gm-btn gm-powers-toggle" id="gm-powers-btn">' +
                'powers \u25BE</button>';
            html += '<div class="gm-powers-menu' + (powersOpen ? ' gm-powers-open' : '') + '">';
            for (const p of available) {
                html += '<button class="gm-power-item" data-power="' + p.key +
                    '" data-npc-id="' + npc.id + '">' + esc(p.label) + '</button>';
            }
            html += '</div></div>';
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

    // Live state
    html += '<div class="gm-section gm-monologue">';
    html += '<div class="gm-thought">' + esc(narrate(npc)) + '</div>';
    html += '</div>';

    // Narrative history
    const narrative = getNpcNarrative(npc.id);
    if (narrative.length > 0) {
        html += '<div class="gm-section">';
        html += '<div class="gm-section-title">story</div>';
        html += '<div class="gm-narrative">';
        // Show newest first
        for (let i = narrative.length - 1; i >= 0; i--) {
            const entry = narrative[i];
            const mins = (entry.tick / 240) * 24 * 60 + 6 * 60;
            const hh = String(Math.floor(mins / 60) % 24).padStart(2, "0");
            const mm = String(Math.floor(mins % 60)).padStart(2, "0");
            html += '<div class="gm-narrative-entry">' +
                '<span class="gm-log-time">d' + (entry.day - 1) + ' ' + hh + ':' + mm + '</span>' +
                esc(entry.text) + '</div>';
        }
        html += '</div></div>';
    }

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
        lastGrpHtml = "";
        powersOpen = false;

        // Build powers registry from callbacks
        powers.length = 0;
        if (cbs.onJump) {
            powers.push({
                key: "jump",
                label: "push into chasm",
                available(npc) { return npc.alive && npc.floor > 0 && !npc.falling; },
                action: cbs.onJump,
            });
        }
        if (cbs.onVision) {
            powers.push({
                key: "vision",
                label: "grant vision",
                available(npc) {
                    const k = npc.components && npc.components.knowledge;
                    return npc.alive && k && !k.bookVision && !npc.free;
                },
                action: cbs.onVision,
            });
        }

        // NPC filter delegation (mousedown for same innerHTML-replacement reason as log)
        const pane = document.getElementById("gm-npc-pane");
        if (pane) {
            pane.addEventListener("mousedown", function (ev) {
                const btn = ev.target.closest("[data-npc-filter]");
                if (!btn) return;
                ev.preventDefault();
                const key = btn.getAttribute("data-npc-filter");
                if (key in npcFilters) npcFilters[key] = !npcFilters[key];
                lastHtml = "";
            });
        }

        // Groups pane delegation
        const grpPane = document.getElementById("gm-grp-pane");
        if (grpPane) {
            grpPane.addEventListener("click", function (ev) {
                const row = ev.target.closest("[data-npc-id]");
                if (row) {
                    const id = parseInt(row.dataset.npcId, 10);
                    if (callbacks.onSelect) callbacks.onSelect(id);
                }
                const locEl = ev.target.closest("[data-center-id]");
                if (locEl) {
                    const id = parseInt(locEl.dataset.centerId, 10);
                    if (callbacks.onCenter) callbacks.onCenter(id);
                }
            });
        }

        // Event delegation — survives innerHTML rebuilds
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
                    if (cbs.onPossess) cbs.onPossess(id);
                    return;
                }

                // Powers dropdown toggle
                if (ev.target.closest("#gm-powers-btn")) {
                    powersOpen = !powersOpen;
                    lastHtml = ""; // force re-render to show/hide menu
                    return;
                }

                // Power item
                const powerBtn = ev.target.closest("[data-power]");
                if (powerBtn) {
                    const key = powerBtn.getAttribute("data-power");
                    const id = parseInt(powerBtn.dataset.npcId, 10);
                    const power = powers.find(p => p.key === key);
                    if (power) power.action(id);
                    powersOpen = false;
                    return;
                }

                // Search map button
                if (ev.target.closest(".gm-search-map-btn")) {
                    const id = parseInt(ev.target.closest(".gm-search-map-btn").dataset.npcId, 10);
                    showSearchMap(id);
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

    /** Register an additional god power. { key, label, available(npc), action(npcId) } */
    registerPower(power) {
        powers.push(power);
    },

    update(snap, selectedId, force) {
        lastSnap = snap;
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

    updateGroups(snap) {
        const pane = document.getElementById("gm-grp-pane");
        if (!pane) return;

        // Collect groups
        const groups = new Map();
        for (const npc of snap.npcs) {
            if (npc.groupId === null || npc.groupId === undefined) continue;
            let g = groups.get(npc.groupId);
            if (!g) { g = []; groups.set(npc.groupId, g); }
            g.push(npc);
        }

        if (groups.size === 0) {
            const empty = '<div class="gm-panel-empty">No groups yet.</div>';
            if (empty !== lastGrpHtml) { pane.innerHTML = empty; lastGrpHtml = empty; }
            return;
        }

        let html = '<div class="gm-grp-list">';
        for (const [gid, members] of groups) {
            html += '<div class="gm-grp-card">';
            // Find leader name from group component
            const leaderName = members.find(m => m.components && m.components.group && m.components.group.leaderName)
                ?.components.group.leaderName || '?';
            html += '<div class="gm-grp-header">' + members.length + ' members &middot; leader: ' + esc(leaderName) + '</div>';
            // Location (use first member)
            const loc = members[0];
            html += '<div class="gm-grp-loc" data-center-id="' + loc.id + '">' +
                (loc.falling ? 'chasm' : (loc.side === 0 ? 'W' : 'E')) + ' f' + loc.floor + ' s' + loc.position + '</div>';
            for (const npc of members) {
                const dispClass = "gm-disp-" + npc.disposition;
                html += '<div class="gm-grp-member" data-npc-id="' + npc.id + '">';
                html += '<span class="gm-npc-row-name">' + esc(npc.name) + '</span>';
                html += '<span class="gm-npc-row-disp ' + dispClass + '">' + (DISP_SHORT[npc.disposition] || npc.disposition) + '</span>';
                if (!npc.alive) html += '<span class="gm-dead-tag">dead</span>';
                html += '</div>';
            }
            html += '</div>';
        }
        html += '</div>';

        if (html !== lastGrpHtml) {
            pane.innerHTML = html;
            lastGrpHtml = html;
        }
    },
};

function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
