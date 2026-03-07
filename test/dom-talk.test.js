import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";
import { getComponent } from "../lib/ecs.core.ts";

/** Place an NPC co-located with the player. */
function placeNpcHere(game, npcIndex) {
    const npc = game.state.npcs[npcIndex];
    npc.side = game.state.side;
    npc.position = game.state.position;
    npc.floor = game.state.floor;
    npc.alive = true;
    game.Social.syncNpcPositions();
    return npc;
}

/** Place NPC here + inject mutual bonds for recruiting. */
function placeNpcWithBonds(game, npcIndex) {
    const npc = placeNpcHere(game, npcIndex);
    const world = game.Social.getWorld();
    const playerEnt = game.Social.getPlayerEntity();
    const npcEnt = game.Social.getNpcEntity(npc.id);

    const playerRels = getComponent(world, playerEnt, "relationships");
    const npcRels = getComponent(world, npcEnt, "relationships");
    playerRels.bonds.set(npcEnt, {
        familiarity: 25, affinity: 20,
        firstContact: 0, lastContact: 100, encounters: 5,
    });
    npcRels.bonds.set(playerEnt, {
        familiarity: 25, affinity: 20,
        firstContact: 0, lastContact: 100, encounters: 5,
    });
    return npc;
}

describe("DOM: Talk screen", () => {
    it("corridor shows NPC talk links when NPC is co-located", () => {
        const game = bootGame();
        placeNpcHere(game, 0);
        game.Engine.goto("Corridor");

        const links = game.document.querySelectorAll(".npc-talk-link");
        assert.ok(links.length > 0, "NPC name is a talk link");
    });

    it("corridor shows 't' talk action when NPCs are present", () => {
        const game = bootGame();
        placeNpcHere(game, 0);
        game.Engine.goto("Corridor");

        const talkBtn = game.document.getElementById("corridor-talk");
        assert.ok(talkBtn, "talk action button exists");
        assert.ok(talkBtn.textContent.includes("talk"), "labeled 'talk'");
    });

    it("clicking NPC name opens Talk screen", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);
        game.Engine.goto("Corridor");

        const link = game.document.querySelector(".npc-talk-link");
        link.click();

        assert.strictEqual(game.state.screen, "Talk", "navigated to Talk screen");
        assert.strictEqual(game.state._talkTarget.id, npc.id, "talk target is the NPC");
    });

    it("Talk screen shows approach options", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);
        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const kindBtn = game.document.getElementById("talk-kind");
        const neutralBtn = game.document.getElementById("talk-neutral");
        const dismissBtn = game.document.getElementById("talk-dismiss");

        assert.ok(kindBtn, "kind option exists");
        assert.ok(neutralBtn, "neutral option exists");
        assert.ok(dismissBtn, "dismissive option exists");
    });

    it("choosing 'kind' resolves talk and shows result", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);
        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const kindBtn = game.document.getElementById("talk-kind");
        kindBtn.click();

        assert.strictEqual(game.state.screen, "Talk Result", "shows talk result");
    });

    it("Talk Result screen has continue button back to Talk", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);
        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const kindBtn = game.document.getElementById("talk-kind");
        kindBtn.click();

        assert.strictEqual(game.state.screen, "Talk Result");
        const passage = game.document.getElementById("passage");
        const continueLink = passage.querySelector("[data-goto='Talk']");
        assert.ok(continueLink, "continue link back to Talk exists");
    });

    it("q key from Talk returns to Corridor", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);
        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        game.document.dispatchEvent(new game.window.KeyboardEvent("keydown", { key: "q" }));
        assert.strictEqual(game.state.screen, "Corridor");
    });
});

describe("DOM: Talk Pick (multiple NPCs)", () => {
    it("shows picker when multiple NPCs are co-located", () => {
        const game = bootGame();
        placeNpcHere(game, 0);
        placeNpcHere(game, 1);
        game.Engine.goto("Corridor");

        const talkBtn = game.document.getElementById("corridor-talk");
        talkBtn.click();

        assert.strictEqual(game.state.screen, "Talk Pick", "picker screen shown");
    });

    it("picker lists all co-located NPCs", () => {
        const game = bootGame();
        const npc0 = placeNpcHere(game, 0);
        const npc1 = placeNpcHere(game, 1);
        game.Engine.goto("Corridor");

        const talkBtn = game.document.getElementById("corridor-talk");
        talkBtn.click();

        const links = game.document.querySelectorAll(".talk-pick-npc");
        assert.ok(links.length >= 2, "at least our 2 placed NPCs listed");
    });

    it("selecting an NPC from picker opens Talk", () => {
        const game = bootGame();
        const npc0 = placeNpcHere(game, 0);
        const npc1 = placeNpcHere(game, 1);
        game.Engine.goto("Corridor");

        const talkBtn = game.document.getElementById("corridor-talk");
        talkBtn.click();

        // Click first NPC
        const links = game.document.querySelectorAll(".talk-pick-npc");
        links[0].click();

        assert.strictEqual(game.state.screen, "Talk");
        assert.strictEqual(game.state._talkTarget.id, npc0.id);
    });

    it("number key selects NPC from picker", () => {
        const game = bootGame();
        placeNpcHere(game, 0);
        const npc1 = placeNpcHere(game, 1);
        game.Engine.goto("Corridor");

        const talkBtn = game.document.getElementById("corridor-talk");
        talkBtn.click();

        // Press "2" to select second NPC
        game.document.dispatchEvent(new game.window.KeyboardEvent("keydown", { key: "2" }));
        assert.strictEqual(game.state.screen, "Talk");
        assert.strictEqual(game.state._talkTarget.id, npc1.id);
    });
});

describe("DOM: Spend Time", () => {
    it("spend time option appears when familiarity >= 5", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);

        // Inject some familiarity
        const world = game.Social.getWorld();
        const playerEnt = game.Social.getPlayerEntity();
        const npcEnt = game.Social.getNpcEntity(npc.id);
        const playerRels = getComponent(world, playerEnt, "relationships");
        playerRels.bonds.set(npcEnt, {
            familiarity: 8, affinity: 5,
            firstContact: 0, lastContact: 100, encounters: 2,
        });

        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const spendBtn = game.document.getElementById("talk-spend");
        assert.ok(spendBtn, "spend time option visible");
    });

    it("spend time option hidden when familiarity < 5", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);

        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const spendBtn = game.document.getElementById("talk-spend");
        assert.strictEqual(spendBtn, null, "spend time option not visible");
    });

    it("clicking spend time opens Spend Time Result", () => {
        const game = bootGame();
        const npc = placeNpcWithBonds(game, 0);

        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const spendBtn = game.document.getElementById("talk-spend");
        assert.ok(spendBtn, "spend button exists");
        spendBtn.click();

        assert.strictEqual(game.state.screen, "Spend Time Result");
    });
});

describe("DOM: Recruit", () => {
    it("recruit option appears when familiarity >= 10", () => {
        const game = bootGame();
        const npc = placeNpcWithBonds(game, 0);

        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const recruitBtn = game.document.getElementById("talk-recruit");
        assert.ok(recruitBtn, "recruit option visible");
    });

    it("recruit option hidden when familiarity < 10", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);

        // Low familiarity
        const world = game.Social.getWorld();
        const playerEnt = game.Social.getPlayerEntity();
        const npcEnt = game.Social.getNpcEntity(npc.id);
        const playerRels = getComponent(world, playerEnt, "relationships");
        playerRels.bonds.set(npcEnt, {
            familiarity: 7, affinity: 5,
            firstContact: 0, lastContact: 100, encounters: 2,
        });

        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const recruitBtn = game.document.getElementById("talk-recruit");
        assert.strictEqual(recruitBtn, null, "recruit option not visible");
    });

    it("successful recruit shows accept message", () => {
        const game = bootGame();
        const npc = placeNpcWithBonds(game, 0);

        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const recruitBtn = game.document.getElementById("talk-recruit");
        recruitBtn.click();

        assert.strictEqual(game.state.screen, "Recruit Result");
        const passage = game.document.getElementById("passage");
        assert.ok(passage.textContent.includes("joined") || passage.textContent.includes("come with"),
            "shows acceptance message");
    });

    it("failed recruit (mad NPC) shows refusal", () => {
        const game = bootGame();
        const npc = placeNpcWithBonds(game, 0);

        // Make NPC mad
        const world = game.Social.getWorld();
        const npcEnt = game.Social.getNpcEntity(npc.id);
        const psych = getComponent(world, npcEnt, "psychology");
        psych.lucidity = 20;

        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const recruitBtn = game.document.getElementById("talk-recruit");
        recruitBtn.click();

        assert.strictEqual(game.state.screen, "Recruit Result");
        const passage = game.document.getElementById("passage");
        // Should NOT show "joined"
        assert.ok(!passage.textContent.includes("has joined"), "no join message for mad NPC");
    });
});

describe("DOM: Talk advances time", () => {
    it("talking consumes ticks", () => {
        const game = bootGame();
        const npc = placeNpcHere(game, 0);
        game.state._talkTarget = npc;
        game.Engine.goto("Talk");

        const tickBefore = game.state.tick;
        const kindBtn = game.document.getElementById("talk-kind");
        kindBtn.click();

        assert.ok(game.state.tick > tickBefore, "tick advanced after talk");
    });

    it("spend time consumes more ticks than talk", () => {
        const game1 = bootGame();
        const npc1 = placeNpcWithBonds(game1, 0);
        game1.state._talkTarget = npc1;
        game1.Engine.goto("Talk");
        const t1before = game1.state.tick;
        const kindBtn = game1.document.getElementById("talk-kind");
        kindBtn.click();
        const talkCost = game1.state.tick - t1before;

        const game2 = bootGame();
        const npc2 = placeNpcWithBonds(game2, 0);
        game2.state._talkTarget = npc2;
        game2.Engine.goto("Talk");
        const t2before = game2.state.tick;
        const spendBtn = game2.document.getElementById("talk-spend");
        spendBtn.click();
        const spendCost = game2.state.tick - t2before;

        assert.ok(spendCost > talkCost, "spend time costs more ticks than talk");
    });
});
