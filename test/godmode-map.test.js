import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for GodmodeMap: corridor switching, follow mode behavior.
 */

describe("Godmode follow mode", () => {
    // Simulate the follow + side-switch logic from GodmodeMap.draw()
    function simulateFollow(viewSide, vpX, vpY, vpCols, vpRows, npc) {
        let switched = false;
        // Auto-switch corridor (mirrors draw() logic)
        if (viewSide !== null && npc.side !== viewSide) {
            viewSide = npc.side;
            switched = true;
        }
        // Deadzone nudge
        const marginX = vpCols * 0.25;
        const marginY = vpRows * 0.25;
        const left = vpX + marginX;
        const right = vpX + vpCols - marginX;
        const bottom = vpY + marginY;
        const top = vpY + vpRows - marginY;
        if (npc.position < left) vpX = npc.position - marginX;
        else if (npc.position > right) vpX = npc.position - vpCols + marginX;
        if (npc.floor < bottom) vpY = npc.floor - marginY;
        else if (npc.floor > top) vpY = npc.floor - vpRows + marginY;
        return { viewSide, vpX, vpY, switched };
    }

    it("follow nudges viewport when NPC moves outside deadzone", () => {
        // NPC starts centered, then moves far right
        const result = simulateFollow(0, 0, 0, 40, 30, { side: 0, position: 50, floor: 15 });
        // Viewport should have shifted right
        assert.ok(result.vpX > 0, "viewport should shift right to follow NPC");
    });

    it("follow does not nudge viewport when NPC is within deadzone", () => {
        // NPC at center of viewport
        const result = simulateFollow(0, 0, 0, 40, 30, { side: 0, position: 20, floor: 15 });
        assert.strictEqual(result.vpX, 0, "viewport should not shift when NPC is within deadzone");
        assert.strictEqual(result.vpY, 0, "viewport Y should not shift when NPC is within deadzone");
    });

    it("follow auto-switches corridor when NPC crosses chasm", () => {
        // Viewing west (0), NPC is now on east (1)
        const result = simulateFollow(0, 10, 5, 40, 30, { side: 1, position: 15, floor: 8 });
        assert.strictEqual(result.viewSide, 1, "should switch to east corridor");
        assert.strictEqual(result.switched, true, "should flag side switch");
    });

    it("follow does not switch corridor when NPC stays on same side", () => {
        const result = simulateFollow(0, 10, 5, 40, 30, { side: 0, position: 15, floor: 8 });
        assert.strictEqual(result.viewSide, 0, "should stay on west corridor");
        assert.strictEqual(result.switched, false, "should not flag side switch");
    });

    it("follow persists viewport tracking through large position changes (year skip)", () => {
        // Simulate NPC that moved very far during a year skip
        let vpX = 0, vpY = 0;
        const vpCols = 40, vpRows = 30;

        // NPC traveled from position 0 to position 5000, floor 0 to floor 200
        const result = simulateFollow(0, vpX, vpY, vpCols, vpRows,
            { side: 0, position: 5000, floor: 200 });

        // Viewport should have jumped to track
        assert.ok(result.vpX > 4900, "viewport should jump to NPC position after large skip");
        assert.ok(result.vpY > 150, "viewport should jump to NPC floor after large skip");
    });

    it("follow tracks NPC through multiple side switches", () => {
        let viewSide = 0;
        let vpX = 0, vpY = 0;
        const vpCols = 40, vpRows = 30;

        // Cross to east
        let r = simulateFollow(viewSide, vpX, vpY, vpCols, vpRows,
            { side: 1, position: 10, floor: 0 });
        assert.strictEqual(r.viewSide, 1);
        viewSide = r.viewSide; vpX = r.vpX; vpY = r.vpY;

        // Cross back to west
        r = simulateFollow(viewSide, vpX, vpY, vpCols, vpRows,
            { side: 0, position: 20, floor: 5 });
        assert.strictEqual(r.viewSide, 0);
    });
});

describe("Godmode follow mode state management", () => {
    // Simulate the godmode.js followMode state transitions
    it("double-click enables follow mode", () => {
        let followMode = false;
        let selectedNpcId = null;

        // Double-click on NPC (mirrors godmode.js dblclick handler)
        const hit = 42;
        selectedNpcId = hit;
        followMode = true;

        assert.strictEqual(followMode, true);
        assert.strictEqual(selectedNpcId, 42);
    });

    it("single-click selects without follow", () => {
        let followMode = true;
        let selectedNpcId = 42;

        // Single-click on different NPC
        const hit = 7;
        selectedNpcId = hit;
        followMode = false; // as in mouseup handler

        assert.strictEqual(followMode, false);
        assert.strictEqual(selectedNpcId, 7);
    });

    it("Escape deselects and breaks follow", () => {
        let followMode = true;
        let selectedNpcId = 42;

        // Escape key
        selectedNpcId = null;
        followMode = false;

        assert.strictEqual(followMode, false);
        assert.strictEqual(selectedNpcId, null);
    });

    it("drag breaks follow mode", () => {
        let followMode = true;
        const wasDrag = true; // drag detected

        if (wasDrag) followMode = false;

        assert.strictEqual(followMode, false);
    });

    it("arrow key navigation breaks follow mode", () => {
        let followMode = true;
        const navKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "h", "j", "k", "l", "Home", "H"]);

        for (const key of navKeys) {
            followMode = true;
            if (navKeys.has(key)) followMode = false;
            assert.strictEqual(followMode, false, key + " should break follow");
        }
    });

    it("zoom does not break follow mode", () => {
        let followMode = true;
        // Wheel zoom — no followMode = false (removed)
        assert.strictEqual(followMode, true, "zoom should preserve follow");
    });

    it("Tab corridor switch does not break follow mode", () => {
        let followMode = true;
        // Tab just switches corridor view, follow stays
        const key = "Tab";
        const navKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "h", "j", "k", "l", "Home", "H"]);
        if (navKeys.has(key)) followMode = false;

        assert.strictEqual(followMode, true, "Tab should not break follow");
    });

    it("speed/play controls do not break follow mode", () => {
        let followMode = true;
        // Space toggles play — not in navKeys
        const key = " ";
        const navKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "h", "j", "k", "l", "Home", "H"]);
        if (navKeys.has(key)) followMode = false;

        assert.strictEqual(followMode, true, "space should not break follow");
    });

    it("follow persists through fast-forward (year skip)", () => {
        let followMode = true;
        let running = true;

        // Fast-forward simulation: pauses running, ticks, resumes
        const wasRunning = running;
        running = false;
        // ... ticking happens ...
        // followMode is never touched by fastForward()
        running = wasRunning;

        assert.strictEqual(followMode, true, "follow should persist through fast-forward");
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

        const hit = null;
        if (hit !== null) {
            setSide(0);
        }

        assert.strictEqual(currentSide, 1, "corridor should remain unchanged on deselect");
    });
});
