/**
 * NPC per-tick movement — reads intent from the INTENT component.
 *
 * Only acts when intent.behavior is explore, seek_rest, or wander_mad.
 * Other intents (search, idle) → no movement.
 *
 * Movement parameters (speed, floor change chance) vary by disposition.
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
import { INTENT, type Intent } from "./intent.core.ts";
import { SLEEP, type Sleep } from "./sleep.core.ts";
import { isRestArea } from "./library.core.ts";

// --- Component ---

export const MOVEMENT = "movement";

export interface Movement {
    /** Target position when seeking rest. Set by movement system. */
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

/** Nearest rest area position from current position. */
function nearestRestArea(position: number): number {
    return Math.round(position / 10) * 10;
}

/** Direction to step toward a target. Returns -1, 0, or 1. */
function stepToward(current: number, target: number): number {
    if (current < target) return 1;
    if (current > target) return -1;
    return 0;
}

// --- Movement behaviors ---

const MOVE_INTENTS = new Set(["explore", "seek_rest", "return_home", "wander_mad"]);

// --- System ---

/**
 * Move NPCs based on their intent (from INTENT component).
 *
 * Only acts on explore, seek_rest, wander_mad. All other intents → skip.
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
        const entity = tuple[0] as Entity;
        const mov = tuple[1] as Movement;
        const pos = tuple[2] as Position;
        const ident = tuple[3] as Identity;
        const psych = tuple[4] as Psychology;
        if (!ident.alive) continue;

        // Read intent — skip if not a movement behavior
        const intent = getComponent<Intent>(world, entity, INTENT);
        if (!intent || !MOVE_INTENTS.has(intent.behavior)) continue;

        const behavior = intent.behavior;
        const isMad = behavior === "wander_mad";
        const moveProb = isMad ? config.madMoveProbability : config.calmMoveProbability;
        const floorChance = isMad ? config.madFloorChangeChance : config.calmFloorChangeChance;

        // Set target for directed movement behaviors
        if (behavior === "seek_rest") {
            mov.targetPosition = nearestRestArea(pos.position);
        } else if (behavior === "return_home") {
            const sleep = getComponent<Sleep>(world, entity, SLEEP);
            mov.targetPosition = sleep ? sleep.homeRestArea : nearestRestArea(pos.position);
        } else {
            mov.targetPosition = null;
        }

        const isDirected = (behavior === "seek_rest" || behavior === "return_home") && mov.targetPosition !== null;

        if (n <= 1) {
            // Single tick
            if (rng.next() >= moveProb) continue;

            if (isDirected) {
                const step = stepToward(pos.position, mov.targetPosition);
                if (step !== 0) {
                    pos.position += step;
                }
            } else {
                // Random walk (explore or wander_mad)
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

            if (isDirected) {
                const dist = Math.abs(pos.position - mov.targetPosition);
                if (expectedMoves >= dist) {
                    pos.position = mov.targetPosition;
                } else {
                    pos.position += stepToward(pos.position, mov.targetPosition) * expectedMoves;
                }
            } else {
                let netMove = 0;
                for (let i = 0; i < expectedMoves; i++) {
                    netMove += rng.next() < 0.5 ? 1 : -1;
                }
                pos.position += netMove;

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
