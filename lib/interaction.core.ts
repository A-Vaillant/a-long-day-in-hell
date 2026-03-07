/**
 * Social interaction — talk, spend time, recruit.
 *
 * High-level abstracted actions. No dialogue trees, no branching.
 * You approach someone. The interaction resolves. Effects apply.
 *
 * @module interaction.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, query } from "./ecs.core.ts";
import { INTENT, type Intent } from "./intent.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP,
    coLocated, getOrCreateBond, accumulateBond, modifyAffinity,
    hasMutualBond, DEFAULT_BOND, DEFAULT_GROUP,
    type Position, type Identity, type Psychology, type Relationships, type Bond,
    type BondConfig, type GroupConfig,
} from "./social.core.ts";
import { applyShockToEntity } from "./psych.core.ts";
import { STATS, type Stats, influenceMod } from "./stats.core.ts";
import { KNOWLEDGE, type Knowledge, shareSearchKnowledge } from "./knowledge.core.ts";

// --- Talk ---

/** How the player approaches the conversation. */
export type Approach = "kind" | "neutral" | "dismissive";

export interface TalkResult {
    success: boolean;
    /** Why it failed, if it did. */
    reason?: string;
    /** The NPC's disposition at time of interaction. */
    disposition: string;
    /** Affinity change applied to NPC→player bond. */
    affinityDelta: number;
    /** Affinity change applied to player→NPC bond. */
    playerAffinityDelta: number;
    /** Hope change on NPC. */
    npcHopeDelta: number;
    /** Hope change on player. */
    playerHopeDelta: number;
    /** Segments player learned from NPC. */
    segmentsLearned: number;
    /** Segments NPC learned from player. */
    segmentsShared: number;
}

export interface TalkConfig {
    /** Affinity NPC gains toward player per approach. */
    affinityGain: Record<Approach, number>;
    /** Affinity player gains toward NPC per approach. */
    playerAffinityGain: Record<Approach, number>;
    /** Hope effect on NPC per approach. */
    npcHopeEffect: Record<Approach, number>;
    /** Hope effect on player from the interaction. */
    playerHopeEffect: Record<Approach, number>;
    /** Familiarity boost from a conversation (on top of passive). */
    familiarityBoost: number;
    /** Ticks the conversation takes. */
    tickCost: number;
}

export const DEFAULT_TALK: TalkConfig = {
    affinityGain:       { kind: 3, neutral: 1, dismissive: -2 },
    playerAffinityGain: { kind: 1.5, neutral: 0.5, dismissive: -1 },
    npcHopeEffect:      { kind: 1.5, neutral: 0.3, dismissive: -1 },
    playerHopeEffect:   { kind: 0.8, neutral: 0.2, dismissive: -0.3 },
    familiarityBoost: 2,
    tickCost: 2,
};

/**
 * Resolve a talk interaction between player and NPC.
 * Both must be alive and co-located. Mad/catatonic NPCs can be
 * talked to but with reduced/altered effects.
 */
export function talkTo(
    world: World,
    player: Entity,
    npc: Entity,
    approach: Approach,
    currentTick: number,
    config: TalkConfig = DEFAULT_TALK,
): TalkResult {
    const playerPos = getComponent<Position>(world, player, POSITION);
    const npcPos = getComponent<Position>(world, npc, POSITION);
    const playerIdent = getComponent<Identity>(world, player, IDENTITY);
    const npcIdent = getComponent<Identity>(world, npc, IDENTITY);

    if (!playerPos || !npcPos || !playerIdent || !npcIdent) {
        return { success: false, reason: "missing", disposition: "calm", affinityDelta: 0, playerAffinityDelta: 0, npcHopeDelta: 0, playerHopeDelta: 0, segmentsLearned: 0, segmentsShared: 0 };
    }
    if (!npcIdent.alive) {
        return { success: false, reason: "dead", disposition: "dead", affinityDelta: 0, playerAffinityDelta: 0, npcHopeDelta: 0, playerHopeDelta: 0, segmentsLearned: 0, segmentsShared: 0 };
    }
    if (!coLocated(playerPos, npcPos)) {
        return { success: false, reason: "not_here", disposition: "calm", affinityDelta: 0, playerAffinityDelta: 0, npcHopeDelta: 0, playerHopeDelta: 0, segmentsLearned: 0, segmentsShared: 0 };
    }

    const npcPsych = getComponent<Psychology>(world, npc, PSYCHOLOGY);
    const playerPsych = getComponent<Psychology>(world, player, PSYCHOLOGY);
    if (!npcPsych || !playerPsych) {
        return { success: false, reason: "missing", disposition: "calm", affinityDelta: 0, playerAffinityDelta: 0, npcHopeDelta: 0, playerHopeDelta: 0, segmentsLearned: 0, segmentsShared: 0 };
    }

    // Derive disposition for response flavor
    const disposition = npcPsych.hope <= 15 ? "catatonic" :
                        npcPsych.lucidity <= 40 ? "mad" :
                        (npcPsych.lucidity <= 60 || npcPsych.hope <= 40) ? "anxious" : "calm";

    // Disposition modifiers — mad NPCs are less receptive, catatonic barely respond
    let effectScale = 1.0;
    if (disposition === "catatonic") effectScale = 0.1;
    else if (disposition === "mad") effectScale = 0.4;
    else if (disposition === "anxious") effectScale = 0.7;

    // Source's influence scales outgoing social pressure
    const playerStats = getComponent<Stats>(world, player, STATS);
    const infMod = playerStats ? influenceMod(playerStats) : 1.0;

    // Apply affinity changes
    const affinityDelta = config.affinityGain[approach] * effectScale * infMod;
    const playerAffinityDelta = config.playerAffinityGain[approach];
    modifyAffinity(world, npc, player, affinityDelta, currentTick);
    modifyAffinity(world, player, npc, playerAffinityDelta, currentTick);

    // Familiarity boost (both directions)
    const npcRels = getComponent<Relationships>(world, npc, RELATIONSHIPS);
    const playerRels = getComponent<Relationships>(world, player, RELATIONSHIPS);
    if (npcRels) {
        const bond = getOrCreateBond(npcRels, player, currentTick);
        bond.familiarity = Math.min(100, bond.familiarity + config.familiarityBoost * effectScale * infMod);
    }
    if (playerRels) {
        const bond = getOrCreateBond(playerRels, npc, currentTick);
        bond.familiarity = Math.min(100, bond.familiarity + config.familiarityBoost);
    }

    // Hope effects — source influence scales impact on target
    const npcHopeDelta = config.npcHopeEffect[approach] * effectScale * infMod;
    const playerHopeDelta = config.playerHopeEffect[approach];
    npcPsych.hope = Math.max(0, Math.min(100, npcPsych.hope + npcHopeDelta));
    playerPsych.hope = Math.max(0, Math.min(100, playerPsych.hope + playerHopeDelta));

    // Being dismissive to someone triggers the beingDismissed shock on them
    if (approach === "dismissive") {
        applyShockToEntity(world, npc, "beingDismissed");
    }

    // Share search knowledge — both parties exchange what segments they've checked
    // Dismissive conversations don't share knowledge (you're not really listening)
    let segmentsLearned = 0;
    let segmentsShared = 0;
    if (approach !== "dismissive") {
        const playerKnow = getComponent<Knowledge>(world, player, KNOWLEDGE);
        const npcKnow = getComponent<Knowledge>(world, npc, KNOWLEDGE);
        if (playerKnow && npcKnow) {
            segmentsLearned = shareSearchKnowledge(npcKnow, playerKnow);
            segmentsShared = shareSearchKnowledge(playerKnow, npcKnow);
        }
    }

    return {
        success: true,
        disposition,
        affinityDelta,
        playerAffinityDelta,
        npcHopeDelta,
        playerHopeDelta,
        segmentsLearned,
        segmentsShared,
    };
}

// --- Spend time ---

export interface SpendTimeResult {
    success: boolean;
    reason?: string;
    ticksSpent: number;
    familiarityGained: number;
    affinityGained: number;
}

export interface SpendTimeConfig {
    /** How many ticks "spending time" lasts. */
    duration: number;
    /** Multiplier on bond accumulation vs passive co-location. */
    bondMultiplier: number;
    /** Hope restored per tick of deliberate companionship. */
    hopePerTick: number;
}

export const DEFAULT_SPEND_TIME: SpendTimeConfig = {
    duration: 10,
    bondMultiplier: 3,
    hopePerTick: 0.15,
};

/**
 * Spend deliberate time with an NPC. Accelerated bond accumulation.
 * Must be co-located and alive.
 */
export function spendTime(
    world: World,
    player: Entity,
    npc: Entity,
    currentTick: number,
    config: SpendTimeConfig = DEFAULT_SPEND_TIME,
    bondConfig: BondConfig = DEFAULT_BOND,
): SpendTimeResult {
    const playerPos = getComponent<Position>(world, player, POSITION);
    const npcPos = getComponent<Position>(world, npc, POSITION);
    const npcIdent = getComponent<Identity>(world, npc, IDENTITY);

    if (!playerPos || !npcPos || !npcIdent || !npcIdent.alive) {
        return { success: false, reason: npcIdent && !npcIdent.alive ? "dead" : "missing", ticksSpent: 0, familiarityGained: 0, affinityGained: 0 };
    }
    if (!coLocated(playerPos, npcPos)) {
        return { success: false, reason: "not_here", ticksSpent: 0, familiarityGained: 0, affinityGained: 0 };
    }

    const playerRels = getComponent<Relationships>(world, player, RELATIONSHIPS);
    const npcRels = getComponent<Relationships>(world, npc, RELATIONSHIPS);
    if (!playerRels || !npcRels) {
        return { success: false, reason: "missing", ticksSpent: 0, familiarityGained: 0, affinityGained: 0 };
    }

    const playerPsych = getComponent<Psychology>(world, player, PSYCHOLOGY);
    const npcPsych = getComponent<Psychology>(world, npc, PSYCHOLOGY);

    // Each entity's influence scales the bond they build on the other
    const playerStats = getComponent<Stats>(world, player, STATS);
    const npcStats = getComponent<Stats>(world, npc, STATS);
    const playerInf = playerStats ? influenceMod(playerStats) : 1.0;
    const npcInf = npcStats ? influenceMod(npcStats) : 1.0;

    // Accelerated bond accumulation for duration ticks
    const npcBondConfig: BondConfig = {
        ...bondConfig,
        familiarityPerTick: bondConfig.familiarityPerTick * config.bondMultiplier * playerInf,
        affinityPerTick: bondConfig.affinityPerTick * config.bondMultiplier * playerInf,
    };
    const playerBondConfig: BondConfig = {
        ...bondConfig,
        familiarityPerTick: bondConfig.familiarityPerTick * config.bondMultiplier * npcInf,
        affinityPerTick: bondConfig.affinityPerTick * config.bondMultiplier * npcInf,
    };

    const playerBondBefore = getOrCreateBond(playerRels, npc, currentTick);
    const famBefore = playerBondBefore.familiarity;
    const affBefore = playerBondBefore.affinity;

    for (let t = 0; t < config.duration; t++) {
        const pBond = getOrCreateBond(playerRels, npc, currentTick);
        accumulateBond(pBond, currentTick, playerBondConfig);
        const nBond = getOrCreateBond(npcRels, player, currentTick);
        accumulateBond(nBond, currentTick, npcBondConfig);

        // Hope restoration from companionship
        if (playerPsych) playerPsych.hope = Math.min(100, playerPsych.hope + config.hopePerTick);
        if (npcPsych) npcPsych.hope = Math.min(100, npcPsych.hope + config.hopePerTick);
    }

    const playerBondAfter = getOrCreateBond(playerRels, npc, currentTick);

    return {
        success: true,
        ticksSpent: config.duration,
        familiarityGained: playerBondAfter.familiarity - famBefore,
        affinityGained: playerBondAfter.affinity - affBefore,
    };
}

// --- Recruit ---

export interface RecruitResult {
    success: boolean;
    reason?: string;
    /** True if they joined your group. */
    joined: boolean;
}

export interface RecruitConfig {
    /** Minimum familiarity (player→NPC) to attempt recruitment. */
    minFamiliarity: number;
    /** Minimum affinity (NPC→player) to accept. */
    minAffinity: number;
    /** Dispositions that can't be recruited. */
    blockedDispositions: string[];
}

export const DEFAULT_RECRUIT: RecruitConfig = {
    minFamiliarity: 15,
    minAffinity: 8,
    blockedDispositions: ["mad", "catatonic"],
};

/**
 * Attempt to recruit an NPC to your group.
 * Requires sufficient familiarity and mutual affinity.
 * Mad/catatonic NPCs refuse.
 *
 * On success, boosts both bonds above the grouping threshold
 * so the group formation system picks them up next tick.
 */
export function recruit(
    world: World,
    player: Entity,
    npc: Entity,
    currentTick: number,
    config: RecruitConfig = DEFAULT_RECRUIT,
    groupConfig: GroupConfig = DEFAULT_GROUP,
): RecruitResult {
    const playerPos = getComponent<Position>(world, player, POSITION);
    const npcPos = getComponent<Position>(world, npc, POSITION);
    const npcIdent = getComponent<Identity>(world, npc, IDENTITY);

    if (!playerPos || !npcPos || !npcIdent || !npcIdent.alive) {
        return { success: false, reason: npcIdent && !npcIdent.alive ? "dead" : "missing", joined: false };
    }
    if (!coLocated(playerPos, npcPos)) {
        return { success: false, reason: "not_here", joined: false };
    }

    const npcPsych = getComponent<Psychology>(world, npc, PSYCHOLOGY);
    if (!npcPsych) return { success: false, reason: "missing", joined: false };

    // Check disposition
    const disposition = npcPsych.hope <= 15 ? "catatonic" :
                        npcPsych.lucidity <= 40 ? "mad" :
                        (npcPsych.lucidity <= 60 || npcPsych.hope <= 40) ? "anxious" : "calm";

    if (config.blockedDispositions.indexOf(disposition) !== -1) {
        return { success: false, reason: "disposition", joined: false };
    }

    // Source's influence lowers recruitment thresholds
    const playerStats = getComponent<Stats>(world, player, STATS);
    const infMod = playerStats ? influenceMod(playerStats) : 1.0;
    const famThreshold = config.minFamiliarity / infMod;
    const affThreshold = config.minAffinity / infMod;

    // Check familiarity threshold (player knows them well enough to ask)
    const playerRels = getComponent<Relationships>(world, player, RELATIONSHIPS);
    if (!playerRels) return { success: false, reason: "missing", joined: false };
    const playerBond = playerRels.bonds.get(npc);
    if (!playerBond || playerBond.familiarity < famThreshold) {
        return { success: false, reason: "unfamiliar", joined: false };
    }

    // Check NPC's affinity toward player (they need to like you enough)
    const npcRels = getComponent<Relationships>(world, npc, RELATIONSHIPS);
    if (!npcRels) return { success: false, reason: "missing", joined: false };
    const npcBond = npcRels.bonds.get(player);
    if (!npcBond || npcBond.affinity < affThreshold) {
        return { success: false, reason: "low_affinity", joined: false };
    }

    // Success — boost both bonds above grouping threshold to form group
    playerBond.familiarity = Math.max(playerBond.familiarity, groupConfig.familiarityThreshold + 1);
    playerBond.affinity = Math.max(playerBond.affinity, groupConfig.affinityThreshold + 1);
    npcBond.familiarity = Math.max(npcBond.familiarity, groupConfig.familiarityThreshold + 1);
    npcBond.affinity = Math.max(npcBond.affinity, groupConfig.affinityThreshold + 1);

    return { success: true, joined: true };
}

// --- NPC socialize system ---

/**
 * Run NPC-to-NPC socialization. Pairs up co-located bonded entities
 * and runs talkTo between them (neutral approach). Works regardless
 * of intent — NPCs chat in passing while exploring, searching, etc.
 * Each entity socializes with at most one partner per tick.
 */
export function socializeSystem(
    world: World,
    currentTick: number,
    config: TalkConfig = DEFAULT_TALK,
): void {
    // Gather all alive entities grouped by position
    const byPos = new Map<string, Entity[]>();
    const entities = query(world, [POSITION, IDENTITY]);
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const pos = tuple[1] as Position;
        const ident = tuple[2] as Identity;
        if (!ident.alive) continue;
        const key = `${pos.side}:${pos.position}:${pos.floor}`;
        if (!byPos.has(key)) byPos.set(key, []);
        byPos.get(key)!.push(entity);
    }

    // Pair up bonded co-located entities
    const talked = new Set<Entity>();
    for (const group of byPos.values()) {
        if (group.length < 2) continue;
        for (let i = 0; i < group.length; i++) {
            if (talked.has(group[i])) continue;
            for (let j = i + 1; j < group.length; j++) {
                if (talked.has(group[j])) continue;
                // Only chat if they have a mutual bond
                if (!hasMutualBond(world, group[i], group[j])) continue;
                talkTo(world, group[i], group[j], "neutral", currentTick, config);
                talked.add(group[i]);
                talked.add(group[j]);
                break;
            }
        }
    }
}
