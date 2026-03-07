import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bootGame } from "./dom-harness.js";
import { getComponent } from "../lib/ecs.core.ts";

/** Force an NPC co-located with the player, inject mutual bonds above group threshold. */
function forceGroup(game, npcIndex) {
    const npc = game.state.npcs[npcIndex];
    npc.side = game.state.side;
    npc.position = game.state.position;
    npc.floor = game.state.floor;
    game.Social.syncNpcPositions();

    const world = game.Social.getWorld();
    const playerEnt = game.Social.getPlayerEntity();
    const npcEnt = game.Social.getNpcEntity(npc.id);

    const playerRels = getComponent(world, playerEnt, "relationships");
    const npcRels = getComponent(world, npcEnt, "relationships");
    playerRels.bonds.set(npcEnt, { familiarity: 20, affinity: 15, lastContact: 0 });
    npcRels.bonds.set(playerEnt, { familiarity: 20, affinity: 15, lastContact: 0 });

    return { npc, npcEnt };
}

describe("DOM: Social sidebar — group display", () => {
    it("getGroupMembers returns empty when no group formed", () => {
        const game = bootGame();
        const members = game.Social.getGroupMembers();
        assert.strictEqual(members.length, 0, "no group initially");
    });

    it("sidebar has no companion entries when player is ungrouped", () => {
        const game = bootGame();
        game.Engine.goto("Corridor");
        const sidebar = game.document.getElementById("story-caption");
        const companions = sidebar.querySelectorAll(".sb-companion");
        assert.strictEqual(companions.length, 0, "no companions shown");
    });

    it("getGroupMembers returns NPCs after forced bond + co-location", () => {
        const game = bootGame();
        const { npc } = forceGroup(game, 0);

        game.Social.onTick();

        const members = game.Social.getGroupMembers();
        assert.ok(members.length > 0, "group has members");
        assert.strictEqual(members[0].name, npc.name, "group member is the NPC");
        assert.strictEqual(members[0].disposition, "calm", "NPC is calm initially");
    });

    it("sidebar shows companion entries when group exists", () => {
        const game = bootGame();
        const { npc } = forceGroup(game, 0);

        game.Social.onTick();
        game.Engine.goto("Corridor");

        const sidebar = game.document.getElementById("story-caption");
        const companions = sidebar.querySelectorAll(".sb-companion");
        assert.ok(companions.length > 0, "companion entry shown");
        assert.ok(companions[0].textContent.includes(npc.name), "shows NPC name");
    });

    it("companion shows disposition-colored class", () => {
        const game = bootGame();
        const { npcEnt } = forceGroup(game, 0);

        // Make NPC anxious by lowering lucidity
        const world = game.Social.getWorld();
        const npcPsych = getComponent(world, npcEnt, "psychology");
        npcPsych.lucidity = 50;

        game.Social.onTick();
        game.Engine.goto("Corridor");

        const sidebar = game.document.getElementById("story-caption");
        const companions = sidebar.querySelectorAll(".sb-companion");
        assert.ok(companions.length > 0, "companion shown");
        assert.ok(companions[0].classList.contains("sb-disp-anxious"), "has anxious class");
    });

    it("group member removed from sidebar when NPC moves away", () => {
        const game = bootGame();
        const { npc } = forceGroup(game, 0);

        game.Social.onTick();
        assert.ok(game.Social.getGroupMembers().length > 0, "grouped initially");

        // Move NPC far away
        npc.position = game.state.position + 100;
        game.Social.syncNpcPositions();
        game.Social.onTick();

        const members = game.Social.getGroupMembers();
        assert.strictEqual(members.length, 0, "no group after NPC moved away");
    });
});

describe("DOM: Ambient muttering", () => {
    it("getNearbyMutterers returns NPCs within hearing range but not co-located", () => {
        const game = bootGame();
        // Place an NPC 2 segments away, same side/floor
        const npc = game.state.npcs[0];
        npc.side = game.state.side;
        npc.position = game.state.position + 2;
        npc.floor = game.state.floor;
        game.Social.syncNpcPositions();
        game.Social.syncPlayerPosition();

        const mutterers = game.Social.getNearbyMutterers();
        assert.ok(mutterers.some(m => m.id === npc.id), "nearby NPC is a mutterer");
    });

    it("co-located NPCs are not mutterers", () => {
        const game = bootGame();
        const npc = game.state.npcs[0];
        npc.side = game.state.side;
        npc.position = game.state.position;
        npc.floor = game.state.floor;
        game.Social.syncNpcPositions();
        game.Social.syncPlayerPosition();

        const mutterers = game.Social.getNearbyMutterers();
        assert.ok(!mutterers.some(m => m.id === npc.id), "co-located NPC is not a mutterer");
    });

    it("NPCs beyond hearing range are not mutterers", () => {
        const game = bootGame();
        const npc = game.state.npcs[0];
        npc.side = game.state.side;
        npc.position = game.state.position + 10;
        npc.floor = game.state.floor;
        game.Social.syncNpcPositions();
        game.Social.syncPlayerPosition();

        const mutterers = game.Social.getNearbyMutterers();
        assert.ok(!mutterers.some(m => m.id === npc.id), "distant NPC is not a mutterer");
    });

    it("catatonic NPCs do not mutter", () => {
        const game = bootGame();
        const npc = game.state.npcs[0];
        npc.side = game.state.side;
        npc.position = game.state.position + 1;
        npc.floor = game.state.floor;
        game.Social.syncNpcPositions();

        // Force catatonic
        const npcEnt = game.Social.getNpcEntity(npc.id);
        const psych = getComponent(game.Social.getWorld(), npcEnt, "psychology");
        psych.hope = 5;
        game.Social.onTick();

        const mutterers = game.Social.getNearbyMutterers();
        assert.ok(!mutterers.some(m => m.id === npc.id), "catatonic NPC does not mutter");
    });

    it("corridor renders muttering text for nearby NPCs", () => {
        const game = bootGame();
        // Place NPC 1 segment away
        const npc = game.state.npcs[0];
        npc.side = game.state.side;
        npc.position = game.state.position + 1;
        npc.floor = game.state.floor;
        game.Social.syncNpcPositions();

        game.Engine.goto("Corridor");
        const mutterings = game.document.querySelectorAll(".muttering");
        assert.ok(mutterings.length > 0, "muttering text shown in corridor");
    });
});

describe("DOM: Social bridge — psychology sync", () => {
    it("player psychology accessible and starts at 100/100", () => {
        const game = bootGame();
        const psych = game.Social.getPlayerPsych();
        assert.ok(psych, "player psych exists");
        assert.strictEqual(psych.lucidity, 100);
        assert.strictEqual(psych.hope, 100);
    });

    it("player disposition starts as calm", () => {
        const game = bootGame();
        assert.strictEqual(game.Social.getPlayerDisposition(), "calm");
    });

    it("NPC disposition written back to state.npcs after tick", () => {
        const game = bootGame();
        const npc = game.state.npcs[0];
        const npcEnt = game.Social.getNpcEntity(npc.id);
        const psych = getComponent(game.Social.getWorld(), npcEnt, "psychology");

        // Force NPC into mad state
        psych.lucidity = 30;
        psych.hope = 80;
        game.Social.onTick();
        assert.strictEqual(npc.disposition, "mad", "disposition written back to state.npcs");
    });
});
