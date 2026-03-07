/* Godmode trends — time-series data collection and canvas sparkline rendering.
 * Samples snapshot data periodically, renders aggregate and per-NPC graphs.
 */

const SAMPLE_INTERVAL = 10;  // sample every N ticks
let samples = [];             // [{ day, tick, avgHope, avgLuc, alive, dead, stances, npcs }]
let lastSampleTick = -999;
let lastHtml = "";
let selectCallback = null;

// Per-NPC history: id → { hope: [], lucidity: [] }
const npcHistory = new Map();
const MAX_SAMPLES = 600;  // ~6000 ticks = 25 days at default

const STANCE_COLORS = {
    undecided: "#888888",
    seeker: "#6a8a5a",
    direite: "#9a2a2a",
    nihilist: "#666666",
    holdout: "#b8a878",
};

const STANCE_ORDER = ["seeker", "holdout", "undecided", "nihilist", "direite"];

function aggregateSide(alive, dead, escaped, side) {
    const a = alive.filter(n => n.side === side);
    const d = dead.filter(n => n.side === side);
    const e = escaped.filter(n => n.side === side);
    let sumH = 0, sumL = 0;
    for (const npc of a) { sumH += npc.hope; sumL += npc.lucidity; }
    const c = a.length || 1;
    const stances = { undecided: 0, seeker: 0, direite: 0, nihilist: 0, holdout: 0 };
    for (const npc of a) {
        const b = npc.components && npc.components.belief;
        const stance = b ? b.stance : "undecided";
        if (stance in stances) stances[stance]++;
        else stances.undecided++;
    }
    return { avgHope: sumH / c, avgLuc: sumL / c, alive: a.length, dead: d.length, escaped: e.length, stances };
}

function record(snap) {
    const globalTick = (snap.day - 1) * 240 + snap.tick;
    if (globalTick - lastSampleTick < SAMPLE_INTERVAL) return;
    lastSampleTick = globalTick;

    const alive = snap.npcs.filter(n => n.alive && !n.free);
    const dead = snap.npcs.filter(n => !n.alive && !n.free);
    const escaped = snap.npcs.filter(n => n.free);

    let sumHope = 0, sumLuc = 0;
    for (const npc of alive) {
        sumHope += npc.hope;
        sumLuc += npc.lucidity;
    }
    const count = alive.length || 1;

    // Stance distribution
    const stances = { undecided: 0, seeker: 0, direite: 0, nihilist: 0, holdout: 0 };
    for (const npc of alive) {
        const b = npc.components && npc.components.belief;
        const stance = b ? b.stance : "undecided";
        if (stance in stances) stances[stance]++;
        else stances.undecided++;
    }

    // Per-corridor breakdown
    const sides = [aggregateSide(alive, dead, escaped, 0), aggregateSide(alive, dead, escaped, 1)];

    samples.push({
        day: snap.day,
        tick: snap.tick,
        globalTick,
        avgHope: sumHope / count,
        avgLuc: sumLuc / count,
        alive: alive.length,
        dead: dead.length,
        escaped: escaped.length,
        stances,
        sides,
    });

    // Per-NPC tracking
    for (const npc of snap.npcs) {
        if (npc.free) continue;
        let hist = npcHistory.get(npc.id);
        if (!hist) {
            hist = { name: npc.name, hope: [], lucidity: [], disposition: [] };
            npcHistory.set(npc.id, hist);
        }
        hist.name = npc.name;
        hist.side = npc.side;
        hist.hope.push(npc.alive ? npc.hope : -1);
        hist.lucidity.push(npc.alive ? npc.lucidity : -1);
        hist.disposition.push(npc.disposition);
    }

    // Cap history
    if (samples.length > MAX_SAMPLES) {
        const excess = samples.length - MAX_SAMPLES;
        samples = samples.slice(excess);
        for (const [, hist] of npcHistory) {
            hist.hope = hist.hope.slice(excess);
            hist.lucidity = hist.lucidity.slice(excess);
            hist.disposition = hist.disposition.slice(excess);
        }
    }
}

function sparkCanvas(id, w, h) {
    return '<canvas id="' + id + '" width="' + w + '" height="' + h +
        '" style="width:' + w + 'px;height:' + h + 'px;display:block"></canvas>';
}

function drawSparkline(canvasId, data, max, color, deadColor) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx = el.getContext("2d");
    const w = el.width;
    const h = el.height;
    ctx.clearRect(0, 0, w, h);

    if (data.length < 2) return;

    // Grid line at 50%
    ctx.strokeStyle = "#1a1610";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const step = w / (data.length - 1);

    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        if (v < 0) {
            // Dead — break line
            if (started) ctx.stroke();
            started = false;
            // Draw dead marker
            if (deadColor) {
                ctx.fillStyle = deadColor;
                ctx.fillRect(i * step, 0, Math.max(step, 1), h);
            }
            continue;
        }
        const x = i * step;
        const y = h - (v / max) * h;
        if (!started) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.moveTo(x, y);
            started = true;
        } else {
            ctx.lineTo(x, y);
        }
    }
    if (started) ctx.stroke();
}

function drawStackedArea(canvasId, stanceData) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx = el.getContext("2d");
    const w = el.width;
    const h = el.height;
    ctx.clearRect(0, 0, w, h);

    if (stanceData.length < 2) return;

    const step = w / (stanceData.length - 1);

    // Find max total for scaling
    let maxTotal = 1;
    for (const s of stanceData) {
        let total = 0;
        for (const k of STANCE_ORDER) total += s[k] || 0;
        if (total > maxTotal) maxTotal = total;
    }

    // Draw stacked areas bottom-up
    for (let si = STANCE_ORDER.length - 1; si >= 0; si--) {
        const key = STANCE_ORDER[si];
        const color = STANCE_COLORS[key] || "#888";

        ctx.fillStyle = color + "60";
        ctx.beginPath();
        ctx.moveTo(0, h);

        for (let i = 0; i < stanceData.length; i++) {
            let cumulative = 0;
            for (let j = 0; j <= si; j++) {
                cumulative += stanceData[i][STANCE_ORDER[j]] || 0;
            }
            const x = i * step;
            const y = h - (cumulative / maxTotal) * h;
            ctx.lineTo(x, y);
        }

        ctx.lineTo((stanceData.length - 1) * step, h);
        ctx.closePath();
        ctx.fill();
    }
}

function drawDualSparkline(canvasId, hope, luc) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const ctx = el.getContext("2d");
    const w = el.width;
    const h = el.height;
    ctx.clearRect(0, 0, w, h);

    if (hope.length < 2) return;

    const step = w / (hope.length - 1);

    // Draw both lines
    const lines = [
        { data: luc, color: "#b8a878" },
        { data: hope, color: "#6a8a5a" },
    ];

    for (const line of lines) {
        ctx.strokeStyle = line.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < line.data.length; i++) {
            const v = line.data[i];
            if (v < 0) {
                if (started) ctx.stroke();
                started = false;
                continue;
            }
            const x = i * step;
            const y = h - (v / 100) * h;
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        if (started) ctx.stroke();
    }
}

function esc(s) {
    if (!s) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderTo(pane) {
    if (!pane) return;

    const W = 290;  // canvas width fits panel
    const H_AGG = 60;
    const H_STANCE = 50;
    const H_NPC = 28;

    let html = '';

    if (samples.length < 3) {
        html = '<div class="gm-panel-empty">Collecting data...</div>';
        if (html !== lastHtml) { pane.innerHTML = html; lastHtml = html; }
        return;
    }

    const latest = samples[samples.length - 1];

    // Summary line
    html += '<div class="gm-section">';
    html += '<div class="gm-section-title">population</div>';
    html += '<div class="gm-trend-summary">';
    html += '<span>' + latest.alive + ' alive</span>';
    html += '<span>' + latest.dead + ' dead</span>';
    if (latest.escaped > 0) html += '<span style="color:#60d060">' + latest.escaped + ' free</span>';
    html += '</div>';

    // Avg hope/lucidity sparklines
    html += '<div class="gm-trend-label"><span style="color:#6a8a5a">avg hope</span> ' +
        '<span class="gm-trend-val">' + Math.round(latest.avgHope) + '</span></div>';
    html += sparkCanvas("gm-spark-hope", W, H_AGG);
    html += '<div class="gm-trend-label"><span style="color:#b8a878">avg lucidity</span> ' +
        '<span class="gm-trend-val">' + Math.round(latest.avgLuc) + '</span></div>';
    html += sparkCanvas("gm-spark-luc", W, H_AGG);
    html += '</div>';

    // West vs East comparison
    const SIDE_W = 130;  // half-width sparklines
    const H_SIDE = 36;
    html += '<div class="gm-section">';
    html += '<div class="gm-section-title">west vs east</div>';
    html += '<div class="gm-trend-sides">';
    const sideNames = ["west", "east"];
    for (let s = 0; s < 2; s++) {
        const sd = latest.sides[s];
        html += '<div class="gm-trend-side">';
        html += '<div class="gm-trend-side-head">' + sideNames[s] + ' <span class="gm-trend-val">' + sd.alive + '</span></div>';
        html += '<div class="gm-trend-label"><span style="color:#6a8a5a">hope</span> ' +
            '<span class="gm-trend-val">' + Math.round(sd.avgHope) + '</span></div>';
        html += sparkCanvas("gm-spark-side-hope-" + s, SIDE_W, H_SIDE);
        html += '<div class="gm-trend-label"><span style="color:#b8a878">luc</span> ' +
            '<span class="gm-trend-val">' + Math.round(sd.avgLuc) + '</span></div>';
        html += sparkCanvas("gm-spark-side-luc-" + s, SIDE_W, H_SIDE);
        // Mini stance bar
        html += '<div class="gm-trend-side-stances">';
        const total = sd.alive || 1;
        for (const key of STANCE_ORDER) {
            const pct = ((sd.stances[key] || 0) / total) * 100;
            if (pct > 0) {
                html += '<span class="gm-trend-side-bar" style="width:' + pct +
                    '%;background:' + STANCE_COLORS[key] + '40;color:' + STANCE_COLORS[key] +
                    '">' + (sd.stances[key] || "") + '</span>';
            }
        }
        html += '</div>';
        html += '</div>';
    }
    html += '</div>';
    html += '</div>';

    // Stance distribution
    html += '<div class="gm-section">';
    html += '<div class="gm-section-title">worldviews</div>';
    html += '<div class="gm-trend-stance-legend">';
    for (const key of STANCE_ORDER) {
        const color = STANCE_COLORS[key];
        const count = latest.stances[key] || 0;
        html += '<span style="color:' + color + '">' + key + ' ' + count + '</span>';
    }
    html += '</div>';
    html += sparkCanvas("gm-spark-stance", W, H_STANCE);
    html += '</div>';

    // Per-NPC sparklines
    html += '<div class="gm-section">';
    html += '<div class="gm-section-title">individual trends</div>';
    html += '<div class="gm-trend-legend"><span style="color:#b8a878">luc</span> <span style="color:#6a8a5a">hope</span></div>';

    const sortedNpcs = Array.from(npcHistory.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const westNpcs = sortedNpcs.filter(([, h]) => h.side === 0);
    const eastNpcs = sortedNpcs.filter(([, h]) => h.side === 1);
    for (const [label, group] of [["west", westNpcs], ["east", eastNpcs]]) {
        if (group.length === 0) continue;
        html += '<div class="gm-trend-side-label">' + label + '</div>';
        for (const [id, hist] of group) {
            const lastDisp = hist.disposition[hist.disposition.length - 1] || "calm";
            html += '<div class="gm-trend-npc-row" data-npc-id="' + id + '">';
            html += '<span class="gm-trend-npc-name gm-disp-' + lastDisp + '">' + esc(hist.name) + '</span>';
            html += sparkCanvas("gm-spark-npc-" + id, W - 80, H_NPC);
            html += '</div>';
        }
    }
    html += '</div>';

    // Only update DOM if content changed (structural, not canvas)
    if (html !== lastHtml) {
        pane.innerHTML = html;
        lastHtml = html;
    }

    // Draw all canvases (always, since values change even if structure doesn't)
    drawSparkline("gm-spark-hope", samples.map(s => s.avgHope), 100, "#6a8a5a");
    drawSparkline("gm-spark-luc", samples.map(s => s.avgLuc), 100, "#b8a878");
    for (let s = 0; s < 2; s++) {
        drawSparkline("gm-spark-side-hope-" + s, samples.map(d => d.sides[s].avgHope), 100, "#6a8a5a");
        drawSparkline("gm-spark-side-luc-" + s, samples.map(d => d.sides[s].avgLuc), 100, "#b8a878");
    }
    drawStackedArea("gm-spark-stance", samples.map(s => s.stances));

    for (const [id, hist] of npcHistory) {
        drawDualSparkline("gm-spark-npc-" + id, hist.hope, hist.lucidity);
    }
}

export const GodmodeTrends = {
    init(onSelect) {
        samples = [];
        lastSampleTick = -999;
        lastHtml = "";
        npcHistory.clear();
        selectCallback = onSelect || null;
    },

    /** Call every tick/batch with the current snapshot. */
    record,

    /** Render the trends pane. */
    renderTo,

    /** Wire click delegation on the trends pane. */
    wireClicks(pane) {
        if (!pane) return;
        pane.addEventListener("click", function (ev) {
            const row = ev.target.closest("[data-npc-id]");
            if (row && selectCallback) {
                selectCallback(parseInt(row.dataset.npcId, 10));
            }
        });
    },

    /** Get sample count (for tests). */
    get sampleCount() { return samples.length; },
};
