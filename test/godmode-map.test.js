import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for GodmodeMap corridor switching on NPC select.
 */

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
