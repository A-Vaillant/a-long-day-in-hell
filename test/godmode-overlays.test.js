import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSearchOverlay } from "../src/js/godmode-overlays.js";

describe("createSearchOverlay", () => {
    it("returns overlay with draw method and npcId", () => {
        const ov = createSearchOverlay({
            npcId: 7,
            npcName: "Rachel",
            segments: [{ side: 0, pos: 10, floor: 50 }],
            bookCoords: null,
            bookVision: null,
            visionAccurate: false,
        });
        assert.strictEqual(ov.npcId, 7);
        assert.strictEqual(typeof ov.draw, "function");
    });

    it("draw calls ctx methods for searched cells", () => {
        const ov = createSearchOverlay({
            npcId: 1,
            npcName: "Soren",
            segments: [
                { side: 0, pos: 5, floor: 10 },
                { side: 0, pos: 6, floor: 10 },
                { side: 1, pos: 5, floor: 10 },
            ],
            bookCoords: null,
            bookVision: null,
            visionAccurate: false,
        });

        const calls = [];
        const ctx = {
            fillStyle: "",
            strokeStyle: "",
            lineWidth: 0,
            font: "",
            textAlign: "",
            fillRect: (x, y, w, h) => calls.push({ fn: "fillRect", x, y, w, h }),
            fillText: (t, x, y) => calls.push({ fn: "fillText", t }),
            beginPath: () => {},
            arc: () => {},
            fill: () => {},
            stroke: () => {},
            moveTo: () => {},
            lineTo: () => {},
        };
        const view = {
            worldToPixelX: (pos, side) => pos * 18 + side * 500,
            worldToPixelY: (floor) => (100 - floor) * 14,
            scatter: false,
            zoom: 1,
            viewSide: null, // show both sides
            CELL_W: 18,
            CELL_H: 14,
            LABEL_GUTTER: 52,
            gridH: 600,
        };

        ov.draw(ctx, view);

        // Should have fillRect calls for 3 segments + label fillText
        const rects = calls.filter(c => c.fn === "fillRect");
        assert.strictEqual(rects.length, 3, "should render 3 segment cells");
        const texts = calls.filter(c => c.fn === "fillText");
        assert.strictEqual(texts.length, 1, "should render label");
        assert.ok(texts[0].t.includes("Soren"), "label should include NPC name");
        assert.ok(texts[0].t.includes("3"), "label should include segment count");
    });

    it("draw filters segments by viewSide", () => {
        const ov = createSearchOverlay({
            npcId: 1,
            npcName: "Test",
            segments: [
                { side: 0, pos: 5, floor: 10 },
                { side: 1, pos: 5, floor: 10 },
            ],
            bookCoords: null,
            bookVision: null,
            visionAccurate: false,
        });

        const rects = [];
        const ctx = {
            fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "",
            fillRect: (x, y, w, h) => rects.push({ x, y, w, h }),
            fillText: () => {},
            beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
            moveTo: () => {}, lineTo: () => {},
        };
        const view = {
            worldToPixelX: (pos, side) => pos * 18,
            worldToPixelY: (floor) => floor * 14,
            scatter: false, zoom: 1,
            viewSide: 0, // west only
            CELL_W: 18, CELL_H: 14, LABEL_GUTTER: 52, gridH: 600,
        };

        ov.draw(ctx, view);
        assert.strictEqual(rects.length, 1, "should only render west-side segment");
    });

    it("draw renders book location marker", () => {
        const ov = createSearchOverlay({
            npcId: 1,
            npcName: "Test",
            segments: [{ side: 0, pos: 5, floor: 10 }],
            bookCoords: { side: 0, position: 20n, floor: 60n },
            bookVision: null,
            visionAccurate: false,
        });

        const arcs = [];
        const ctx = {
            fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "",
            fillRect: () => {},
            fillText: () => {},
            beginPath: () => {},
            arc: (x, y, r) => arcs.push({ x, y, r }),
            fill: () => {},
            stroke: () => {},
            moveTo: () => {},
            lineTo: () => {},
        };
        const view = {
            worldToPixelX: (pos) => pos * 18,
            worldToPixelY: (floor) => (100 - floor) * 14,
            scatter: false, zoom: 1,
            viewSide: null,
            CELL_W: 18, CELL_H: 14, LABEL_GUTTER: 52, gridH: 600,
        };

        ov.draw(ctx, view);
        // Should have arcs for book marker (fill + ring = 2 arcs)
        assert.ok(arcs.length >= 2, "should render book marker arcs");
    });

    it("draw renders vision cross marker", () => {
        const ov = createSearchOverlay({
            npcId: 1,
            npcName: "Test",
            segments: [{ side: 0, pos: 5, floor: 10 }],
            bookCoords: null,
            bookVision: { side: 0, position: 15n, floor: 30n },
            visionAccurate: true,
        });

        const lines = [];
        const ctx = {
            fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "",
            fillRect: () => {},
            fillText: () => {},
            beginPath: () => {},
            arc: () => {},
            fill: () => {},
            stroke: () => {},
            moveTo: (x, y) => lines.push({ fn: "moveTo", x, y }),
            lineTo: (x, y) => lines.push({ fn: "lineTo", x, y }),
        };
        const view = {
            worldToPixelX: (pos) => pos * 18,
            worldToPixelY: (floor) => (100 - floor) * 14,
            scatter: false, zoom: 1,
            viewSide: null,
            CELL_W: 18, CELL_H: 14, LABEL_GUTTER: 52, gridH: 600,
        };

        ov.draw(ctx, view);
        // Cross = 2 moveTo + 2 lineTo
        const moves = lines.filter(l => l.fn === "moveTo");
        assert.ok(moves.length >= 2, "should draw cross with at least 2 moveTo calls");
    });

    it("draw uses scatter mode for small cells", () => {
        const ov = createSearchOverlay({
            npcId: 1,
            npcName: "Test",
            segments: [{ side: 0, pos: 5, floor: 10 }],
            bookCoords: null,
            bookVision: null,
            visionAccurate: false,
        });

        const rects = [];
        const ctx = {
            fillStyle: "", strokeStyle: "", lineWidth: 0, font: "", textAlign: "",
            fillRect: (x, y, w, h) => rects.push({ w, h }),
            fillText: () => {},
            beginPath: () => {}, arc: () => {}, fill: () => {}, stroke: () => {},
            moveTo: () => {}, lineTo: () => {},
        };
        const view = {
            worldToPixelX: (pos) => pos * 2,
            worldToPixelY: (floor) => floor * 1.4,
            scatter: true, zoom: 0.1,
            viewSide: null,
            CELL_W: 2, CELL_H: 1.4, LABEL_GUTTER: 52, gridH: 600,
        };

        ov.draw(ctx, view);
        // In scatter mode, cells should be small dots, not full CELL_W
        assert.ok(rects[0].w <= 2, "scatter cells should be small");
    });
});

describe("Godmode overlay API (unit logic)", () => {
    // Test the overlay Map contract directly — mirrors GodmodeMap's overlay management
    it("set/has/remove lifecycle", () => {
        const overlays = new Map();
        const ov = { draw() {} };

        overlays.set("test", ov);
        assert.ok(overlays.has("test"));

        overlays.delete("test");
        assert.ok(!overlays.has("test"));
    });

    it("toggle adds then removes", () => {
        const overlays = new Map();
        const ov = { draw() {} };

        // Toggle on
        if (overlays.has("k")) { overlays.delete("k"); } else { overlays.set("k", ov); }
        assert.ok(overlays.has("k"), "first toggle should add");

        // Toggle off
        if (overlays.has("k")) { overlays.delete("k"); } else { overlays.set("k", ov); }
        assert.ok(!overlays.has("k"), "second toggle should remove");
    });

    it("multiple overlays coexist by key", () => {
        const overlays = new Map();
        overlays.set("search:1", { draw() {} });
        overlays.set("search:2", { draw() {} });
        overlays.set("other", { draw() {} });

        assert.strictEqual(overlays.size, 3);
        overlays.delete("search:1");
        assert.strictEqual(overlays.size, 2);
        assert.ok(overlays.has("search:2"));
        assert.ok(overlays.has("other"));
    });
});
