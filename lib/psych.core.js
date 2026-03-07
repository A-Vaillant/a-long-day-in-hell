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
import { getComponent } from "./ecs.core.js";
import { PSYCHOLOGY } from "./social.core.js";
// --- Component key ---
export const HABITUATION = "habituation";
export const DEFAULT_SHOCKS = {
    // Cosmic scale: shocks are meaningful but not devastating.
    // A single death shouldn't move the needle much after centuries.
    witnessChasm: { lucidity: -0.5, hope: -2, habitRate: 0.3 },
    beingKilled: { lucidity: -1, hope: -1.5, habitRate: 0.8 },
    companionMad: { lucidity: -1.5, hope: -1, habitRate: 0.15 },
    beingDismissed: { lucidity: 0, hope: -2, habitRate: 0.4 },
    witnessAttack: { lucidity: -0.8, hope: -0.3, habitRate: 1.0 },
    committingViolence: { lucidity: -0.3, hope: -1, habitRate: 0.6 },
};
// --- Core functions ---
/**
 * Compute attenuated shock impact after habituation.
 * Formula: base / (1 + habitRate * exposures)
 */
export function attenuateShock(source, exposures) {
    const denom = 1 + source.habitRate * exposures;
    return {
        lucidity: source.lucidity / denom,
        hope: source.hope / denom,
    };
}
/**
 * Get the current exposure count for a source.
 */
export function getExposure(habit, sourceKey) {
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
export function applyShock(psych, habit, sourceKey, config = DEFAULT_SHOCKS) {
    const source = config[sourceKey];
    if (!source)
        return { lucidity: 0, hope: 0 };
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
export function applyShockToEntity(world, entity, sourceKey, config = DEFAULT_SHOCKS) {
    const psych = getComponent(world, entity, PSYCHOLOGY);
    if (!psych)
        return { lucidity: 0, hope: 0 };
    const habit = getComponent(world, entity, HABITUATION);
    return applyShock(psych, habit, sourceKey, config);
}
