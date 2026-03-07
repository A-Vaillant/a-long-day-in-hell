/**
 * Belief system — prior faith and hell-born convictions.
 *
 * Two layers:
 *   1. Prior faith — your religion in life. Fixed at spawn. Determines
 *      how hard the Zoroastrian revelation hits you and what you talk about.
 *   2. Stance — what hell has turned you into. Evolves over time based on
 *      psychology, social exposure, and shocks. Mutually exclusive positions:
 *      undecided → seeker / direite / nihilist / holdout.
 *
 * Prior faith erodes (faithCrisis grows). What replaces it is the stance.
 * You can't be a Direite and a Seeker. You can't be a Holdout and a Nihilist.
 * Transitions are driven by psychology thresholds and social contagion.
 *
 * ECS component key: "belief"
 *
 * @module belief.core
 */

import { getComponent } from "./ecs.core.js";

// --- Types ---

export interface Rng {
    next(): number;
}

export const BELIEF = "belief";

/** Prior faith traditions. */
export const FAITHS = [
    "mormon",
    "catholic",
    "protestant",
    "evangelical",
    "jewish",
    "muslim",
    "hindu",
    "buddhist",
    "atheist",
    "agnostic",
] as const;

export type Faith = typeof FAITHS[number];

/**
 * Hell-born stances. Mutually exclusive.
 *
 * - undecided: default. Haven't committed to a worldview yet.
 * - seeker: accepted the rules, searching with purpose. Functional faith.
 * - direite: God spoke, scourge them. Meaning through violence.
 * - nihilist: none of it means anything. Precursor to catatonia.
 * - holdout: clinging to prior faith. "This is a test."
 */
export const STANCES = [
    "undecided",
    "seeker",
    "direite",
    "nihilist",
    "holdout",
] as const;

export type Stance = typeof STANCES[number];

export interface BeliefComponent {
    faith: Faith;
    /** 0–1: how devout they were in life. Higher = harder the crisis hits. */
    devotion: number;
    /** 0–1: how far their prior faith has crumbled. Grows over time. */
    faithCrisis: number;
    /** 0–1: how much they've accepted the Zoroastrian reality. */
    acceptance: number;
    /** Current hell-born stance. */
    stance: Stance;
}

// --- Generation ---

/** Faith distribution weights. Roughly mirrors English-speaking readers
 *  who died in the last century. */
const FAITH_WEIGHTS: Record<Faith, number> = {
    protestant: 0.20,
    catholic: 0.18,
    evangelical: 0.10,
    mormon: 0.04,
    jewish: 0.06,
    muslim: 0.05,
    hindu: 0.04,
    buddhist: 0.03,
    atheist: 0.15,
    agnostic: 0.15,
};

function weightedPick<T extends string>(weights: Record<T, number>, roll: number): T {
    let cumulative = 0;
    const entries = Object.entries(weights) as [T, number][];
    for (const [key, weight] of entries) {
        cumulative += weight;
        if (roll < cumulative) return key;
    }
    return entries[entries.length - 1][0];
}

/**
 * Generate a belief component from an RNG.
 * Deterministic given the same RNG state.
 */
export function generateBelief(rng: Rng): BeliefComponent {
    const faith = weightedPick(FAITH_WEIGHTS, rng.next());
    const devotion = rng.next();

    return {
        faith,
        devotion,
        faithCrisis: 0,
        acceptance: 0,
        stance: "undecided",
    };
}

// --- Faith crisis evolution ---

export const DEFAULT_CRISIS = {
    /** Base rate of faith crisis growth per tick. */
    crisisGrowthBase: 0.0005,
    /** How much devotion amplifies crisis growth (more devout = harder fall). */
    devotionAmplifier: 1.5,
    /** Base rate of acceptance growth per tick. */
    acceptanceGrowthBase: 0.0002,
    /** Acceptance grows faster when faith crisis is high. */
    acceptanceCrisisBoost: 2.0,
    /** Floor for crisis growth (even atheists feel the ground shift). */
    crisisFloor: 0.3,
};

/**
 * Advance faith crisis and acceptance by one tick.
 * Mutates the belief component in place.
 *
 * Faith crisis grows faster for devout believers.
 * Acceptance grows faster once crisis is high (resignation).
 * Atheists/agnostics still have crisis — the universe has a god
 * and it's not theirs — but the floor is lower.
 */
export function evolveBelief(
    belief: BeliefComponent,
    config = DEFAULT_CRISIS,
): void {
    const devScale = config.crisisFloor + belief.devotion * config.devotionAmplifier;
    const crisisGrowth = config.crisisGrowthBase * devScale;
    belief.faithCrisis = Math.min(1, belief.faithCrisis + crisisGrowth);

    const acceptBoost = 1 + belief.faithCrisis * config.acceptanceCrisisBoost;
    belief.acceptance = Math.min(1, belief.acceptance + config.acceptanceGrowthBase * acceptBoost);
}

// --- Stance transitions ---

export const DEFAULT_STANCE = {
    /** Faith crisis threshold to leave holdout. */
    holdoutCrisisBreak: 0.8,
    /** Acceptance threshold to become seeker. */
    seekerAcceptance: 0.6,
    /** Hope threshold below which nihilist emerges. */
    nihilistHope: 30,
    /** Lucidity threshold below which direite emerges. */
    direiteLucidity: 35,
    /** Hope must be above this for direite (they have energy, just misdirected). */
    direiteHopeFloor: 25,
    /** Social exposure ticks near direites to accelerate transition. */
    direiteExposureThreshold: 50,
};

/**
 * Determine what stance an entity should transition to, given their
 * current psychology and belief state.
 *
 * Returns the new stance, or the current stance if no transition.
 * Does NOT mutate — caller decides whether to apply.
 *
 * Transition rules:
 * - Holdout: high devotion + low crisis. Clinging to prior faith.
 *   Breaks when crisis exceeds threshold.
 * - Direite: low lucidity + enough hope + (optional) social exposure.
 *   Mad but energized. Violence as meaning.
 * - Nihilist: low hope. Nothing matters. Precursor to catatonia.
 * - Seeker: high acceptance + adequate lucidity + adequate hope.
 *   Functional. Playing the game.
 * - Undecided: none of the above.
 *
 * Priority: direite > nihilist > holdout > seeker > undecided.
 * (Madness and despair override reasoned positions.)
 */
export function deriveStance(
    belief: BeliefComponent,
    lucidity: number,
    hope: number,
    direiteExposure: number,
    config = DEFAULT_STANCE,
): Stance {
    // Direite: broken lucidity, enough hope to act, social pull
    if (lucidity <= config.direiteLucidity &&
        hope > config.direiteHopeFloor) {
        return "direite";
    }

    // Nihilist: hope bottomed out
    if (hope <= config.nihilistHope) {
        return "nihilist";
    }

    // Holdout: still clinging to prior faith
    if (belief.devotion > 0.4 &&
        belief.faithCrisis < config.holdoutCrisisBreak) {
        return "holdout";
    }

    // Seeker: accepted reality, still functional
    if (belief.acceptance >= config.seekerAcceptance &&
        lucidity > config.direiteLucidity &&
        hope > config.nihilistHope) {
        return "seeker";
    }

    return "undecided";
}

/**
 * Update stance on an entity's belief component.
 * Call once per tick (or less frequently — stance changes are slow).
 * Mutates belief.stance in place.
 * Returns true if stance changed.
 */
export function updateStance(
    belief: BeliefComponent,
    lucidity: number,
    hope: number,
    direiteExposure: number,
    config = DEFAULT_STANCE,
): boolean {
    const newStance = deriveStance(belief, lucidity, hope, direiteExposure, config);
    if (newStance !== belief.stance) {
        belief.stance = newStance;
        return true;
    }
    return false;
}

// --- Psychology modifiers ---

export interface BeliefDecayMod {
    hopeMul: number;
    lucidityMul: number;
}

/**
 * Compute psychology decay modifiers from belief state.
 *
 * Unresolved faith crisis (high crisis, low acceptance) accelerates hope decay.
 * Acceptance dampens hope decay (you've stopped fighting).
 * Stance modifies both axes:
 *   - Holdout: slower lucidity decay (conviction protects clarity)
 *     but faster hope decay (reality keeps contradicting you)
 *   - Seeker: slight resilience on both (purpose helps)
 *   - Nihilist: faster hope decay (feedback loop)
 *   - Direite: slower hope decay (purpose through violence)
 *     but faster lucidity decay (deeper into madness)
 *
 * Returns multipliers centered around 1.0.
 */
export function beliefDecayMod(belief: BeliefComponent): BeliefDecayMod {
    let hopeMul = 1.0;
    let lucidityMul = 1.0;

    // Unresolved faith crisis drains hope
    const unresolved = belief.faithCrisis * (1 - belief.acceptance);
    hopeMul += unresolved * 0.3;

    // Acceptance provides slight hope resilience
    hopeMul -= belief.acceptance * 0.1;

    // Stance effects
    switch (belief.stance) {
        case "holdout":
            lucidityMul -= 0.1;  // conviction protects clarity
            hopeMul += 0.15;     // but reality keeps hitting
            break;
        case "seeker":
            hopeMul -= 0.1;      // purpose sustains
            lucidityMul -= 0.05; // slight clarity bonus
            break;
        case "nihilist":
            hopeMul += 0.2;      // despair feedback loop
            break;
        case "direite":
            hopeMul -= 0.15;     // violence gives purpose
            lucidityMul += 0.15; // deeper into madness
            break;
    }

    return { hopeMul, lucidityMul };
}

// --- Entity convenience ---

/**
 * Get belief decay modifiers for an entity. Returns neutral modifiers
 * if the entity has no belief component.
 */
export function entityBeliefDecayMod(
    world: Parameters<typeof getComponent>[0],
    entity: number,
): BeliefDecayMod {
    const belief = getComponent<BeliefComponent>(world, entity, BELIEF);
    if (!belief) return { hopeMul: 1.0, lucidityMul: 1.0 };
    return beliefDecayMod(belief);
}
