/**
 * NPC survival needs — hunger, thirst, exhaustion.
 *
 * NEEDS ECS component + system. NPCs accumulate needs at ~1/3 player speed.
 * At rest areas with lights on, they auto-eat/drink/sleep.
 * Starvation or dehydration kills (temporary — resurrects at dawn).
 *
 * @module needs.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, query } from "./ecs.core.ts";
import { POSITION, IDENTITY, type Position, type Identity } from "./social.core.ts";
import { isRestArea } from "./library.core.ts";
import { STATS, type Stats, enduranceMod } from "./stats.core.ts";

// --- Component ---

export const NEEDS = "needs";

export interface Needs {
    hunger: number;     // 0–100
    thirst: number;     // 0–100
    exhaustion: number; // 0–100
}

// --- Config ---

export interface NeedsConfig {
    hungerRate: number;      // per tick
    thirstRate: number;      // per tick
    exhaustionRate: number;  // per tick
    eatThreshold: number;    // auto-eat above this
    drinkThreshold: number;  // auto-drink above this
    sleepThreshold: number;  // auto-sleep above this
    eatRelief: number;       // hunger reduction per eat
    drinkRelief: number;     // thirst reduction per drink
}

import { perDay } from "./scale.core.ts";

export const DEFAULT_NEEDS: NeedsConfig = {
    hungerRate: perDay(100 / 25),      // ~25 days to 100
    thirstRate: perDay(100 / 11),      // ~11 days to 100
    exhaustionRate: perDay(100 / 5),   // ~5 days to 100
    eatThreshold: 50,
    drinkThreshold: 50,
    sleepThreshold: 70,
    eatRelief: 40,
    drinkRelief: 40,
};

// --- Pure computation ---

export interface ComputeNeedsInput {
    needs: Needs;
    atRest: boolean;
    lightsOn: boolean;
    enduranceMod: number;
    config: NeedsConfig;
    n: number;
}

export interface ComputeNeedsResult {
    died: boolean;
}

/**
 * Pure needs computation. Mutates `input.needs` in place, returns whether
 * the entity died. No ECS queries — caller resolves all component data.
 */
export function computeNeeds(input: ComputeNeedsInput): ComputeNeedsResult {
    const { needs, atRest, lightsOn, enduranceMod: eMod, config, n } = input;

    if (n <= 1) {
        // Single tick
        needs.hunger += config.hungerRate * eMod;
        needs.thirst += config.thirstRate * eMod;
        needs.exhaustion += config.exhaustionRate * eMod;

        if (atRest && lightsOn) {
            if (needs.hunger >= config.eatThreshold) {
                needs.hunger = Math.max(0, needs.hunger - config.eatRelief);
            }
            if (needs.thirst >= config.drinkThreshold) {
                needs.thirst = Math.max(0, needs.thirst - config.drinkRelief);
            }
            if (needs.exhaustion >= config.sleepThreshold) {
                needs.exhaustion = 0;
            }
        }
    } else {
        // Batch: accumulate needs analytically, then apply relief.
        // Rest areas are every 10 segments — NPCs always pass through them.
        // Over any multi-day batch, everyone eats/drinks/sleeps regularly.
        needs.hunger += config.hungerRate * eMod * n;
        needs.thirst += config.thirstRate * eMod * n;
        needs.exhaustion += config.exhaustionRate * eMod * n;

        // All NPCs get relief in batch — rest areas are ubiquitous
        while (needs.hunger >= config.eatThreshold) {
            needs.hunger -= config.eatRelief;
        }
        needs.hunger = Math.max(0, needs.hunger);

        while (needs.thirst >= config.drinkThreshold) {
            needs.thirst -= config.drinkRelief;
        }
        needs.thirst = Math.max(0, needs.thirst);

        if (needs.exhaustion >= config.sleepThreshold) {
            needs.exhaustion = 0;
        }
    }

    // Death from starvation/dehydration
    const died = needs.hunger >= 100 || needs.thirst >= 100;
    return { died };
}

// --- Systems ---

/**
 * Tick up needs for alive entities, auto-eat/drink/sleep at rest areas.
 * When hunger>=100 or thirst>=100, kill the NPC.
 *
 * Batch mode (n>1): accumulates needs, simulates eat/sleep cycles analytically.
 * Thin wrapper over computeNeeds().
 */
export function needsSystem(
    world: World,
    lightsOn: boolean,
    config: NeedsConfig = DEFAULT_NEEDS,
    n: number = 1,
): void {
    const entities = query(world, [NEEDS, POSITION, IDENTITY]);
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const needs = tuple[1] as Needs;
        const pos = tuple[2] as Position;
        const ident = tuple[3] as Identity;
        if (!ident.alive) continue;

        const stats = getComponent<Stats>(world, entity, STATS);
        const eMod = stats ? enduranceMod(stats) : 1.0;

        const result = computeNeeds({
            needs,
            atRest: isRestArea(pos.position),
            lightsOn,
            enduranceMod: eMod,
            config,
            n,
        });

        if (result.died) {
            ident.alive = false;
        }
    }
}

/**
 * Returns a decay rate multiplier based on how many needs are critical (>=80).
 * 1 critical need: 1.5x decay. 2+ critical: 2.0x.
 */
export function needsDecayMultiplier(needs: Needs): number {
    let critical = 0;
    if (needs.hunger >= 80) critical++;
    if (needs.thirst >= 80) critical++;
    if (needs.exhaustion >= 80) critical++;
    if (critical >= 2) return 2.0;
    if (critical >= 1) return 1.5;
    return 1.0;
}

/**
 * Dawn reset: revive dead NPCs, reset their needs.
 */
export function resetNeedsAtDawn(world: World): void {
    const entities = query(world, [NEEDS, IDENTITY]);
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const needs = tuple[1] as Needs;
        const ident = tuple[2] as Identity;
        if (!ident.alive) {
            // FREE entities stay dead — they left the library
            if (ident.free) continue;
            ident.alive = true;
            needs.hunger = 0;
            needs.thirst = 0;
            needs.exhaustion = 0;
        }
    }
}
