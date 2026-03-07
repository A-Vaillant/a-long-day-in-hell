import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY } from "../lib/social.core.ts";
import { NEEDS } from "../lib/needs.core.ts";
import { MOVEMENT, movementSystem, DEFAULT_MOVEMENT } from "../lib/movement.core.ts";

function makeRng(values) {
    let i = 0;
    return { next() { return values[i++ % values.length]; } };
}

function makeNpc(world, {
    position = 0, floor = 0, alive = true,
    lucidity = 100, hope = 100,
    hunger = 0, thirst = 0, exhaustion = 0,
} = {}) {
    const e = spawn(world);
    addComponent(world, e, IDENTITY, { name: "Test", alive });
    addComponent(world, e, POSITION, { side: 0, position, floor });
    addComponent(world, e, PSYCHOLOGY, { lucidity, hope });
    addComponent(world, e, NEEDS, { hunger, thirst, exhaustion });
    addComponent(world, e, MOVEMENT, { intent: "idle", targetPosition: null, moveAccum: 0 });
    return e;
}

describe("movementSystem", () => {
    it("catatonic NPCs do not move", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5, hope: 10 }); // catatonic: hope <= 15
        const rng = makeRng([0.0]); // would always trigger move
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 5);
    });

    it("dead NPCs do not move", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 5, alive: false });
        const rng = makeRng([0.0]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 5);
    });

    it("mad NPCs move with higher probability", () => {
        const w = createWorld();
        // mad: lucidity <= 40
        const e = makeNpc(w, { position: 10, lucidity: 25, hope: 60 });
        // rng.next() = 0.1 < 0.3 (mad prob) → moves. next = 0.3 < 0.5 → right (+1)
        const rng = makeRng([0.1, 0.3]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 11);
    });

    it("calm NPCs move with lower probability", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 10 }); // calm: lucidity=100, hope=100
        // rng.next() = 0.2 → 0.2 >= 0.15 calm prob → no move
        const rng = makeRng([0.2]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 10);
    });

    it("calm NPC moves when roll is below probability", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 10 });
        // 0.05 < 0.15 → moves. 0.3 < 0.5 → right (+1)
        const rng = makeRng([0.05, 0.3]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 11);
    });

    it("seeks nearest rest area when needs critical", () => {
        const w = createWorld();
        // position=7, nearest rest area = 10
        const e = makeNpc(w, { position: 7, hunger: 85 });
        const rng = makeRng([0.05]); // triggers move
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 8); // stepped toward 10
        const mov = getComponent(w, e, MOVEMENT);
        assert.equal(mov.intent, "seek_rest");
        assert.equal(mov.targetPosition, 10);
    });

    it("seeks rest area when exhaustion high", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 13, exhaustion: 75 });
        const rng = makeRng([0.05]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 12); // stepped toward 10
    });

    it("direction correctness: steps left toward lower rest area", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 3, hunger: 85 });
        // nearest rest area to 3 = 0 (round(3/10)*10 = 0)
        const rng = makeRng([0.05]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 2); // stepped toward 0
    });

    it("floor change only at rest areas", () => {
        const w = createWorld();
        // mad NPC at non-rest-area position=5
        const e = makeNpc(w, { position: 5, floor: 3, lucidity: 25, hope: 60 });
        // 0.1 < 0.3 → moves. 0.8 → right (+1). position becomes 6, not rest area
        // floor change check: isRestArea(6) = false, so no floor change
        const rng = makeRng([0.1, 0.8, 0.01, 0.3]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.floor, 3); // unchanged
    });

    it("floor change happens at rest areas for mad NPC", () => {
        const w = createWorld();
        // mad NPC at position=9, will move right to 10 (rest area)
        const e = makeNpc(w, { position: 9, floor: 3, lucidity: 25, hope: 60 });
        // 0.1 < 0.3 → moves. 0.3 < 0.5 → right (+1) → position=10 (rest area)
        // floor change: 0.05 < 0.15 → yes. 0.8 >= 0.5 → floor-1 = 2
        const rng = makeRng([0.1, 0.3, 0.05, 0.8]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 10);
        assert.equal(pos.floor, 2);
    });

    it("floor cannot go below 0", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 9, floor: 0, lucidity: 25, hope: 60 });
        // moves right to 10 (rest area), floor change tries -1 → clamped to 0
        const rng = makeRng([0.1, 0.8, 0.05, 0.3]);
        movementSystem(w, rng);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.floor, 0);
    });

    it("batch mode: seek rest area teleports if enough moves", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 7, hunger: 85 });
        // n=100 → expectedMoves = round(0.15*100) = 15, dist to 10 = 3, so teleport
        const rng = makeRng([0.5]);
        movementSystem(w, rng, undefined, 100);
        const pos = getComponent(w, e, POSITION);
        assert.equal(pos.position, 10);
    });

    it("batch mode: random walk displacement for exploring NPC", () => {
        const w = createWorld();
        const e = makeNpc(w, { position: 50 }); // calm, no critical needs
        // n=100 → expectedMoves = round(0.15*100) = 15 random steps
        const values = [];
        for (let i = 0; i < 20; i++) values.push(0.05, 0.7); // 0.05 triggers, 0.7 → right
        const rng = makeRng(values);
        movementSystem(w, rng, undefined, 100);
        const pos = getComponent(w, e, POSITION);
        // Should have moved from 50
        assert.notEqual(pos.position, 50);
    });
});
