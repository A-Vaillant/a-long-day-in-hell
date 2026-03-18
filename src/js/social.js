/* Social physics bridge — wires ECS social simulation into the game.
 *
 * Owns the ECS World. Creates entities for player + NPCs at init.
 * Runs per-tick systems (psychology decay, relationships, groups, social pressure).
 * Writes derived disposition back to state.npcs[] so rendering doesn't change.
 * Syncs positions from state.npcs → ECS components.
 */

import {
    createWorld, spawn, addComponent, removeComponent, getComponent, hasComponent, entitiesWith,
} from "../../lib/ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, PLAYER, AI, GROUP,
    deriveDisposition, psychologyDecaySystem, relationshipSystem,
    groupFormationSystem, socialPressureSystem, npcDismissSystem, segmentDistance,
    buildLocationIndex,
} from "../../lib/social.core.ts";
import { HABITUATION, applyShockToEntity } from "../../lib/psych.core.ts";
import { PERSONALITY, generatePersonality, applySideBias } from "../../lib/personality.core.ts";
import { BELIEF, generateBelief } from "../../lib/belief.core.ts";
import { STATS, generateStats, quicknessMod } from "../../lib/stats.core.ts";
import { NEEDS, needsSystem, resetNeedsAtDawn } from "../../lib/needs.core.ts";
import { MOVEMENT, movementSystem } from "../../lib/movement.core.ts";
import { SEARCHING, createSearching, searchSystem, findWordsFromSeed } from "../../lib/search.core.ts";
import { INTENT, intentSystem, getAvailableBehaviors } from "../../lib/intent.core.ts";
import { SLEEP, sleepOnsetSystem, sleepWakeSystem, nearestRestArea } from "../../lib/sleep.core.ts";
import { generateNpcLifeStory } from "../../lib/lifestory.core.ts";
import {
    MEMORY, MEMORY_TYPES,
    DEFAULT_MEMORY_CONFIG,
    createMemory, addMemory, hasRecentMemory, witnessSystem, memoryDecaySystem,
    getBookVision, grantBookVision, grantVagueBookVision, getSearchProgress,
    isAtBookSegment, isInVisionRadius, isSegmentSearched,
} from "../../lib/memory.core.ts";
import {
    talkTo, spendTime as spendTimeCore, recruit as recruitCore, socializeSystem,
} from "../../lib/interaction.core.ts";
import { dismiss as dismissCore } from "../../lib/actions.core.ts";
import { isRestArea, mercyKiosk } from "../../lib/library.core.ts";
import { TICKS_PER_DAY } from "../../lib/tick.core.ts";
import { generateBookPage } from "../../lib/book.core.ts";
import { seedFromString } from "../../lib/prng.core.ts";
import { fallTick, attemptGrab } from "../../lib/chasm.core.ts";
import { tickNpcAction } from "../../lib/npc-action.core.ts";
import { appendEvents } from "./event-log.js";
import { state } from "./state.js";
import { Engine } from "./engine.js";

let world = null;
let playerEntity = null;
// Map NPC id → ECS entity
const npcEntities = new Map();
// Events queued from outside the tick cycle (e.g. godmode powers)
const pendingWitnessEvents = [];

export const Social = {
    /** Initialize ECS world, spawn player + NPC entities. Call after Npc.init(). */
    init() {
        world = createWorld();
        npcEntities.clear();

        // Spawn player entity
        playerEntity = spawn(world);
        addComponent(world, playerEntity, POSITION, {
            side: state.side, position: BigInt(state.position), floor: BigInt(state.floor),
        });
        const playerName = (state.lifeStory && state.lifeStory.name) || "You";
        addComponent(world, playerEntity, IDENTITY, { name: playerName, alive: true, free: false, lifeStory: state.lifeStory || null });
        addComponent(world, playerEntity, PSYCHOLOGY, { lucidity: 100, hope: 50 });
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
        const playerStatsRng = seedFromString(state.seed + ":player:stats");
        addComponent(world, playerEntity, STATS, generateStats(playerStatsRng));
        addComponent(world, playerEntity, NEEDS, {
            hunger: state.hunger || 0,
            thirst: state.thirst || 0,
            exhaustion: state.exhaustion || 0,
        });
        const playerHeadingRng = seedFromString(state.seed + ":player:heading");
        addComponent(world, playerEntity, MOVEMENT, {
            targetPosition: null,
            heading: playerHeadingRng.next() < 0.5 ? 1 : -1,
        });
        addComponent(world, playerEntity, SEARCHING, createSearching());
        const playerMem = createMemory();
        addComponent(world, playerEntity, MEMORY, playerMem);
        // Grant player book vision on Memory (if they have a life story with coords)
        if (state.lifeStory && state.lifeStory.bookCoords) {
            grantBookVision(playerMem, state.lifeStory.bookCoords, 0);
        }
        addComponent(world, playerEntity, SLEEP, {
            home: { side: state.side, position: nearestRestArea(BigInt(state.position)), floor: BigInt(state.floor) },
            bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0,
            nomadic: false,
        });

        // Spawn NPC entities
        if (state.npcs) {
            for (const npc of state.npcs) {
                const ent = spawn(world);
                npcEntities.set(npc.id, ent);

                addComponent(world, ent, POSITION, {
                    side: npc.side, position: npc.position, floor: npc.floor,
                });
                // Generate NPC life story from seed (deterministic per NPC id)
                const npcStory = generateNpcLifeStory(
                    state.seed, npc.id,
                    { side: npc.side, position: npc.position, floor: npc.floor },
                    state.playerRawAddress, state.playerBookAddress,
                );
                addComponent(world, ent, IDENTITY, { name: npc.name, alive: npc.alive, free: false, lifeStory: npcStory });
                // Match initial psychology to spawn disposition
                const initPsych = npc.disposition === "mad" ? { lucidity: 25, hope: 30 } :
                                  npc.disposition === "anxious" ? { lucidity: 55, hope: 40 } :
                                  npc.disposition === "catatonic" ? { lucidity: 20, hope: 10 } :
                                  { lucidity: 100, hope: 50 };
                addComponent(world, ent, PSYCHOLOGY, initPsych);
                addComponent(world, ent, RELATIONSHIPS, { bonds: new Map() });
                addComponent(world, ent, HABITUATION, { exposures: new Map() });
                addComponent(world, ent, NEEDS, { hunger: 0, thirst: 0, exhaustion: 0 });
                const headingRng = seedFromString(state.seed + ":npc:heading:" + npc.id);
                addComponent(world, ent, MOVEMENT, { targetPosition: null, heading: headingRng.next() < 0.5 ? 1 : -1 });
                addComponent(world, ent, SEARCHING, createSearching());
                const npcMem = createMemory();
                addComponent(world, ent, MEMORY, npcMem);
                addComponent(world, ent, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
                addComponent(world, ent, SLEEP, {
                    home: { side: npc.side, position: nearestRestArea(npc.position), floor: npc.floor },
                    bedIndex: null, asleep: false, coSleepers: [], awayStreak: 0,
                    nomadic: npc.disposition === "mad",
                });
                addComponent(world, ent, AI, {});

                // NPC personality — biased by corridor side
                const npcPersRng = seedFromString(state.seed + ":npc:pers:" + npc.id);
                const pers = generatePersonality(npcPersRng);
                applySideBias(pers, npc.side === state.side);
                addComponent(world, ent, PERSONALITY, pers);
                const npcBeliefRng = seedFromString(state.seed + ":npc:belief:" + npc.id);
                addComponent(world, ent, BELIEF, generateBelief(npcBeliefRng));
                const npcStatsRng = seedFromString(state.seed + ":npc:stats:" + npc.id);
                addComponent(world, ent, STATS, generateStats(npcStatsRng));

                // Restore persisted ECS state if available
                if (npc.components) {
                    const c = npc.components;
                    if (c.psychology) {
                        const p = getComponent(world, ent, PSYCHOLOGY);
                        p.lucidity = c.psychology.lucidity;
                        p.hope = c.psychology.hope;
                    }
                    if (c.memory) {
                        addComponent(world, ent, MEMORY, {
                            entries: c.memory.entries || [],
                            capacity: c.memory.capacity || 32,
                            nextId: c.memory.nextId || 0,
                        });
                    }
                    if (c.intent) {
                        const it = getComponent(world, ent, INTENT);
                        it.behavior = c.intent.behavior;
                        it.cooldown = c.intent.cooldown;
                        it.elapsed = c.intent.elapsed;
                    }
                    if (c.needs) {
                        const n = getComponent(world, ent, NEEDS);
                        n.hunger = c.needs.hunger;
                        n.thirst = c.needs.thirst;
                        n.exhaustion = c.needs.exhaustion;
                    }
                    if (c.belief) {
                        const b = getComponent(world, ent, BELIEF);
                        b.faith = c.belief.faith;
                        b.faithCrisis = c.belief.faithCrisis;
                        b.stance = c.belief.stance;
                    }
                    if (c.habituation) {
                        addComponent(world, ent, HABITUATION, { exposures: c.habituation.exposures });
                    }
                }
            }

            // Restore relationships after all entities exist (needs Entity id cross-references)
            for (const npc of state.npcs) {
                if (!npc.components || !npc.components.relationships) continue;
                const ent = npcEntities.get(npc.id);
                if (ent === undefined) continue;
                const rels = getComponent(world, ent, RELATIONSHIPS);
                if (!rels) continue;
                const saved = npc.components.relationships.bondsByNpcId;
                for (const [npcIdStr, bond] of Object.entries(saved)) {
                    const npcId = Number(npcIdStr);
                    const otherEnt = npcId === -1 ? playerEntity : npcEntities.get(npcId);
                    if (otherEnt !== undefined && otherEnt !== null) {
                        rels.bonds.set(otherEnt, bond);
                    }
                }
            }
        }

        // Restore player components
        if (state._playerComponents && playerEntity !== null) {
            const c = state._playerComponents;
            if (c.psychology) {
                const p = getComponent(world, playerEntity, PSYCHOLOGY);
                p.lucidity = c.psychology.lucidity;
                p.hope = c.psychology.hope;
            }
            if (c.memory) {
                addComponent(world, playerEntity, MEMORY, {
                    entries: c.memory.entries || [],
                    capacity: c.memory.capacity || 32,
                    nextId: c.memory.nextId || 0,
                });
            }
            if (c.habituation) {
                addComponent(world, playerEntity, HABITUATION, { exposures: c.habituation.exposures });
            }
            if (c.relationships) {
                const rels = getComponent(world, playerEntity, RELATIONSHIPS);
                if (rels) {
                    for (const [npcIdStr, bond] of Object.entries(c.relationships.bondsByNpcId)) {
                        const npcId = Number(npcIdStr);
                        const otherEnt = npcEntities.get(npcId);
                        if (otherEnt !== undefined) {
                            rels.bonds.set(otherEnt, bond);
                        }
                    }
                }
            }
        }

        // Register ECS export as pre-save hook (idempotent — only registers once)
        if (!Social._preSaveRegistered) {
            Engine.onBeforeSave(() => Social.exportComponents());
            Social._preSaveRegistered = true;
        }
    },

    /**
     * Export ECS component state into state.npcs[].components (and state._playerComponents).
     * Called automatically before every save via Engine.onBeforeSave.
     */
    exportComponents() {
        if (!world || !state.npcs) return;

        // Build reverse lookup: Entity → npcId
        const entityToNpcId = new Map();
        for (const [npcId, ent] of npcEntities) {
            entityToNpcId.set(ent, npcId);
        }
        if (playerEntity !== null) {
            entityToNpcId.set(playerEntity, -1);
        }

        for (const npc of state.npcs) {
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;

            const psych = getComponent(world, ent, PSYCHOLOGY);
            const mem = getComponent(world, ent, MEMORY);
            const intent = getComponent(world, ent, INTENT);
            const needs = getComponent(world, ent, NEEDS);
            const belief = getComponent(world, ent, BELIEF);
            const habit = getComponent(world, ent, HABITUATION);
            const rels = getComponent(world, ent, RELATIONSHIPS);

            const components = {};
            if (psych) components.psychology = { lucidity: psych.lucidity, hope: psych.hope };
            if (mem) components.memory = { entries: mem.entries, capacity: mem.capacity, nextId: mem.nextId };
            if (intent) components.intent = { behavior: intent.behavior, cooldown: intent.cooldown, elapsed: intent.elapsed };
            if (needs) components.needs = { hunger: needs.hunger, thirst: needs.thirst, exhaustion: needs.exhaustion };
            if (belief) components.belief = { faith: belief.faith, faithCrisis: belief.faithCrisis, stance: belief.stance };
            if (habit) components.habituation = { exposures: habit.exposures };
            if (rels && rels.bonds.size > 0) {
                const bondsByNpcId = {};
                for (const [otherEnt, bond] of rels.bonds) {
                    const otherId = entityToNpcId.get(otherEnt);
                    if (otherId !== undefined) {
                        bondsByNpcId[otherId] = { ...bond };
                    }
                }
                components.relationships = { bondsByNpcId };
            }

            npc.components = components;
        }

        // Export player components
        if (playerEntity !== null) {
            const psych = getComponent(world, playerEntity, PSYCHOLOGY);
            const mem = getComponent(world, playerEntity, MEMORY);
            const habit = getComponent(world, playerEntity, HABITUATION);
            const rels = getComponent(world, playerEntity, RELATIONSHIPS);
            const playerComps = {};
            if (psych) playerComps.psychology = { lucidity: psych.lucidity, hope: psych.hope };
            if (mem) playerComps.memory = { entries: mem.entries, capacity: mem.capacity, nextId: mem.nextId };
            if (habit) playerComps.habituation = { exposures: habit.exposures };
            if (rels && rels.bonds.size > 0) {
                const bondsByNpcId = {};
                for (const [otherEnt, bond] of rels.bonds) {
                    const otherId = entityToNpcId.get(otherEnt);
                    if (otherId !== undefined) {
                        bondsByNpcId[otherId] = { ...bond };
                    }
                }
                playerComps.relationships = { bondsByNpcId };
            }
            state._playerComponents = playerComps;
        }
    },

    /** Sync player state from game state into ECS. Call before tick systems. */
    syncPlayerPosition() {
        if (!world || playerEntity === null) return;
        const pos = getComponent(world, playerEntity, POSITION);
        if (pos) {
            pos.side = state.side;
            pos.position = BigInt(state.position);
            pos.floor = BigInt(state.floor);
        }
        // Keep player alive status in sync
        const ident = getComponent(world, playerEntity, IDENTITY);
        if (ident) ident.alive = !state.dead;
        // Sync needs from state → ECS (survival.js is source of truth for player)
        const needs = getComponent(world, playerEntity, NEEDS);
        if (needs) {
            needs.hunger = state.hunger || 0;
            needs.thirst = state.thirst || 0;
            needs.exhaustion = state.exhaustion || 0;
        }

        // When possessing, sync player state back to the possessed NPC
        if (state._possessedNpcId != null) {
            const npc = state.npcs && state.npcs.find(n => n.id === state._possessedNpcId);
            if (npc) {
                npc.side = state.side;
                npc.position = BigInt(state.position);
                npc.floor = BigInt(state.floor);
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

        const currentTick = (state.day - 1) * TICKS_PER_DAY + state.tick;

        // Build location index once, share between relationship + group systems
        const prebuilt = buildLocationIndex(world);

        // Snapshot group membership before formation/dissolution (for witnessEvents)
        const prevGroups = new Map(); // entity → groupId
        for (const [npcId, ent] of npcEntities) {
            const g = getComponent(world, ent, GROUP);
            if (g) prevGroups.set(ent, g.groupId);
        }
        if (playerEntity !== null) {
            const g = getComponent(world, playerEntity, GROUP);
            if (g) prevGroups.set(playerEntity, g.groupId);
        }

        // Snapshot bond familiarity before relationship system (for MET_SOMEONE detection)
        // Map: entity → Map<otherEntity, familiarity>
        const BOND_THRESHOLD = 1.0;
        const prevFamiliarity = new Map();
        const allEntities = [...npcEntities.values()];
        if (playerEntity !== null) allEntities.push(playerEntity);
        for (const ent of allEntities) {
            const rels = getComponent(world, ent, RELATIONSHIPS);
            if (!rels) continue;
            const snap = new Map();
            for (const [other, bond] of rels.bonds) snap.set(other, bond.familiarity);
            prevFamiliarity.set(ent, snap);
        }

        // Core systems — order matters
        relationshipSystem(world, currentTick, undefined, prebuilt, n);
        psychologyDecaySystem(world, undefined, n);
        groupFormationSystem(world, undefined, prebuilt);
        const dismissRng = seedFromString(state.seed + ":npc:dismiss:" + currentTick);
        npcDismissSystem(world, dismissRng);
        socialPressureSystem(world, undefined, undefined, undefined, n);

        // Needs (before intent evaluation — intent reads needs)
        needsSystem(world, state.lightsOn, undefined, n);

        // Intent arbiter (before movement/search — they read intent)
        const intentRng = seedFromString(state.seed + ":npc:intent:" + currentTick);
        intentSystem(world, intentRng, undefined, state.tick);

        // NPC action dispatch — normal mode uses shared resolveAction,
        // batch mode (godmode) uses the optimized movementSystem.
        if (n <= 1) {
            const globalCtx = {
                lightsOn: state.lightsOn,
                tick: state.tick,
                day: state.day,
                seed: state.seed,
            };
            for (const [npcId, ent] of npcEntities) {
                tickNpcAction(world, ent, globalCtx);
            }
            // Autonomous player (godmode): run through same action dispatch
            if (playerEntity !== null && hasComponent(world, playerEntity, AI)) {
                tickNpcAction(world, playerEntity, globalCtx);
                // Sync position back to state
                const pos = getComponent(world, playerEntity, POSITION);
                if (pos) {
                    state.side = pos.side;
                    state.position = pos.position;
                    state.floor = pos.floor;
                }
            }
        } else {
            // Batch mode: movement system handles bulk position updates
            const moveRng = seedFromString(state.seed + ":npc:move:" + currentTick);
            movementSystem(world, moveRng, undefined, n);
        }

        // Mercy kiosk detection for NPCs — after movement, before search
        for (const [npcId, ent] of npcEntities) {
            const pos = getComponent(world, ent, POSITION);
            const mem = getComponent(world, ent, MEMORY);
            const bookVision = mem ? getBookVision(mem) : null;
            if (!pos || !bookVision || !bookVision.coords || !bookVision.accurate) continue;
            if (!isRestArea(pos.position)) continue;

            const mercy = mercyKiosk(pos, bookVision.coords);
            if (!mercy) continue;

            // mem already fetched above for bookVision check
            if (!mem) continue;
            if (hasRecentMemory(mem, MEMORY_TYPES.REACHED_MERCY, null, currentTick, Infinity)) continue;

            const tc = DEFAULT_MEMORY_CONFIG.types[MEMORY_TYPES.REACHED_MERCY];
            addMemory(mem, {
                id: mem.nextId++,
                type: MEMORY_TYPES.REACHED_MERCY,
                tick: currentTick,
                weight: tc.initialWeight,
                initialWeight: tc.initialWeight,
                permanent: tc.permanent,
                subject: null,
                contagious: tc.contagious,
            });

            const psych = getComponent(world, ent, PSYCHOLOGY);
            if (psych) {
                psych.hope = Math.min(100, psych.hope + 40);
            }
        }

        // Book searching (only for search intent)
        const searchRng = seedFromString(state.seed + ":npc:search:" + currentTick);
        const pageSampler = (side, position, floor, bookIndex, pageIndex) =>
            generateBookPage(side, position, floor, bookIndex, pageIndex, state.seed, 400);
        const fastWordFinder = (side, position, floor, bookIndex, pageIndex) =>
            findWordsFromSeed(state.seed, side, position, floor, bookIndex, pageIndex);
        const searchEvents = searchSystem(world, searchRng, pageSampler, undefined, fastWordFinder);

        // FOUND_WORDS is self-witnessed — apply memory directly to the finder
        if (searchEvents && searchEvents.length > 0) {
            for (const se of searchEvents) {
                if (!se.words || se.words.length === 0) continue;
                const ent = se.entity;
                const ident = getComponent(world, ent, IDENTITY);
                if (!ident || !ident.alive) continue;
                let mem = getComponent(world, ent, MEMORY);
                if (!mem) { mem = createMemory(); addComponent(world, ent, MEMORY, mem); }
                // Only create foundWords memory if this is a new personal best
                // (otherwise the player's memory fills with daily word-finds)
                const sp = getSearchProgress(mem, false);
                const prevBest = sp ? sp.bestScore : 0;
                if (se.words.length > prevBest && !hasRecentMemory(mem, MEMORY_TYPES.FOUND_WORDS, ent, currentTick, DEFAULT_MEMORY_CONFIG.dedupWindow)) {
                    const tc = DEFAULT_MEMORY_CONFIG.types[MEMORY_TYPES.FOUND_WORDS];
                    mem.entries.push({
                        id: mem.nextId++,
                        type: MEMORY_TYPES.FOUND_WORDS,
                        tick: currentTick,
                        weight: tc.initialWeight,
                        initialWeight: tc.initialWeight,
                        permanent: tc.permanent,
                        subject: ent,
                        contagious: tc.contagious,
                    });
                    // foundWords has no acute shockKey — hope boost is handled by searchSystem
                }
            }
        }

        // NPC-to-NPC socialization (share knowledge, build bonds)
        socializeSystem(world, currentTick);

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

        // Collect witness events from escape/chasm/falling/disposition changes
        const witnessEvents = [];
        // Drain any events queued from outside the tick cycle
        while (pendingWitnessEvents.length > 0) witnessEvents.push(pendingWitnessEvents.pop());

        // Detect new bonds (familiarity crossed threshold).
        // Apply MET_SOMEONE directly to both parties (full weight), then push a
        // sight-range witnessEvent for bystanders (minor hope boost, same weight from config).
        const reportedBonds = new Set(); // "minEnt:maxEnt" to avoid double-emit per pair
        const tc_met = DEFAULT_MEMORY_CONFIG.types[MEMORY_TYPES.MET_SOMEONE];
        for (const ent of allEntities) {
            const rels = getComponent(world, ent, RELATIONSHIPS);
            if (!rels) continue;
            const prev = prevFamiliarity.get(ent);
            if (!prev) continue;
            const ident = getComponent(world, ent, IDENTITY);
            if (!ident || !ident.alive) continue;
            for (const [other, bond] of rels.bonds) {
                const prevFam = prev.get(other) ?? 0;
                if (prevFam < BOND_THRESHOLD && bond.familiarity >= BOND_THRESHOLD) {
                    const pairKey = Math.min(ent, other) + ":" + Math.max(ent, other);
                    if (reportedBonds.has(pairKey)) continue;
                    reportedBonds.add(pairKey);
                    const pos = getComponent(world, ent, POSITION);
                    if (!pos) continue;
                    const eventPos = { side: pos.side, position: pos.position, floor: pos.floor };

                    // Apply directly to both parties
                    for (const party of [ent, other]) {
                        const partyIdent = getComponent(world, party, IDENTITY);
                        if (!partyIdent || !partyIdent.alive) continue;
                        let mem = getComponent(world, party, MEMORY);
                        if (!mem) { mem = createMemory(); addComponent(world, party, MEMORY, mem); }
                        if (!hasRecentMemory(mem, MEMORY_TYPES.MET_SOMEONE, other, currentTick, DEFAULT_MEMORY_CONFIG.dedupWindow)) {
                            const partyWeight = 4; // parties get stronger memory than bystanders
                            mem.entries.push({
                                id: mem.nextId++,
                                type: MEMORY_TYPES.MET_SOMEONE,
                                tick: currentTick,
                                weight: partyWeight,
                                initialWeight: partyWeight,
                                permanent: tc_met.permanent,
                                subject: other,
                                contagious: tc_met.contagious,
                            });
                        }
                    }

                    // Bystanders within sight get a weaker version via witnessSystem
                    witnessEvents.push({
                        type: MEMORY_TYPES.MET_SOMEONE,
                        subject: other,
                        position: eventPos,
                        bondedOnly: false,
                        range: "sight",
                    });
                }
            }
        }

        // Detect group dissolutions: self-witnessed by the entity that lost their group
        for (const [ent, prevGroupId] of prevGroups) {
            const g = getComponent(world, ent, GROUP);
            if (!g || g.groupId !== prevGroupId) {
                const ident = getComponent(world, ent, IDENTITY);
                if (!ident || !ident.alive) continue;
                let mem = getComponent(world, ent, MEMORY);
                if (!mem) { mem = createMemory(); addComponent(world, ent, MEMORY, mem); }
                if (!hasRecentMemory(mem, MEMORY_TYPES.GROUP_DISSOLVED, ent, currentTick, DEFAULT_MEMORY_CONFIG.dedupWindow)) {
                    const tc = DEFAULT_MEMORY_CONFIG.types[MEMORY_TYPES.GROUP_DISSOLVED];
                    mem.entries.push({
                        id: mem.nextId++,
                        type: MEMORY_TYPES.GROUP_DISSOLVED,
                        tick: currentTick,
                        weight: tc.initialWeight,
                        initialWeight: tc.initialWeight,
                        permanent: tc.permanent,
                        subject: ent,
                        contagious: tc.contagious,
                    });
                    // Apply acute shock
                    applyShockToEntity(world, ent, "groupDissolved");
                }
            }
        }

        // Escape check: pilgrims who arrived at their book, or have book at rest area
        this.checkEscapes(witnessEvents);

        // NPC chasm AI: check for jumps, advance falling
        this.checkNpcChasmJump(witnessEvents);
        this.tickNpcFalling(witnessEvents);

        // Write derived disposition back to state.npcs
        for (const npc of state.npcs) {
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const psych = getComponent(world, ent, PSYCHOLOGY);
            const ident = getComponent(world, ent, IDENTITY);
            if (!psych || !ident) continue;

            const mem = getComponent(world, ent, MEMORY);
            const bv = mem ? getBookVision(mem) : null;
            const onPilgrimage = !!(bv && bv.coords && bv.state !== "exhausted" && ident.alive);
            const prevDisposition = npc.disposition;
            npc.disposition = deriveDisposition(psych, ident.alive, undefined, onPilgrimage);

            // Detect madness transition
            const wentMad = prevDisposition !== "mad" && npc.disposition === "mad";
            if (wentMad && ident.alive) {
                const pos = getComponent(world, ent, POSITION);
                if (pos) {
                    const eventPos = { side: pos.side, position: pos.position, floor: pos.floor };
                    witnessEvents.push({
                        type: MEMORY_TYPES.WITNESS_MADNESS,
                        subject: ent,
                        position: eventPos,
                        bondedOnly: false,
                        range: "colocated",
                    });
                    witnessEvents.push({
                        type: MEMORY_TYPES.COMPANION_MAD,
                        subject: ent,
                        position: eventPos,
                        bondedOnly: true,
                        range: "sight",
                    });
                }
            }

            // Sync alive status back; emit death events
            if (!ident.alive && npc.alive) {
                const needs = getComponent(world, ent, NEEDS);
                console.log("NPC DEATH (ECS sync):", npc.name, "id="+npc.id,
                    "needs:", needs ? {h:Math.round(needs.hunger), t:Math.round(needs.thirst), e:Math.round(needs.exhaustion)} : "none",
                    "tick="+state.tick, "day="+state.day);
                npc.alive = false;

                const pos = getComponent(world, ent, POSITION);
                if (pos) {
                    const eventPos = { side: pos.side, position: pos.position, floor: pos.floor };
                    witnessEvents.push({
                        type: MEMORY_TYPES.FOUND_BODY,
                        subject: ent,
                        position: eventPos,
                        bondedOnly: false,
                        range: "colocated",
                    });
                    witnessEvents.push({
                        type: MEMORY_TYPES.COMPANION_DIED,
                        subject: ent,
                        position: eventPos,
                        bondedOnly: true,
                        range: "sight",
                    });
                }
            }
        }

        // Memory systems — witness events create lasting psychological scars
        witnessSystem(world, witnessEvents, currentTick, prebuilt);
        memoryDecaySystem(world, undefined, n);

        // Emit directly to objective log — avoids batch-tick snapshot-diff blindspots
        const logEntries = [];
        for (const ev of witnessEvents) {
            // Resolve entity → npc id + name for the log
            let npcId = null;
            let npcName = null;
            const subjectIdent = getComponent(world, ev.subject, IDENTITY);
            if (subjectIdent) npcName = subjectIdent.name;
            // Find npc id by reverse-lookup
            for (const [id, ent] of npcEntities) {
                if (ent === ev.subject) { npcId = id; break; }
            }
            if (npcId === null) continue; // player or unknown entity — skip

            const pos = ev.position;
            const locStr = pos ? " (s" + pos.position + " f" + pos.floor + ")" : "";
            switch (ev.type) {
                case MEMORY_TYPES.WITNESS_ESCAPE:
                    logEntries.push({ tick: currentTick, day: state.day, type: "escape",
                        text: npcName + " submitted their book and is FREE.", npcIds: [npcId], position: pos });
                    break;
                case MEMORY_TYPES.WITNESS_CHASM:
                    logEntries.push({ tick: currentTick, day: state.day, type: "chasm",
                        text: npcName + " jumped into the chasm" + locStr + ".", npcIds: [npcId], position: pos });
                    break;
                case MEMORY_TYPES.WITNESS_MADNESS:
                    logEntries.push({ tick: currentTick, day: state.day, type: "disposition",
                        text: npcName + " went mad.", npcIds: [npcId], position: pos });
                    break;
                case MEMORY_TYPES.FOUND_BODY:
                    logEntries.push({ tick: currentTick, day: state.day, type: "death",
                        text: npcName + " died" + locStr + ".", npcIds: [npcId], position: pos });
                    break;
                case MEMORY_TYPES.MET_SOMEONE:
                    logEntries.push({ tick: currentTick, day: state.day, type: "bond",
                        text: npcName + " became known.", npcIds: [npcId], position: pos });
                    break;
                // COMPANION_DIED, COMPANION_MAD, WITNESS_ESCAPE(bonded) — skip, duplicates above
            }
        }
        if (searchEvents && searchEvents.length > 0) {
            for (const se of searchEvents) {
                if (!se.words || se.words.length === 0) continue;
                const ident = getComponent(world, se.entity, IDENTITY);
                if (!ident || !ident.alive) continue;
                let npcId = null;
                for (const [id, ent] of npcEntities) {
                    if (ent === se.entity) { npcId = id; break; }
                }
                if (npcId === null) continue;
                const wordStr = "\u201c" + se.words.join(" ") + "\u201d";
                logEntries.push({ tick: currentTick, day: state.day, type: "search",
                    text: ident.name + " found " + wordStr + " in a book!", npcIds: [npcId] });
            }
        }
        if (logEntries.length > 0) appendEvents(logEntries);

        // Sync player needs from ECS → state (ECS is authority)
        if (playerEntity !== null) {
            const pNeeds = getComponent(world, playerEntity, NEEDS);
            if (pNeeds) {
                state.hunger = pNeeds.hunger;
                state.thirst = pNeeds.thirst;
                state.exhaustion = pNeeds.exhaustion;
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
        const currentTick = (state.day - 1) * TICKS_PER_DAY + state.tick;
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

    /**
     * Enable/disable autonomous player — intent system scores behaviors
     * and tickNpcAction resolves movement for the player entity.
     * Used by godmode to make the player autopilot (pilgrimage, etc).
     */
    setPlayerAutonomous(enabled) {
        if (!world || playerEntity === null) return;
        if (enabled) {
            addComponent(world, playerEntity, AI, {});
        } else {
            removeComponent(world, playerEntity, AI);
        }
    },

    /** Resolve an ECS entity to a display name. */
    getEntityName(entity) {
        if (!world) return null;
        const ident = getComponent(world, entity, IDENTITY);
        return ident ? ident.name : null;
    },

    /** Get player memory component (for introspection screen). */
    getPlayerMemory() {
        if (!world || playerEntity === null) return null;
        return getComponent(world, playerEntity, MEMORY);
    },

    /** Get NPC memory component (for godmode / narrative). */
    getNpcMemory(npcId) {
        const ent = npcEntities.get(npcId);
        if (ent === undefined || !world) return null;
        return getComponent(world, ent, MEMORY);
    },

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

    /** Get player memory (bookVision and search progress). */
    getPlayerKnowledge() {
        if (!world || playerEntity === null) return null;
        return getComponent(world, playerEntity, MEMORY);
    },

    /** Get NPC memory for debug/UI. */
    getNpcKnowledge(npcId) {
        const ent = npcEntities.get(npcId);
        if (ent === undefined || !world) return null;
        return getComponent(world, ent, MEMORY);
    },

    /**
     * Grant a divine vision to an NPC, revealing their book location.
     * Default: vague vision (NPC searches ±50 segments around jittered coords).
     * Pass vague=false for exact vision (NPC walks to precise coords).
     * Returns true if vision was granted.
     */
    grantVision(npcId, { accurate = true, vague = true } = {}) {
        const ent = npcEntities.get(npcId);
        if (ent === undefined || !world) return false;
        const ident = getComponent(world, ent, IDENTITY);
        if (!ident || ident.free || !ident.lifeStory) return false;

        // Grant on Memory
        let mem = getComponent(world, ent, MEMORY);
        if (!mem) { mem = createMemory(); addComponent(world, ent, MEMORY, mem); }
        if (accurate && vague) {
            grantVagueBookVision(mem, ident.lifeStory.bookCoords, 50, state.tick);
        } else if (accurate) {
            grantBookVision(mem, ident.lifeStory.bookCoords, state.tick);
        }

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

    /**
     * Get the group leader's home location, if the player is in a group.
     * Returns { side, position, floor } or null.
     */
    getGroupHome() {
        if (!world || playerEntity === null) return null;
        const playerGroup = getComponent(world, playerEntity, GROUP);
        if (!playerGroup || playerGroup.leaderId == null) return null;
        const leaderSleep = getComponent(world, playerGroup.leaderId, SLEEP);
        if (!leaderSleep || !leaderSleep.home) return null;
        return leaderSleep.home;
    },

    // --- Escape resolution ---

    /**
     * Check pilgrimage arrivals and handle book discovery.
     *
     * Vague path: NPC arrives in vision radius, searches, all noise,
     * eventually exhausts the zone → trauma.
     *
     * Exact path: NPC arrives at exact coords, picks up book,
     * walks to rest area, opens it → noise → trauma.
     *
     * Neither path leads to escape (wrong universe).
     */
    checkEscapes(witnessEvents = []) {
        if (!world || !state.npcs) return;
        for (const npc of state.npcs) {
            if (!npc.alive) continue;
            const ent = npcEntities.get(npc.id);
            if (ent === undefined) continue;
            const ident = getComponent(world, ent, IDENTITY);
            if (!ident || ident.free) continue;

            // Read from Memory (primary)
            let mem = getComponent(world, ent, MEMORY);
            if (!mem) continue;
            const entry = getBookVision(mem);
            if (!entry || entry.state === "exhausted") continue;
            if (!entry.coords || !entry.accurate) continue;

            const pos = getComponent(world, ent, POSITION);
            if (!pos) continue;

            if (entry.vague) {
                // --- Vague path: check if NPC has searched enough of the vision zone ---
                if (!isInVisionRadius(entry, pos)) continue;

                // Count how many segments within the vision radius have been searched
                const visionPos = entry.coords.position;
                const radius = BigInt(entry.radius);
                let searchedInZone = 0;
                let totalInZone = 0;
                for (let offset = -radius; offset <= radius; offset++) {
                    const segPos = visionPos + offset;
                    totalInZone++;
                    if (isSegmentSearched(mem, pos.side, segPos, pos.floor)) {
                        searchedInZone++;
                    }
                }

                // Need to have searched at least 60% of the zone
                if (searchedInZone < totalInZone * 0.6) continue;

                // --- Exhaustion: the zone is searched, nothing legible found ---
                entry.state = "exhausted";
                entry.coords = null;
                // Mutate to pilgrimageFailure for psychological impact
                const pfConfig = DEFAULT_MEMORY_CONFIG.types["pilgrimageFailure"];
                entry.type = "pilgrimageFailure";
                entry.weight = pfConfig.initialWeight;
                entry.initialWeight = pfConfig.initialWeight;

                // Apply trauma
                const psych = getComponent(world, ent, PSYCHOLOGY);
                if (psych) {
                    applyShockToEntity(world, ent, "pilgrimageFailure");
                }

                console.log("PILGRIMAGE FAILED:", npc.name, "id=" + npc.id,
                    "searched", searchedInZone + "/" + totalInZone, "segments",
                    "at s" + pos.position, "f" + pos.floor,
                    "day=" + state.day, "tick=" + state.tick);

            } else {
                // --- Exact path: pick up book, walk to rest area, discover noise ---
                if (entry.state !== "found") {
                    if (isAtBookSegment(entry, pos)) {
                        entry.state = "found";
                    }
                    continue;
                }

                // Has book + at rest area → "opens" it → noise → trauma
                if (!isRestArea(pos.position)) continue;

                entry.state = "exhausted";
                entry.coords = null;
                // Mutate to pilgrimageFailure
                const pfConfig = DEFAULT_MEMORY_CONFIG.types["pilgrimageFailure"];
                entry.type = "pilgrimageFailure";
                entry.weight = pfConfig.initialWeight;
                entry.initialWeight = pfConfig.initialWeight;

                const psych = getComponent(world, ent, PSYCHOLOGY);
                if (psych) {
                    applyShockToEntity(world, ent, "pilgrimageFailure");
                }

                console.log("PILGRIMAGE FAILED (exact):", npc.name, "id=" + npc.id,
                    "at s" + pos.position, "f" + pos.floor,
                    "day=" + state.day, "tick=" + state.tick);
            }
        }
    },

    // --- NPC chasm falling ---

    /**
     * Tick all falling NPCs. Called once per tick from onTick().
     * Each falling NPC gets physics + auto-grab attempt.
     */
    tickNpcFalling(witnessEvents = []) {
        if (!state.npcs) return;
        for (const npc of state.npcs) {
            if (!npc.falling || !npc.alive) continue;
            // Skip possessed NPC — player controls their falling via normal screens
            if (state._possessedNpcId === npc.id) continue;

            const result = fallTick(npc.falling, Number(npc.floor));
            npc.floor = BigInt(result.newFloor);
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
                    const tick = (state.day - 1) * TICKS_PER_DAY + state.tick;
                    appendEvents([{ tick, day: state.day, type: "death",
                        text: npc.name + " hit the ground at floor " + npc.floor + ".",
                        npcIds: [npc.id],
                        position: { side: npc.side, position: npc.position, floor: npc.floor } }]);
                }
                continue;
            }

            // Auto-grab: NPCs try every few ticks when speed is manageable
            if (npc.falling.speed > 0 && npc.falling.speed < 30) {
                const grabRng = seedFromString(state.seed + ":npcgrab:" + npc.id + ":" + state.tick + ":" + npc.floor);
                // NPCs only attempt grab 20% of eligible ticks (they're panicking)
                if (grabRng.next() < 0.2) {
                    const ent2 = npcEntities.get(npc.id);
                    const npcStats = ent2 !== undefined ? getComponent(world, ent2, STATS) : null;
                    const qBonus = npcStats ? Math.max(0, quicknessMod(npcStats) - 1) * 0.2 : 0;
                    const grabResult = attemptGrab(npc.falling.speed, grabRng, qBonus);
                    if (grabResult.success) {
                        npc.falling = null;
                        const tick = (state.day - 1) * TICKS_PER_DAY + state.tick;
                        appendEvents([{ tick, day: state.day, type: "chasm",
                            text: npc.name + " caught a railing at floor " + npc.floor + ".",
                            npcIds: [npc.id],
                            position: { side: npc.side, position: npc.position, floor: npc.floor } }]);
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
                            const tick = (state.day - 1) * TICKS_PER_DAY + state.tick;
                            appendEvents([{ tick, day: state.day, type: "death",
                                text: npc.name + " died from impact at floor " + npc.floor + ".",
                                npcIds: [npc.id],
                                position: { side: npc.side, position: npc.position, floor: npc.floor } }]);
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
    checkNpcChasmJump(witnessEvents = []) {
        if (!state.npcs) return;
        for (const npc of state.npcs) {
            if (!npc.alive || npc.falling) continue;
            if (npc.floor <= 0n) continue; // can't fall from bottom
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
                // Emit witnessChasm event (sight range — visible from either side)
                witnessEvents.push({
                    type: MEMORY_TYPES.WITNESS_CHASM,
                    subject: ent,
                    position: { side: npc.side, position: npc.position, floor: npc.floor },
                    bondedOnly: false,
                    range: "sight",
                });
            }
        }
    },

    /**
     * Make a specific NPC jump into the chasm. Called from godmode possess.
     */
    npcJump(npcId) {
        const npc = state.npcs && state.npcs.find(n => n.id === npcId);
        if (!npc || !npc.alive || npc.floor <= 0n) return false;
        npc.falling = { speed: 0, floorsToFall: 0, side: npc.side };
        // Queue witness event for next tick
        const ent = npcEntities.get(npcId);
        if (ent !== undefined) {
            pendingWitnessEvents.push({
                type: MEMORY_TYPES.WITNESS_CHASM,
                subject: ent,
                position: { side: npc.side, position: npc.position, floor: npc.floor },
                bondedOnly: false,
                range: "sight",
            });
        }
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

    // --- Player social actions ---

    talk(npcId, approach) {
        if (!world || playerEntity === null) return { success: false, reason: "no_world" };
        const ent = npcEntities.get(npcId);
        if (ent === undefined) return { success: false, reason: "not_found" };
        const currentTick = (state.day - 1) * TICKS_PER_DAY + state.tick;
        this.syncPlayerPosition();
        return talkTo(world, playerEntity, ent, approach, currentTick);
    },

    spendTimeWith(npcId) {
        if (!world || playerEntity === null) return { success: false, reason: "no_world" };
        const ent = npcEntities.get(npcId);
        if (ent === undefined) return { success: false, reason: "not_found" };
        const currentTick = (state.day - 1) * TICKS_PER_DAY + state.tick;
        this.syncPlayerPosition();
        return spendTimeCore(world, playerEntity, ent, currentTick);
    },

    recruit(npcId) {
        if (!world || playerEntity === null) return { success: false, reason: "no_world", joined: false };
        const ent = npcEntities.get(npcId);
        if (ent === undefined) return { success: false, reason: "not_found", joined: false };
        const currentTick = (state.day - 1) * TICKS_PER_DAY + state.tick;
        this.syncPlayerPosition();
        return recruitCore(world, playerEntity, ent, currentTick);
    },

    dismissFromGroup(npcId) {
        if (!world || playerEntity === null) return { success: false, reason: "no_world" };
        const ent = npcEntities.get(npcId);
        if (ent === undefined) return { success: false, reason: "not_found" };
        const playerGroup = getComponent(world, playerEntity, GROUP);
        const npcGroup = getComponent(world, ent, GROUP);
        if (!playerGroup || !npcGroup || playerGroup.groupId !== npcGroup.groupId) {
            return { success: false, reason: "not_in_group" };
        }
        dismissCore(world, playerEntity, ent);
        return { success: true };
    },

    isInPlayerGroup(npcId) {
        if (!world || playerEntity === null) return false;
        const playerGroup = getComponent(world, playerEntity, GROUP);
        if (!playerGroup) return false;
        const ent = npcEntities.get(npcId);
        if (ent === undefined) return false;
        const npcGroup = getComponent(world, ent, GROUP);
        return npcGroup && npcGroup.groupId === playerGroup.groupId;
    },

    getBond(npcId) {
        if (!world || playerEntity === null) return null;
        const ent = npcEntities.get(npcId);
        if (ent === undefined) return null;
        const rels = getComponent(world, playerEntity, RELATIONSHIPS);
        if (!rels) return null;
        const bond = rels.bonds.get(ent);
        if (!bond) return null;
        return { familiarity: bond.familiarity, affinity: bond.affinity };
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
                const dir = npcPos.position > playerPos.position ? "right"
                           : npcPos.position < playerPos.position ? "left"
                           : "here";
                result.push({ name: npc.name, disposition: disp, distance: dist, id: npc.id, direction: dir });
            }
        }
        result.sort((a, b) => a.distance - b.distance);
        return result;
    },

    /** Get the current entity's quickness bonus for grab chance (0 if no stats). */
    getQuicknessGrabBonus() {
        if (!world || playerEntity === null) return 0;
        const stats = getComponent(world, playerEntity, STATS);
        return stats ? Math.max(0, quicknessMod(stats) - 1) * 0.2 : 0;
    },
};
