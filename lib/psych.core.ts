/**
 * Psychology simulation — shock, habituation, numbness.
 *
 * Every source of psychological damage ("SAN damage") has its own
 * habituation curve per entity. First exposure hits hard. Repeated
 * exposure numbs you. The curve is hyperbolic: impact = base / (1 + k * n).
 *
 * Built on the ECS. Defines the HABITUATION component and a registry
 * of shock sources with configurable base impacts and habituation rates.
 *
 * @module psych.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent } from "./ecs.core.ts";
import type { Psychology } from "./social.core.ts";
import { PSYCHOLOGY } from "./social.core.ts";

// --- Component key ---

export const HABITUATION = "habituation";

// --- Component type ---

/**
 * Tracks per-source exposure counts for shock habituation.
 * Key: shock source ID string. Value: number of exposures.
 */
export interface Habituation {
    exposures: Map<string, number>;
}

// --- Shock source registry ---

/**
 * A shock source definition.
 *
 * Impact formula: base / (1 + habitRate * exposures)
 * At 0 exposures: full base impact. Approaches 0 asymptotically.
 * habitRate = 0 means no habituation (always full impact).
 */
export interface ShockSource {
    lucidity: number;    // base lucidity impact (negative = damage)
    hope: number;        // base hope impact (negative = damage)
    habitRate: number;   // habituation speed (higher = numb faster)
}

/**
 * Registry of shock sources. Add new keys to extend.
 */
export type ShockConfig = Record<string, ShockSource>;

export const DEFAULT_SHOCKS: ShockConfig = {
    // Witnessing someone jump into the chasm — they'll be tumbling for a long time
    witnessChasm:       { lucidity: -3,  hope: -12, habitRate: 0.3 },
    // Being killed — terrifying at first, routine eventually
    beingKilled:        { lucidity: -5,  hope: -8,  habitRate: 0.8 },
    // Companion going mad — personal, slow to numb
    companionMad:       { lucidity: -8,  hope: -5,  habitRate: 0.15 },
    // Being dismissed/abandoned
    beingDismissed:     { lucidity: 0,   hope: -10, habitRate: 0.4 },
    // Witnessing an attack — goes numb fastest
    witnessAttack:      { lucidity: -4,  hope: -2,  habitRate: 1.0 },
    // Killing someone (attacker's cost)
    committingViolence: { lucidity: -2,  hope: -5,  habitRate: 0.6 },
};

// --- Core functions ---

/**
 * Compute attenuated shock impact after habituation.
 * Formula: base / (1 + habitRate * exposures)
 */
export function attenuateShock(
    source: ShockSource,
    exposures: number,
): { lucidity: number; hope: number } {
    const denom = 1 + source.habitRate * exposures;
    return {
        lucidity: source.lucidity / denom,
        hope: source.hope / denom,
    };
}

/**
 * Get the current exposure count for a source.
 */
export function getExposure(habit: Habituation, sourceKey: string): number {
    return habit.exposures.get(sourceKey) || 0;
}

/**
 * Apply a shock from a named source to psychology, accounting for
 * habituation. Increments the exposure counter.
 *
 * If no Habituation provided, applies full unattenuated shock.
 *
 * Returns the actual impact applied (after attenuation).
 */
export function applyShock(
    psych: Psychology,
    habit: Habituation | undefined,
    sourceKey: string,
    config: ShockConfig = DEFAULT_SHOCKS,
): { lucidity: number; hope: number } {
    const source = config[sourceKey];
    if (!source) return { lucidity: 0, hope: 0 };

    const exposures = habit ? getExposure(habit, sourceKey) : 0;
    const impact = attenuateShock(source, exposures);

    const prevLucidity = psych.lucidity;
    const prevHope = psych.hope;

    psych.lucidity = Math.max(0, Math.min(100, psych.lucidity + impact.lucidity));
    psych.hope = Math.max(0, Math.min(100, psych.hope + impact.hope));

    if (habit) {
        habit.exposures.set(sourceKey, exposures + 1);
    }

    return {
        lucidity: psych.lucidity - prevLucidity,
        hope: psych.hope - prevHope,
    };
}

/**
 * Apply a shock to an entity by ID, looking up components from the world.
 * Convenience wrapper for the common ECS pattern.
 *
 * Returns the actual impact, or { lucidity: 0, hope: 0 } if missing components.
 */
export function applyShockToEntity(
    world: World,
    entity: Entity,
    sourceKey: string,
    config: ShockConfig = DEFAULT_SHOCKS,
): { lucidity: number; hope: number } {
    const psych = getComponent<Psychology>(world, entity, PSYCHOLOGY);
    if (!psych) return { lucidity: 0, hope: 0 };

    const habit = getComponent<Habituation>(world, entity, HABITUATION);
    return applyShock(psych, habit, sourceKey, config);
}
