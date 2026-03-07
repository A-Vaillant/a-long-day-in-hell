/* Godmode map — canvas renderer for the chasm cross-section.
 *
 * Layout: two columns (west/east) with a chasm gap between them.
 * Each cell = one segment at one floor. NPCs are colored dots.
 * Viewport scrolls to follow selected NPC or pans manually.
 */

const CELL_W = 12;
const CELL_H = 8;
const CHASM_W = 40;   // pixels between the two corridor columns
const REST_EVERY = 10; // rest areas every 10 segments

// Viewport in world coords (position, floor)
let vpX = 0;       // leftmost position visible
let vpY = 0;       // bottom floor visible
let vpCols = 40;   // segments visible
let vpRows = 30;   // floors visible
let canvas = null;
let ctx = null;
let startFloor = 0;

// NPC hit targets for click detection
let hitTargets = []; // { id, x, y, r }

const DISP_COLORS = {
    calm:      "#b8a878",
    anxious:   "#c49530",
    mad:       "#9a2a2a",
    catatonic: "#555555",
    dead:      "#2a2a2a",
};

export const GodmodeMap = {
    init(canvasEl, state) {
        canvas = canvasEl;
        ctx = canvas.getContext("2d");
        startFloor = state.floor;
        // Center viewport on starting location
        vpX = state.position - Math.floor(vpCols / 2);
        vpY = state.floor - Math.floor(vpRows / 2);
        this.resize();
        window.addEventListener("resize", () => this.resize());
    },

    resize() {
        const wrap = canvas.parentElement;
        if (!wrap) return;
        canvas.width = wrap.clientWidth;
        canvas.height = wrap.clientHeight;
        // Recalculate visible cells based on canvas size
        const usableW = (canvas.width - CHASM_W) / 2;
        vpCols = Math.max(10, Math.floor(usableW / CELL_W));
        vpRows = Math.max(10, Math.floor(canvas.height / CELL_H));
    },

    draw(snap, selectedId, follow) {
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;

        // If following, center on selected NPC
        if (follow && selectedId !== null) {
            const npc = snap.npcs.find(n => n.id === selectedId);
            if (npc) {
                vpX = npc.position - Math.floor(vpCols / 2);
                vpY = npc.floor - Math.floor(vpRows / 2);
            }
        }

        // Clear
        ctx.fillStyle = snap.lightsOn ? "#0a0906" : "#050403";
        ctx.fillRect(0, 0, w, h);

        hitTargets = [];

        // Compute column widths
        const colW = vpCols * CELL_W;
        const westX = 0;
        const chasmX = colW;
        const eastX = colW + CHASM_W;

        // Draw chasm
        ctx.fillStyle = "#020201";
        ctx.fillRect(chasmX, 0, CHASM_W, h);

        // Draw grid lines and rest areas
        for (let row = 0; row < vpRows; row++) {
            const floor = vpY + vpRows - 1 - row;
            const y = row * CELL_H;

            // Floor line
            ctx.strokeStyle = "#1a1810";
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(westX, y);
            ctx.lineTo(westX + colW, y);
            ctx.moveTo(eastX, y);
            ctx.lineTo(eastX + colW, y);
            ctx.stroke();

            for (let col = 0; col < vpCols; col++) {
                const pos = vpX + col;
                if (pos < 0) continue;

                // Rest area highlight
                if (pos % REST_EVERY === 0) {
                    ctx.fillStyle = snap.lightsOn ? "#0f0d08" : "#080704";
                    ctx.fillRect(westX + col * CELL_W, y, CELL_W, CELL_H);
                    ctx.fillRect(eastX + col * CELL_W, y, CELL_W, CELL_H);
                }
            }

            // Bridge at floor 0
            if (floor === 0) {
                ctx.fillStyle = "#2a2520";
                ctx.fillRect(chasmX, y, CHASM_W, CELL_H);
            }
        }

        // Draw NPCs
        for (const npc of snap.npcs) {
            const col = npc.position - vpX;
            const row = vpRows - 1 - (npc.floor - vpY);

            if (col < 0 || col >= vpCols || row < 0 || row >= vpRows) continue;

            const baseX = npc.side === 0 ? westX : eastX;
            const cx = baseX + col * CELL_W + CELL_W / 2;
            const cy = row * CELL_H + CELL_H / 2;
            const r = 3;

            // Dot
            ctx.fillStyle = DISP_COLORS[npc.disposition] || DISP_COLORS.calm;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();

            // Selection ring
            if (npc.id === selectedId) {
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Group indicator — subtle glow for grouped NPCs
            if (npc.groupId !== null && npc.groupId !== undefined) {
                ctx.strokeStyle = "rgba(184, 168, 120, 0.3)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
                ctx.stroke();
            }

            hitTargets.push({ id: npc.id, x: cx, y: cy, r: r + 4 });
        }

        // Update controls display
        const dayEl = document.getElementById("gm-day");
        const tickEl = document.getElementById("gm-tick");
        if (dayEl) dayEl.textContent = "Day " + snap.day;
        if (tickEl) {
            // Convert tick to time (0=6am, 160=10pm, 240=6am next)
            const totalMinutes = (snap.tick / 240) * 24 * 60 + 6 * 60;
            const hours = Math.floor(totalMinutes / 60) % 24;
            const mins = Math.floor(totalMinutes % 60);
            tickEl.textContent = String(hours).padStart(2, "0") + ":" + String(mins).padStart(2, "0");
        }

        // Status
        const statusEl = document.getElementById("gm-status");
        if (statusEl) {
            const alive = snap.npcs.filter(n => n.alive).length;
            statusEl.textContent = alive + "/" + snap.npcs.length + " alive";
            if (!snap.lightsOn) statusEl.textContent += " · night";
        }
    },

    hitTest(x, y) {
        for (const t of hitTargets) {
            const dx = x - t.x;
            const dy = y - t.y;
            if (dx * dx + dy * dy <= t.r * t.r) return t.id;
        }
        return null;
    },

    handleKey(key) {
        const step = 3;
        if (key === "ArrowLeft" || key === "h") vpX -= step;
        else if (key === "ArrowRight" || key === "l") vpX += step;
        else if (key === "ArrowUp" || key === "k") vpY += step;
        else if (key === "ArrowDown" || key === "j") vpY -= step;
        // Clamp
        if (vpX < 0) vpX = 0;
        if (vpY < 0) vpY = 0;
    },
};
