/**
 * Social physics — psychology, relationships, groups, disposition.
 *
 * Built on the ECS. Defines components and systems for the social simulation.
 * All systems are pure functions that take a World + RNG and mutate component
 * data in place (ECS convention: systems mutate, components are data).
 *
 * Components:
 *   "position"     — { side, position, floor }
 *   "identity"     — { name, alive }
 *   "psychology"   — { lucidity, hope }
 *   "relationships" — { bonds: Map<Entity, Bond> }
 *   "group"        — { groupId }
 *   "player"       — {} (tag, no data)
 *   "ai"           — {} (tag, no data)
 *
 * @module social.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, query, addComponent } from "./ecs.core.ts";
import { PERSONALITY, type Personality, decayBias, entityCompatibility, familiarityFatigue } from "./personality.core.ts";
import { BELIEF, type BeliefComponent, beliefDecayMod, evolveBelief, updateStance } from "./belief.core.ts";
import { NEEDS, type Needs, needsDecayMultiplier } from "./needs.core.ts";
import { KNOWLEDGE, type Knowledge } from "./knowledge.core.ts";
import { STATS, type Stats, influenceMod } from "./stats.core.ts";
import { HABITUATION, type Habituation, applyShock as applyHabituatedShock } from "./psych.core.ts";

// --- Component keys ---

export const POSITION = "position";
export const IDENTITY = "identity";
export const PSYCHOLOGY = "psychology";
export const RELATIONSHIPS = "relationships";
export const GROUP = "group";
export const PLAYER = "player";
export const AI = "ai";

// --- Component types ---

export interface Position {
    side: number;
    position: number;
    floor: number;
}

export interface Identity {
    name: string;
    alive: boolean;
    /** Entity has submitted their book and left the library. */
    free: boolean;
}

export interface Psychology {
    lucidity: number;  // 100 = clear-minded, 0 = total delusion
    hope: number;      // 100 = engaged, 0 = catatonic withdrawal
}

export interface Bond {
    familiarity: number;   // how well you know them (accumulates, very slow decay)
    affinity: number;      // how you feel about them (fluctuates, can go negative)
    firstContact: number;  // tick of first meeting
    lastContact: number;   // tick of last co-location
    encounters: number;    // number of distinct encounters (separated by absence)
}

export interface Relationships {
    bonds: Map<Entity, Bond>;
}

export interface Group {
    groupId: number;
    separatedTicks: number;  // ticks since last co-location with a groupmate
    leaderId: Entity | null; // entity with highest influence in the group
}

// --- RNG interface ---

export interface Rng {
    next(): number;
}

// --- Disposition derivation ---

export type Disposition = "calm" | "anxious" | "mad" | "catatonic" | "dead" | "inspired" | "escaped";

/**
 * Thresholds for disposition derivation from psychology.
 * Checked in priority order: dead > catatonic > mad > anxious > calm.
 *
 * Stored as a config object so content can tune these later.
 */
export interface DispositionThresholds {
    catatonicHope: number;      // hope below this = catatonic
    madLucidity: number;        // lucidity below this = mad
    anxiousLucidity: number;    // lucidity below this AND not mad = anxious
    anxiousHope: number;        // hope below this AND not mad = anxious
}

export const DEFAULT_THRESHOLDS: DispositionThresholds = {
    catatonicHope: 15,
    madLucidity: 40,
    anxiousLucidity: 60,
    anxiousHope: 40,
};

/**
 * Derive a disposition label from an entity's psychology and identity.
 * Returns "dead" if not alive.
 */
export function deriveDisposition(
    psych: Psychology,
    alive: boolean,
    thresholds: DispositionThresholds = DEFAULT_THRESHOLDS,
    hasPilgrimage: boolean = false,
): Disposition {
    if (!alive) return "dead";
    // Catatonic takes priority — no energy for madness
    if (psych.hope <= thresholds.catatonicHope) return "catatonic";
    if (psych.lucidity <= thresholds.madLucidity) return "mad";
    if (psych.lucidity <= thresholds.anxiousLucidity || psych.hope <= thresholds.anxiousHope) {
        return "anxious";
    }
    // Inspired: has a divine vision and is on pilgrimage
    if (hasPilgrimage) return "inspired";
    return "calm";
}

// --- Psychology decay system ---

/**
 * Configuration for psychological decay rates.
 * All rates are per-tick.
 */
export interface DecayConfig {
    lucidityBase: number;       // base lucidity drain per tick
    hopeBase: number;           // base hope drain per tick
    accel: number;              // acceleration factor at low stats
    curve: number;              // exponent for non-linear acceleration
    isolationMultiplier: number; // multiplier when entity has no co-located bonds
    companionDamper: number;    // multiplier when entity has co-located bonds (< 1 = slows decay)
    companionRestore: number;   // per-tick restoration from companion contact
    lucidityFloor: number;      // lucidity can't go below this from decay alone
    hopeFloor: number;          // hope can't go below this from decay alone
}

export const DEFAULT_DECAY: DecayConfig = {
    // --- Cosmic-scale decay ---
    // Non-linear: decay accelerates as stats drop (despair feedback).
    // High stats decay very slowly (functional people stay functional for centuries).
    // rate = base * (1 + accel * (1 - stat/100)^curve)
    lucidityBase: 0.00003,
    hopeBase: 0.00004,
    accel: 12.0,
    curve: 2.0,
    isolationMultiplier: 1.0,
    companionDamper: 0.1,       // companion slows decay to 10% of base
    companionRestore: 0.000008, // per tick — very slow healing from social contact
    lucidityFloor: 0,
    hopeFloor: 0,
};

/**
 * Check if an entity has any nearby bonded entity (within hearing range,
 * familiarity > 0, affinity > 0, alive).
 *
 * You feel less alone when you can hear someone you know nearby,
 * even if they're not right next to you.
 *
 * Returns 0 if no social contact, or the best companion's influence
 * modifier (>0) if contact exists. High-influence companions restore
 * more effectively.
 */
export function socialContactInfluence(
    world: World,
    entity: Entity,
    awarenessConfig: AwarenessConfig = DEFAULT_AWARENESS,
): number {
    const pos = getComponent<Position>(world, entity, POSITION);
    const rels = getComponent<Relationships>(world, entity, RELATIONSHIPS);
    if (!pos || !rels) return 0;

    let bestInfluence = 0;
    for (const [other] of rels.bonds) {
        const otherPos = getComponent<Position>(world, other, POSITION);
        const otherIdent = getComponent<Identity>(world, other, IDENTITY);
        if (!otherPos || !otherIdent || !otherIdent.alive) continue;
        if (canHear(pos, otherPos, awarenessConfig)) {
            const bond = rels.bonds.get(other)!;
            if (bond.familiarity > 0 && bond.affinity > 0) {
                const stats = getComponent<Stats>(world, entity, STATS);
                const infMod = stats ? influenceMod(stats) : 1.0;
                if (infMod > bestInfluence) bestInfluence = infMod;
            }
        }
    }
    return bestInfluence;
}

/** Backwards-compatible boolean check. */
export function hasSocialContact(
    world: World,
    entity: Entity,
    awarenessConfig: AwarenessConfig = DEFAULT_AWARENESS,
): boolean {
    return socialContactInfluence(world, entity, awarenessConfig) > 0;
}

/**
 * Non-linear decay rate: accelerates as stat drops.
 * rate = base * (1 + accel * (1 - stat/100)^curve)
 */
export function decayRate(stat: number, base: number, config: DecayConfig = DEFAULT_DECAY): number {
    const deficit = 1 - stat / 100;
    const acceleration = 1 + config.accel * Math.pow(Math.max(0, deficit), config.curve);
    return base * acceleration;
}

/**
 * Apply psychological decay to a single entity.
 * Mutates the psychology component in place.
 * Returns the new psychology values (same reference).
 *
 * Non-linear: decay accelerates as stats drop (despair feedback loop).
 * Social contact provides slow restoration, not just damping.
 */
export function decayPsychology(
    psych: Psychology,
    hasSocial: boolean,
    config: DecayConfig = DEFAULT_DECAY,
    bias?: { lucidityMul: number; hopeMul: number },
    socialInfluence: number = 1.0,
): Psychology {
    const lucMul = bias ? bias.lucidityMul : 1.0;
    const hopMul = bias ? bias.hopeMul : 1.0;

    if (hasSocial) {
        const lucDecay = decayRate(psych.lucidity, config.lucidityBase, config) * config.companionDamper * lucMul;
        const hopDecay = decayRate(psych.hope, config.hopeBase, config) * config.companionDamper * hopMul;
        const restore = config.companionRestore * socialInfluence;
        psych.lucidity = Math.min(100, Math.max(config.lucidityFloor, psych.lucidity - lucDecay + restore));
        psych.hope = Math.min(100, Math.max(config.hopeFloor, psych.hope - hopDecay + restore));
    } else {
        const lucDecay = decayRate(psych.lucidity, config.lucidityBase, config) * config.isolationMultiplier * lucMul;
        const hopDecay = decayRate(psych.hope, config.hopeBase, config) * config.isolationMultiplier * hopMul;
        psych.lucidity = Math.max(config.lucidityFloor, psych.lucidity - lucDecay);
        psych.hope = Math.max(config.hopeFloor, psych.hope - hopDecay);
    }

    return psych;
}

/**
 * System: apply psychological decay to all entities with Psychology + Identity.
 * Dead entities are skipped. Combines personality trait bias and belief state
 * modifiers multiplicatively into the decay bias.
 *
 * Also evolves belief (faith crisis / acceptance) and updates stance per tick.
 */
export function psychologyDecaySystem(
    world: World,
    config: DecayConfig = DEFAULT_DECAY,
    n: number = 1,
): void {
    const entities = query(world, [PSYCHOLOGY, IDENTITY]);
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const psychology = tuple[1] as Psychology;
        const identity = tuple[2] as Identity;
        if (!identity.alive) continue;

        const socialInf = socialContactInfluence(world, entity);
        const social = socialInf > 0;
        const personality = getComponent<Personality>(world, entity, PERSONALITY);
        const belief = getComponent<BeliefComponent>(world, entity, BELIEF);

        // Combine personality bias and belief bias multiplicatively
        let lucidityMul = 1.0;
        let hopeMul = 1.0;
        if (personality) {
            const pb = decayBias(personality);
            lucidityMul *= pb.lucidityMul;
            hopeMul *= pb.hopeMul;
        }
        if (belief) {
            for (let t = 0; t < n; t++) evolveBelief(belief);
            const bb = beliefDecayMod(belief);
            lucidityMul *= bb.lucidityMul;
            hopeMul *= bb.hopeMul;
            updateStance(belief, psychology.lucidity, psychology.hope, 0);
        }

        // Apply needs-based decay multiplier if entity has NEEDS component
        const needs = getComponent<Needs>(world, entity, NEEDS);
        if (needs) {
            const needsMul = needsDecayMultiplier(needs);
            lucidityMul *= needsMul;
            hopeMul *= needsMul;
        }

        const bias = { lucidityMul, hopeMul };
        for (let t = 0; t < n; t++) {
            decayPsychology(psychology, social, config, bias, socialInf || 1.0);
        }

        // Pilgrims have purpose — hope can't drop below catatonic threshold
        const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
        if (knowledge && knowledge.bookVision && identity.alive) {
            const pilgrimHopeFloor = 20; // above catatonic (15)
            if (psychology.hope < pilgrimHopeFloor) {
                psychology.hope = pilgrimHopeFloor;
            }
        }
    }
}

// --- Relationship system ---

/**
 * Configuration for bond accumulation.
 */
export interface BondConfig {
    familiarityPerTick: number;     // familiarity gained per tick of co-location
    affinityPerTick: number;        // affinity gained per tick of co-location (base)
    familiarityDecayRate: number;   // familiarity lost per tick apart (very slow)
    affinityDecayRate: number;      // affinity drift toward 0 per tick apart
    maxFamiliarity: number;
    maxAffinity: number;
    minAffinity: number;
    // Bond creation threshold: entities must be co-located for this many
    // ticks before a bond forms at all
    contactThreshold: number;
    // Minimum absence (ticks) before re-contact counts as a new encounter
    reencounterGap: number;
}

export const DEFAULT_BOND: BondConfig = {
    familiarityPerTick: 0.15,   // ~36/day co-located → grouping threshold (10) in ~67 ticks
    affinityPerTick: 0.08,      // ~19/day co-located → grouping threshold (5) in ~63 ticks
    familiarityDecayRate: 0.002, // very slow — you don't forget people
    affinityDecayRate: 0.02,    // feelings fade faster than memory
    maxFamiliarity: 100,
    maxAffinity: 100,
    minAffinity: -100,
    contactThreshold: 0,
    reencounterGap: 240,        // 1 day of absence = new encounter
};

/**
 * Get or create a bond from entity A to entity B.
 */
export function getOrCreateBond(rels: Relationships, target: Entity, currentTick: number): Bond {
    let bond = rels.bonds.get(target);
    if (!bond) {
        bond = {
            familiarity: 0, affinity: 0,
            firstContact: currentTick, lastContact: currentTick,
            encounters: 1,
        };
        rels.bonds.set(target, bond);
    }
    return bond;
}

/**
 * Accumulate bond from proximity. Called when two entities are co-located.
 * Mutates bond in place.
 *
 * If compatibility is provided (0–1), familiarity fatigue applies:
 * past the fatigue threshold, affinity gain slows and eventually reverses.
 */
export function accumulateBond(
    bond: Bond,
    currentTick: number,
    config: BondConfig = DEFAULT_BOND,
    compat?: number,
    infMod: number = 1.0,
): void {
    // Track re-encounters: if enough time has passed since last contact, count a new encounter
    const absence = currentTick - bond.lastContact;
    if (absence > config.reencounterGap) {
        bond.encounters = (bond.encounters || 1) + 1;
    }

    bond.familiarity = Math.min(config.maxFamiliarity,
        bond.familiarity + config.familiarityPerTick);

    let affinityDelta = config.affinityPerTick * infMod;

    // Familiarity fatigue: compatibility determines how long affinity keeps growing
    if (compat !== undefined) {
        affinityDelta += familiarityFatigue(bond.familiarity, compat, config.maxFamiliarity);
    }

    bond.affinity = Math.max(config.minAffinity,
        Math.min(config.maxAffinity, bond.affinity + affinityDelta));
    bond.lastContact = currentTick;
}

/**
 * Decay bond from absence. Called per tick for bonds not currently co-located.
 * Familiarity decays very slowly. Affinity drifts toward 0.
 * Mutates bond in place.
 */
export function decayBond(
    bond: Bond,
    config: BondConfig = DEFAULT_BOND,
): void {
    bond.familiarity = Math.max(0, bond.familiarity - config.familiarityDecayRate);
    // Affinity drifts toward 0
    if (bond.affinity > 0) {
        bond.affinity = Math.max(0, bond.affinity - config.affinityDecayRate);
    } else if (bond.affinity < 0) {
        bond.affinity = Math.min(0, bond.affinity + config.affinityDecayRate);
    }
}

/**
 * Check if two positions are co-located (exact same spot).
 */
export function coLocated(a: Position, b: Position): boolean {
    return a.side === b.side && a.position === b.position && a.floor === b.floor;
}

// --- Awareness ranges ---

/**
 * Awareness range thresholds (in segments).
 */
export interface AwarenessConfig {
    talkRange: number;    // must be co-located (always 0)
    hearRange: number;    // can hear footsteps, muttering
    shoutRange: number;   // can hear shouting (mad NPCs)
    sightRange: number;   // can see someone in the corridor
}

export const DEFAULT_AWARENESS: AwarenessConfig = {
    talkRange: 0,
    hearRange: 3,
    shoutRange: 6,
    sightRange: 10,
};

/**
 * Distance between two positions. Returns Infinity if different floor.
 * Same side: absolute position difference.
 * Different side (across chasm): only visual — returns distance but
 * flagged via the separate `canSeeAcrossChasm` function.
 */
export function segmentDistance(a: Position, b: Position): number {
    if (a.floor !== b.floor) return Infinity;
    if (a.side !== b.side) return Infinity; // use canSeeAcrossChasm for cross-chasm
    return Math.abs(a.position - b.position);
}

/**
 * Whether entity A can see entity B across the chasm.
 * Same floor, different side. Visual only — no interaction possible
 * except at floor 0 where you can cross.
 */
export function canSeeAcrossChasm(a: Position, b: Position): boolean {
    return a.floor === b.floor && a.side !== b.side;
}

/**
 * Whether A can hear B (same side, same floor, within hearing range).
 */
export function canHear(
    a: Position,
    b: Position,
    config: AwarenessConfig = DEFAULT_AWARENESS,
): boolean {
    return segmentDistance(a, b) <= config.hearRange;
}

/**
 * Whether A can see B (same side, same floor, within sight range).
 */
export function canSee(
    a: Position,
    b: Position,
    config: AwarenessConfig = DEFAULT_AWARENESS,
): boolean {
    const dist = segmentDistance(a, b);
    if (dist <= config.sightRange) return true;
    return false;
}

/**
 * Get all entities visible to a given entity (same side within sight range,
 * or across chasm on same floor). Returns array of [entity, distance] pairs.
 * Distance is Infinity for cross-chasm sightings.
 */
export function getVisibleEntities(
    world: World,
    entity: Entity,
    config: AwarenessConfig = DEFAULT_AWARENESS,
): [Entity, number][] {
    const pos = getComponent<Position>(world, entity, POSITION);
    if (!pos) return [];

    const results: [Entity, number][] = [];
    const entities = query(world, [POSITION, IDENTITY]);

    for (const [other, otherPos, otherIdent] of entities) {
        if ((other as Entity) === entity) continue;
        if (!(otherIdent as Identity).alive) continue;
        const op = otherPos as Position;

        const dist = segmentDistance(pos, op);
        if (dist <= config.sightRange) {
            results.push([other as Entity, dist]);
        } else if (canSeeAcrossChasm(pos, op)) {
            results.push([other as Entity, Infinity]);
        }
    }
    return results;
}

/**
 * Get entities within hearing range (same side, same floor, within hearRange).
 */
export function getNearbyEntities(
    world: World,
    entity: Entity,
    config: AwarenessConfig = DEFAULT_AWARENESS,
): Entity[] {
    const pos = getComponent<Position>(world, entity, POSITION);
    if (!pos) return [];

    const results: Entity[] = [];
    const entities = query(world, [POSITION, IDENTITY]);

    for (const [other, otherPos, otherIdent] of entities) {
        if ((other as Entity) === entity) continue;
        if (!(otherIdent as Identity).alive) continue;
        if (canHear(pos, otherPos as Position, config)) {
            results.push(other as Entity);
        }
    }
    return results;
}

export interface PrebuiltIndex {
    locationIndex: Map<number, Entity[]>;
    entities: [Entity, ...unknown[]][];
}

/**
 * Build a location index from entities with Position + Relationships + Identity.
 * Shared between relationshipSystem and groupFormationSystem.
 */
export function buildLocationIndex(world: World): PrebuiltIndex {
    const entities = query(world, [POSITION, RELATIONSHIPS, IDENTITY]);
    const locationIndex = new Map<number, Entity[]>();
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const pos = tuple[1] as Position;
        const ident = tuple[3] as Identity;
        if (!ident.alive) continue;
        const key = pos.side * 1000000000 + pos.position * 10000 + pos.floor;
        let list = locationIndex.get(key);
        if (!list) {
            list = [];
            locationIndex.set(key, list);
        }
        list.push(entity);
    }
    return { locationIndex, entities };
}

/**
 * System: update relationships for all entities based on co-location.
 * Accepts a pre-built location index to share work with groupFormationSystem.
 * n = number of ticks to simulate (scales accumulation/decay linearly).
 */
export function relationshipSystem(
    world: World,
    currentTick: number,
    config: BondConfig = DEFAULT_BOND,
    prebuilt?: PrebuiltIndex,
    n: number = 1,
): void {
    const { locationIndex, entities } = prebuilt || buildLocationIndex(world);

    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const pos = tuple[1] as Position;
        const rels = tuple[2] as Relationships;
        const ident = tuple[3] as Identity;
        if (!ident.alive) continue;
        const key = pos.side * 1000000000 + pos.position * 10000 + pos.floor;
        const coLocated = locationIndex.get(key);

        // Accumulate bonds with co-located entities
        if (coLocated) {
            for (let ci = 0; ci < coLocated.length; ci++) {
                const other = coLocated[ci];
                if (other === entity) continue;
                const bond = getOrCreateBond(rels, other, currentTick);
                const compat = entityCompatibility(world, entity, other);
                // Other entity's influence affects how fast you warm to them
                const otherStats = getComponent<Stats>(world, other, STATS);
                const infMod = otherStats ? influenceMod(otherStats) : 1.0;
                for (let t = 0; t < n; t++) {
                    accumulateBond(bond, currentTick, config, compat, infMod);
                }
            }
        }

        // Decay bonds with absent entities
        for (const [other, bond] of rels.bonds) {
            if (coLocated) {
                let isCoLocated = false;
                for (let ci = 0; ci < coLocated.length; ci++) {
                    if (coLocated[ci] === other) { isCoLocated = true; break; }
                }
                if (isCoLocated) continue;
            }
            const otherIdent = getComponent<Identity>(world, other, IDENTITY);
            if (otherIdent && !otherIdent.alive) continue;
            for (let t = 0; t < n; t++) {
                decayBond(bond, config);
            }
        }
    }
}

// --- Group formation system ---

/**
 * Configuration for group formation.
 */
export interface GroupConfig {
    /** Minimum mutual familiarity to consider for grouping. */
    familiarityThreshold: number;
    /** Minimum mutual affinity to consider for grouping. */
    affinityThreshold: number;
    /** Ticks of separation before a member is removed from the group. */
    separationTolerance: number;
}

export const DEFAULT_GROUP: GroupConfig = {
    familiarityThreshold: 10,
    affinityThreshold: 5,
    separationTolerance: 30,  // ~3 hours game time
};

/**
 * Check if two entities have a mutual bond above the grouping threshold.
 */
export function hasMutualBond(
    world: World,
    a: Entity,
    b: Entity,
    config: GroupConfig = DEFAULT_GROUP,
): boolean {
    const relsA = getComponent<Relationships>(world, a, RELATIONSHIPS);
    const relsB = getComponent<Relationships>(world, b, RELATIONSHIPS);
    if (!relsA || !relsB) return false;

    const bondAB = relsA.bonds.get(b);
    const bondBA = relsB.bonds.get(a);
    if (!bondAB || !bondBA) return false;

    return bondAB.familiarity >= config.familiarityThreshold &&
           bondAB.affinity >= config.affinityThreshold &&
           bondBA.familiarity >= config.familiarityThreshold &&
           bondBA.affinity >= config.affinityThreshold;
}

/**
 * System: form and maintain groups from co-located entities with mutual bonds.
 *
 * Groups are STATEFUL — they persist across ticks. Members tolerate brief
 * separation (configurable via separationTolerance). Groups only dissolve
 * when members have been apart long enough or bonds decay below threshold.
 *
 * Phase 1: Maintain existing groups (increment/reset separation counters).
 * Phase 2: Form new groups from ungrouped co-located bonded entities.
 */
export function groupFormationSystem(
    world: World,
    config: GroupConfig = DEFAULT_GROUP,
    prebuilt?: PrebuiltIndex,
): void {
    const { locationIndex } = prebuilt || buildLocationIndex(world);

    // Build a fast position lookup: entity → position key
    const entityPos = new Map<Entity, number>();
    for (const [key, list] of locationIndex) {
        for (const e of list) entityPos.set(e, key);
    }

    // --- Phase 1: Maintain existing groups ---

    // Collect current group membership
    const groupMembers = new Map<number, Entity[]>();
    const groupMap = world.components.get(GROUP) as Map<Entity, Group> | undefined;
    if (groupMap) {
        for (const [entity, group] of groupMap) {
            const ident = getComponent<Identity>(world, entity, IDENTITY);
            if (!ident || !ident.alive) continue;
            let members = groupMembers.get(group.groupId);
            if (!members) { members = []; groupMembers.set(group.groupId, members); }
            members.push(entity);
        }
    }

    // For each existing group, check separation and bond health
    const toRemove: Entity[] = [];
    for (const [gid, members] of groupMembers) {
        for (const entity of members) {
            const group = getComponent<Group>(world, entity, GROUP)!;
            const myPos = entityPos.get(entity);

            // Check if co-located with ANY other group member
            let nearMate = false;
            for (const other of members) {
                if (other === entity) continue;
                if (myPos && entityPos.get(other) === myPos) {
                    nearMate = true;
                    break;
                }
            }

            if (nearMate) {
                group.separatedTicks = 0;
            } else {
                group.separatedTicks++;
                if (group.separatedTicks > config.separationTolerance) {
                    toRemove.push(entity);
                    continue;
                }
            }

            // Also check bond health — if bonds with ALL groupmates decayed,
            // remove from group even if co-located
            let hasValidBond = false;
            for (const other of members) {
                if (other === entity) continue;
                if (hasMutualBond(world, entity, other, config)) {
                    hasValidBond = true;
                    break;
                }
            }
            if (!hasValidBond) {
                toRemove.push(entity);
            }
        }
    }

    // Remove separated/decayed members
    for (const entity of toRemove) {
        if (groupMap) groupMap.delete(entity);
    }

    // Clean up groups that dropped to 1 or 0 members
    if (groupMap) {
        const remaining = new Map<number, Entity[]>();
        for (const [entity, group] of groupMap) {
            let list = remaining.get(group.groupId);
            if (!list) { list = []; remaining.set(group.groupId, list); }
            list.push(entity);
        }
        for (const [, members] of remaining) {
            if (members.length < 2) {
                for (const e of members) groupMap.delete(e);
            }
        }
    }

    // --- Phase 2: Form new groups from ungrouped entities ---

    // Union-find for ungrouped co-located bonded entities
    const ungrouped = new Set<Entity>();
    for (const list of locationIndex.values()) {
        for (const e of list) {
            if (!getComponent<Group>(world, e, GROUP)) {
                ungrouped.add(e);
            }
        }
    }

    const parent = new Map<Entity, Entity>();
    function find(x: Entity): Entity {
        while (parent.get(x) !== x) {
            const p = parent.get(x)!;
            parent.set(x, parent.get(p)!);
            x = p;
        }
        return x;
    }
    function union(a: Entity, b: Entity): void {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    }

    for (const e of ungrouped) parent.set(e, e);

    for (const list of locationIndex.values()) {
        for (let i = 0; i < list.length; i++) {
            if (!ungrouped.has(list[i])) continue;
            for (let j = i + 1; j < list.length; j++) {
                if (!ungrouped.has(list[j])) continue;
                if (hasMutualBond(world, list[i], list[j], config)) {
                    union(list[i], list[j]);
                }
            }
        }
    }

    // Also allow ungrouped entities to join existing groups if co-located + bonded
    for (const list of locationIndex.values()) {
        for (const e of list) {
            if (!ungrouped.has(e)) continue;
            for (const other of list) {
                if (other === e) continue;
                const otherGroup = getComponent<Group>(world, other, GROUP);
                if (otherGroup && hasMutualBond(world, e, other, config)) {
                    // Join the existing group
                    addComponent<Group>(world, e, GROUP, { groupId: otherGroup.groupId, separatedTicks: 0, leaderId: null });
                    ungrouped.delete(e);
                    break;
                }
            }
        }
    }

    // Assign new groups from union-find (only ungrouped entities that formed clusters)
    const newGroups = new Map<Entity, Entity[]>();
    for (const e of ungrouped) {
        const root = find(e);
        let list = newGroups.get(root);
        if (!list) { list = []; newGroups.set(root, list); }
        list.push(e);
    }

    for (const [root, members] of newGroups) {
        if (members.length < 2) continue;
        const groupId = root as number;
        for (const e of members) {
            addComponent<Group>(world, e, GROUP, { groupId, separatedTicks: 0, leaderId: null });
        }
    }

    // --- Phase 3: Elect leaders ---
    // Rebuild group membership after all formation/dissolution
    electGroupLeaders(world);
}

/**
 * Elect leaders for all groups. Leader = highest influence stat.
 * Ties broken by entity id (deterministic). Updates leaderId on all members.
 */
export function electGroupLeaders(world: World): void {
    const groupMap = world.components.get(GROUP) as Map<Entity, Group> | undefined;
    if (!groupMap) return;

    const groups = new Map<number, Entity[]>();
    for (const [entity, group] of groupMap) {
        const ident = getComponent<Identity>(world, entity, IDENTITY);
        if (!ident?.alive) continue;
        let list = groups.get(group.groupId);
        if (!list) { list = []; groups.set(group.groupId, list); }
        list.push(entity);
    }

    for (const [, members] of groups) {
        let leader: Entity = members[0];
        let bestInfluence = -1;
        for (const e of members) {
            const stats = getComponent<Stats>(world, e, STATS);
            const inf = stats ? influenceMod(stats) : 1.0;
            if (inf > bestInfluence || (inf === bestInfluence && (e as number) < (leader as number))) {
                bestInfluence = inf;
                leader = e;
            }
        }
        for (const e of members) {
            const g = getComponent<Group>(world, e, GROUP)!;
            g.leaderId = leader;
        }
    }
}

// --- Companion detection ---

/**
 * Get the companion entity for a given entity, if any.
 * A companion is: in the same group, co-located, alive, and has the
 * highest mutual affinity.
 *
 * Returns undefined if no companion.
 */
export function getCompanion(world: World, entity: Entity): Entity | undefined {
    const group = getComponent<Group>(world, entity, GROUP);
    if (!group) return undefined;

    const rels = getComponent<Relationships>(world, entity, RELATIONSHIPS);
    if (!rels) return undefined;

    const pos = getComponent<Position>(world, entity, POSITION);
    if (!pos) return undefined;

    let bestEntity: Entity | undefined;
    let bestAffinity = -Infinity;

    for (const [other, bond] of rels.bonds) {
        const otherGroup = getComponent<Group>(world, other, GROUP);
        if (!otherGroup || otherGroup.groupId !== group.groupId) continue;

        const otherIdent = getComponent<Identity>(world, other, IDENTITY);
        if (!otherIdent || !otherIdent.alive) continue;

        const otherPos = getComponent<Position>(world, other, POSITION);
        if (!otherPos || !coLocated(pos, otherPos)) continue;

        if (bond.affinity > bestAffinity) {
            bestAffinity = bond.affinity;
            bestEntity = other;
        }
    }

    return bestEntity;
}

// --- Affinity modifiers ---

/**
 * Apply an affinity change to the directed bond from source to target.
 * Creates the bond if it doesn't exist.
 */
export function modifyAffinity(
    world: World,
    source: Entity,
    target: Entity,
    delta: number,
    currentTick: number,
    config: BondConfig = DEFAULT_BOND,
): void {
    const rels = getComponent<Relationships>(world, source, RELATIONSHIPS);
    if (!rels) return;
    const bond = getOrCreateBond(rels, target, currentTick);
    bond.affinity = Math.max(config.minAffinity,
        Math.min(config.maxAffinity, bond.affinity + delta));
}

/**
 * Apply a psychology shock (loss, violence, trauma).
 * Directly reduces lucidity and/or hope.
 */
export function applyShock(
    psych: Psychology,
    lucidityDelta: number,
    hopeDelta: number,
): void {
    psych.lucidity = Math.max(0, Math.min(100, psych.lucidity + lucidityDelta));
    psych.hope = Math.max(0, Math.min(100, psych.hope + hopeDelta));
}

// --- Social pressure ---

/**
 * Mad entities exert social pressure on nearby non-mad entities
 * (within shout range), accelerating their lucidity decay.
 * This is the Direite recruitment mechanic. You can hear them ranting
 * from corridors away.
 *
 * A single mad prophet is enough to start the contagion.
 * Call after groupFormationSystem.
 */
export function socialPressureSystem(
    world: World,
    thresholds: DispositionThresholds = DEFAULT_THRESHOLDS,
    pressureRate: number = 0.003,
    awareness: AwarenessConfig = DEFAULT_AWARENESS,
    n: number = 1,
): void {
    const entities = query(world, [POSITION, PSYCHOLOGY, IDENTITY]);

    const targets: { pos: Position, psych: Psychology }[] = [];
    // Track mad NPC positions + their influence modifier
    const madIndex = new Map<number, { position: number, infMod: number }[]>();

    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const pos = tuple[1] as Position;
        const psych = tuple[2] as Psychology;
        const ident = tuple[3] as Identity;
        if (!ident.alive) continue;
        const disp = deriveDisposition(psych, true, thresholds);

        if (disp === "mad") {
            const key = pos.side * 1000000 + pos.floor;
            let list = madIndex.get(key);
            if (!list) { list = []; madIndex.set(key, list); }
            const stats = getComponent<Stats>(world, entity, STATS);
            list.push({ position: pos.position, infMod: stats ? influenceMod(stats) : 1.0 });
        } else if (disp !== "catatonic") {
            targets.push({ pos, psych });
        }
    }

    for (const target of targets) {
        const key = target.pos.side * 1000000 + target.pos.floor;
        const madNearby = madIndex.get(key);
        if (!madNearby) continue;

        let pressure = 0;
        for (let mi = 0; mi < madNearby.length; mi++) {
            if (Math.abs(target.pos.position - madNearby[mi].position) <= awareness.shoutRange) {
                pressure += madNearby[mi].infMod;
            }
        }

        if (pressure > 0) {
            target.psych.lucidity = Math.max(0,
                target.psych.lucidity - pressureRate * pressure * n);
        }
    }
}

// --- NPC dismiss system ---

export interface DismissConfig {
    /** Base probability per tick of an NPC considering dismissing a groupmate. */
    baseChance: number;
    /** Affinity below this triggers dismiss consideration. */
    affinityThreshold: number;
}

export const DEFAULT_DISMISS: DismissConfig = {
    baseChance: 0.002,       // ~0.2% per tick → checked when affinity is low
    affinityThreshold: 2,    // only consider dismissing when affinity drops below this
};

/**
 * NPC-initiated group dismissal. Each tick, grouped NPCs with low affinity
 * toward a groupmate may voluntarily leave.
 *
 * Probability modulated by personality:
 * - Low openness → more likely to dismiss (guarded, self-protective)
 * - High pace → more likely (restless, wants to move on)
 * - High temperament → more likely (volatile, reactive)
 *
 * When an NPC dismisses, the worst-affinity groupmate is removed.
 * Uses the same dismiss action (affinity hit + shock) as player dismiss.
 */
export function npcDismissSystem(
    world: World,
    rng: Rng,
    config: DismissConfig = DEFAULT_DISMISS,
): void {
    const groupMap = world.components.get(GROUP) as Map<Entity, Group> | undefined;
    if (!groupMap) return;

    // Collect group members
    const groups = new Map<number, Entity[]>();
    for (const [entity, group] of groupMap) {
        const ident = getComponent<Identity>(world, entity, IDENTITY);
        if (!ident?.alive) continue;
        let list = groups.get(group.groupId);
        if (!list) { list = []; groups.set(group.groupId, list); }
        list.push(entity);
    }

    const dismissed: Entity[] = [];

    for (const [, members] of groups) {
        for (const entity of members) {
            if (dismissed.includes(entity)) continue;

            const rels = getComponent<Relationships>(world, entity, RELATIONSHIPS);
            if (!rels) continue;

            // Find worst-affinity groupmate
            let worstMate: Entity | undefined;
            let worstAffinity = Infinity;
            for (const other of members) {
                if (other === entity) continue;
                const bond = rels.bonds.get(other);
                const aff = bond ? bond.affinity : 0;
                if (aff < worstAffinity) {
                    worstAffinity = aff;
                    worstMate = other;
                }
            }

            if (worstMate === undefined || worstAffinity >= config.affinityThreshold) continue;

            // Personality modulates dismiss probability
            const pers = getComponent<Personality>(world, entity, PERSONALITY);
            let chance = config.baseChance;
            if (pers) {
                // Guarded (low openness) → more likely to cut ties
                chance *= 1.0 + (1.0 - pers.openness) * 1.5;
                // Restless (high pace) → wants to move on
                chance *= 1.0 + pers.pace * 0.8;
                // Volatile (high temperament) → reactive
                chance *= 1.0 + pers.temperament * 0.5;
            }

            // Lower affinity → higher chance (exponential ramp)
            const affinityFactor = Math.max(0, config.affinityThreshold - worstAffinity) / config.affinityThreshold;
            chance *= 1.0 + affinityFactor * 3.0;

            if (rng.next() < chance) {
                // Remove the worst mate from the group
                groupMap.delete(worstMate);
                dismissed.push(worstMate);

                // Apply affinity + shock via the relationship
                const tgtPsych = getComponent<Psychology>(world, worstMate, PSYCHOLOGY);
                const tgtRels = getComponent<Relationships>(world, worstMate, RELATIONSHIPS);
                const tgtPers = getComponent<Personality>(world, worstMate, PERSONALITY);

                // Dismisser guilt
                const srcOpenness = pers ? pers.openness : 0.5;
                const bond = rels.bonds.get(worstMate);
                if (bond) {
                    bond.affinity = Math.max(-100, bond.affinity - (2 + srcOpenness * 3));
                }

                // Target hurt
                if (tgtRels) {
                    const tgtBond = tgtRels.bonds.get(entity);
                    if (tgtBond) {
                        const tgtOpen = tgtPers ? tgtPers.openness : 0.5;
                        const famPenalty = Math.floor(tgtBond.familiarity / 8);
                        tgtBond.affinity = Math.max(-100, tgtBond.affinity - (4 + tgtOpen * 6 + famPenalty));
                    }
                }

                // Hope shock
                if (tgtPsych) {
                    const tgtHabit = getComponent<Habituation>(world, worstMate, HABITUATION);
                    applyHabituatedShock(tgtPsych, tgtHabit, "beingDismissed");
                }
            }
        }
    }

    // Clean up groups that dropped below 2
    if (dismissed.length > 0) {
        const remaining = new Map<number, Entity[]>();
        for (const [entity, group] of groupMap) {
            let list = remaining.get(group.groupId);
            if (!list) { list = []; remaining.set(group.groupId, list); }
            list.push(entity);
        }
        for (const [, members] of remaining) {
            if (members.length < 2) {
                for (const e of members) groupMap.delete(e);
            }
        }
        // Re-elect leaders after dismissals
        if (dismissed.length > 0) electGroupLeaders(world);
    }
}
