/**
 * Character stats — physical and social capabilities.
 *
 * Three stats on 3–18 (3d6):
 *   - Endurance: hunger/thirst/exhaustion resistance, mortality resilience
 *   - Influence: social pressure output, companion restoration, affinity gain
 *   - Quickness: movement speed, chasm grab bonus, search speed
 *
 * Personality traits determine *direction* (which way you break).
 * Stats determine *magnitude* (how fast, how hard, how much).
 *
 * Modifier functions return multipliers centered around 1.0.
 * A stat of 10–11 gives ~1.0. Extremes (3 or 18) give ~0.5 or ~1.5.
 *
 * @module stats.core
 */

// --- Component ---

export const STATS = "stats";

export interface Stats {
    endurance: number;   // 3–18
    influence: number;   // 3–18
    quickness: number;   // 3–18
}

// --- Generation ---

export interface Rng {
    next(): number;
}

/** Roll 3d6. */
function roll3d6(rng: Rng): number {
    return Math.floor(rng.next() * 6) + 1
         + Math.floor(rng.next() * 6) + 1
         + Math.floor(rng.next() * 6) + 1;
}

/** Generate stats from an RNG. Deterministic given the same state. */
export function generateStats(rng: Rng): Stats {
    return {
        endurance: roll3d6(rng),
        influence: roll3d6(rng),
        quickness: roll3d6(rng),
    };
}

// --- Modifier derivation ---

/**
 * Convert a 3–18 stat to a multiplier centered around 1.0.
 * 10.5 is the 3d6 mean.
 *
 *   3 → 0.5,  10–11 → 1.0,  18 → 1.5
 *
 * Linear interpolation. Clamped to [0.5, 1.5].
 */
export function statMod(stat: number): number {
    const mod = 0.5 + (stat - 3) / 15;
    return Math.max(0.5, Math.min(1.5, mod));
}

/** Endurance modifier — scales needs accumulation (inverted: high = slower). */
export function enduranceMod(stats: Stats): number {
    // High endurance = slower need growth = 1/mod
    return 1 / statMod(stats.endurance);
}

/** Influence modifier — scales social pressure output, companion restore, affinity gain. */
export function influenceMod(stats: Stats): number {
    return statMod(stats.influence);
}

/** Quickness modifier — scales movement probability, search speed, grab chance bonus. */
export function quicknessMod(stats: Stats): number {
    return statMod(stats.quickness);
}
