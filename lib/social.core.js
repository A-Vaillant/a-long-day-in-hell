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
import { getComponent, query, addComponent } from "./ecs.core.js";
import { PERSONALITY, decayBias, entityCompatibility, familiarityFatigue } from "./personality.core.js";
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
    lucidityBase: 0.003, // ~0.72/day alone → anxious ~day 55, mad ~day 83
    hopeBase: 0.004, // ~0.96/day alone → anxious ~day 62, catatonic ~day 88
    isolationMultiplier: 1.0, // no extra penalty — base rate IS the isolation rate
    companionDamper: 0.15, // companion slows decay to 15% of base
    lucidityFloor: 0,
    hopeFloor: 0,
};
/**
 * Check if an entity has any nearby bonded entity (within hearing range,
 * familiarity > 0, affinity > 0, alive).
 *
 * You feel less alone when you can hear someone you know nearby,
 * even if they're not right next to you.
 */
export function hasSocialContact(world, entity, awarenessConfig = DEFAULT_AWARENESS) {
    const pos = getComponent(world, entity, POSITION);
    const rels = getComponent(world, entity, RELATIONSHIPS);
    if (!pos || !rels)
        return false;
    for (const [other] of rels.bonds) {
        const otherPos = getComponent(world, other, POSITION);
        const otherIdent = getComponent(world, other, IDENTITY);
        if (!otherPos || !otherIdent || !otherIdent.alive)
            continue;
        if (canHear(pos, otherPos, awarenessConfig)) {
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
 *
 * If decayBias is provided ({ lucidityMul, hopeMul }), it skews
 * which axis decays faster based on personality traits.
 */
export function decayPsychology(psych, hasSocial, config = DEFAULT_DECAY, bias) {
    const multiplier = hasSocial ? config.companionDamper : config.isolationMultiplier;
    const lucMul = bias ? bias.lucidityMul : 1.0;
    const hopeMul = bias ? bias.hopeMul : 1.0;
    psych.lucidity = Math.max(config.lucidityFloor, psych.lucidity - config.lucidityBase * multiplier * lucMul);
    psych.hope = Math.max(config.hopeFloor, psych.hope - config.hopeBase * multiplier * hopeMul);
    return psych;
}
/**
 * System: apply psychological decay to all entities with Psychology + Identity.
 * Dead entities are skipped. If the entity has a Personality component,
 * trait-based decay bias is applied.
 */
export function psychologyDecaySystem(world, config = DEFAULT_DECAY) {
    const entities = query(world, [PSYCHOLOGY, IDENTITY]);
    for (const [entity, psych, ident] of entities) {
        const identity = ident;
        const psychology = psych;
        if (!identity.alive)
            continue;
        const social = hasSocialContact(world, entity);
        const personality = getComponent(world, entity, PERSONALITY);
        const bias = personality ? decayBias(personality) : undefined;
        decayPsychology(psychology, social, config, bias);
    }
}
export const DEFAULT_BOND = {
    familiarityPerTick: 0.15, // ~36/day co-located → grouping threshold (10) in ~67 ticks
    affinityPerTick: 0.08, // ~19/day co-located → grouping threshold (5) in ~63 ticks
    familiarityDecayRate: 0.002, // very slow — you don't forget people
    affinityDecayRate: 0.02, // feelings fade faster than memory
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
 *
 * If compatibility is provided (0–1), familiarity fatigue applies:
 * past the fatigue threshold, affinity gain slows and eventually reverses.
 */
export function accumulateBond(bond, currentTick, config = DEFAULT_BOND, compat) {
    bond.familiarity = Math.min(config.maxFamiliarity, bond.familiarity + config.familiarityPerTick);
    let affinityDelta = config.affinityPerTick;
    // Familiarity fatigue: compatibility determines how long affinity keeps growing
    if (compat !== undefined) {
        affinityDelta += familiarityFatigue(bond.familiarity, compat, config.maxFamiliarity);
    }
    bond.affinity = Math.max(config.minAffinity, Math.min(config.maxAffinity, bond.affinity + affinityDelta));
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
 * Check if two positions are co-located (exact same spot).
 */
export function coLocated(a, b) {
    return a.side === b.side && a.position === b.position && a.floor === b.floor;
}
export const DEFAULT_AWARENESS = {
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
export function segmentDistance(a, b) {
    if (a.floor !== b.floor)
        return Infinity;
    if (a.side !== b.side)
        return Infinity; // use canSeeAcrossChasm for cross-chasm
    return Math.abs(a.position - b.position);
}
/**
 * Whether entity A can see entity B across the chasm.
 * Same floor, different side. Visual only — no interaction possible
 * except at floor 0 where you can cross.
 */
export function canSeeAcrossChasm(a, b) {
    return a.floor === b.floor && a.side !== b.side;
}
/**
 * Whether A can hear B (same side, same floor, within hearing range).
 */
export function canHear(a, b, config = DEFAULT_AWARENESS) {
    return segmentDistance(a, b) <= config.hearRange;
}
/**
 * Whether A can see B (same side, same floor, within sight range).
 */
export function canSee(a, b, config = DEFAULT_AWARENESS) {
    const dist = segmentDistance(a, b);
    if (dist <= config.sightRange)
        return true;
    return false;
}
/**
 * Get all entities visible to a given entity (same side within sight range,
 * or across chasm on same floor). Returns array of [entity, distance] pairs.
 * Distance is Infinity for cross-chasm sightings.
 */
export function getVisibleEntities(world, entity, config = DEFAULT_AWARENESS) {
    const pos = getComponent(world, entity, POSITION);
    if (!pos)
        return [];
    const results = [];
    const entities = query(world, [POSITION, IDENTITY]);
    for (const [other, otherPos, otherIdent] of entities) {
        if (other === entity)
            continue;
        if (!otherIdent.alive)
            continue;
        const op = otherPos;
        const dist = segmentDistance(pos, op);
        if (dist <= config.sightRange) {
            results.push([other, dist]);
        }
        else if (canSeeAcrossChasm(pos, op)) {
            results.push([other, Infinity]);
        }
    }
    return results;
}
/**
 * Get entities within hearing range (same side, same floor, within hearRange).
 */
export function getNearbyEntities(world, entity, config = DEFAULT_AWARENESS) {
    const pos = getComponent(world, entity, POSITION);
    if (!pos)
        return [];
    const results = [];
    const entities = query(world, [POSITION, IDENTITY]);
    for (const [other, otherPos, otherIdent] of entities) {
        if (other === entity)
            continue;
        if (!otherIdent.alive)
            continue;
        if (canHear(pos, otherPos, config)) {
            results.push(other);
        }
    }
    return results;
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
            const compat = entityCompatibility(world, entity, other);
            accumulateBond(bond, currentTick, config, compat);
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
    // Clear all existing group components (iterate map directly, no array alloc)
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
 * Mad entities exert social pressure on nearby non-mad entities
 * (within shout range), accelerating their lucidity decay.
 * This is the Direite recruitment mechanic. You can hear them ranting
 * from corridors away.
 *
 * Requires 2+ mad entities within shout range to trigger.
 * Call after groupFormationSystem.
 */
export function socialPressureSystem(world, thresholds = DEFAULT_THRESHOLDS, pressureRate = 0.1, awareness = DEFAULT_AWARENESS) {
    const entities = query(world, [POSITION, PSYCHOLOGY, IDENTITY]);
    // Partition alive entities into mad (sources) and targets, indexed spatially
    const targets = [];
    // Index mad entities by (side, floor) for O(M) range checks per target
    const madIndex = new Map();
    for (const [, pos, psych, ident] of entities) {
        if (!ident.alive)
            continue;
        const psychology = psych;
        const position = pos;
        const disp = deriveDisposition(psychology, true, thresholds);
        if (disp === "mad") {
            const key = `${position.side}:${position.floor}`;
            let list = madIndex.get(key);
            if (!list) {
                list = [];
                madIndex.set(key, list);
            }
            list.push({ position: position.position });
        }
        else if (disp !== "catatonic") {
            targets.push({ pos: position, psych: psychology });
        }
    }
    // For each target, count mad entities within shout range (same side+floor only)
    for (const target of targets) {
        const key = `${target.pos.side}:${target.pos.floor}`;
        const madNearby = madIndex.get(key);
        if (!madNearby)
            continue;
        let nearbyMadCount = 0;
        for (const mad of madNearby) {
            if (Math.abs(target.pos.position - mad.position) <= awareness.shoutRange) {
                nearbyMadCount++;
            }
        }
        if (nearbyMadCount >= 2) {
            target.psych.lucidity = Math.max(0, target.psych.lucidity - pressureRate * nearbyMadCount);
        }
    }
}
