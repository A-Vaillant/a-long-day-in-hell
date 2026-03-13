import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY } from "../lib/social.core.ts";
import { NEEDS } from "../lib/needs.core.ts";
import { MOVEMENT, movementSystem, DEFAULT_MOVEMENT } from "../lib/movement.core.ts";
import { INTENT } from "../lib/intent.core.ts";
import { KNOWLEDGE, markSearched } from "../lib/knowledge.core.ts";
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";

const G = GALLERIES_PER_SEGMENT; // bigint, rest areas at 0, G, 2G, 3G, ...
const Gn = Number(G);           // numeric form for loop bounds

function makeRng(values) {
    let i = 0;
    return { next() { return values[i++ % values.length]; } };
}

function makeNpc(world, {
    position = 0n, floor = 0n, side = 0, alive = true,
    behavior = "explore", heading = 1, withKnowledge = false,
} = {}) {
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name: "Test", alive });
    addComponent(world, e, POSITION, { side, position, floor });
    addComponent(world, e, PSYCHOLOGY, { lucidity: 100, hope: 100 });
    addComponent(world, e, NEEDS, { hunger: 0, thirst: 0, exhaustion: 0 });
    addComponent(world, e, MOVEMENT, { targetPosition: null, heading });
    addComponent(world, e, INTENT, { behavior, cooldown: 0, elapsed: 0 });
    if (withKnowledge) {
        addComponent(world, e, KNOWLEDGE, {
            lifeStory: null, bookVision: null,
            visionAccurate: true, hasBook: false,
            searchedSegments: new Set(),
        });
    }
    return e;
}

describe("movementSystem", () => {
    it("idle NPCs do not move", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5n, behavior: "idle" });
        movementSystem(w, makeRng([0.5]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 5n);
    });

    it("dead NPCs do not move", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5n, alive: false, behavior: "explore" });
        movementSystem(w, makeRng([0.5]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 5n);
    });

    // --- Explore ---

    it("explore NPC moves 1 step in heading direction", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5n, heading: 1, behavior: "explore" });
        movementSystem(w, makeRng([0.5]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 6n);
    });

    it("explore NPC moves left with heading -1", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5n, heading: -1, behavior: "explore" });
        movementSystem(w, makeRng([0.5]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 4n);
    });

    it("explore heading reverses at rest area", () => {
        const w = createWorld();
        // 1 step before rest area G, heading +1 → lands on G (rest area)
        const e = makeNpc(w, { position: G - 1n, heading: 1, behavior: "explore" });
        // rng: 0.1 < 0.3 (reverseChance) → reverse
        movementSystem(w, makeRng([0.1, 0.9]));
        const mov = getComponent(w, e, MOVEMENT);
        assert.equal(mov.heading, -1);
    });

    it("explore heading does not reverse when roll is high", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: G - 1n, heading: 1, behavior: "explore" });
        // rng: 0.5 >= 0.3 → no reverse
        movementSystem(w, makeRng([0.5, 0.9]));
        const mov = getComponent(w, e, MOVEMENT);
        assert.equal(mov.heading, 1);
    });

    it("explore floor change at rest area", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: G - 1n, floor: 3n, heading: 1, behavior: "explore" });
        // rng: 0.5 (no reverse), 0.01 < 0.05 (floor change), 0.8 >= 0.5 (floor-1)
        movementSystem(w, makeRng([0.5, 0.01, 0.8]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.floor, 2n);
    });

    it("explore no floor change at non-rest area", () => {
        const w = createWorld();
        // position 5 is not a rest area (rest areas at multiples of G)
        const e = makeNpc(w, { position: 5n, floor: 3n, heading: 1, behavior: "explore" });
        movementSystem(w, makeRng([0.01, 0.01, 0.01]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 6n);
        assert.equal(pos.floor, 3n);
    });

    // --- Wander mad ---

    it("wander_mad moves random direction each tick", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 10n, behavior: "wander_mad" });
        // 0.3 < 0.5 → +1
        movementSystem(w, makeRng([0.3]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 11n);
    });

    it("wander_mad moves left when rng >= 0.5", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 10n, behavior: "wander_mad" });
        // 0.7 >= 0.5 → -1
        movementSystem(w, makeRng([0.7]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 9n);
    });

    it("wander_mad floor change at rest area", () => {
        const w = createWorld();
        // 1 step before rest area G, wander right (+1) → G (rest area)
        const e = makeNpc(w, { position: G - 1n, floor: 3n, behavior: "wander_mad" });
        // 0.3 < 0.5 → +1 (pos=G). 0.05 < 0.15 → floor change. 0.8 >= 0.5 → floor-1
        movementSystem(w, makeRng([0.3, 0.05, 0.8]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, G);
        assert.equal(pos.floor, 2n);
    });

    it("floor cannot go below 0", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: G - 1n, floor: 0n, behavior: "wander_mad" });
        // moves right to G, floor change tries -1 → clamped to 0
        movementSystem(w, makeRng([0.3, 0.05, 0.8]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.floor, 0n);
    });

    // --- Seek rest ---

    it("seek_rest steps toward nearest rest area", () => {
        const w = createWorld();
        // position G+3: nearest is G (dist 3) vs 2G (dist G-3), step left toward G
        const e = makeNpc(w, { position: G + 3n, behavior: "seek_rest" });
        movementSystem(w, makeRng([0.5]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, G + 2n);
        const mov = getComponent(w, e, MOVEMENT);
        assert.equal(mov.targetPosition, G);
    });

    it("seek_rest steps right toward higher rest area", () => {
        const w = createWorld();
        // position G-3: nearest is G (dist 3) vs 0 (dist G-3), step right toward G
        const e = makeNpc(w, { position: G - 3n, behavior: "seek_rest" });
        movementSystem(w, makeRng([0.5]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, G - 2n);
    });

    it("seek_rest from far in segment steps toward closer end", () => {
        const w = createWorld();
        // position 2G+3: nearest is 2G (dist 3) vs 3G (dist G-3), step left toward 2G
        const e = makeNpc(w, { position: 2n * G + 3n, behavior: "seek_rest" });
        movementSystem(w, makeRng([0.5]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 2n * G + 2n);
    });

    // --- Batch mode ---

    it("batch: seek_rest teleports when n >= distance", () => {
        const w = createWorld();
        // position G+3, nearest rest area is G
        const e = makeNpc(w, { position: G + 3n, behavior: "seek_rest" });
        movementSystem(w, makeRng([0.5]), undefined, 100);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, G);
    });

    it("batch: explore moves n steps in heading", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 50n, heading: 1, behavior: "explore" });
        movementSystem(w, makeRng([0.5, 0.5, 0.5]), undefined, 20);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 70n); // 50 + 1*20
    });

    it("batch: wander_mad random walk", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 50n, behavior: "wander_mad" });
        // 10 steps: all 0.3 < 0.5 → all +1 → net +10
        movementSystem(w, makeRng([0.3]), undefined, 10);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 60n);
    });

    it("batch: wander_mad mixed directions", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 50n, behavior: "wander_mad" });
        // alternating: 0.3 (+1), 0.7 (-1) → net 0 over 10 steps
        movementSystem(w, makeRng([0.3, 0.7]), undefined, 10);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 50n);
    });

    // --- Knowledge-aware exploration ---

    it("explore reverses when forward span is fully searched", () => {
        const w = createWorld();
        // 1 step before rest area G, heading +1 → lands on G
        const e = makeNpc(w, { position: G - 1n, heading: 1, behavior: "explore", withKnowledge: true });
        const k = getComponent(w, e, KNOWLEDGE);
        // Mark all G-1 galleries ahead of rest area G as searched
        for (let i = 1; i < Gn; i++) markSearched(k, 0, G + BigInt(i), 0n);
        // Behind (1 to G-1) not searched
        movementSystem(w, makeRng([0.5]));
        const mov = getComponent(w, e, MOVEMENT);
        assert.equal(mov.heading, -1, "should reverse away from exhausted span");
    });

    it("explore keeps heading when forward span has unsearched segments", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: G - 1n, heading: 1, behavior: "explore", withKnowledge: true });
        const k = getComponent(w, e, KNOWLEDGE);
        // Mark backward span searched, forward has work
        for (let i = 1; i < Gn; i++) markSearched(k, 0, BigInt(i), 0n);
        movementSystem(w, makeRng([0.5]));
        const mov = getComponent(w, e, MOVEMENT);
        assert.equal(mov.heading, 1, "should keep heading toward unsearched span");
    });

    it("explore prefers floor change when both spans exhausted", () => {
        const w = createWorld();
        // 1 step before rest area G, floor 2, heading +1 → lands on G
        const e = makeNpc(w, { position: G - 1n, floor: 2n, heading: 1, behavior: "explore", withKnowledge: true });
        const k = getComponent(w, e, KNOWLEDGE);
        // Exhaust both spans (G-1 galleries each direction) on floor 2
        for (let i = 1; i < Gn; i++) {
            markSearched(k, 0, G + BigInt(i), 2n);
            markSearched(k, 0, G - BigInt(i), 2n);
        }
        // rng: first for direction (both exhausted, 0.5 > 0.3 so no reverse),
        //       then 0.2 < 0.5 (exhausted floor change chance) → floor change
        //       floor 3 has work, floor 1 has work → random: 0.3 < 0.5 → +1
        movementSystem(w, makeRng([0.5, 0.2, 0.3]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.floor, 3n, "should change floor when local area exhausted");
    });

    it("explore prefers unsearched floor direction", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: G - 1n, floor: 2n, heading: 1, behavior: "explore", withKnowledge: true });
        const k = getComponent(w, e, KNOWLEDGE);
        // Exhaust both spans on floor 2
        for (let i = 1; i < Gn; i++) {
            markSearched(k, 0, G + BigInt(i), 2n);
            markSearched(k, 0, G - BigInt(i), 2n);
        }
        // Also exhaust floor 3 (both spans)
        for (let i = 1; i < Gn; i++) {
            markSearched(k, 0, G + BigInt(i), 3n);
            markSearched(k, 0, G - BigInt(i), 3n);
        }
        // Floor 1 still has work
        // rng: direction (0.5), floor roll (0.2 < 0.5), floor preference → down
        movementSystem(w, makeRng([0.5, 0.2, 0.8]));
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.floor, 1n, "should prefer floor with unsearched territory");
    });

    it("explore without knowledge falls back to random behavior", () => {
        const w = createWorld();
        // No withKnowledge — 1 step before rest area G
        const e = makeNpc(w, { position: G - 1n, heading: 1, behavior: "explore" });
        // rng: 0.1 < 0.3 → reverse
        movementSystem(w, makeRng([0.1, 0.9]));
        const mov = getComponent(w, e, MOVEMENT);
        assert.equal(mov.heading, -1, "should use random reversal without knowledge");
    });
});
