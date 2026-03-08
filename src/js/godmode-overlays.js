/* Godmode map overlay factories.
 *
 * Each factory returns an object with:
 *   draw(ctx, view)  — render onto the godmode canvas
 *
 * view: { worldToPixelX, worldToPixelY, scatter, zoom, viewSide,
 *         CELL_W, CELL_H, LABEL_GUTTER, gridH }
 */

/**
 * Search coverage overlay — highlights segments an NPC has searched,
 * plus book location and vision markers.
 *
 * @param {object} opts
 * @param {number} opts.npcId
 * @param {string} opts.npcName
 * @param {Array<{side:number, pos:number, floor:number}>} opts.segments
 * @param {{side:number, position:*, floor:*}|null} opts.bookCoords
 * @param {{side:number, position:*, floor:*}|null} opts.bookVision
 * @param {boolean} opts.visionAccurate
 */
export function createSearchOverlay(opts) {
    const { npcId, npcName, segments, bookCoords, bookVision, visionAccurate } = opts;

    return {
        npcId,
        draw(ctx, view) {
            const { worldToPixelX, worldToPixelY, scatter, zoom, viewSide, CELL_W, CELL_H, LABEL_GUTTER } = view;

            // Searched cells
            ctx.fillStyle = "rgba(58, 90, 58, 0.45)";
            for (const seg of segments) {
                if (viewSide !== null && seg.side !== viewSide) continue;
                const px = worldToPixelX(seg.pos, seg.side);
                const py = worldToPixelY(seg.floor);
                if (scatter) {
                    const r = Math.max(1, CELL_W * 0.6);
                    ctx.fillRect(px - r / 2, py - r / 2, r, r);
                } else {
                    ctx.fillRect(px - CELL_W / 2, py - CELL_H / 2, CELL_W, CELL_H);
                }
            }

            // Book location
            if (bookCoords && (viewSide === null || bookCoords.side === viewSide)) {
                const bx = worldToPixelX(Number(bookCoords.position), bookCoords.side);
                const by = worldToPixelY(Number(bookCoords.floor));
                const r = Math.max(3, Math.round(5 * zoom));
                ctx.fillStyle = "#60d060";
                ctx.beginPath();
                ctx.arc(bx, by, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "rgba(96, 208, 96, 0.5)";
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(bx, by, r + 3, 0, Math.PI * 2);
                ctx.stroke();
            }

            // Vision location (cross marker)
            if (bookVision && (viewSide === null || bookVision.side === viewSide)) {
                const vx = worldToPixelX(Number(bookVision.position), bookVision.side);
                const vy = worldToPixelY(Number(bookVision.floor));
                const r = Math.max(3, Math.round(5 * zoom));
                ctx.strokeStyle = visionAccurate ? "#60d060" : "#d04040";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(vx - r, vy - r); ctx.lineTo(vx + r, vy + r);
                ctx.moveTo(vx + r, vy - r); ctx.lineTo(vx - r, vy + r);
                ctx.stroke();
            }

            // Label — draw in the header banner (negative y to escape grid translation)
            ctx.fillStyle = "rgba(96, 208, 96, 0.7)";
            ctx.font = "bold 10px 'Share Tech Mono', monospace";
            ctx.textAlign = "left";
            ctx.fillText(npcName + " search (" + segments.length + ")", LABEL_GUTTER + 4, -8);
        },
    };
}
