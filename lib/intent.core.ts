/**
 * Intent system — utility-based behavior arbiter for NPCs.
 *
 * One active behavior at a time per entity. Each behavior has a scoring
 * function that evaluates the entity's current state (psychology, needs,
 * personality) and returns a utility score. Highest score wins.
 *
 * Stickiness: the current behavior gets a bonus to its score, preventing
 * thrashing. Forced states (dead, catatonic, mad) bypass scoring entirely.
 *
 * Psychology, needs, and personality are read-only inputs.
 * Intent does not modify them — it only decides what the NPC does.
 *
 * To add a new behavior:
 *   1. Add the string to BEHAVIORS
 *   2. Add a scorer to DEFAULT_SCORERS
 *   3. Write the behavior system that checks intent.behavior === "yourThing"
 *
 * @module intent.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, hasComponent, query } from "./ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, PLAYER, RELATIONSHIPS,
    deriveDisposition, coLocated,
    type Position, type Identity, type Psychology, type Relationships,
} from "./social.core.ts";
import { PERSONALITY, type Personality } from "./personality.core.ts";
import { NEEDS, type Needs } from "./needs.core.ts";
import { SLEEP, type Sleep } from "./sleep.core.ts";
import { MEMORY, type Memory, getBookVision, type BookVisionEntry } from "./memory.core.ts";
import { LIGHTS_ON_TICKS } from "./tick.core.ts";
import { TICKS_PER_HOUR } from "./scale.core.ts";

// --- Behavior type ---

export const BEHAVIORS = [
    "idle",
    "explore",
    "seek_rest",
    "search",
    "return_home",
    "wander_mad",
    "pilgrimage",
    "socialize",
] as const;

export type Behavior = typeof BEHAVIORS[number];

// --- Component ---

export const INTENT = "intent";

export interface Intent {
    /** Current active behavior. */
    behavior: Behavior;
    /** Ticks remaining before arbiter can switch behaviors. */
    cooldown: number;
    /** Ticks spent in current behavior. */
    elapsed: number;
}

// --- Scoring context ---

/** Read-only snapshot of entity state passed to scorers. */
export interface ScorerContext {
    psych: Psychology;
    alive: boolean;
    disposition: string;
    needs: Needs | null;
    personality: Personality | null;
    intent: Intent;
    rng: Rng;
    /** Current position (for distance calculations). */
    position: Position | null;
    /** Sleep component (for home rest area). */
    sleep: Sleep | null;
    /** Memory component (for bookVision lookup). */
    memory: Memory | null;
    /** Current tick within the day (0–239). */
    tick: number;
    /** Whether a bonded entity is co-located. */
    hasCompanion: boolean;
}

interface Rng {
    next(): number;
}

/**
 * A scorer returns a utility value for a behavior given entity state.
 * Higher = more desirable. Return -Infinity to make it impossible.
 */
export type BehaviorScorer = (ctx: ScorerContext, config: IntentConfig) => number;

// --- Config ---

export interface IntentConfig {
    /** Hunger/thirst threshold that drives seek_rest urgency. */
    needsCriticalThreshold: number;
    /** Exhaustion threshold that drives seek_rest urgency. */
    exhaustionThreshold: number;
    /** Bonus score for the currently active behavior (stickiness). */
    stickinessBonus: number;
    /** Cooldowns per behavior (ticks before re-evaluation after switching). */
    cooldowns: Partial<Record<Behavior, number>>;
    /** Default cooldown if not specified per-behavior. */
    defaultCooldown: number;
}

export const DEFAULT_INTENT: IntentConfig = {
    needsCriticalThreshold: 80,
    exhaustionThreshold: 70,
    stickinessBonus: 0.3,
    cooldowns: {
        search: 8,
        explore: 10,
        seek_rest: 5,
        return_home: 8,
        pilgrimage: 20,
        socialize: 12,
    },
    defaultCooldown: 5,
};

// --- Scorers ---

const scorers: Record<string, BehaviorScorer> = {
    /**
     * Idle: fallback. Low constant score. Never actively chosen
     * unless nothing else applies.
     */
    idle(_ctx) {
        return 0.1;
    },

    /**
     * Explore: default wandering. Moderate base score.
     * Restless (high pace) NPCs score this higher.
     */
    explore(ctx) {
        let score = 0.5;
        if (ctx.personality) {
            score += ctx.personality.pace * 0.3; // restless → want to move
        }
        return score;
    },

    /**
     * Seek rest: driven by needs. Score scales with how critical
     * needs are — gradual urgency, not a hard threshold.
     */
    seek_rest(ctx, config) {
        if (!ctx.needs) return -Infinity;
        const hungerUrgency = Math.max(0, ctx.needs.hunger - 50) / 50;
        const thirstUrgency = Math.max(0, ctx.needs.thirst - 50) / 50;
        const exhaustUrgency = Math.max(0, ctx.needs.exhaustion - 40) / 60;
        const maxUrgency = Math.max(hungerUrgency, thirstUrgency, exhaustUrgency);
        if (maxUrgency <= 0) return -Infinity;
        // Scales from 0.6 (mildly hungry) to 2.0 (very hungry).
        // Above 85% need, survival panic kicks in — score spikes to 3.0+,
        // overriding pilgrimage (2.5) and everything except madness.
        if (maxUrgency >= 0.7) {
            return 2.0 + (maxUrgency - 0.7) / 0.3 * 1.5;
        }
        return 0.6 + maxUrgency * 1.4;
    },

    /**
     * Search: browse bookshelves. Open NPCs score this higher.
     * Patient (low pace) NPCs also prefer this over explore.
     * Small random jitter so not every NPC searches simultaneously.
     */
    search(ctx) {
        let score = 0.3;
        if (ctx.personality) {
            score += ctx.personality.openness * 0.5;      // curious → search
            score += (1 - ctx.personality.pace) * 0.2;    // patient → search
        }
        // Jitter: ±0.15 so identical NPCs don't all flip at once
        score += (ctx.rng.next() - 0.5) * 0.3;
        return score;
    },

    /**
     * Return home: head back to home rest area as evening approaches.
     * Score ramps from tick 120 (~8pm) toward lights-out (tick 160).
     * Drops off if too far from home (they'll go to nearest rest area instead).
     * Already at home → no need to return.
     */
    return_home(ctx) {
        if (!ctx.sleep || !ctx.position || ctx.sleep.nomadic) return -Infinity;

        const home = ctx.sleep.home;
        const pos = ctx.position;
        const posDist = Number(pos.position > home.position ? pos.position - home.position : home.position - pos.position);
        const floorDist = Number(pos.floor > home.floor ? pos.floor - home.floor : home.floor - pos.floor);
        const sideDiff = pos.side !== home.side ? 1 : 0;
        // Rough travel distance: position segments + floor changes + side crossing
        const distToHome = posDist + floorDist * 5 + sideDiff * 10;

        // Already at home rest area — no need
        if (posDist === 0 && floorDist === 0 && sideDiff === 0) return -Infinity;

        // Too far from home — nearest rest area via seek_rest is better
        if (distToHome > 30) return -Infinity;

        // Time pressure: ramps from 8 PM to LIGHTS_ON_TICKS (10 PM)
        // Before 8 PM: no urgency
        const eveningStart = 14 * TICKS_PER_HOUR; // 8:00 PM (14h after 6 AM)
        if (ctx.tick < eveningStart) return -Infinity;

        const timeUrgency = Math.min(1, (ctx.tick - eveningStart) / (LIGHTS_ON_TICKS - eveningStart));

        // Base score scales with time urgency: 0.4 (early evening) → 1.8 (near lights-out)
        let score = 0.4 + timeUrgency * 1.4;

        // Closer to home = slightly higher score (worth the trip)
        score += (1 - distToHome / 30) * 0.3;

        return score;
    },

    /**
     * Wander mad: erratic movement. Only scores for mad disposition.
     * Returns -Infinity otherwise — this is disposition-gated.
     */
    wander_mad(ctx) {
        if (ctx.disposition !== "mad") return -Infinity;
        return 3.0; // very high — madness dominates
    },

    /**
     * Socialize: stay put and interact with a co-located companion.
     * Only scores when a bonded entity is here. Patient, sociable
     * NPCs prefer this. Keeps the NPC idle (movement system ignores it).
     */
    socialize(ctx) {
        if (!ctx.hasCompanion) return -Infinity;
        let score = 0.4;
        if (ctx.personality) {
            score += (1 - ctx.personality.pace) * 0.3;  // patient → socialize
            score += ctx.personality.openness * 0.2;     // open → socialize
        }
        // Diminishing returns: score decays the longer they've been socializing
        // Halves every 8 ticks of continuous socializing
        if (ctx.intent.behavior === "socialize" && ctx.intent.elapsed > 0) {
            score *= Math.pow(0.5, ctx.intent.elapsed / 8);
        }
        // Small jitter
        score += (ctx.rng.next() - 0.5) * 0.2;
        return score;
    },

    /**
     * Pilgrimage: travel to a divinely revealed book location.
     * Only scores when the entity has a bookVision memory entry and hasn't escaped.
     * Very high priority — this is the most purposeful thing an NPC can do.
     * Needs override pilgrimage only at critical levels.
     */
    pilgrimage(ctx) {
        if (!ctx.memory) return -Infinity;
        const vision = getBookVision(ctx.memory);
        if (!vision || !vision.coords) return -Infinity;
        if (vision.state === "exhausted") return -Infinity;
        // Has book: keep pilgrimaging to nearest rest area for submission
        if (vision.state === "found") return 2.5;
        // Vague vision + within search radius → yield to search behavior
        if (vision.vague && ctx.position) {
            const v = vision.coords;
            if (ctx.position.side === v.side && ctx.position.floor === v.floor) {
                const dist = ctx.position.position > v.position
                    ? ctx.position.position - v.position
                    : v.position - ctx.position.position;
                if (dist <= BigInt(vision.radius)) {
                    return -Infinity;
                }
            }
        }
        // Exact vision + already at book location → no need to travel
        if (!vision.vague && ctx.position) {
            const v = vision.coords;
            if (ctx.position.side === v.side &&
                ctx.position.position === v.position &&
                ctx.position.floor === v.floor) {
                return -Infinity;
            }
        }
        return 2.5;
    },
};

/** Exported for testing. */
export const DEFAULT_SCORERS: Record<string, BehaviorScorer> = scorers;

// --- Companion check ---

/**
 * Check if entity has a bonded, alive, co-located companion.
 * Used by the socialize scorer.
 */
function checkHasCompanion(
    world: World,
    entity: Entity,
    position: Position | null | undefined,
): boolean {
    if (!position) return false;
    const rels = getComponent<Relationships>(world, entity, RELATIONSHIPS);
    if (!rels || rels.bonds.size === 0) return false;
    for (const [other] of rels.bonds) {
        const otherPos = getComponent<Position>(world, other, POSITION);
        const otherIdent = getComponent<Identity>(world, other, IDENTITY);
        if (!otherPos || !otherIdent || !otherIdent.alive) continue;
        if (coLocated(position, otherPos)) return true;
    }
    return false;
}

// --- Arbiter ---

/**
 * Evaluate what behavior an NPC should adopt using utility scoring.
 *
 * Each registered behavior is scored. The current behavior gets a
 * stickiness bonus. Highest score wins.
 *
 * Returns the new behavior and its cooldown, or null if current
 * behavior should persist (cooldown not expired, no forced override).
 */
export function evaluateIntent(
    intent: Intent,
    psych: Psychology,
    alive: boolean,
    needs: Needs | null,
    personality: Personality | null,
    rng: Rng,
    config: IntentConfig = DEFAULT_INTENT,
    behaviorScorers: Record<string, BehaviorScorer> = scorers,
    position: Position | null = null,
    sleep: Sleep | null = null,
    tick: number = 0,
    _knowledge: unknown = null,
    hasCompanion: boolean = false,
    memory: Memory | null = null,
): { behavior: Behavior; cooldown: number } | null {
    const disposition = deriveDisposition(psych, alive);

    // Forced: dead, catatonic, or lights off → idle, bypass scoring
    if (!alive || disposition === "catatonic" || tick >= LIGHTS_ON_TICKS) {
        if (intent.behavior !== "idle") return { behavior: "idle", cooldown: 0 };
        return null;
    }

    // Mad: normally forced to wander_mad, but survival panic
    // can override when needs are critical enough to outscore 3.0.
    if (disposition === "mad") {
        if (needs) {
            const hungerUrg = Math.max(0, needs.hunger - 50) / 50;
            const thirstUrg = Math.max(0, needs.thirst - 50) / 50;
            if (Math.max(hungerUrg, thirstUrg) >= 0.7) {
                // Fall through to normal scoring — seek_rest can compete
            } else {
                if (intent.behavior !== "wander_mad") return { behavior: "wander_mad", cooldown: 0 };
                return null;
            }
        } else {
            if (intent.behavior !== "wander_mad") return { behavior: "wander_mad", cooldown: 0 };
            return null;
        }
    }

    // Sticky: don't re-evaluate until cooldown expires
    if (intent.cooldown > 0) return null;

    const ctx: ScorerContext = {
        psych, alive, disposition, needs, personality, intent, rng,
        position, sleep, memory, tick, hasCompanion,
    };

    let bestBehavior: Behavior = "idle";
    let bestScore = -Infinity;

    for (const key in behaviorScorers) {
        const behavior = key as Behavior;
        let score = behaviorScorers[key](ctx, config);
        // Stickiness: bonus for staying in current behavior
        if (behavior === intent.behavior) {
            score += config.stickinessBonus;
        }
        if (score > bestScore) {
            bestScore = score;
            bestBehavior = behavior;
        }
    }

    // No change needed
    if (bestBehavior === intent.behavior) return null;

    const cooldown = config.cooldowns[bestBehavior] ?? config.defaultCooldown;
    return { behavior: bestBehavior, cooldown };
}

// --- Available actions query ---

/** A scored behavior option for UI display. */
export interface ScoredBehavior {
    behavior: Behavior;
    score: number;
}

/**
 * Score all behaviors for a single entity and return them ranked.
 *
 * Used by the UI to show available social actions to the player.
 * Same scorers as the AI arbiter — when new behaviors are added,
 * they automatically appear here.
 *
 * Returns all behaviors with score > -Infinity, sorted by score descending.
 */
export function getAvailableBehaviors(
    world: World,
    entity: Entity,
    rng: Rng,
    tick: number = 0,
    config: IntentConfig = DEFAULT_INTENT,
    behaviorScorers: Record<string, BehaviorScorer> = scorers,
): ScoredBehavior[] {
    const psych = getComponent<Psychology>(world, entity, PSYCHOLOGY);
    const ident = getComponent<Identity>(world, entity, IDENTITY);
    const intent = getComponent<Intent>(world, entity, INTENT);
    if (!psych || !ident || !intent) return [];

    const needs = getComponent<Needs>(world, entity, NEEDS);
    const personality = getComponent<Personality>(world, entity, PERSONALITY);
    const position = getComponent<Position>(world, entity, POSITION);
    const sleep = getComponent<Sleep>(world, entity, SLEEP);
    const memory = getComponent<Memory>(world, entity, MEMORY);
    const disposition = deriveDisposition(psych, ident.alive);
    const hasCompanion = checkHasCompanion(world, entity, position ?? null);

    const ctx: ScorerContext = {
        psych, alive: ident.alive, disposition,
        needs: needs ?? null, personality: personality ?? null,
        intent, rng,
        position: position ?? null, sleep: sleep ?? null,
        memory: memory ?? null, tick, hasCompanion,
    };

    const results: ScoredBehavior[] = [];
    for (const key in behaviorScorers) {
        const behavior = key as Behavior;
        const score = behaviorScorers[key](ctx, config);
        if (score > -Infinity) {
            results.push({ behavior, score });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

// --- System ---

/**
 * Run the intent arbiter for all entities with INTENT components.
 * Decrements cooldowns, evaluates transitions, updates intent.
 *
 * Call this BEFORE movement/search systems so they read fresh intents.
 */
export function intentSystem(
    world: World,
    rng: Rng,
    config: IntentConfig = DEFAULT_INTENT,
    tick: number = 0,
): void {
    const entities = query(world, [INTENT, IDENTITY, PSYCHOLOGY]);

    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const intent = tuple[1] as Intent;
        const ident = tuple[2] as Identity;
        const psych = tuple[3] as Psychology;

        // Player intent is manual — don't auto-resolve
        if (hasComponent(world, entity, PLAYER)) continue;

        // Tick counters
        intent.elapsed++;
        if (intent.cooldown > 0) intent.cooldown--;

        const needs = getComponent<Needs>(world, entity, NEEDS);
        const personality = getComponent<Personality>(world, entity, PERSONALITY);
        const position = getComponent<Position>(world, entity, POSITION);
        const sleep = getComponent<Sleep>(world, entity, SLEEP);
        const memory = getComponent<Memory>(world, entity, MEMORY);
        const hasCompanion = checkHasCompanion(world, entity, position);

        const result = evaluateIntent(
            intent, psych, ident.alive, needs ?? null, personality ?? null, rng, config,
            undefined, position ?? null, sleep ?? null, tick, null, hasCompanion,
            memory ?? null,
        );

        if (result) {
            intent.behavior = result.behavior;
            intent.cooldown = result.cooldown;
            intent.elapsed = 0;
        }
    }
}
