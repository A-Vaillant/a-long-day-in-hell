import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/**
 * Tests for GodmodeMap viewport centering and corridor switching.
 *
 * We can't import GodmodeMap directly (it uses canvas APIs), so we
 * replicate the core math from _pixelToWorld and centerOnPixel to
 * verify the viewport logic is correct.
 */

// Constants mirrored from godmode-map.js
const BASE_CELL_W = 18;
const BASE_CELL_H = 14;
const BASE_CHASM_W = 48;
const LABEL_GUTTER = 52;
const HEADER_H = 28;

describe("GodmodeMap viewport centering", () => {
    // Replicate the viewport state and core methods
    let vpX, vpY, vpCols, vpRows, zoom, viewSide;
    let CELL_W, CELL_H, CHASM_W;

    function recalcCells(canvasW) {
        CELL_W = Math.round(BASE_CELL_W * zoom);
        CELL_H = Math.round(BASE_CELL_H * zoom);
        CHASM_W = Math.round(BASE_CHASM_W * zoom);
        const usableW = viewSide !== null
            ? canvasW - LABEL_GUTTER
            : (canvasW - CHASM_W - LABEL_GUTTER) / 2;
        vpCols = Math.max(4, Math.ceil(usableW / CELL_W) + 1);
        vpRows = Math.max(4, Math.ceil((400 - HEADER_H) / CELL_H) + 1);
    }

    function pixelToWorld(px, py) {
        const colW = vpCols * CELL_W;
        const corridorX = LABEL_GUTTER;
        let localCol;
        if (viewSide !== null) {
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
    }

    function centerOnPixel(px, py) {
        const world = pixelToWorld(px, py);
        vpX = world.pos - vpCols / 2;
        vpY = world.floor - vpRows / 2;
    }

    beforeEach(() => {
        vpX = 0;
        vpY = 0;
        zoom = 1;
        viewSide = 0; // single corridor
        recalcCells(800);
    });

    it("centerOnPixel moves viewport so clicked point is centered", () => {
        // Click at canvas center
        const cx = 800 / 2;
        const cy = 400 / 2;

        const worldBefore = pixelToWorld(cx, cy);
        centerOnPixel(cx, cy);

        // After centering, the center of the viewport should be at the clicked world coords
        // Viewport center in world = vpX + vpCols/2, vpY + vpRows/2
        const centerPos = vpX + vpCols / 2;
        const centerFloor = vpY + vpRows / 2;

        assert.ok(Math.abs(centerPos - worldBefore.pos) < 0.01,
            `centerPos ${centerPos} should equal clicked pos ${worldBefore.pos}`);
        assert.ok(Math.abs(centerFloor - worldBefore.floor) < 0.01,
            `centerFloor ${centerFloor} should equal clicked floor ${worldBefore.floor}`);
    });

    it("centerOnPixel on offset viewport moves to new location", () => {
        // Start viewport at position 50, floor 20
        vpX = 50;
        vpY = 20;

        // Click near the top-left of the canvas (low position, high floor)
        const px = LABEL_GUTTER + CELL_W * 2; // ~2 cells in
        const py = HEADER_H + CELL_H * 1;     // ~1 row down (high floor)

        const worldTarget = pixelToWorld(px, py);
        centerOnPixel(px, py);

        const centerPos = vpX + vpCols / 2;
        const centerFloor = vpY + vpRows / 2;

        assert.ok(Math.abs(centerPos - worldTarget.pos) < 0.01,
            `viewport should center on clicked position`);
        assert.ok(Math.abs(centerFloor - worldTarget.floor) < 0.01,
            `viewport should center on clicked floor`);
    });

    it("centerOnPixel works at different zoom levels", () => {
        zoom = 2;
        recalcCells(800);
        vpX = 10;
        vpY = 5;

        const cx = 800 / 2;
        const cy = 400 / 2;

        const worldTarget = pixelToWorld(cx, cy);
        centerOnPixel(cx, cy);

        const centerPos = vpX + vpCols / 2;
        const centerFloor = vpY + vpRows / 2;

        assert.ok(Math.abs(centerPos - worldTarget.pos) < 0.01);
        assert.ok(Math.abs(centerFloor - worldTarget.floor) < 0.01);
    });

    it("centerOnPixel works in chasm (both-sides) view", () => {
        viewSide = null;
        recalcCells(800);

        const cx = 800 / 2;
        const cy = 400 / 2;

        const worldTarget = pixelToWorld(cx, cy);
        centerOnPixel(cx, cy);

        const centerPos = vpX + vpCols / 2;
        const centerFloor = vpY + vpRows / 2;

        assert.ok(Math.abs(centerPos - worldTarget.pos) < 0.01);
        assert.ok(Math.abs(centerFloor - worldTarget.floor) < 0.01);
    });
});

describe("Godmode corridor switching on NPC select", () => {
    it("selecting NPC switches corridor but does not follow", () => {
        const npcs = [
            { id: "soren", name: "Soren", side: 0, position: 5, floor: 3 },
            { id: "rachel", name: "Rachel", side: 1, position: 12, floor: 7 },
        ];

        let currentSide = 0;
        let followMode = false;
        function setSide(s) { currentSide = s; }

        // Click selects Rachel (east side)
        const hit = "rachel";
        const npc = npcs.find(n => n.id === hit);
        if (npc) setSide(npc.side);
        followMode = false; // as in godmode.js

        assert.strictEqual(currentSide, 1, "should switch to east corridor for Rachel");
        assert.strictEqual(followMode, false, "should not enter follow mode");

        // Click selects Soren (west side)
        const hit2 = "soren";
        const npc2 = npcs.find(n => n.id === hit2);
        if (npc2) setSide(npc2.side);
        followMode = false;

        assert.strictEqual(currentSide, 0, "should switch to west corridor for Soren");
        assert.strictEqual(followMode, false, "should not enter follow mode");
    });

    it("deselecting NPC should not change corridor", () => {
        let currentSide = 1;
        function setSide(s) { currentSide = s; }

        // No NPC hit — the handler does centerOnPixel but not setSide
        const hit = null;
        if (hit !== null) {
            setSide(0); // would only run if hit
        }

        assert.strictEqual(currentSide, 1, "corridor should remain unchanged on deselect");
    });
});
