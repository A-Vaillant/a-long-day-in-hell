/**
 * Personality system — fixed traits, compatibility, familiarity fatigue.
 *
 * Each entity has a personality derived from their life story seed.
 * Personality is who you were. Disposition is what hell does to you.
 *
 * Traits determine:
 * - Long-term compatibility between entities (fatigue threshold)
 * - Directional bias in psychological decay (which way you break)
 *
 * @module personality.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent } from "./ecs.core.ts";

// --- Component ---

export const PERSONALITY = "personality";

/**
 * Fixed personality traits. All 0–1 continuous.
 * Derived from the entity's seed at spawn. Never changes.
 */
export interface Personality {
    /** withdrawn (0) ↔ volatile (1) — stress response */
    temperament: number;
    /** patient (0) ↔ restless (1) — tolerance for staying put */
    pace: number;
    /** guarded (0) ↔ open (1) — how readily you let people in */
    openness: number;
    /** accepting (0) ↔ resistant (1) — how you frame being here */
    outlook: number;
}

// --- Trait generation ---

export interface Rng {
    next(): number;
}

/**
 * Generate a personality from an RNG (seeded from life story).
 */
export function generatePersonality(rng: Rng): Personality {
    return {
        temperament: rng.next(),
        pace: rng.next(),
        openness: rng.next(),
        outlook: rng.next(),
    };
}

// --- Compatibility ---

/**
 * Compatibility between two personalities. Returns 0–1.
 *
 * Rules:
 * - Similar temperament = good (you handle stress the same way)
 * - Similar pace = good (you want the same things day to day)
 * - Openness: one open + one guarded can work; both guarded is slow
 *   but stable; both open is warm but volatile. Mild bonus for difference.
 * - Outlook: similar is stabilizing. An accepter + resister can work
 *   but generates friction.
 *
 * Weighted: temperament and pace matter most for daily cohabitation.
 */
export function compatibility(a: Personality, b: Personality): number {
    // Distance per axis (0 = identical, 1 = opposite)
    const tempDist = Math.abs(a.temperament - b.temperament);
    const paceDist = Math.abs(a.pace - b.pace);
    const openDist = Math.abs(a.openness - b.openness);
    const outlookDist = Math.abs(a.outlook - b.outlook);

    // Similarity scores (1 = identical, 0 = opposite)
    const tempSim = 1 - tempDist;
    const paceSim = 1 - paceDist;
    // Openness: slight bonus for complementary (one open, one guarded)
    const openSim = 1 - openDist * 0.5;
    const outlookSim = 1 - outlookDist * 0.7;

    // Weighted average — temperament and pace dominate daily life
    const score = tempSim * 0.35 + paceSim * 0.35 + openSim * 0.15 + outlookSim * 0.15;

    return Math.max(0, Math.min(1, score));
}

/**
 * Get compatibility between two entities from the world.
 * Returns 0.5 (neutral) if either lacks a personality component.
 */
export function entityCompatibility(
    world: World,
    a: Entity,
    b: Entity,
): number {
    const pa = getComponent<Personality>(world, a, PERSONALITY);
    const pb = getComponent<Personality>(world, b, PERSONALITY);
    if (!pa || !pb) return 0.5;
    return compatibility(pa, pb);
}

// --- Familiarity fatigue ---

/**
 * Configuration for familiarity fatigue.
 */
export interface FatigueConfig {
    /** Compatibility maps to this fraction of maxFamiliarity as threshold.
     *  e.g., 1.0 means compatibility 0.8 → fatigue at familiarity 80. */
    thresholdScale: number;
    /** How strongly friction erodes affinity past the threshold. */
    frictionRate: number;
}

export const DEFAULT_FATIGUE: FatigueConfig = {
    thresholdScale: 1.0,
    frictionRate: 0.03,
};

/**
 * Compute the affinity adjustment for familiarity fatigue.
 * Returns a modifier to add to the normal affinity gain per tick.
 *
 * Below fatigue threshold: returns 0 (no effect, normal gain applies).
 * Above threshold: returns a negative value (friction) that scales
 * with how far past the threshold you are.
 *
 * At max familiarity with compatibility 0.3:
 *   overshoot = (100 - 30) / (100 - 30) = 1.0
 *   friction = -frictionRate * 1.0 = -0.03/tick
 *   Normal gain is 0.08, so net = 0.08 - 0.03 = 0.05 (slowing)
 *
 * At max familiarity with compatibility 0.1:
 *   threshold = 10, overshoot at fam 100 = 1.0
 *   But you've been past threshold since fam 10, so erosion dominates.
 */
export function familiarityFatigue(
    familiarity: number,
    compat: number,
    maxFamiliarity: number = 100,
    config: FatigueConfig = DEFAULT_FATIGUE,
): number {
    const threshold = compat * maxFamiliarity * config.thresholdScale;
    if (familiarity <= threshold) return 0;

    const range = maxFamiliarity - threshold;
    if (range <= 0) return 0;

    const overshoot = (familiarity - threshold) / range;
    return -config.frictionRate * overshoot;
}

// --- Trait-influenced decay direction ---

/**
 * Decay bias from personality traits.
 * Returns multipliers for lucidity and hope decay rates.
 *
 * Volatile (high temperament) → lucidity decays faster (you break toward madness)
 * Withdrawn (low temperament) → hope decays faster (you break toward catatonia)
 * Resistant outlook → lucidity decays faster (fighting reality erodes clarity)
 * Accepting outlook → slight hope resilience (you've made peace, somewhat)
 *
 * Returns { lucidityMul, hopeMul } — multipliers on base decay rate.
 * Centered around 1.0. Range roughly 0.7–1.3.
 */
export function decayBias(personality: Personality): { lucidityMul: number; hopeMul: number } {
    // Temperament: volatile = faster lucidity loss, withdrawn = faster hope loss
    // At 0.5 (neutral): no bias. Deviation of 0.5 → ±0.2 multiplier shift.
    const tempBias = (personality.temperament - 0.5) * 0.4;

    // Outlook: resistant = faster lucidity loss, accepting = slight hope resilience
    const outlookBias = (personality.outlook - 0.5) * 0.2;

    return {
        lucidityMul: 1.0 + tempBias + outlookBias,
        hopeMul: 1.0 - tempBias + outlookBias * 0.5,
    };
}
