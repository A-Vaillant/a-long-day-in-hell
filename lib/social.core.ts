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

import type { Entity, World } from "./ecs.core.js";
import { getComponent, query, entitiesWith, addComponent } from "./ecs.core.js";

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
}

export interface Psychology {
    lucidity: number;  // 100 = clear-minded, 0 = total delusion
    hope: number;      // 100 = engaged, 0 = catatonic withdrawal
}

export interface Bond {
    familiarity: number;  // how well you know them (accumulates, very slow decay)
    affinity: number;     // how you feel about them (fluctuates, can go negative)
    lastContact: number;  // tick of last co-location
}

export interface Relationships {
    bonds: Map<Entity, Bond>;
}

export interface Group {
    groupId: number;
}

// --- RNG interface ---

export interface Rng {
    next(): number;
}

// --- Disposition derivation ---

export type Disposition = "calm" | "anxious" | "mad" | "catatonic" | "dead";

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
): Disposition {
    if (!alive) return "dead";
    // Catatonic takes priority — no energy for madness
    if (psych.hope <= thresholds.catatonicHope) return "catatonic";
    if (psych.lucidity <= thresholds.madLucidity) return "mad";
    if (psych.lucidity <= thresholds.anxiousLucidity || psych.hope <= thresholds.anxiousHope) {
        return "anxious";
    }
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
    isolationMultiplier: number; // multiplier when entity has no co-located bonds
    companionDamper: number;    // multiplier when entity has co-located bonds (< 1 = slows decay)
    lucidityFloor: number;      // lucidity can't go below this from decay alone
    hopeFloor: number;          // hope can't go below this from decay alone
}

export const DEFAULT_DECAY: DecayConfig = {
    lucidityBase: 0.02,
    hopeBase: 0.03,
    isolationMultiplier: 2.0,
    companionDamper: 0.3,
    lucidityFloor: 0,
    hopeFloor: 0,
};

/**
 * Check if an entity has any co-located bonded entity (familiarity > 0,
 * affinity > 0, at same position, alive).
 */
export function hasSocialContact(world: World, entity: Entity): boolean {
    const pos = getComponent<Position>(world, entity, POSITION);
    const rels = getComponent<Relationships>(world, entity, RELATIONSHIPS);
    if (!pos || !rels) return false;

    for (const [other] of rels.bonds) {
        const otherPos = getComponent<Position>(world, other, POSITION);
        const otherIdent = getComponent<Identity>(world, other, IDENTITY);
        if (!otherPos || !otherIdent || !otherIdent.alive) continue;
        if (otherPos.side === pos.side &&
            otherPos.position === pos.position &&
            otherPos.floor === pos.floor) {
            const bond = rels.bonds.get(other)!;
            if (bond.familiarity > 0 && bond.affinity > 0) return true;
        }
    }
    return false;
}

/**
 * Apply psychological decay to a single entity.
 * Mutates the psychology component in place.
 * Returns the new psychology values (same reference).
 */
export function decayPsychology(
    psych: Psychology,
    hasSocial: boolean,
    config: DecayConfig = DEFAULT_DECAY,
): Psychology {
    const multiplier = hasSocial ? config.companionDamper : config.isolationMultiplier;

    psych.lucidity = Math.max(
        config.lucidityFloor,
        psych.lucidity - config.lucidityBase * multiplier,
    );
    psych.hope = Math.max(
        config.hopeFloor,
        psych.hope - config.hopeBase * multiplier,
    );

    return psych;
}

/**
 * System: apply psychological decay to all entities with Psychology + Identity.
 * Dead entities are skipped.
 */
export function psychologyDecaySystem(
    world: World,
    config: DecayConfig = DEFAULT_DECAY,
): void {
    const entities = query(world, [PSYCHOLOGY, IDENTITY]);
    for (const [entity, psych, ident] of entities) {
        const identity = ident as Identity;
        const psychology = psych as Psychology;
        if (!identity.alive) continue;

        const social = hasSocialContact(world, entity as Entity);
        decayPsychology(psychology, social, config);
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
}

export const DEFAULT_BOND: BondConfig = {
    familiarityPerTick: 0.1,
    affinityPerTick: 0.05,
    familiarityDecayRate: 0.001,
    affinityDecayRate: 0.01,
    maxFamiliarity: 100,
    maxAffinity: 100,
    minAffinity: -100,
    contactThreshold: 0,
};

/**
 * Get or create a bond from entity A to entity B.
 */
export function getOrCreateBond(rels: Relationships, target: Entity, currentTick: number): Bond {
    let bond = rels.bonds.get(target);
    if (!bond) {
        bond = { familiarity: 0, affinity: 0, lastContact: currentTick };
        rels.bonds.set(target, bond);
    }
    return bond;
}

/**
 * Accumulate bond from proximity. Called when two entities are co-located.
 * Mutates bond in place.
 */
export function accumulateBond(
    bond: Bond,
    currentTick: number,
    config: BondConfig = DEFAULT_BOND,
): void {
    bond.familiarity = Math.min(config.maxFamiliarity,
        bond.familiarity + config.familiarityPerTick);
    bond.affinity = Math.min(config.maxAffinity,
        bond.affinity + config.affinityPerTick);
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
 * Check if two positions are co-located.
 */
export function coLocated(a: Position, b: Position): boolean {
    return a.side === b.side && a.position === b.position && a.floor === b.floor;
}

/**
 * System: update relationships for all entities based on co-location.
 * For each entity with Position + Relationships + Identity (alive),
 * find all other such entities at the same location and accumulate bonds.
 * Decay bonds for absent entities.
 */
export function relationshipSystem(
    world: World,
    currentTick: number,
    config: BondConfig = DEFAULT_BOND,
): void {
    const entities = query(world, [POSITION, RELATIONSHIPS, IDENTITY]);

    // Build location index for efficient co-location lookup
    const locationIndex = new Map<string, Entity[]>();
    for (const [entity, pos, , ident] of entities) {
        const identity = ident as Identity;
        if (!identity.alive) continue;
        const position = pos as Position;
        const key = `${position.side}:${position.position}:${position.floor}`;
        let list = locationIndex.get(key);
        if (!list) {
            list = [];
            locationIndex.set(key, list);
        }
        list.push(entity as Entity);
    }

    // For each alive entity, accumulate bonds with co-located entities,
    // decay bonds with absent entities
    for (const [entity, pos, rels, ident] of entities) {
        const identity = ident as Identity;
        if (!identity.alive) continue;
        const position = pos as Position;
        const relationships = rels as Relationships;
        const key = `${position.side}:${position.position}:${position.floor}`;
        const coLocatedEntities = new Set(locationIndex.get(key) || []);
        coLocatedEntities.delete(entity as Entity);

        // Accumulate bonds with co-located entities
        for (const other of coLocatedEntities) {
            const bond = getOrCreateBond(relationships, other, currentTick);
            accumulateBond(bond, currentTick, config);
        }

        // Decay bonds with absent entities
        for (const [other, bond] of relationships.bonds) {
            if (coLocatedEntities.has(other)) continue;
            // Check if other is still alive
            const otherIdent = getComponent<Identity>(world, other, IDENTITY);
            if (otherIdent && !otherIdent.alive) continue; // don't decay bonds with dead
            decayBond(bond, config);
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
}

export const DEFAULT_GROUP: GroupConfig = {
    familiarityThreshold: 10,
    affinityThreshold: 5,
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
 * System: form groups from co-located entities with mutual bonds.
 * Uses connected-component detection via union-find.
 *
 * Groups are re-computed each tick (stateless — no persistent group IDs).
 * Entities not in any group have their group component removed.
 */
export function groupFormationSystem(
    world: World,
    config: GroupConfig = DEFAULT_GROUP,
): void {
    const entities = query(world, [POSITION, RELATIONSHIPS, IDENTITY]);

    // Build location index of alive entities
    const locationIndex = new Map<string, Entity[]>();
    for (const [entity, pos, , ident] of entities) {
        if (!(ident as Identity).alive) continue;
        const position = pos as Position;
        const key = `${position.side}:${position.position}:${position.floor}`;
        let list = locationIndex.get(key);
        if (!list) {
            list = [];
            locationIndex.set(key, list);
        }
        list.push(entity as Entity);
    }

    // Union-find
    const parent = new Map<Entity, Entity>();
    function find(x: Entity): Entity {
        while (parent.get(x) !== x) {
            const p = parent.get(x)!;
            parent.set(x, parent.get(p)!); // path compression
            x = p;
        }
        return x;
    }
    function union(a: Entity, b: Entity): void {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    }

    // Initialize parent
    const allAlive: Entity[] = [];
    for (const list of locationIndex.values()) {
        for (const e of list) {
            parent.set(e, e);
            allAlive.push(e);
        }
    }

    // Union co-located entities with mutual bonds
    for (const list of locationIndex.values()) {
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) {
                if (hasMutualBond(world, list[i], list[j], config)) {
                    union(list[i], list[j]);
                }
            }
        }
    }

    // Assign group IDs (root entity ID = group ID)
    // Only assign groups of size >= 2
    const groups = new Map<Entity, Entity[]>();
    for (const e of allAlive) {
        const root = find(e);
        let list = groups.get(root);
        if (!list) {
            list = [];
            groups.set(root, list);
        }
        list.push(e);
    }

    // Clear all existing group components
    const existingGrouped = entitiesWith(world, GROUP);
    for (const e of existingGrouped) {
        // Remove by setting to undefined isn't how ECS works — use removeComponent
        // But we imported addComponent. Let's just overwrite or skip.
        // Actually we need removeComponent. For now, we'll re-add groups for
        // all entities: grouped ones get a group, ungrouped ones get removed.
    }

    // We need removeComponent
    const groupMap = world.components.get(GROUP);
    if (groupMap) groupMap.clear();

    for (const [root, members] of groups) {
        if (members.length < 2) continue;
        const groupId = root; // use root entity as group ID
        for (const e of members) {
            addComponent<Group>(world, e, GROUP, { groupId });
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
 * Mad entities at a location exert social pressure on non-mad entities,
 * accelerating their lucidity decay. This is the Direite recruitment mechanic.
 *
 * Call after groupFormationSystem.
 */
export function socialPressureSystem(
    world: World,
    thresholds: DispositionThresholds = DEFAULT_THRESHOLDS,
    pressureRate: number = 0.1,
): void {
    const entities = query(world, [POSITION, PSYCHOLOGY, IDENTITY]);

    // Build location index with disposition info
    const locationMadCount = new Map<string, number>();
    const locationEntities = new Map<string, [Entity, Psychology][]>();

    for (const [entity, pos, psych, ident] of entities) {
        const identity = ident as Identity;
        if (!identity.alive) continue;
        const position = pos as Position;
        const psychology = psych as Psychology;
        const key = `${position.side}:${position.position}:${position.floor}`;

        const disp = deriveDisposition(psychology, true, thresholds);

        let list = locationEntities.get(key);
        if (!list) {
            list = [];
            locationEntities.set(key, list);
        }
        list.push([entity as Entity, psychology]);

        if (disp === "mad") {
            locationMadCount.set(key, (locationMadCount.get(key) || 0) + 1);
        }
    }

    // Apply pressure: for each location with 2+ mad entities,
    // non-mad entities lose lucidity faster
    for (const [key, madCount] of locationMadCount) {
        if (madCount < 2) continue;
        const ents = locationEntities.get(key);
        if (!ents) continue;
        for (const [, psychology] of ents) {
            const disp = deriveDisposition(psychology, true, thresholds);
            if (disp !== "mad" && disp !== "catatonic") {
                psychology.lucidity = Math.max(0,
                    psychology.lucidity - pressureRate * madCount);
            }
        }
    }
}
