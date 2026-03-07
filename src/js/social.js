/* Social physics bridge — wires ECS social simulation into the game.
 *
 * Owns the ECS World. Creates entities for player + NPCs at init.
 * Runs per-tick systems (psychology decay, relationships, groups, social pressure).
 * Writes derived disposition back to state.npcs[] so rendering doesn't change.
 * Syncs positions from state.npcs → ECS components.
 */

import {
    createWorld, spawn, addComponent, getComponent, entitiesWith,
} from "../../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, PLAYER, AI, GROUP,
    deriveDisposition, psychologyDecaySystem, relationshipSystem,
    groupFormationSystem, socialPressureSystem, segmentDistance,
    buildLocationIndex,
} from "../../lib/social.core.ts";
import { HABITUATION } from "../../lib/psych.core.ts";
import { PERSONALITY, generatePersonality } from "../../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../../lib/belief.core.ts";
import { NEEDS, needsSystem, resetNeedsAtDawn } from "../../lib/needs.core.ts";
import { MOVEMENT, movementSystem } from "../../lib/movement.core.ts";
import { SEARCHING, searchSystem, scoreFromSeed } from "../../lib/search.core.ts";
import { INTENT, intentSystem, getAvailableBehaviors } from "../../lib/intent.core.ts";
import { SLEEP, sleepOnsetSystem, sleepWakeSystem, nearestRestArea } from "../../lib/sleep.core.ts";
import { KNOWLEDGE, createKnowledge, grantVision as applyVision, isAtBookSegment } from "../../lib/knowledge.core.ts";
import { isRestArea } from "../../lib/library.core.ts";
import { generateBookPage } from "../../lib/book.core.ts";
import { seedFromString } from "../../lib/prng.core.ts";
import { fallTick, attemptGrab } from "../../lib/chasm.core.js";
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
        addComponent(world, playerEntity, IDENTITY, { name: "You", alive: true, free: false });
        addComponent(world, playerEntity, PSYCHOLOGY, { lucidity: 100, hope: 100 });
        addComponent(world, playerEntity, RELATIONSHIPS, { bonds: new Map() });
        addComponent(world, playerEntity, HABITUATION, { exposures: new Map() });
        addComponent(world, playerEntity, PLAYER, {});
        addComponent(world, playerEntity, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });

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
                addComponent(world, ent, IDENTITY, { name: npc.name, alive: npc.alive, free: false });
                // Match initial psychology to spawn disposition
                const initPsych = npc.disposition === "mad" ? { lucidity: 25, hope: 60 } :
                                  npc.disposition === "anxious" ? { lucidity: 55, hope: 50 } :
                                  npc.disposition === "catatonic" ? { lucidity: 20, hope: 10 } :
                                  { lucidity: 100, hope: 100 };
                addComponent(world, ent, PSYCHOLOGY, initPsych);
                addComponent(world, ent, RELATIONSHIPS, { bonds: new Map() });
                addComponent(world, ent, HABITUATION, { exposures: new Map() });
                addComponent(world, ent, NEEDS, { hunger: 0, thirst: 0, exhaustion: 0 });
                addComponent(world, ent, MOVEMENT, { targetPosition: null, moveAccum: 0 });
                addComponent(world, ent, SEARCHING, { bookIndex: 0, ticksSearched: 0, patience: 10, active: false, bestScore: 0 });
                addComponent(world, ent, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
                addComponent(world, ent, SLEEP, {
                    homeRestArea: nearestRestArea(npc.position),
                    bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0,
                    nomadic: npc.disposition === "mad",
                });
                addComponent(world, ent, AI, {});

                // NPC personality seeded from their name + game seed
                const npcPersRng = seedFromString(state.seed + ":npc:pers:" + npc.id);
                addComponent(world, ent, PERSONALITY, generatePersonality(npcPersRng));
                const npcBeliefRng = seedFromString(state.seed + ":npc:belief:" + npc.id);
                addComponent(world, ent, BELIEF, generateBelief(npcBeliefRng));

                // Knowledge: each NPC has their own life story + target book
                addComponent(world, ent, KNOWLEDGE, createKnowledge(
                    state.seed, npc.id,
                    { side: npc.side, position: npc.position, floor: npc.floor },
                ));
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

        // When possessing, sync player state back to the possessed NPC
        if (state._possessedNpcId != null) {
            const npc = state.npcs && state.npcs.find(n => n.id === state._possessedNpcId);
            if (npc) {
                npc.side = state.side;
                npc.position = state.position;
                npc.floor = state.floor;
                npc.falling = state.falling;
            }
        }
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
    /**
     * Run n ticks of social simulation. Defaults to 1.
     * Batch mode: runs systems once with scaled effects (n > 1).
     */
    onTick(n) {
        if (!world || !state.npcs) return;
        if (n === undefined) n = 1;

        this.syncPlayerPosition();

        const currentTick = (state.day - 1) * 240 + state.tick;

        // Build location index once, share between relationship + group systems
        const prebuilt = buildLocationIndex(world);

        // Core systems — order matters
        relationshipSystem(world, currentTick, undefined, prebuilt, n);
        psychologyDecaySystem(world, undefined, n);
        groupFormationSystem(world, undefined, prebuilt);
        socialPressureSystem(world, undefined, undefined, undefined, n);

        // Needs (before intent evaluation — intent reads needs)
        needsSystem(world, state.lightsOn, undefined, n);

        // Intent arbiter (before movement/search — they read intent)
        const intentRng = seedFromString(state.seed + ":npc:intent:" + currentTick);
        intentSystem(world, intentRng, undefined, state.tick);

        // Movement (only for explore/seek_rest/wander_mad intents)
        const moveRng = seedFromString(state.seed + ":npc:move:" + currentTick);
        movementSystem(world, moveRng, undefined, n);

        // Book searching (only for search intent)
        const searchRng = seedFromString(state.seed + ":npc:search:" + currentTick);
        const pageSampler = (side, position, floor, bookIndex, pageIndex) =>
            generateBookPage(side, position, floor, bookIndex, pageIndex, state.seed, 400);
        const fastScorer = (side, position, floor, bookIndex, pageIndex) =>
            scoreFromSeed(state.seed, side, position, floor, bookIndex, pageIndex);
        searchSystem(world, searchRng, pageSampler, undefined, fastScorer);

        // Sync ECS positions back to state.npcs (every tick now, not just dawn)
        for (const npc of state.npcs) {
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const pos = getComponent(world, ent, POSITION);
            if (pos) {
                npc.side = pos.side;
                npc.position = pos.position;
                npc.floor = pos.floor;
            }
        }

        // Escape check: pilgrims who arrived at their book, or have book at rest area
        this.checkEscapes();

        // NPC chasm AI: check for jumps, advance falling
        this.checkNpcChasmJump();
        this.tickNpcFalling();

        // Write derived disposition back to state.npcs
        for (const npc of state.npcs) {
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const psych = getComponent(world, ent, PSYCHOLOGY);
            const ident = getComponent(world, ent, IDENTITY);
            if (!psych || !ident) continue;

            const knowledge = getComponent(world, ent, KNOWLEDGE);
            const onPilgrimage = !!(knowledge && knowledge.bookVision && ident.alive);
            npc.disposition = deriveDisposition(psych, ident.alive, undefined, onPilgrimage);
            // Sync alive status back
            if (!ident.alive && npc.alive) {
                const needs = getComponent(world, ent, NEEDS);
                console.log("NPC DEATH (ECS sync):", npc.name, "id="+npc.id,
                    "needs:", needs ? {h:Math.round(needs.hunger), t:Math.round(needs.thirst), e:Math.round(needs.exhaustion)} : "none",
                    "tick="+state.tick, "day="+state.day);
                npc.alive = false;
            }
        }
    },

    /** Lights-out hook — NPCs at rest areas claim beds and fall asleep. */
    onLightsOut() {
        if (world) sleepOnsetSystem(world);
    },

    /** Dawn hook — resolve sleep effects, resurrect dead NPCs, reset needs. */
    onDawn() {
        if (!world) return;
        const currentTick = (state.day - 1) * 240 + state.tick;
        sleepWakeSystem(world, currentTick);
        resetNeedsAtDawn(world);
        // Sync ECS resurrection back to state.npcs (skip escaped NPCs)
        if (state.npcs) {
            for (const npc of state.npcs) {
                if (!npc.alive) {
                    const ent = npcEntities.get(npc.id);
                    const ident = ent !== undefined ? getComponent(world, ent, IDENTITY) : null;
                    if (ident && ident.free) continue; // FREE = gone forever
                    npc.alive = true;
                    npc.falling = null;
                }
            }
        }
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

    /** Get NPC knowledge for debug/UI. */
    getNpcKnowledge(npcId) {
        const ent = npcEntities.get(npcId);
        if (ent === undefined || !world) return null;
        return getComponent(world, ent, KNOWLEDGE);
    },

    /**
     * Grant a divine vision to an NPC, revealing their book location.
     * Returns true if vision was granted, false if NPC not found or already escaped.
     */
    grantVision(npcId, accurate = true) {
        const ent = npcEntities.get(npcId);
        if (ent === undefined || !world) return false;
        const knowledge = getComponent(world, ent, KNOWLEDGE);
        const ident = getComponent(world, ent, IDENTITY);
        if (!knowledge || (ident && ident.free)) return false;
        applyVision(knowledge, accurate);
        // Divine inspiration: immediate hope boost
        const psych = getComponent(world, ent, PSYCHOLOGY);
        if (psych) {
            psych.hope = Math.min(100, psych.hope + 40);
        }
        return true;
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

    // --- Escape resolution ---

    /**
     * Check if any NPC has found their book or can submit it.
     *
     * Two-phase:
     * 1. Pilgrim at book segment → picks up book (hasBook = true)
     * 2. NPC with book at rest area → submits and escapes
     *
     * Witness boost: nearby NPCs on same side/floor get +15 hope.
     */
    checkEscapes() {
        if (!world || !state.npcs) return;
        for (const npc of state.npcs) {
            if (!npc.alive) continue;
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const knowledge = getComponent(world, ent, KNOWLEDGE);
            const ident = getComponent(world, ent, IDENTITY);
            if (!knowledge || !ident || ident.free) continue;

            const pos = getComponent(world, ent, POSITION);
            if (!pos) continue;

            // Phase 1: at book segment → pick up book
            if (!knowledge.hasBook && knowledge.bookVision && knowledge.visionAccurate) {
                if (isAtBookSegment(knowledge, pos)) {
                    knowledge.hasBook = true;
                }
            }

            // Phase 2: has book at rest area → submit and escape
            if (knowledge.hasBook && isRestArea(pos.position)) {
                ident.free = true;
                ident.alive = false;
                npc.alive = false;
                npc.disposition = "escaped";

                // Witness hope boost: NPCs within 3 segments on same side+floor
                for (const other of state.npcs) {
                    if (other.id === npc.id || !other.alive) continue;
                    if (other.side !== pos.side || other.floor !== pos.floor) continue;
                    if (Math.abs(other.position - pos.position) > 3) continue;
                    const otherEnt = npcEntities.get(other.id);
                    if (otherEnt === undefined) continue;
                    const otherPsych = getComponent(world, otherEnt, PSYCHOLOGY);
                    if (otherPsych) {
                        otherPsych.hope = Math.min(100, otherPsych.hope + 15);
                    }
                }

                console.log("NPC ESCAPED:", npc.name, "id=" + npc.id,
                    "at s" + pos.position + " f" + pos.floor,
                    "day=" + state.day, "tick=" + state.tick);
            }
        }
    },

    // --- NPC chasm falling ---

    /**
     * Tick all falling NPCs. Called once per tick from onTick().
     * Each falling NPC gets physics + auto-grab attempt.
     */
    tickNpcFalling() {
        if (!state.npcs) return;
        for (const npc of state.npcs) {
            if (!npc.falling || !npc.alive) continue;
            // Skip possessed NPC — player controls their falling via normal screens
            if (state._possessedNpcId === npc.id) continue;

            const result = fallTick(npc.falling, npc.floor);
            npc.floor = result.newFloor;
            npc.falling.speed = result.newSpeed;

            if (result.landed) {
                npc.falling = null;
                if (result.fatal) {
                    console.log("NPC DEATH (fatal landing):", npc.name, "id="+npc.id, "floor="+npc.floor, "speed="+Math.round(result.newSpeed), "tick="+state.tick);
                    npc.alive = false;
                    const ent = npcEntities.get(npc.id);
                    if (ent !== undefined) {
                        const ident = getComponent(world, ent, IDENTITY);
                        if (ident) ident.alive = false;
                    }
                }
                continue;
            }

            // Auto-grab: NPCs try every few ticks when speed is manageable
            if (npc.falling.speed > 0 && npc.falling.speed < 30) {
                const grabRng = seedFromString(state.seed + ":npcgrab:" + npc.id + ":" + state.tick + ":" + npc.floor);
                // NPCs only attempt grab 20% of eligible ticks (they're panicking)
                if (grabRng.next() < 0.2) {
                    const grabResult = attemptGrab(npc.falling.speed, grabRng);
                    if (grabResult.success) {
                        npc.falling = null;
                    } else {
                        npc.falling.speed = grabResult.speedAfter;
                        // Mortality damage — NPCs don't track mortality, just kill on bad hits
                        if (grabResult.mortalityHit > 15) {
                            console.log("NPC DEATH (grab damage):", npc.name, "id="+npc.id, "mortalityHit="+grabResult.mortalityHit, "speed="+Math.round(npc.falling.speed), "floor="+npc.floor, "tick="+state.tick);
                            npc.alive = false;
                            const ent = npcEntities.get(npc.id);
                            if (ent !== undefined) {
                                const ident = getComponent(world, ent, IDENTITY);
                                if (ident) ident.alive = false;
                            }
                        }
                    }
                }
            }

            // Sync floor to ECS
            const ent = npcEntities.get(npc.id);
            if (ent !== undefined) {
                const pos = getComponent(world, ent, POSITION);
                if (pos) pos.floor = npc.floor;
            }
        }
    },

    /**
     * Check if any catatonic NPCs should jump into the chasm.
     * Called once per tick. Very low probability.
     */
    checkNpcChasmJump() {
        if (!state.npcs) return;
        for (const npc of state.npcs) {
            if (!npc.alive || npc.falling) continue;
            if (npc.floor <= 0) continue; // can't fall from bottom
            if (state._possessedNpcId === npc.id) continue;

            // Only catatonic or very low hope NPCs jump
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const psych = getComponent(world, ent, PSYCHOLOGY);
            if (!psych) continue;

            const disp = deriveDisposition(psych, true);
            // Catatonic: ~0.1% per tick. Mad: ~0.02% per tick.
            let jumpChance = 0;
            if (disp === "catatonic") jumpChance = 0.001;
            else if (disp === "mad") jumpChance = 0.0002;
            else continue;

            const rng = seedFromString(state.seed + ":npcjump:" + npc.id + ":" + state.tick);
            if (rng.next() < jumpChance) {
                npc.falling = { speed: 0, floorsToFall: 0, side: npc.side };
            }
        }
    },

    /**
     * Make a specific NPC jump into the chasm. Called from godmode possess.
     */
    npcJump(npcId) {
        const npc = state.npcs && state.npcs.find(n => n.id === npcId);
        if (!npc || !npc.alive || npc.floor <= 0) return false;
        npc.falling = { speed: 0, floorsToFall: 0, side: npc.side };
        return true;
    },

    // --- Possession ---

    /**
     * Possess an NPC: swap player state to NPC's position.
     * Stores original player state for restoration.
     */
    possess(npcId) {
        const npc = state.npcs && state.npcs.find(n => n.id === npcId);
        if (!npc) return false;

        // Save original player state
        state._possessedNpcId = npcId;
        state._possessOriginal = {
            side: state.side,
            position: state.position,
            floor: state.floor,
            falling: state.falling,
            heldBook: state.heldBook,
        };

        // Swap player position to NPC
        state.side = npc.side;
        state.position = npc.position;
        state.floor = npc.floor;
        state.falling = npc.falling || null;
        state.heldBook = null;

        return true;
    },

    /**
     * Unpossess: sync NPC state from player, restore original player position.
     */
    unpossess() {
        if (!state._possessedNpcId) return;
        const npc = state.npcs && state.npcs.find(n => n.id === state._possessedNpcId);

        // Sync player position back to NPC
        if (npc) {
            npc.side = state.side;
            npc.position = state.position;
            npc.floor = state.floor;
            npc.falling = state.falling;

            // Sync to ECS
            const ent = npcEntities.get(npc.id);
            if (ent !== undefined) {
                const pos = getComponent(world, ent, POSITION);
                if (pos) {
                    pos.side = npc.side;
                    pos.position = npc.position;
                    pos.floor = npc.floor;
                }
            }
        }

        // Restore original player state
        const orig = state._possessOriginal;
        if (orig) {
            state.side = orig.side;
            state.position = orig.position;
            state.floor = orig.floor;
            state.falling = orig.falling;
            state.heldBook = orig.heldBook;
        }

        state._possessedNpcId = null;
        state._possessOriginal = null;
    },

    /** Is the player currently possessing an NPC? */
    isPossessing() {
        return !!state._possessedNpcId;
    },

    /** Get the ID of the possessed NPC. */
    getPossessedId() {
        return state._possessedNpcId || null;
    },

    /**
     * Get available behaviors for the current entity (player or possessed NPC).
     * Returns scored behaviors from the intent system, sorted by score.
     * UI can use this to show social action options.
     */
    getAvailableActions() {
        if (!world) return [];
        const entity = playerEntity;
        if (entity === null) return [];
        const rng = seedFromString(state.seed + ":actions:" + state.tick);
        return getAvailableBehaviors(world, entity, rng, state.tick);
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
