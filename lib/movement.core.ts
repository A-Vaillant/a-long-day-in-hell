/**
 * NPC per-tick movement — reads intent from the INTENT component.
 *
 * Movement model: if your intent is a movement intent, you move
 * 1 segment per tick. No probability rolls.
 *
 * - Directed (seek_rest, return_home, pilgrimage): step toward target.
 * - Explore: walk in current heading. At rest areas, chance to change
 *   floor. Heading flips at rest areas occasionally.
 * - Wander_mad: random direction each tick (erratic).
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
import { KNOWLEDGE, type Knowledge } from "./knowledge.core.ts";
import { isRestArea } from "./library.core.ts";

// --- Component ---

export const MOVEMENT = "movement";

export interface Movement {
    /** Target position when seeking rest. Set by movement system. */
    targetPosition: number | null;
    /** Current heading for exploration: 1 (right) or -1 (left). */
    heading: number;
}

// --- Config ---

export interface MovementConfig {
    /** Chance of reversing heading at a rest area (explore). */
    exploreReverseChance: number;
    /** Chance of changing floor at a rest area (explore). */
    exploreFloorChance: number;
    /** Chance of changing floor at a rest area (wander_mad). */
    madFloorChance: number;
}

export const DEFAULT_MOVEMENT: MovementConfig = {
    exploreReverseChance: 0.3,
    exploreFloorChance: 0.05,
    madFloorChance: 0.15,
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

const MOVE_INTENTS = new Set(["explore", "seek_rest", "return_home", "wander_mad", "pilgrimage"]);

// --- System ---

/**
 * Move NPCs based on their intent (from INTENT component).
 *
 * Only acts on movement intents. All other intents → skip.
 * Every moving NPC moves 1 segment per tick (no probability roll).
 * Batch mode (n>1): directed = n steps toward target. Random = n coin flips.
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

        // Set target for directed movement behaviors
        if (behavior === "seek_rest") {
            mov.targetPosition = nearestRestArea(pos.position);
        } else if (behavior === "return_home") {
            const sleep = getComponent<Sleep>(world, entity, SLEEP);
            mov.targetPosition = sleep ? sleep.home.position : nearestRestArea(pos.position);
        } else if (behavior === "pilgrimage") {
            const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
            const vision = knowledge?.bookVision;
            if (knowledge?.hasBook) {
                mov.targetPosition = nearestRestArea(pos.position);
            } else if (vision) {
                if (pos.side !== vision.side) {
                    mov.targetPosition = nearestRestArea(pos.position);
                } else if (pos.floor !== vision.floor) {
                    mov.targetPosition = nearestRestArea(pos.position);
                } else {
                    mov.targetPosition = vision.position;
                }
            } else {
                mov.targetPosition = null;
            }
        } else {
            mov.targetPosition = null;
        }

        const isDirected = (behavior === "seek_rest" || behavior === "return_home" || behavior === "pilgrimage") && mov.targetPosition !== null;

        if (n <= 1) {
            // --- Single tick ---
            if (isDirected) {
                const step = stepToward(pos.position, mov.targetPosition!);
                if (step !== 0) {
                    pos.position += step;
                } else if (behavior === "pilgrimage" && isRestArea(pos.position)) {
                    // At rest area target — handle floor/side transitions
                    const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
                    const vision = knowledge?.bookVision;
                    if (vision) {
                        if (pos.side !== vision.side && pos.floor === 0) {
                            pos.side = vision.side;
                        } else if (pos.side !== vision.side && pos.floor > 0) {
                            pos.floor--;
                        } else if (pos.floor !== vision.floor) {
                            pos.floor += pos.floor < vision.floor ? 1 : -1;
                            pos.floor = Math.max(0, pos.floor);
                        }
                    }
                }
            } else if (behavior === "wander_mad") {
                // Erratic: random direction each tick
                pos.position += rng.next() < 0.5 ? 1 : -1;
                if (isRestArea(pos.position) && rng.next() < config.madFloorChance) {
                    pos.floor += rng.next() < 0.5 ? 1 : -1;
                    pos.floor = Math.max(0, pos.floor);
                }
            } else {
                // Explore: walk in current heading
                pos.position += mov.heading;
                if (isRestArea(pos.position)) {
                    // Chance to reverse
                    if (rng.next() < config.exploreReverseChance) {
                        mov.heading = -mov.heading;
                    }
                    // Chance to change floor
                    if (rng.next() < config.exploreFloorChance) {
                        pos.floor += rng.next() < 0.5 ? 1 : -1;
                        pos.floor = Math.max(0, pos.floor);
                    }
                }
            }
        } else {
            // --- Batch mode ---
            if (isDirected) {
                const dist = Math.abs(pos.position - mov.targetPosition!);
                if (n >= dist) {
                    pos.position = mov.targetPosition!;
                    // Pilgrimage batch: use remaining moves for floor/side transitions
                    if (behavior === "pilgrimage" && isRestArea(pos.position)) {
                        const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
                        const vision = knowledge?.bookVision;
                        if (vision) {
                            let remaining = n - dist;
                            // Phase 1: wrong side → descend to floor 0, then cross
                            if (pos.side !== vision.side && remaining > 0) {
                                const floorsDown = Math.min(pos.floor, remaining);
                                pos.floor -= floorsDown;
                                remaining -= floorsDown;
                                if (pos.floor === 0 && remaining > 0) {
                                    pos.side = vision.side;
                                    remaining--;
                                }
                            }
                            // Phase 2: right side, wrong floor → move toward target floor
                            if (pos.side === vision.side && pos.floor !== vision.floor && remaining > 0) {
                                const floorDist = Math.abs(pos.floor - vision.floor);
                                const floorMoves = Math.min(remaining, floorDist);
                                pos.floor += (pos.floor < vision.floor ? 1 : -1) * floorMoves;
                                remaining -= floorMoves;
                            }
                            // Phase 3: right side+floor → walk toward book position
                            if (pos.side === vision.side && pos.floor === vision.floor && remaining > 0) {
                                const posDist = Math.abs(pos.position - vision.position);
                                const posMoves = Math.min(remaining, posDist);
                                pos.position += stepToward(pos.position, vision.position) * posMoves;
                            }
                            pos.floor = Math.max(0, pos.floor);
                        }
                    }
                } else {
                    pos.position += stepToward(pos.position, mov.targetPosition!) * n;
                }
            } else if (behavior === "wander_mad") {
                // Erratic batch: n random steps
                let netMove = 0;
                for (let i = 0; i < n; i++) {
                    netMove += rng.next() < 0.5 ? 1 : -1;
                }
                pos.position += netMove;
                if (isRestArea(pos.position)) {
                    const floorMoves = Math.round(config.madFloorChance * n);
                    for (let i = 0; i < floorMoves; i++) {
                        pos.floor += rng.next() < 0.5 ? 1 : -1;
                        pos.floor = Math.max(0, pos.floor);
                    }
                }
            } else {
                // Explore batch: walk n steps in heading, reversing at rest areas
                // Simplified: net displacement is n in heading direction,
                // minus reversals. Approximate with heading * n, then apply
                // floor changes at landing position.
                pos.position += mov.heading * n;
                // Check if we crossed any rest areas — approximate floor changes
                const restsCrossed = Math.floor(Math.abs(n) / 10);
                for (let i = 0; i < restsCrossed; i++) {
                    if (rng.next() < config.exploreReverseChance) {
                        mov.heading = -mov.heading;
                    }
                    if (rng.next() < config.exploreFloorChance) {
                        pos.floor += rng.next() < 0.5 ? 1 : -1;
                        pos.floor = Math.max(0, pos.floor);
                    }
                }
            }
        }
    }
}
