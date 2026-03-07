/* Godmode map — canvas renderer for the chasm cross-section.
 *
 * Layout: two columns (west/east) with a chasm gap between them.
 * Each cell = one segment at one floor. NPCs are colored dots.
 * Viewport scrolls to follow selected NPC or pans manually.
 */

const BASE_CELL_W = 12;
const BASE_CELL_H = 8;
const BASE_CHASM_W = 40;
const REST_EVERY = 10;

// Zoom
const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
let zoomIndex = 3;  // start at 1x
let zoom = 1;

// Derived from zoom
let CELL_W = BASE_CELL_W;
let CELL_H = BASE_CELL_H;
let CHASM_W = BASE_CHASM_W;

// Viewport in world coords (position, floor) — fractional for smooth pan
let vpX = 0;
let vpY = 0;
let vpCols = 40;
let vpRows = 30;
let canvas = null;
let ctx = null;
let startFloor = 0;

// Mouse drag state
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragVpX = 0;
let dragVpY = 0;

// NPC hit targets for click detection
let hitTargets = []; // { id, x, y, r }

const DISP_COLORS = {
    calm:      "#b8a878",
    anxious:   "#c49530",
    mad:       "#9a2a2a",
    catatonic: "#555555",
    dead:      "#2a2a2a",
};

// Muted distinct colors for group enclosures (hex without alpha — alpha appended in draw)
const GROUP_COLORS = [
    "#b8a878", // gold
    "#7a9a6a", // sage
    "#6a7a9a", // slate blue
    "#9a6a7a", // dusty rose
    "#8a8a6a", // olive
    "#6a8a8a", // teal
    "#9a7a5a", // bronze
    "#7a6a9a", // muted purple
];

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
        this._recalcCells();
    },

    _recalcCells() {
        CELL_W = Math.round(BASE_CELL_W * zoom);
        CELL_H = Math.round(BASE_CELL_H * zoom);
        CHASM_W = Math.round(BASE_CHASM_W * zoom);
        if (!canvas) return;
        const usableW = (canvas.width - CHASM_W) / 2;
        vpCols = Math.max(4, Math.ceil(usableW / CELL_W) + 1);
        vpRows = Math.max(4, Math.ceil(canvas.height / CELL_H) + 1);
    },

    /** Zoom in/out, centering on the given pixel coords (or canvas center). */
    zoom(delta, pivotX, pivotY) {
        if (pivotX === undefined) { pivotX = canvas.width / 2; pivotY = canvas.height / 2; }

        // World coords under pivot before zoom
        const colW = vpCols * CELL_W;
        const worldPosBefore = this._pixelToWorld(pivotX, pivotY);

        const oldIndex = zoomIndex;
        zoomIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIndex + delta));
        if (zoomIndex === oldIndex) return;
        zoom = ZOOM_LEVELS[zoomIndex];
        this._recalcCells();

        // World coords under pivot after zoom — adjust vpX/vpY to keep same world point under cursor
        const worldPosAfter = this._pixelToWorld(pivotX, pivotY);
        vpX += worldPosBefore.pos - worldPosAfter.pos;
        vpY += worldPosBefore.floor - worldPosAfter.floor;
    },

    /** Convert pixel coords to world (position, floor). */
    _pixelToWorld(px, py) {
        const colW = vpCols * CELL_W;
        // Determine which side/column the pixel is in
        let localCol;
        if (px < colW) {
            localCol = px / CELL_W;
        } else if (px >= colW + CHASM_W) {
            localCol = (px - colW - CHASM_W) / CELL_W;
        } else {
            localCol = vpCols / 2; // chasm center
        }
        const pos = vpX + localCol;
        const row = py / CELL_H;
        const floor = vpY + (vpRows - 1) - row;
        return { pos, floor };
    },

    /** Start a drag-pan. */
    dragStart(px, py) {
        dragging = true;
        dragStartX = px;
        dragStartY = py;
        dragVpX = vpX;
        dragVpY = vpY;
    },

    /** Continue drag-pan. */
    dragMove(px, py) {
        if (!dragging) return;
        const dx = px - dragStartX;
        const dy = py - dragStartY;
        vpX = dragVpX - dx / CELL_W;
        vpY = dragVpY + dy / CELL_H;  // screen Y is inverted from world floor
    },

    /** End drag-pan. Returns true if there was meaningful drag (to suppress click). */
    dragEnd(px, py) {
        if (!dragging) return false;
        dragging = false;
        const dx = Math.abs(px - dragStartX);
        const dy = Math.abs(py - dragStartY);
        return dx > 3 || dy > 3;  // threshold to distinguish drag from click
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
            const floor = Math.floor(vpY) + vpRows - 1 - row;
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
                const pos = Math.floor(vpX + col);
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

        // Collect NPC screen positions and group memberships
        const npcScreenPos = []; // { npc, cx, cy, r }
        const groups = new Map(); // groupId → [{ cx, cy }]

        for (const npc of snap.npcs) {
            const col = npc.position - Math.floor(vpX);
            const row = vpRows - 1 - (npc.floor - Math.floor(vpY));

            if (col < 0 || col >= vpCols || row < 0 || row >= vpRows) continue;

            const baseX = npc.side === 0 ? westX : eastX;
            const cx = baseX + col * CELL_W + CELL_W / 2;
            const cy = row * CELL_H + CELL_H / 2;
            const r = Math.max(2, Math.round(3 * zoom));

            npcScreenPos.push({ npc, cx, cy, r });

            if (npc.groupId !== null && npc.groupId !== undefined) {
                let list = groups.get(npc.groupId);
                if (!list) { list = []; groups.set(npc.groupId, list); }
                list.push({ cx, cy });
            }
        }

        // Draw group enclosures (behind NPCs)
        for (const [groupId, members] of groups) {
            if (members.length < 2) continue;
            const color = GROUP_COLORS[groupId % GROUP_COLORS.length];
            const pad = Math.max(6, Math.round(8 * zoom));

            // Bounding box of members
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const m of members) {
                if (m.cx < minX) minX = m.cx;
                if (m.cy < minY) minY = m.cy;
                if (m.cx > maxX) maxX = m.cx;
                if (m.cy > maxY) maxY = m.cy;
            }

            const rx = minX - pad;
            const ry = minY - pad;
            const rw = maxX - minX + pad * 2;
            const rh = maxY - minY + pad * 2;
            const corner = Math.min(pad, 6);

            // Filled enclosure
            ctx.fillStyle = color + "15"; // ~8% opacity
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, corner);
            ctx.fill();

            // Border
            ctx.strokeStyle = color + "40"; // ~25% opacity
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, corner);
            ctx.stroke();
        }

        // Draw NPCs
        for (const { npc, cx, cy, r } of npcScreenPos) {
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

            hitTargets.push({ id: npc.id, x: cx, y: cy, r: r + 4 });
        }

        // Update controls display
        const dayEl = document.getElementById("gm-day");
        const tickEl = document.getElementById("gm-tick");
        if (dayEl) dayEl.textContent = "Day " + (snap.day - 1);
        if (tickEl) {
            // Convert tick to time (0=6am, 160=10pm, 240=6am next)
            const totalMinutes = (snap.tick / 240) * 24 * 60 + 6 * 60;
            const hours = Math.floor(totalMinutes / 60) % 24;
            const mins = Math.floor(totalMinutes % 60);
            tickEl.textContent = String(hours).padStart(2, "0") + ":" + String(mins).padStart(2, "0");
        }

        // Zoom display
        const zoomEl = document.getElementById("gm-zoom");
        if (zoomEl) zoomEl.textContent = zoom + "x";

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
        const step = Math.max(1, Math.round(3 / zoom));
        if (key === "ArrowLeft" || key === "h") vpX -= step;
        else if (key === "ArrowRight" || key === "l") vpX += step;
        else if (key === "ArrowUp" || key === "k") vpY += step;
        else if (key === "ArrowDown" || key === "j") vpY -= step;
        else if (key === "+" || key === "=") this.zoom(1);
        else if (key === "-" || key === "_") this.zoom(-1);
    },

    /** Current zoom level for display. */
    getZoom() { return zoom; },
};
