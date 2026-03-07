/**
 * NPC per-tick movement — disposition-driven, needs-aware pathfinding.
 *
 * MOVEMENT ECS component + system. NPCs move based on disposition:
 * - Catatonic: no movement
 * - Mad: high move probability, random direction, ignores needs
 * - Calm/anxious: lower move probability, seeks rest areas when needs are critical
 *
 * @module movement.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, query } from "./ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY,
    deriveDisposition,
    type Position, type Identity, type Psychology,
} from "./social.core.ts";
import { NEEDS, type Needs } from "./needs.core.ts";
import { isRestArea } from "./library.core.ts";

// --- Component ---

export const MOVEMENT = "movement";

export interface Movement {
    intent: "idle" | "explore" | "seek_rest";
    targetPosition: number | null;
    moveAccum: number; // fractional move accumulator for batch mode
}

// --- Config ---

export interface MovementConfig {
    madMoveProbability: number;     // per-tick chance of moving (mad)
    calmMoveProbability: number;    // per-tick chance of moving (calm/anxious)
    madFloorChangeChance: number;   // chance of floor change when moving (mad)
    calmFloorChangeChance: number;  // chance of floor change when moving (calm)
}

export const DEFAULT_MOVEMENT: MovementConfig = {
    madMoveProbability: 0.3,
    calmMoveProbability: 0.15,
    madFloorChangeChance: 0.15,
    calmFloorChangeChance: 0.05,
};

// --- Helpers ---

interface Rng {
    next(): number;
}

/**
 * Nearest rest area position from current position.
 * Rest areas are at position % 10 === 0.
 */
function nearestRestArea(position: number): number {
    return Math.round(position / 10) * 10;
}

/**
 * Direction to step toward a target position. Returns -1, 0, or 1.
 */
function stepToward(current: number, target: number): number {
    if (current < target) return 1;
    if (current > target) return -1;
    return 0;
}

/**
 * Check if any need is critical (>= threshold).
 */
function needsCritical(needs: Needs): boolean {
    return needs.hunger >= 80 || needs.thirst >= 80;
}

/**
 * Check if exhaustion is high.
 */
function needsRest(needs: Needs): boolean {
    return needs.exhaustion >= 70;
}

// --- System ---

/**
 * Move NPCs based on disposition and needs.
 *
 * Batch mode (n>1): expected moves = probability * n, applied as steps.
 */
export function movementSystem(
    world: World,
    rng: Rng,
    config: MovementConfig = DEFAULT_MOVEMENT,
    n: number = 1,
): void {
    const entities = query(world, [MOVEMENT, POSITION, IDENTITY, PSYCHOLOGY]);
    for (const tuple of entities) {
        const mov = tuple[1] as Movement;
        const pos = tuple[2] as Position;
        const ident = tuple[3] as Identity;
        const psych = tuple[4] as Psychology;
        if (!ident.alive) continue;

        const disp = deriveDisposition(psych, true);
        if (disp === "catatonic") {
            mov.intent = "idle";
            continue;
        }

        const needs = getComponent<Needs>(world, tuple[0] as Entity, NEEDS);
        const isMad = disp === "mad";
        const moveProb = isMad ? config.madMoveProbability : config.calmMoveProbability;
        const floorChance = isMad ? config.madFloorChangeChance : config.calmFloorChangeChance;

        // Determine intent
        if (!isMad && needs && (needsCritical(needs) || needsRest(needs))) {
            mov.intent = "seek_rest";
            mov.targetPosition = nearestRestArea(pos.position);
        } else {
            mov.intent = "explore";
            mov.targetPosition = null;
        }

        if (n <= 1) {
            // Single tick
            if (rng.next() >= moveProb) continue;

            if (mov.intent === "seek_rest" && mov.targetPosition !== null) {
                const step = stepToward(pos.position, mov.targetPosition);
                if (step !== 0) {
                    pos.position += step;
                } else {
                    // Already at rest area, stay put
                }
            } else {
                // Random walk
                pos.position += rng.next() < 0.5 ? 1 : -1;

                // Floor change (only at rest areas)
                if (isRestArea(pos.position) && rng.next() < floorChance) {
                    pos.floor += rng.next() < 0.5 ? 1 : -1;
                    pos.floor = Math.max(0, pos.floor);
                }
            }
        } else {
            // Batch mode: expected moves
            const expectedMoves = Math.round(moveProb * n);

            if (mov.intent === "seek_rest" && mov.targetPosition !== null) {
                const dist = Math.abs(pos.position - mov.targetPosition);
                if (expectedMoves >= dist) {
                    // Teleport to rest area, remaining moves are idle
                    pos.position = mov.targetPosition;
                } else {
                    pos.position += stepToward(pos.position, mov.targetPosition) * expectedMoves;
                }
            } else {
                // Random walk: net displacement ~ sqrt(n) but we use simple random steps
                let netMove = 0;
                for (let i = 0; i < expectedMoves; i++) {
                    netMove += rng.next() < 0.5 ? 1 : -1;
                }
                pos.position += netMove;

                // Floor change
                if (isRestArea(pos.position)) {
                    const floorMoves = Math.round(floorChance * expectedMoves);
                    for (let i = 0; i < floorMoves; i++) {
                        pos.floor += rng.next() < 0.5 ? 1 : -1;
                        pos.floor = Math.max(0, pos.floor);
                    }
                }
            }
        }
    }
}
