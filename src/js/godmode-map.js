/* Godmode map — canvas renderer for the chasm cross-section.
 *
 * Layout: two columns (west/east) with a chasm gap between them.
 * Each cell = one segment at one floor. NPCs are colored dots.
 * Viewport scrolls to follow selected NPC or pans manually.
 */

const BASE_CELL_W = 18;
const BASE_CELL_H = 14;
const BASE_CHASM_W = 48;
const REST_EVERY = 10;
const LABEL_GUTTER = 52; // floor number labels on left
const HEADER_H = 28;     // reserved header strip for view title

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

// Side view: null = chasm (both), 0 = west only, 1 = east only
let viewSide = 0;   // default: player's starting corridor
let startSide = 0;

// Mouse drag state
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragVpX = 0;
let dragVpY = 0;

// NPC hit targets for click detection
let hitTargets = []; // { id, x, y, r }

const DISP_COLORS = {
    calm:      "#d4c898",
    anxious:   "#e0b040",
    mad:       "#d04040",
    catatonic: "#707070",
    dead:      "#3a3a3a",
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
        startSide = state.side;
        viewSide = state.side;  // default to player's corridor
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
        const usableW = viewSide !== null
            ? canvas.width - LABEL_GUTTER           // single side: full width
            : (canvas.width - CHASM_W - LABEL_GUTTER) / 2;  // both sides: split
        vpCols = Math.max(4, Math.ceil(usableW / CELL_W) + 1);
        vpRows = Math.max(4, Math.ceil((canvas.height - HEADER_H) / CELL_H) + 1);
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
        const corridorX = LABEL_GUTTER;
        let localCol;
        if (viewSide !== null) {
            // Single side — one corridor fills the canvas
            localCol = (px - corridorX) / CELL_W;
        } else {
            const chasmX = corridorX + colW;
            const eastX = chasmX + CHASM_W;
            if (px < chasmX) {
                localCol = (px - corridorX) / CELL_W;
            } else if (px >= eastX) {
                localCol = (px - eastX) / CELL_W;
            } else {
                localCol = vpCols / 2;
            }
        }
        const pos = vpX + localCol;
        const row = (py - HEADER_H) / CELL_H;
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
        // Chasm view: vertical drag only
        if (viewSide !== null) vpX = dragVpX - dx / CELL_W;
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

        // Chasm view: lock horizontal viewport (both corridors share the same column space)
        const showBoth = viewSide === null;
        if (showBoth && !follow) {
            vpX = -Math.floor(vpCols / 2);  // center on position 0
        }

        // Clear
        ctx.fillStyle = snap.lightsOn ? "#0a0906" : "#050403";
        ctx.fillRect(0, 0, w, h);

        hitTargets = [];

        // --- Header strip ---
        ctx.fillStyle = "#0d0b08";
        ctx.fillRect(0, 0, w, HEADER_H);
        ctx.strokeStyle = "#2a2418";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, HEADER_H);
        ctx.lineTo(w, HEADER_H);
        ctx.stroke();

        const titleSize = 16;
        ctx.font = "bold " + titleSize + "px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";

        // Compute column widths with label gutter
        const colW = vpCols * CELL_W;
        const corridorX = LABEL_GUTTER;

        // In single-side mode, no chasm or second column
        const chasmX = showBoth ? corridorX + colW : -1;
        const eastX = showBoth ? chasmX + CHASM_W : -1;
        // For single-side: westX is always corridorX, eastX not used
        const westX = corridorX;

        if (showBoth) {
            // Header: WEST — CHASM — EAST
            ctx.fillStyle = "#6a6050";
            ctx.fillText("WEST", westX + colW / 2, HEADER_H / 2 + titleSize / 3);
            ctx.fillText("EAST", eastX + colW / 2, HEADER_H / 2 + titleSize / 3);
            ctx.fillStyle = "#4a4030";
            ctx.font = "bold 11px 'Share Tech Mono', monospace";
            ctx.fillText("CHASM", chasmX + CHASM_W / 2, HEADER_H / 2 + 4);
        } else {
            const sideName = viewSide === 0 ? "WEST" : "EAST";
            const corNum = viewSide === startSide ? "1" : "2";
            ctx.fillStyle = "#8a7a60";
            ctx.fillText("CORRIDOR " + corNum + "  ·  " + sideName, w / 2, HEADER_H / 2 + titleSize / 3);
        }

        // Offset all grid drawing below header
        ctx.save();
        ctx.translate(0, HEADER_H);
        const gridH = h - HEADER_H;

        if (showBoth) {
            // Draw chasm — darker with subtle gradient edges
            ctx.fillStyle = "#020201";
            ctx.fillRect(chasmX, 0, CHASM_W, gridH);
            ctx.strokeStyle = "#2a2218";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(chasmX, 0); ctx.lineTo(chasmX, gridH);
            ctx.moveTo(eastX, 0); ctx.lineTo(eastX, gridH);
            ctx.stroke();
        }

        // Floor label font
        const floorFontSize = Math.max(8, Math.round(9 * zoom));
        ctx.font = floorFontSize + "px 'Share Tech Mono', monospace";
        ctx.textAlign = "right";

        // Determine floor label interval based on zoom
        const floorLabelEvery = zoom < 0.35 ? 20 : zoom < 0.6 ? 10 : zoom < 2 ? 5 : 1;

        // Draw grid lines, rest areas, and floor labels
        for (let row = 0; row < vpRows; row++) {
            const floor = Math.floor(vpY) + vpRows - 1 - row;
            const y = row * CELL_H;

            // Floor line
            ctx.strokeStyle = "#201c14";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(corridorX, y);
            ctx.lineTo(corridorX + colW, y);
            if (showBoth) {
                ctx.moveTo(eastX, y);
                ctx.lineTo(eastX + colW, y);
            }
            ctx.stroke();

            // Floor number label in gutter
            if (floor >= 0 && floor % floorLabelEvery === 0) {
                ctx.fillStyle = floor % 10 === 0 ? "#6a6050" : "#3a3428";
                ctx.fillText(String(floor), LABEL_GUTTER - 6, y + CELL_H / 2 + floorFontSize / 3);
            }

            for (let col = 0; col < vpCols; col++) {
                const pos = Math.floor(vpX + col);

                // Rest area highlight
                if (pos % REST_EVERY === 0) {
                    ctx.fillStyle = snap.lightsOn ? "#16130c" : "#0c0a06";
                    ctx.fillRect(corridorX + col * CELL_W, y, CELL_W, CELL_H);
                    if (showBoth) {
                        ctx.fillRect(eastX + col * CELL_W, y, CELL_W, CELL_H);
                    }
                }
            }

            // Bridge at floor 0 (only in both-sides view)
            if (showBoth && floor === 0) {
                ctx.fillStyle = "#3a3020";
                ctx.fillRect(chasmX, y, CHASM_W, CELL_H);
                ctx.strokeStyle = "#4a4030";
                ctx.lineWidth = 0.5;
                for (let bx = chasmX; bx < eastX; bx += 6) {
                    ctx.beginPath();
                    ctx.moveTo(bx, y); ctx.lineTo(bx + 6, y + CELL_H);
                    ctx.stroke();
                }
            }
        }

        // Position labels along the top of grid area — rest area kiosk numbers
        const posFontSize = Math.max(9, Math.round(11 * zoom));
        const posLabelY = posFontSize + 4;
        ctx.font = posFontSize + "px 'Share Tech Mono', monospace";
        ctx.textAlign = "center";
        for (let col = 0; col < vpCols; col++) {
            const pos = Math.floor(vpX + col);
            if (pos % REST_EVERY !== 0) continue;
            const px = corridorX + col * CELL_W + CELL_W / 2;
            const label = String(pos);
            const tw = ctx.measureText(label).width;
            // Background pill for readability
            ctx.fillStyle = snap.lightsOn ? "#0a0906" : "#050403";
            ctx.fillRect(px - tw / 2 - 3, posLabelY - posFontSize, tw + 6, posFontSize + 4);
            ctx.fillStyle = "#b8a878";
            ctx.fillText(label, px, posLabelY);
            // Dashed vertical guide line
            ctx.strokeStyle = "#2a2418";
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(px, posLabelY + 4);
            ctx.lineTo(px, gridH);
            ctx.stroke();
            ctx.setLineDash([]);
            if (showBoth) {
                const epx = eastX + col * CELL_W + CELL_W / 2;
                ctx.fillStyle = snap.lightsOn ? "#0a0906" : "#050403";
                ctx.fillRect(epx - tw / 2 - 3, posLabelY - posFontSize, tw + 6, posFontSize + 4);
                ctx.fillStyle = "#b8a878";
                ctx.fillText(label, epx, posLabelY);
                ctx.strokeStyle = "#2a2418";
                ctx.lineWidth = 1;
                ctx.setLineDash([2, 4]);
                ctx.beginPath();
                ctx.moveTo(epx, posLabelY + 4);
                ctx.lineTo(epx, gridH);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        // Collect NPC screen positions and group data
        const dotR = Math.max(3, Math.round(4.5 * zoom));
        const nameFontSize = Math.max(8, Math.round(9 * zoom));
        const npcScreenPos = [];
        const groups = new Map();

        // Collect NPCs by cell to cluster co-located ones
        const cellBuckets = new Map(); // "side,pos,floor" → [npc, ...]
        for (const npc of snap.npcs) {
            if (viewSide !== null && npc.side !== viewSide) continue;
            const col = npc.position - Math.floor(vpX);
            const row = vpRows - 1 - (npc.floor - Math.floor(vpY));
            if (col < 0 || col >= vpCols || row < 0 || row >= vpRows) continue;
            const key = npc.side + "," + npc.position + "," + npc.floor;
            let bucket = cellBuckets.get(key);
            if (!bucket) { bucket = []; cellBuckets.set(key, bucket); }
            bucket.push({ npc, col, row });
        }

        for (const [, bucket] of cellBuckets) {
            const n = bucket.length;
            for (let i = 0; i < n; i++) {
                const { npc, col, row } = bucket[i];
                const baseX = showBoth
                    ? (npc.side === 0 ? westX : eastX)
                    : corridorX;
                let cx = baseX + col * CELL_W + CELL_W / 2;
                let cy = row * CELL_H + CELL_H / 2;

                // Spread co-located NPCs in a circle around cell center
                if (n > 1) {
                    const spread = Math.min(dotR * 1.4, CELL_W * 0.35, CELL_H * 0.35);
                    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
                    cx += Math.cos(angle) * spread;
                    cy += Math.sin(angle) * spread;
                }

                const color = DISP_COLORS[npc.disposition] || DISP_COLORS.calm;
                npcScreenPos.push({ npc, cx, cy, color });

                if (npc.groupId !== null && npc.groupId !== undefined) {
                    let list = groups.get(npc.groupId);
                    if (!list) { list = []; groups.set(npc.groupId, list); }
                    list.push({ cx, cy });
                }
            }
        }

        // Draw group enclosures (behind NPCs)
        for (const [groupId, members] of groups) {
            if (members.length < 2) continue;
            const gColor = GROUP_COLORS[groupId % GROUP_COLORS.length];
            const pad = Math.max(6, Math.round(8 * zoom));

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

            ctx.fillStyle = gColor + "15";
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, corner);
            ctx.fill();

            ctx.strokeStyle = gColor + "40";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(rx, ry, rw, rh, corner);
            ctx.stroke();
        }

        // Draw NPCs
        for (const { npc, cx, cy, color } of npcScreenPos) {
            // Glow
            ctx.fillStyle = color.slice(0, 7) + "40";
            ctx.beginPath();
            ctx.arc(cx, cy, dotR + 3, 0, Math.PI * 2);
            ctx.fill();

            // Dot
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
            ctx.fill();

            // Selection ring + name (selected only)
            if (npc.id === selectedId) {
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cx, cy, dotR + 3, 0, Math.PI * 2);
                ctx.stroke();

                ctx.font = "bold " + nameFontSize + "px 'Share Tech Mono', monospace";
                ctx.fillStyle = "#ffffff";
                ctx.textAlign = "center";
                ctx.fillText(npc.name, cx, cy - dotR - 5);
            }

            // Group indicator ring
            if (npc.groupId !== null && npc.groupId !== undefined) {
                ctx.strokeStyle = "rgba(184, 168, 120, 0.5)";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.arc(cx, cy, dotR + 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
            }

            hitTargets.push({ id: npc.id, x: cx, y: cy + HEADER_H, r: dotR + 6 });
        }

        ctx.restore(); // end grid translation

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
        // Chasm view: vertical only
        if (key === "ArrowLeft" || key === "h") { if (viewSide !== null) vpX -= step; }
        else if (key === "ArrowRight" || key === "l") { if (viewSide !== null) vpX += step; }
        else if (key === "ArrowUp" || key === "k") vpY += step;
        else if (key === "ArrowDown" || key === "j") vpY -= step;
        else if (key === "+" || key === "=") this.zoom(1);
        else if (key === "-" || key === "_") this.zoom(-1);
        else if (key === "Tab") {
            // Cycle: corridor 1 (start side) → corridor 2 → chasm (both)
            const otherSide = startSide === 0 ? 1 : 0;
            if (viewSide === startSide) viewSide = otherSide;
            else if (viewSide === otherSide) viewSide = null;
            else viewSide = startSide;
            this._recalcCells();
        }
    },

    /** Current zoom level for display. */
    getZoom() { return zoom; },

    /** Set zoom to nearest available level. */
    setZoom(level) {
        let best = 0;
        for (let i = 0; i < ZOOM_LEVELS.length; i++) {
            if (Math.abs(ZOOM_LEVELS[i] - level) < Math.abs(ZOOM_LEVELS[best] - level)) best = i;
        }
        zoomIndex = best;
        zoom = ZOOM_LEVELS[zoomIndex];
        this._recalcCells();
    },

    /** Set viewport origin (position, floor). Undefined values keep current. */
    setViewport(x, y) {
        if (x !== undefined) vpX = x;
        if (y !== undefined) vpY = y;
    },

    /** Center viewport on a pixel coordinate (converts to world coords). */
    centerOnPixel(px, py) {
        const world = this._pixelToWorld(px, py);
        vpX = world.pos - vpCols / 2;
        vpY = world.floor - vpRows / 2;
    },

    /** Set side view: 0=west, 1=east, null=both. */
    setSide(s) {
        viewSide = s;
        this._recalcCells();
    },
};
