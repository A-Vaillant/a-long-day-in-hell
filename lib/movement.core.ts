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
    type Position, type Identity,
} from "./social.core.ts";
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

/** Check if the span from a rest area in a direction has any unsearched galleries. */
function spanHasUnsearched(knowledge: Knowledge, side: number, restPos: bigint, dir: number, floor: bigint): boolean {
    const span = Number(GALLERIES_PER_SEGMENT);
    for (let i = 1; i < span; i++) {
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

// --- Pure computation ---

/** Resolved optional component data for a single entity's movement. */
export interface MovementInput {
    mov: Movement;
    pos: Position;
    behavior: string;
    rng: Rng;
    config: MovementConfig;
    n: number;
    /** Home position from SLEEP component, if present. */
    homePosition: bigint | null;
    /** Book vision from KNOWLEDGE component, if present. */
    bookVision: { side: number; position: bigint; floor: bigint } | null;
    /** Whether NPC has their book (KNOWLEDGE.hasBook). */
    hasBook: boolean;
    /** Full knowledge for search-aware exploration, if present. */
    knowledge: Knowledge | null;
    /** Leader's position if in a group with a different leader, if present. */
    leaderPos: Position | null;
    /** Patience value from personality (1 - pace), default 0.5. */
    patience: number;
}

/**
 * Resolve the movement target for directed behaviors.
 * Pure — reads from input, writes to mov.targetPosition.
 */
function resolveTarget(input: MovementInput): void {
    const { mov, pos, behavior, homePosition, bookVision, hasBook } = input;

    if (behavior === "seek_rest") {
        mov.targetPosition = nearestRestArea(pos.position);
    } else if (behavior === "return_home") {
        mov.targetPosition = homePosition !== null ? homePosition : nearestRestArea(pos.position);
    } else if (behavior === "pilgrimage") {
        if (hasBook) {
            mov.targetPosition = nearestRestArea(pos.position);
        } else if (bookVision) {
            if (pos.side !== bookVision.side) {
                mov.targetPosition = nearestRestArea(pos.position);
            } else if (pos.floor !== bookVision.floor) {
                mov.targetPosition = nearestRestArea(pos.position);
            } else {
                mov.targetPosition = bookVision.position;
            }
        } else {
            mov.targetPosition = null;
        }
    } else {
        mov.targetPosition = null;
    }
}

/**
 * Pure movement computation. Mutates `input.mov` and `input.pos` in place.
 * No ECS queries — caller resolves all component data.
 */
export function computeMovement(input: MovementInput): void {
    const { mov, pos, behavior, rng, config, n, bookVision, knowledge, leaderPos, patience } = input;

    if (!MOVE_INTENTS.has(behavior)) return;

    resolveTarget(input);

    const isDirected = (behavior === "seek_rest" || behavior === "return_home" || behavior === "pilgrimage") && mov.targetPosition !== null;

    if (n <= 1) {
        // --- Single tick ---
        if (isDirected) {
            const step = stepToward(pos.position, mov.targetPosition!);
            if (step !== 0n) {
                pos.position += step;
            } else if (behavior === "pilgrimage" && isRestArea(pos.position)) {
                // At rest area target — handle floor/side transitions
                if (bookVision) {
                    if (pos.side !== bookVision.side && pos.floor === 0n) {
                        pos.side = bookVision.side;
                    } else if (pos.side !== bookVision.side && pos.floor > 0n) {
                        pos.floor -= 1n;
                    } else if (pos.floor !== bookVision.floor) {
                        pos.floor += pos.floor < bookVision.floor ? 1n : -1n;
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
            const sameLevel = leaderPos && leaderPos.side === pos.side && leaderPos.floor === pos.floor;
            const followingLeader = sameLevel && leaderPos!.position !== pos.position;
            const chasingLeader = leaderPos && !sameLevel;

            if (chasingLeader && isRestArea(pos.position)) {
                if (pos.side !== leaderPos!.side && pos.floor === 0n) {
                    pos.side = leaderPos!.side;
                } else if (pos.side !== leaderPos!.side && pos.floor > 0n) {
                    pos.floor -= 1n;
                } else if (pos.floor !== leaderPos!.floor) {
                    pos.floor += pos.floor < leaderPos!.floor ? 1n : -1n;
                    pos.floor = bigMax(0n, pos.floor);
                }
            } else if (chasingLeader) {
                pos.position += stepToward(pos.position, nearestRestArea(pos.position));
            } else if (followingLeader) {
                const followChance = 0.8 + patience * 0.18;
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
                if (knowledge) {
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
                if (behavior === "pilgrimage" && isRestArea(pos.position)) {
                    if (bookVision) {
                        let remaining = BigInt(n) - dist;
                        if (pos.side !== bookVision.side && remaining > 0n) {
                            const floorsDown = bigMin(pos.floor, remaining);
                            pos.floor -= floorsDown;
                            remaining -= floorsDown;
                            if (pos.floor === 0n && remaining > 0n) {
                                pos.side = bookVision.side;
                                remaining -= 1n;
                            }
                        }
                        if (pos.side === bookVision.side && pos.floor !== bookVision.floor && remaining > 0n) {
                            const floorDist = bigAbs(pos.floor - bookVision.floor);
                            const floorMoves = bigMin(remaining, floorDist);
                            pos.floor += (pos.floor < bookVision.floor ? 1n : -1n) * floorMoves;
                            remaining -= floorMoves;
                        }
                        if (pos.side === bookVision.side && pos.floor === bookVision.floor && remaining > 0n) {
                            const posDist = bigAbs(pos.position - bookVision.position);
                            const posMoves = bigMin(remaining, posDist);
                            pos.position += stepToward(pos.position, bookVision.position) * posMoves;
                        }
                        pos.floor = bigMax(0n, pos.floor);
                    }
                }
            } else {
                pos.position += stepToward(pos.position, mov.targetPosition!) * BigInt(n);
            }
        } else if (behavior === "wander_mad") {
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
            // Explore batch
            const sameFloor = leaderPos && leaderPos.side === pos.side && leaderPos.floor === pos.floor;

            if (leaderPos && !sameFloor) {
                let remaining = BigInt(n);
                const restDist = bigAbs(pos.position - nearestRestArea(pos.position));
                if (restDist > 0n) {
                    const steps = bigMin(remaining, restDist);
                    pos.position += stepToward(pos.position, nearestRestArea(pos.position)) * steps;
                    remaining -= steps;
                }
                if (remaining > 0n && isRestArea(pos.position)) {
                    if (pos.side !== leaderPos!.side) {
                        const floorsDown = bigMin(pos.floor, remaining);
                        pos.floor -= floorsDown;
                        remaining -= floorsDown;
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
                if (remaining > 0n && pos.side === leaderPos!.side && pos.floor === leaderPos!.floor) {
                    const dist = bigAbs(leaderPos!.position - pos.position);
                    const steps = bigMin(remaining, dist);
                    pos.position += stepToward(pos.position, leaderPos!.position) * steps;
                }
            } else if (sameFloor) {
                const dist = leaderPos!.position - pos.position;
                const step = bigMin(bigAbs(dist), BigInt(n));
                pos.position += bigSign(dist) * step;
            } else {
                pos.position += BigInt(mov.heading * n);
            }
            const restsCrossed = Math.floor(Math.abs(n) / Number(GALLERIES_PER_SEGMENT));
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

// --- System ---

/**
 * Move NPCs based on their intent (from INTENT component).
 *
 * Only acts on movement intents. All other intents → skip.
 * Every moving NPC moves 1 segment per tick (no probability roll).
 * Batch mode (n>1): directed = n steps toward target. Random = n coin flips.
 * Thin wrapper over computeMovement().
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
        if (!ident.alive) continue;

        const intent = getComponent<Intent>(world, entity, INTENT);
        if (!intent || !MOVE_INTENTS.has(intent.behavior)) continue;

        // Resolve optional components
        const sleep = getComponent<Sleep>(world, entity, SLEEP);
        const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
        const group = getComponent<Group>(world, entity, GROUP);
        const leaderPos = group?.leaderId != null && group.leaderId !== entity
            ? getComponent<Position>(world, group.leaderId, POSITION) : null;
        const pers = getComponent<Personality>(world, entity, PERSONALITY);

        computeMovement({
            mov,
            pos,
            behavior: intent.behavior,
            rng,
            config,
            n,
            homePosition: sleep ? sleep.home.position : null,
            bookVision: knowledge?.bookVision ?? null,
            hasBook: knowledge?.hasBook ?? false,
            knowledge: knowledge ?? null,
            leaderPos: leaderPos ?? null,
            patience: pers ? 1.0 - pers.pace : 0.5,
        });
    }
}
