/* Social physics bridge — wires ECS social simulation into the game.
 *
 * Owns the ECS World. Creates entities for player + NPCs at init.
 * Runs per-tick systems (psychology decay, relationships, groups, social pressure).
 * Writes derived disposition back to state.npcs[] so rendering doesn't change.
 * Syncs positions from state.npcs → ECS components.
 */

import {
    createWorld, spawn, addComponent, getComponent, entitiesWith,
} from "../../lib/ecs.core.js";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, PLAYER, AI, GROUP,
    deriveDisposition, psychologyDecaySystem, relationshipSystem,
    groupFormationSystem, socialPressureSystem, segmentDistance,
} from "../../lib/social.core.js";
import { HABITUATION } from "../../lib/psych.core.js";
import { PERSONALITY, generatePersonality } from "../../lib/personality.core.js";
import { BELIEF, generateBelief } from "../../lib/belief.core.js";
import { seedFromString } from "../../lib/prng.core.js";
import { state } from "./state.js";

let world = null;
let playerEntity = null;
// Map NPC id → ECS entity
const npcEntities = new Map();

export const Social = {
    /** Initialize ECS world, spawn player + NPC entities. Call after Npc.init(). */
    init() {
        world = createWorld();
        npcEntities.clear();

        // Spawn player entity
        playerEntity = spawn(world);
        addComponent(world, playerEntity, POSITION, {
            side: state.side, position: state.position, floor: state.floor,
        });
        addComponent(world, playerEntity, IDENTITY, { name: "You", alive: true });
        addComponent(world, playerEntity, PSYCHOLOGY, { lucidity: 100, hope: 100 });
        addComponent(world, playerEntity, RELATIONSHIPS, { bonds: new Map() });
        addComponent(world, playerEntity, HABITUATION, { exposures: new Map() });
        addComponent(world, playerEntity, PLAYER, {});

        // Generate player personality from seed (use seedFromString, not PRNG.fork,
        // to avoid shifting the main PRNG sequence)
        const playerPersRng = seedFromString(state.seed + ":player:personality");
        addComponent(world, playerEntity, PERSONALITY, generatePersonality(playerPersRng));
        const playerBeliefRng = seedFromString(state.seed + ":player:belief");
        addComponent(world, playerEntity, BELIEF, generateBelief(playerBeliefRng));

        // Spawn NPC entities
        if (state.npcs) {
            for (const npc of state.npcs) {
                const ent = spawn(world);
                npcEntities.set(npc.id, ent);

                addComponent(world, ent, POSITION, {
                    side: npc.side, position: npc.position, floor: npc.floor,
                });
                addComponent(world, ent, IDENTITY, { name: npc.name, alive: npc.alive });
                // Match initial psychology to spawn disposition
                const initPsych = npc.disposition === "mad" ? { lucidity: 25, hope: 60 } :
                                  npc.disposition === "anxious" ? { lucidity: 55, hope: 50 } :
                                  npc.disposition === "catatonic" ? { lucidity: 20, hope: 10 } :
                                  { lucidity: 100, hope: 100 };
                addComponent(world, ent, PSYCHOLOGY, initPsych);
                addComponent(world, ent, RELATIONSHIPS, { bonds: new Map() });
                addComponent(world, ent, HABITUATION, { exposures: new Map() });
                addComponent(world, ent, AI, {});

                // NPC personality seeded from their name + game seed
                const npcPersRng = seedFromString(state.seed + ":npc:pers:" + npc.id);
                addComponent(world, ent, PERSONALITY, generatePersonality(npcPersRng));
                const npcBeliefRng = seedFromString(state.seed + ":npc:belief:" + npc.id);
                addComponent(world, ent, BELIEF, generateBelief(npcBeliefRng));
            }
        }
    },

    /** Sync player position from game state into ECS. Call before tick systems. */
    syncPlayerPosition() {
        if (!world || playerEntity === null) return;
        const pos = getComponent(world, playerEntity, POSITION);
        if (pos) {
            pos.side = state.side;
            pos.position = state.position;
            pos.floor = state.floor;
        }
        // Keep player alive status in sync
        const ident = getComponent(world, playerEntity, IDENTITY);
        if (ident) ident.alive = !state.dead;
    },

    /** Sync NPC positions from state.npcs into ECS. Call after NPC movement. */
    syncNpcPositions() {
        if (!world || !state.npcs) return;
        for (const npc of state.npcs) {
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const pos = getComponent(world, ent, POSITION);
            if (pos) {
                pos.side = npc.side;
                pos.position = npc.position;
                pos.floor = npc.floor;
            }
            const ident = getComponent(world, ent, IDENTITY);
            if (ident) ident.alive = npc.alive;
        }
    },

    /**
     * Run one tick of social simulation. Call from Tick on every game tick.
     * Updates ECS psychology, bonds, groups, then writes disposition back
     * to state.npcs[].
     */
    onTick() {
        if (!world || !state.npcs) return;

        this.syncPlayerPosition();

        const currentTick = (state.day - 1) * 240 + state.tick;

        // Core systems — order matters
        relationshipSystem(world, currentTick);
        psychologyDecaySystem(world);
        groupFormationSystem(world);
        socialPressureSystem(world);

        // Write derived disposition back to state.npcs
        for (const npc of state.npcs) {
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const psych = getComponent(world, ent, PSYCHOLOGY);
            const ident = getComponent(world, ent, IDENTITY);
            if (!psych || !ident) continue;

            npc.disposition = deriveDisposition(psych, ident.alive);
            // Sync alive status back (social pressure can't kill, but
            // the old system's catatonic→dead transition still applies)
            if (!ident.alive) npc.alive = false;
        }
    },

    /** Dawn hook — sync positions after NPC movement, resurrect dead NPCs' identity. */
    onDawn() {
        this.syncNpcPositions();
    },

    /** Expose world for debug. */
    getWorld() { return world; },
    getPlayerEntity() { return playerEntity; },
    getNpcEntity(npcId) { return npcEntities.get(npcId); },

    /** Get player psychology (for sidebar/UI). */
    getPlayerPsych() {
        if (!world || playerEntity === null) return null;
        return getComponent(world, playerEntity, PSYCHOLOGY);
    },

    /** Get player disposition. */
    getPlayerDisposition() {
        const psych = this.getPlayerPsych();
        if (!psych) return "calm";
        return deriveDisposition(psych, !state.dead);
    },

    /** Get NPC psychology for debug/UI. */
    getNpcPsych(npcId) {
        const ent = npcEntities.get(npcId);
        if (ent === undefined || !world) return null;
        return getComponent(world, ent, PSYCHOLOGY);
    },

    /** Get NPC belief for debug/UI. */
    getNpcBelief(npcId) {
        const ent = npcEntities.get(npcId);
        if (ent === undefined || !world) return null;
        return getComponent(world, ent, BELIEF);
    },

    /**
     * Get the player's group members (NPCs in same ECS group, co-located).
     * Returns array of { name, disposition } for sidebar display.
     * Empty array if player is not in a group.
     */
    getGroupMembers() {
        if (!world || playerEntity === null || !state.npcs) return [];
        const playerGroup = getComponent(world, playerEntity, GROUP);
        if (!playerGroup) return [];

        const members = [];
        for (const npc of state.npcs) {
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const npcGroup = getComponent(world, ent, GROUP);
            if (!npcGroup || npcGroup.groupId !== playerGroup.groupId) continue;
            const ident = getComponent(world, ent, IDENTITY);
            if (!ident || !ident.alive) continue;
            const psych = getComponent(world, ent, PSYCHOLOGY);
            members.push({
                name: ident.name,
                disposition: psych ? deriveDisposition(psych, true) : "calm",
            });
        }
        return members;
    },

    /**
     * Get NPCs the player can hear but not see (nearby, not co-located).
     * Returns array of { name, disposition, distance } sorted by distance.
     */
    getNearbyMutterers() {
        if (!world || playerEntity === null || !state.npcs) return [];
        const playerPos = getComponent(world, playerEntity, POSITION);
        if (!playerPos) return [];

        const result = [];
        for (const npc of state.npcs) {
            if (!npc.alive) continue;
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const npcPos = getComponent(world, ent, POSITION);
            if (!npcPos) continue;
            const dist = segmentDistance(playerPos, npcPos);
            // Nearby but not here (distance 1–3 on same side/floor)
            if (dist > 0 && dist <= 3) {
                const psych = getComponent(world, ent, PSYCHOLOGY);
                const disp = psych ? deriveDisposition(psych, true) : "calm";
                // Catatonic NPCs don't mutter
                if (disp === "catatonic") continue;
                result.push({ name: npc.name, disposition: disp, distance: dist, id: npc.id });
            }
        }
        result.sort((a, b) => a.distance - b.distance);
        return result;
    },
};
