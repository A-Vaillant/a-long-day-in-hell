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
import { getComponent, query, entitiesWith, addComponent } from "./ecs.core.js";
// --- Component keys ---
export const POSITION = "position";
export const IDENTITY = "identity";
export const PSYCHOLOGY = "psychology";
export const RELATIONSHIPS = "relationships";
export const GROUP = "group";
export const PLAYER = "player";
export const AI = "ai";
export const DEFAULT_THRESHOLDS = {
    catatonicHope: 15,
    madLucidity: 40,
    anxiousLucidity: 60,
    anxiousHope: 40,
};
/**
 * Derive a disposition label from an entity's psychology and identity.
 * Returns "dead" if not alive.
 */
export function deriveDisposition(psych, alive, thresholds = DEFAULT_THRESHOLDS) {
    if (!alive)
        return "dead";
    // Catatonic takes priority — no energy for madness
    if (psych.hope <= thresholds.catatonicHope)
        return "catatonic";
    if (psych.lucidity <= thresholds.madLucidity)
        return "mad";
    if (psych.lucidity <= thresholds.anxiousLucidity || psych.hope <= thresholds.anxiousHope) {
        return "anxious";
    }
    return "calm";
}
export const DEFAULT_DECAY = {
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
export function hasSocialContact(world, entity) {
    const pos = getComponent(world, entity, POSITION);
    const rels = getComponent(world, entity, RELATIONSHIPS);
    if (!pos || !rels)
        return false;
    for (const [other] of rels.bonds) {
        const otherPos = getComponent(world, other, POSITION);
        const otherIdent = getComponent(world, other, IDENTITY);
        if (!otherPos || !otherIdent || !otherIdent.alive)
            continue;
        if (otherPos.side === pos.side &&
            otherPos.position === pos.position &&
            otherPos.floor === pos.floor) {
            const bond = rels.bonds.get(other);
            if (bond.familiarity > 0 && bond.affinity > 0)
                return true;
        }
    }
    return false;
}
/**
 * Apply psychological decay to a single entity.
 * Mutates the psychology component in place.
 * Returns the new psychology values (same reference).
 */
export function decayPsychology(psych, hasSocial, config = DEFAULT_DECAY) {
    const multiplier = hasSocial ? config.companionDamper : config.isolationMultiplier;
    psych.lucidity = Math.max(config.lucidityFloor, psych.lucidity - config.lucidityBase * multiplier);
    psych.hope = Math.max(config.hopeFloor, psych.hope - config.hopeBase * multiplier);
    return psych;
}
/**
 * System: apply psychological decay to all entities with Psychology + Identity.
 * Dead entities are skipped.
 */
export function psychologyDecaySystem(world, config = DEFAULT_DECAY) {
    const entities = query(world, [PSYCHOLOGY, IDENTITY]);
    for (const [entity, psych, ident] of entities) {
        const identity = ident;
        const psychology = psych;
        if (!identity.alive)
            continue;
        const social = hasSocialContact(world, entity);
        decayPsychology(psychology, social, config);
    }
}
export const DEFAULT_BOND = {
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
export function getOrCreateBond(rels, target, currentTick) {
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
export function accumulateBond(bond, currentTick, config = DEFAULT_BOND) {
    bond.familiarity = Math.min(config.maxFamiliarity, bond.familiarity + config.familiarityPerTick);
    bond.affinity = Math.min(config.maxAffinity, bond.affinity + config.affinityPerTick);
    bond.lastContact = currentTick;
}
/**
 * Decay bond from absence. Called per tick for bonds not currently co-located.
 * Familiarity decays very slowly. Affinity drifts toward 0.
 * Mutates bond in place.
 */
export function decayBond(bond, config = DEFAULT_BOND) {
    bond.familiarity = Math.max(0, bond.familiarity - config.familiarityDecayRate);
    // Affinity drifts toward 0
    if (bond.affinity > 0) {
        bond.affinity = Math.max(0, bond.affinity - config.affinityDecayRate);
    }
    else if (bond.affinity < 0) {
        bond.affinity = Math.min(0, bond.affinity + config.affinityDecayRate);
    }
}
/**
 * Check if two positions are co-located.
 */
export function coLocated(a, b) {
    return a.side === b.side && a.position === b.position && a.floor === b.floor;
}
/**
 * System: update relationships for all entities based on co-location.
 * For each entity with Position + Relationships + Identity (alive),
 * find all other such entities at the same location and accumulate bonds.
 * Decay bonds for absent entities.
 */
export function relationshipSystem(world, currentTick, config = DEFAULT_BOND) {
    const entities = query(world, [POSITION, RELATIONSHIPS, IDENTITY]);
    // Build location index for efficient co-location lookup
    const locationIndex = new Map();
    for (const [entity, pos, , ident] of entities) {
        const identity = ident;
        if (!identity.alive)
            continue;
        const position = pos;
        const key = `${position.side}:${position.position}:${position.floor}`;
        let list = locationIndex.get(key);
        if (!list) {
            list = [];
            locationIndex.set(key, list);
        }
        list.push(entity);
    }
    // For each alive entity, accumulate bonds with co-located entities,
    // decay bonds with absent entities
    for (const [entity, pos, rels, ident] of entities) {
        const identity = ident;
        if (!identity.alive)
            continue;
        const position = pos;
        const relationships = rels;
        const key = `${position.side}:${position.position}:${position.floor}`;
        const coLocatedEntities = new Set(locationIndex.get(key) || []);
        coLocatedEntities.delete(entity);
        // Accumulate bonds with co-located entities
        for (const other of coLocatedEntities) {
            const bond = getOrCreateBond(relationships, other, currentTick);
            accumulateBond(bond, currentTick, config);
        }
        // Decay bonds with absent entities
        for (const [other, bond] of relationships.bonds) {
            if (coLocatedEntities.has(other))
                continue;
            // Check if other is still alive
            const otherIdent = getComponent(world, other, IDENTITY);
            if (otherIdent && !otherIdent.alive)
                continue; // don't decay bonds with dead
            decayBond(bond, config);
        }
    }
}
export const DEFAULT_GROUP = {
    familiarityThreshold: 10,
    affinityThreshold: 5,
};
/**
 * Check if two entities have a mutual bond above the grouping threshold.
 */
export function hasMutualBond(world, a, b, config = DEFAULT_GROUP) {
    const relsA = getComponent(world, a, RELATIONSHIPS);
    const relsB = getComponent(world, b, RELATIONSHIPS);
    if (!relsA || !relsB)
        return false;
    const bondAB = relsA.bonds.get(b);
    const bondBA = relsB.bonds.get(a);
    if (!bondAB || !bondBA)
        return false;
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
export function groupFormationSystem(world, config = DEFAULT_GROUP) {
    const entities = query(world, [POSITION, RELATIONSHIPS, IDENTITY]);
    // Build location index of alive entities
    const locationIndex = new Map();
    for (const [entity, pos, , ident] of entities) {
        if (!ident.alive)
            continue;
        const position = pos;
        const key = `${position.side}:${position.position}:${position.floor}`;
        let list = locationIndex.get(key);
        if (!list) {
            list = [];
            locationIndex.set(key, list);
        }
        list.push(entity);
    }
    // Union-find
    const parent = new Map();
    function find(x) {
        while (parent.get(x) !== x) {
            const p = parent.get(x);
            parent.set(x, parent.get(p)); // path compression
            x = p;
        }
        return x;
    }
    function union(a, b) {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent.set(ra, rb);
    }
    // Initialize parent
    const allAlive = [];
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
    const groups = new Map();
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
    if (groupMap)
        groupMap.clear();
    for (const [root, members] of groups) {
        if (members.length < 2)
            continue;
        const groupId = root; // use root entity as group ID
        for (const e of members) {
            addComponent(world, e, GROUP, { groupId });
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
export function getCompanion(world, entity) {
    const group = getComponent(world, entity, GROUP);
    if (!group)
        return undefined;
    const rels = getComponent(world, entity, RELATIONSHIPS);
    if (!rels)
        return undefined;
    const pos = getComponent(world, entity, POSITION);
    if (!pos)
        return undefined;
    let bestEntity;
    let bestAffinity = -Infinity;
    for (const [other, bond] of rels.bonds) {
        const otherGroup = getComponent(world, other, GROUP);
        if (!otherGroup || otherGroup.groupId !== group.groupId)
            continue;
        const otherIdent = getComponent(world, other, IDENTITY);
        if (!otherIdent || !otherIdent.alive)
            continue;
        const otherPos = getComponent(world, other, POSITION);
        if (!otherPos || !coLocated(pos, otherPos))
            continue;
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
export function modifyAffinity(world, source, target, delta, currentTick, config = DEFAULT_BOND) {
    const rels = getComponent(world, source, RELATIONSHIPS);
    if (!rels)
        return;
    const bond = getOrCreateBond(rels, target, currentTick);
    bond.affinity = Math.max(config.minAffinity, Math.min(config.maxAffinity, bond.affinity + delta));
}
/**
 * Apply a psychology shock (loss, violence, trauma).
 * Directly reduces lucidity and/or hope.
 */
export function applyShock(psych, lucidityDelta, hopeDelta) {
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
export function socialPressureSystem(world, thresholds = DEFAULT_THRESHOLDS, pressureRate = 0.1) {
    const entities = query(world, [POSITION, PSYCHOLOGY, IDENTITY]);
    // Build location index with disposition info
    const locationMadCount = new Map();
    const locationEntities = new Map();
    for (const [entity, pos, psych, ident] of entities) {
        const identity = ident;
        if (!identity.alive)
            continue;
        const position = pos;
        const psychology = psych;
        const key = `${position.side}:${position.position}:${position.floor}`;
        const disp = deriveDisposition(psychology, true, thresholds);
        let list = locationEntities.get(key);
        if (!list) {
            list = [];
            locationEntities.set(key, list);
        }
        list.push([entity, psychology]);
        if (disp === "mad") {
            locationMadCount.set(key, (locationMadCount.get(key) || 0) + 1);
        }
    }
    // Apply pressure: for each location with 2+ mad entities,
    // non-mad entities lose lucidity faster
    for (const [key, madCount] of locationMadCount) {
        if (madCount < 2)
            continue;
        const ents = locationEntities.get(key);
        if (!ents)
            continue;
        for (const [, psychology] of ents) {
            const disp = deriveDisposition(psychology, true, thresholds);
            if (disp !== "mad" && disp !== "catatonic") {
                psychology.lucidity = Math.max(0, psychology.lucidity - pressureRate * madCount);
            }
        }
    }
}
