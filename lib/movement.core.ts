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
import { KNOWLEDGE, type Knowledge, isSearched } from "./knowledge.core.ts";
import { GROUP, type Group } from "./social.core.ts";
import { PERSONALITY, type Personality } from "./personality.core.ts";
import { isRestArea, GALLERIES_PER_SEGMENT } from "./library.core.ts";
import { bigAbs, bigMax, bigMin, bigSign } from "./bigint-utils.core.ts";

// --- Component ---

export const MOVEMENT = "movement";

export interface Movement {
    /** Target position when seeking rest. Set by movement system. */
    targetPosition: bigint | null;
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
function nearestRestArea(position: bigint): bigint {
    const n = GALLERIES_PER_SEGMENT;
    const r = ((position % n) + n) % n;
    return r * 2n >= n ? position - r + n : position - r;
}

/** Check if the span from a rest area in a direction has any unsearched segments. */
function spanHasUnsearched(knowledge: Knowledge, side: number, restPos: bigint, dir: number, floor: bigint): boolean {
    for (let i = 1; i <= 10; i++) {
        if (!isSearched(knowledge, side, restPos + BigInt(dir * i), floor)) return true;
    }
    return false;
}

/** Check if the spans in both directions from a rest area are fully searched. */
function localExhausted(knowledge: Knowledge, side: number, restPos: bigint, floor: bigint): boolean {
    return !spanHasUnsearched(knowledge, side, restPos, 1, floor) &&
           !spanHasUnsearched(knowledge, side, restPos, -1, floor);
}

/** Direction to step toward a target. Returns -1n, 0n, or 1n. */
function stepToward(current: bigint, target: bigint): bigint {
    if (current < target) return 1n;
    if (current > target) return -1n;
    return 0n;
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
                if (step !== 0n) {
                    pos.position += step;
                } else if (behavior === "pilgrimage" && isRestArea(pos.position)) {
                    // At rest area target — handle floor/side transitions
                    const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
                    const vision = knowledge?.bookVision;
                    if (vision) {
                        if (pos.side !== vision.side && pos.floor === 0n) {
                            pos.side = vision.side;
                        } else if (pos.side !== vision.side && pos.floor > 0n) {
                            pos.floor -= 1n;
                        } else if (pos.floor !== vision.floor) {
                            pos.floor += pos.floor < vision.floor ? 1n : -1n;
                            pos.floor = bigMax(0n, pos.floor);
                        }
                    }
                }
            } else if (behavior === "wander_mad") {
                // Erratic: random direction each tick
                pos.position += rng.next() < 0.5 ? 1n : -1n;
                if (isRestArea(pos.position) && rng.next() < config.madFloorChance) {
                    pos.floor += rng.next() < 0.5 ? 1n : -1n;
                    pos.floor = bigMax(0n, pos.floor);
                }
            } else {
                // Explore: walk in current heading, biased toward group leader
                const group = getComponent<Group>(world, entity, GROUP);
                const leaderPos = group?.leaderId != null && group.leaderId !== entity
                    ? getComponent<Position>(world, group.leaderId, POSITION) : null;
                const sameLevel = leaderPos && leaderPos.side === pos.side && leaderPos.floor === pos.floor;
                const followingLeader = sameLevel && leaderPos!.position !== pos.position;
                // Leader on different floor/side — navigate to rejoin
                const chasingLeader = leaderPos && !sameLevel;

                if (chasingLeader && isRestArea(pos.position)) {
                    // At rest area: change floor or cross to reach leader
                    if (pos.side !== leaderPos!.side && pos.floor === 0n) {
                        pos.side = leaderPos!.side;
                    } else if (pos.side !== leaderPos!.side && pos.floor > 0n) {
                        pos.floor -= 1n;
                    } else if (pos.floor !== leaderPos!.floor) {
                        pos.floor += pos.floor < leaderPos!.floor ? 1n : -1n;
                        pos.floor = bigMax(0n, pos.floor);
                    }
                } else if (chasingLeader) {
                    // Not at rest area: head toward nearest rest area to change floor/side
                    pos.position += stepToward(pos.position, nearestRestArea(pos.position));
                } else if (followingLeader) {
                    // Same floor+side: strongly bias toward leader
                    const pers = getComponent<Personality>(world, entity, PERSONALITY);
                    const patience = pers ? 1.0 - pers.pace : 0.5; // 0=restless, 1=patient
                    const followChance = 0.8 + patience * 0.18; // 0.8–0.98
                    if (rng.next() < followChance) {
                        pos.position += stepToward(pos.position, leaderPos!.position);
                    } else {
                        pos.position += BigInt(mov.heading);
                    }
                } else {
                    pos.position += BigInt(mov.heading);
                }
                const hasLeader = followingLeader || chasingLeader;
                if (isRestArea(pos.position) && !hasLeader) {
                    const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
                    if (knowledge) {
                        // Knowledge-aware: prefer unsearched territory
                        const fwdHasWork = spanHasUnsearched(knowledge, pos.side, pos.position, mov.heading, pos.floor);
                        const bwdHasWork = spanHasUnsearched(knowledge, pos.side, pos.position, -mov.heading, pos.floor);
                        if (!fwdHasWork && bwdHasWork) {
                            mov.heading = -mov.heading;
                        } else if (fwdHasWork && !bwdHasWork) {
                            // keep going
                        } else {
                            if (rng.next() < config.exploreReverseChance) {
                                mov.heading = -mov.heading;
                            }
                        }
                        // Floor change: if both spans exhausted, move floors more eagerly
                        const exhausted = !fwdHasWork && !bwdHasWork;
                        const floorChangeChance = exhausted ? 0.5 : config.exploreFloorChance;
                        if (rng.next() < floorChangeChance) {
                            const upHasWork = spanHasUnsearched(knowledge, pos.side, pos.position, 1, pos.floor + 1n) ||
                                              spanHasUnsearched(knowledge, pos.side, pos.position, -1, pos.floor + 1n);
                            const downHasWork = pos.floor > 0n && (
                                spanHasUnsearched(knowledge, pos.side, pos.position, 1, pos.floor - 1n) ||
                                spanHasUnsearched(knowledge, pos.side, pos.position, -1, pos.floor - 1n));
                            if (upHasWork && !downHasWork) {
                                pos.floor += 1n;
                            } else if (!upHasWork && downHasWork && pos.floor > 0n) {
                                pos.floor -= 1n;
                            } else {
                                pos.floor += rng.next() < 0.5 ? 1n : -1n;
                                pos.floor = bigMax(0n, pos.floor);
                            }
                        }
                    } else {
                        // No knowledge component — original random behavior
                        if (rng.next() < config.exploreReverseChance) {
                            mov.heading = -mov.heading;
                        }
                        if (rng.next() < config.exploreFloorChance) {
                            pos.floor += rng.next() < 0.5 ? 1n : -1n;
                            pos.floor = bigMax(0n, pos.floor);
                        }
                    }
                }
            }
        } else {
            // --- Batch mode ---
            if (isDirected) {
                const dist = bigAbs(pos.position - mov.targetPosition!);
                if (BigInt(n) >= dist) {
                    pos.position = mov.targetPosition!;
                    // Pilgrimage batch: use remaining moves for floor/side transitions
                    if (behavior === "pilgrimage" && isRestArea(pos.position)) {
                        const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
                        const vision = knowledge?.bookVision;
                        if (vision) {
                            let remaining = BigInt(n) - dist;
                            // Phase 1: wrong side → descend to floor 0, then cross
                            if (pos.side !== vision.side && remaining > 0n) {
                                const floorsDown = bigMin(pos.floor, remaining);
                                pos.floor -= floorsDown;
                                remaining -= floorsDown;
                                if (pos.floor === 0n && remaining > 0n) {
                                    pos.side = vision.side;
                                    remaining -= 1n;
                                }
                            }
                            // Phase 2: right side, wrong floor → move toward target floor
                            if (pos.side === vision.side && pos.floor !== vision.floor && remaining > 0n) {
                                const floorDist = bigAbs(pos.floor - vision.floor);
                                const floorMoves = bigMin(remaining, floorDist);
                                pos.floor += (pos.floor < vision.floor ? 1n : -1n) * floorMoves;
                                remaining -= floorMoves;
                            }
                            // Phase 3: right side+floor → walk toward book position
                            if (pos.side === vision.side && pos.floor === vision.floor && remaining > 0n) {
                                const posDist = bigAbs(pos.position - vision.position);
                                const posMoves = bigMin(remaining, posDist);
                                pos.position += stepToward(pos.position, vision.position) * posMoves;
                            }
                            pos.floor = bigMax(0n, pos.floor);
                        }
                    }
                } else {
                    pos.position += stepToward(pos.position, mov.targetPosition!) * BigInt(n);
                }
            } else if (behavior === "wander_mad") {
                // Erratic batch: n random steps
                let netMove = 0n;
                for (let i = 0; i < n; i++) {
                    netMove += rng.next() < 0.5 ? 1n : -1n;
                }
                pos.position += netMove;
                if (isRestArea(pos.position)) {
                    const floorMoves = Math.round(config.madFloorChance * n);
                    for (let i = 0; i < floorMoves; i++) {
                        pos.floor += rng.next() < 0.5 ? 1n : -1n;
                        pos.floor = bigMax(0n, pos.floor);
                    }
                }
            } else {
                // Explore batch: walk n steps, biased toward group leader if applicable
                const group = getComponent<Group>(world, entity, GROUP);
                const leaderPos = group?.leaderId != null && group.leaderId !== entity
                    ? getComponent<Position>(world, group.leaderId, POSITION) : null;
                const sameFloor = leaderPos && leaderPos.side === pos.side && leaderPos.floor === pos.floor;

                if (leaderPos && !sameFloor) {
                    // Leader on different floor/side — navigate to rejoin in batch
                    let remaining = BigInt(n);
                    // Step 1: reach nearest rest area
                    const restDist = bigAbs(pos.position - nearestRestArea(pos.position));
                    if (restDist > 0n) {
                        const steps = bigMin(remaining, restDist);
                        pos.position += stepToward(pos.position, nearestRestArea(pos.position)) * steps;
                        remaining -= steps;
                    }
                    // Step 2: at rest area — change floors/cross to match leader
                    if (remaining > 0n && isRestArea(pos.position)) {
                        if (pos.side !== leaderPos!.side) {
                            // Descend to floor 0
                            const floorsDown = bigMin(pos.floor, remaining);
                            pos.floor -= floorsDown;
                            remaining -= floorsDown;
                            // Cross bridge
                            if (pos.floor === 0n && remaining > 0n) {
                                pos.side = leaderPos!.side;
                                remaining -= 1n;
                            }
                        }
                        if (pos.side === leaderPos!.side && pos.floor !== leaderPos!.floor && remaining > 0n) {
                            const floorDist = bigAbs(pos.floor - leaderPos!.floor);
                            const floorSteps = bigMin(remaining, floorDist);
                            pos.floor += (pos.floor < leaderPos!.floor ? 1n : -1n) * floorSteps;
                            remaining -= floorSteps;
                        }
                        pos.floor = bigMax(0n, pos.floor);
                    }
                    // Step 3: same floor — walk toward leader
                    if (remaining > 0n && pos.side === leaderPos!.side && pos.floor === leaderPos!.floor) {
                        const dist = bigAbs(leaderPos!.position - pos.position);
                        const steps = bigMin(remaining, dist);
                        pos.position += stepToward(pos.position, leaderPos!.position) * steps;
                    }
                } else if (sameFloor) {
                    // Move toward leader position in batch
                    const dist = leaderPos!.position - pos.position;
                    const step = bigMin(bigAbs(dist), BigInt(n));
                    pos.position += bigSign(dist) * step;
                } else {
                    pos.position += BigInt(mov.heading * n);
                }
                // Check if we crossed any rest areas — approximate floor changes
                const restsCrossed = Math.floor(Math.abs(n) / 10);
                for (let i = 0; i < restsCrossed; i++) {
                    if (rng.next() < config.exploreReverseChance) {
                        mov.heading = -mov.heading;
                    }
                    if (!leaderPos && rng.next() < config.exploreFloorChance) {
                        pos.floor += rng.next() < 0.5 ? 1n : -1n;
                        pos.floor = bigMax(0n, pos.floor);
                    }
                }
            }
        }
    }
}
