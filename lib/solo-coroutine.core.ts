/**
 * Solo NPC coroutine — runs a single isolated NPC through the full
 * per-tick pipeline without ECS queries.
 *
 * Must produce identical results to the ECS pipeline for isolated NPCs
 * (no cross-entity interactions). This is the foundation for Tier 1.5
 * entity coroutine simulation.
 *
 * Pipeline order (matches Social.onTick):
 *   1. Psychology decay
 *   2. Needs accumulation + auto-relief
 *   3. Intent evaluation
 *   4. Movement
 *
 * @module solo-coroutine.core
 */

import type { Position } from "./social.core.ts";
import type { Psychology } from "./social.core.ts";
import type { Needs, NeedsConfig } from "./needs.core.ts";
import type { Movement, MovementConfig, MovementInput } from "./movement.core.ts";
import type { Intent, IntentConfig, Behavior } from "./intent.core.ts";
import type { Personality } from "./personality.core.ts";
import type { BeliefComponent } from "./belief.core.ts";
import type { Stats } from "./stats.core.ts";
import type { Sleep } from "./sleep.core.ts";
import type { Memory, BookVisionEntry } from "./memory.core.ts";
import { getBookVision } from "./memory.core.ts";
import type { DecayConfig } from "./social.core.ts";
import type { Habituation } from "./psych.core.ts";

import { computeNeeds, DEFAULT_NEEDS } from "./needs.core.ts";
import { computeMovement, DEFAULT_MOVEMENT } from "./movement.core.ts";
import { evaluateIntent, DEFAULT_INTENT } from "./intent.core.ts";
import { decayPsychology, DEFAULT_DECAY } from "./social.core.ts";
import { needsDecayMultiplier } from "./needs.core.ts";
import { enduranceMod } from "./stats.core.ts";
import { decayBias } from "./personality.core.ts";
import { beliefDecayMod, evolveBelief, updateStance } from "./belief.core.ts";
import { isRestArea } from "./library.core.ts";
import { seedFromString } from "./prng.core.ts";
import { TICKS_PER_DAY, WAKING_TICKS } from "./scale.core.ts";

// --- State ---

/** All per-entity state needed for a solo coroutine tick. */
export interface SoloState {
    // Identity
    name: string;
    alive: boolean;

    // Spatial
    pos: Position;

    // Psychology
    psych: Psychology;

    // Needs
    needs: Needs;

    // Movement
    mov: Movement;

    // Intent
    intent: Intent;

    // Read-only traits (generated once)
    personality: Personality | null;
    belief: BeliefComponent | null;
    stats: Stats | null;
    sleep: Sleep | null;
    memory?: Memory | null;
    habituation: Habituation | null;

    // Time
    tick: number;  // tick within day (0–TICKS_PER_DAY-1)
    day: number;

    // Seed for deterministic RNG
    seed: string;
}

// --- Config ---

export interface SoloConfig {
    needs: NeedsConfig;
    movement: MovementConfig;
    intent: IntentConfig;
    decay: DecayConfig;
    ticksPerDay: number;
    lightsOnTicks: number;
}

export const DEFAULT_SOLO_CONFIG: SoloConfig = {
    needs: DEFAULT_NEEDS,
    movement: DEFAULT_MOVEMENT,
    intent: DEFAULT_INTENT,
    decay: DEFAULT_DECAY,
    ticksPerDay: TICKS_PER_DAY,
    lightsOnTicks: WAKING_TICKS,
};

// --- Core tick ---

/**
 * Advance a solo NPC by exactly one tick. Mutates state in place.
 * Matches the per-tick ECS pipeline order exactly.
 */
export function advanceSoloTick(state: SoloState, config: SoloConfig = DEFAULT_SOLO_CONFIG): void {
    if (!state.alive) return;

    const currentTick = (state.day - 1) * config.ticksPerDay + state.tick;
    const lightsOn = state.tick < config.lightsOnTicks;

    // 1. Psychology decay
    applyPsychologyDecay(state, config);

    // 2. Needs
    applyNeeds(state, lightsOn, config);

    // 3. Intent
    applyIntent(state, currentTick, config);

    // 4. Movement
    applyMovement(state, currentTick, config);

    // 5. Advance time
    state.tick++;
    if (state.tick >= config.ticksPerDay) {
        state.tick = 0;
        state.day++;
    }
}

// --- Subsystem implementations ---

function applyPsychologyDecay(state: SoloState, config: SoloConfig): void {
    // Combine personality bias and belief bias multiplicatively
    // (mirrors psychologyDecaySystem)
    let lucidityMul = 1.0;
    let hopeMul = 1.0;

    if (state.personality) {
        const pb = decayBias(state.personality);
        lucidityMul *= pb.lucidityMul;
        hopeMul *= pb.hopeMul;
    }

    if (state.belief) {
        evolveBelief(state.belief);
        const bb = beliefDecayMod(state.belief);
        lucidityMul *= bb.lucidityMul;
        hopeMul *= bb.hopeMul;
        updateStance(state.belief, state.psych.lucidity, state.psych.hope, 0);
    }

    // Needs-based decay multiplier
    const needsMul = needsDecayMultiplier(state.needs);
    lucidityMul *= needsMul;
    hopeMul *= needsMul;

    const bias = { lucidityMul, hopeMul };

    // Solo NPC: no social contact (isolated)
    decayPsychology(state.psych, false, config.decay, bias, 1.0);

    // Pilgrim hope floor
    const bookVision = state.memory ? getBookVision(state.memory) : null;
    const hasPurpose = bookVision && bookVision.state !== "exhausted";
    if (hasPurpose) {
        const pilgrimHopeFloor = 20;
        if (state.psych.hope < pilgrimHopeFloor) {
            state.psych.hope = pilgrimHopeFloor;
        }
    }
}

function applyNeeds(state: SoloState, lightsOn: boolean, config: SoloConfig): void {
    const eMod = state.stats ? enduranceMod(state.stats) : 1.0;

    const result = computeNeeds({
        needs: state.needs,
        atRest: isRestArea(state.pos.position),
        lightsOn,
        enduranceMod: eMod,
        config: config.needs,
        n: 1,
    });

    if (result.died) {
        state.alive = false;
    }
}

function applyIntent(state: SoloState, currentTick: number, config: SoloConfig): void {
    // Tick counters (mirrors intentSystem)
    state.intent.elapsed++;
    if (state.intent.cooldown > 0) state.intent.cooldown--;

    const intentRng = seedFromString(state.seed + ":intent:" + currentTick);

    const result = evaluateIntent(
        state.intent,
        state.psych,
        state.alive,
        state.needs,
        state.personality,
        intentRng,
        config.intent,
        undefined,
        state.pos,
        state.sleep,
        state.tick,
        null,
        false, // solo — no companion
        state.memory ?? null,
    );

    if (result) {
        state.intent.behavior = result.behavior;
        state.intent.cooldown = result.cooldown;
        state.intent.elapsed = 0;
    }
}

function applyMovement(state: SoloState, currentTick: number, config: SoloConfig): void {
    const moveRng = seedFromString(state.seed + ":move:" + currentTick);

    const mem = state.memory ?? null;
    const bookVisionEntry: BookVisionEntry | null = mem
        ? (mem.entries?.find(e => e.type === "bookVision") as BookVisionEntry | undefined) ?? null
        : null;
    computeMovement({
        mov: state.mov,
        pos: state.pos,
        behavior: state.intent.behavior,
        rng: moveRng,
        config: config.movement,
        n: 1,
        homePosition: state.sleep ? state.sleep.home.position : null,
        bookVisionEntry,
        memory: mem,
        leaderPos: null,  // solo — no group
        patience: state.personality ? 1.0 - state.personality.pace : 0.5,
    });
}

// --- Multi-tick advance ---

/**
 * Advance a solo NPC by N ticks. Returns the number of ticks actually
 * advanced (may be less if the NPC dies).
 */
export function advanceSolo(
    state: SoloState,
    ticks: number,
    config: SoloConfig = DEFAULT_SOLO_CONFIG,
): number {
    let advanced = 0;
    for (let i = 0; i < ticks; i++) {
        if (!state.alive) break;
        advanceSoloTick(state, config);
        advanced++;
    }
    return advanced;
}

// --- Threshold computation ---

/**
 * Compute the minimum number of ticks until the next internal state
 * transition. Used for fast-forward: skip this many ticks safely
 * without missing a transition.
 *
 * Conservative: returns a lower bound. Never overshoots.
 */
export function ticksToNextThreshold(
    state: SoloState,
    config: SoloConfig = DEFAULT_SOLO_CONFIG,
): number {
    const thresholds: number[] = [];

    const eMod = state.stats ? enduranceMod(state.stats) : 1.0;

    // Needs thresholds: ticks until eat/drink/sleep trigger
    if (state.needs.hunger < config.needs.eatThreshold) {
        thresholds.push(
            Math.floor((config.needs.eatThreshold - state.needs.hunger) / (config.needs.hungerRate * eMod))
        );
    }
    if (state.needs.thirst < config.needs.drinkThreshold) {
        thresholds.push(
            Math.floor((config.needs.drinkThreshold - state.needs.thirst) / (config.needs.thirstRate * eMod))
        );
    }
    if (state.needs.exhaustion < config.needs.sleepThreshold) {
        thresholds.push(
            Math.floor((config.needs.sleepThreshold - state.needs.exhaustion) / (config.needs.exhaustionRate * eMod))
        );
    }

    // Death thresholds
    if (state.needs.hunger < 100) {
        thresholds.push(
            Math.floor((100 - state.needs.hunger) / (config.needs.hungerRate * eMod))
        );
    }
    if (state.needs.thirst < 100) {
        thresholds.push(
            Math.floor((100 - state.needs.thirst) / (config.needs.thirstRate * eMod))
        );
    }

    // Intent cooldown expiry
    if (state.intent.cooldown > 0) {
        thresholds.push(state.intent.cooldown);
    }

    // Day boundary
    const ticksToEndOfDay = config.ticksPerDay - state.tick;
    thresholds.push(ticksToEndOfDay);

    // Lights transition
    if (state.tick < config.lightsOnTicks) {
        thresholds.push(config.lightsOnTicks - state.tick);
    }

    // Psychology thresholds (conservative: use current decay rate, which is the minimum)
    const lucRate = computeLucidityDecayRate(state, config);
    const hopRate = computeHopeDecayRate(state, config);

    // Ticks to mad threshold (lucidity → 40)
    const madThreshold = 40;
    if (state.psych.lucidity > madThreshold && lucRate > 0) {
        thresholds.push(
            Math.floor((state.psych.lucidity - madThreshold) / lucRate)
        );
    }

    // Ticks to catatonic threshold (hope → 15)
    const catatonicThreshold = 15;
    if (state.psych.hope > catatonicThreshold && hopRate > 0) {
        thresholds.push(
            Math.floor((state.psych.hope - catatonicThreshold) / hopRate)
        );
    }

    // Filter out non-positive values, return minimum
    const valid = thresholds.filter(t => t > 0);
    return valid.length > 0 ? Math.min(...valid) : 1;
}

function computeLucidityDecayRate(state: SoloState, config: SoloConfig): number {
    const deficit = 1 - state.psych.lucidity / 100;
    const acceleration = 1 + config.decay.accel * Math.pow(Math.max(0, deficit), config.decay.curve);
    let rate = config.decay.lucidityBase * acceleration * config.decay.isolationMultiplier;

    if (state.personality) {
        const pb = decayBias(state.personality);
        rate *= pb.lucidityMul;
    }
    if (state.belief) {
        const bb = beliefDecayMod(state.belief);
        rate *= bb.lucidityMul;
    }

    const needsMul = needsDecayMultiplier(state.needs);
    rate *= needsMul;

    return rate;
}

function computeHopeDecayRate(state: SoloState, config: SoloConfig): number {
    const deficit = 1 - state.psych.hope / 100;
    const acceleration = 1 + config.decay.accel * Math.pow(Math.max(0, deficit), config.decay.curve);
    let rate = config.decay.hopeBase * acceleration * config.decay.isolationMultiplier;

    if (state.personality) {
        const pb = decayBias(state.personality);
        rate *= pb.hopeMul;
    }
    if (state.belief) {
        const bb = beliefDecayMod(state.belief);
        rate *= bb.hopeMul;
    }

    const needsMul = needsDecayMultiplier(state.needs);
    rate *= needsMul;

    return rate;
}

// --- Fast-forward advance ---

/**
 * Advance a solo NPC using threshold-based fast-forward.
 * Runs tick-by-tick near thresholds, skips uneventful stretches.
 *
 * Returns the number of ticks actually advanced.
 */
export function advanceSoloFastForward(
    state: SoloState,
    ticks: number,
    config: SoloConfig = DEFAULT_SOLO_CONFIG,
): number {
    let remaining = ticks;
    let advanced = 0;

    while (remaining > 0 && state.alive) {
        const skip = Math.min(remaining, ticksToNextThreshold(state, config));

        // Run tick-by-tick (correct behavior for now; batch optimization
        // within coroutine is a future enhancement)
        for (let i = 0; i < skip && state.alive; i++) {
            advanceSoloTick(state, config);
            advanced++;
        }
        remaining -= skip;
    }

    return advanced;
}
