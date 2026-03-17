/**
 * NPC action translation — converts ECS intent behaviors into Actions.
 *
 * Each NPC has an intent (from the intent system) that describes what
 * behavior they're pursuing. This module translates that high-level
 * behavior into a concrete Action that can be resolved via resolveAction.
 *
 * @module npc-action.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent } from "./ecs.core.ts";
import type { Action } from "./action.core.ts";
import { INTENT, type Intent } from "./intent.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY, type Position, type Identity, type Psychology } from "./social.core.ts";
import { MOVEMENT, type Movement } from "./movement.core.ts";
import { SEARCHING, type Searching } from "./search.core.ts";
import { SLEEP, type Sleep } from "./sleep.core.ts";
import { NEEDS, type Needs } from "./needs.core.ts";
import { MEMORY, type Memory, getBookVision, type BookVisionEntry } from "./memory.core.ts";
import { isRestArea } from "./library.core.ts";
import type { Direction } from "./library.core.ts";
import { nearestRestArea } from "./sleep.core.ts";
import { resolveAction, type GameState, type ActionContext } from "./action-dispatch.core.ts";

/**
 * Translate an NPC's current intent behavior into a concrete Action.
 *
 * Returns null if the NPC shouldn't act this tick (dead, sleeping,
 * or behavior doesn't map to an action).
 */
export function behaviorToAction(
    world: World,
    entity: Entity,
): Action | null {
    const intent = getComponent<Intent>(world, entity, INTENT);
    const ident = getComponent<Identity>(world, entity, IDENTITY);
    const pos = getComponent<Position>(world, entity, POSITION);
    if (!intent || !ident || !pos || !ident.alive) return null;

    const mov = getComponent<Movement>(world, entity, MOVEMENT);

    switch (intent.behavior) {
        case "idle":
            return { type: "wait" };

        case "explore": {
            // Walk in current heading direction
            if (!mov) return { type: "wait" };
            const dir: Direction = mov.heading > 0 ? "right" : "left";
            return { type: "move", dir };
        }

        case "seek_rest": {
            // Walk toward nearest rest area
            if (!pos) return { type: "wait" };
            const target = nearestRestArea(pos.position);
            if (pos.position === target) return { type: "wait" };
            return { type: "move", dir: pos.position < target ? "right" : "left" };
        }

        case "return_home": {
            const sleep = getComponent<Sleep>(world, entity, SLEEP);
            if (!sleep || sleep.nomadic) return { type: "wait" };
            const home = sleep.home;
            if (pos.side !== home.side || pos.floor !== home.floor) {
                // Need to go to a rest area first for stairs/crossing
                const restTarget = nearestRestArea(pos.position);
                if (pos.position !== restTarget) {
                    return { type: "move", dir: pos.position < restTarget ? "right" : "left" };
                }
                // At rest area — change floor or cross
                if (pos.side !== home.side && pos.floor === 0n) {
                    return { type: "move", dir: "cross" };
                }
                if (pos.side !== home.side) {
                    return { type: "move", dir: "down" };
                }
                return { type: "move", dir: pos.floor < home.floor ? "up" : "down" };
            }
            // Same side and floor — walk toward home position
            if (pos.position === home.position) return { type: "wait" };
            return { type: "move", dir: pos.position < home.position ? "right" : "left" };
        }

        case "pilgrimage": {
            const mem = getComponent<Memory>(world, entity, MEMORY);
            const vision = mem ? getBookVision(mem) : null;
            if (!vision || !vision.coords) return { type: "wait" };

            // Has book (state "found") — head to rest area for submission
            if (vision.state === "found") {
                const restTarget = nearestRestArea(pos.position);
                if (pos.position === restTarget && isRestArea(pos.position)) {
                    return { type: "submit" };
                }
                if (pos.position !== restTarget) {
                    return { type: "move", dir: pos.position < restTarget ? "right" : "left" };
                }
                return { type: "wait" };
            }

            const v = vision.coords;
            // Wrong side — navigate to floor 0, cross, then go up
            if (pos.side !== v.side) {
                const restTarget = nearestRestArea(pos.position);
                if (pos.position !== restTarget) {
                    return { type: "move", dir: pos.position < restTarget ? "right" : "left" };
                }
                if (pos.floor === 0n) return { type: "move", dir: "cross" };
                return { type: "move", dir: "down" };
            }
            // Wrong floor — go to rest area, take stairs
            if (pos.floor !== v.floor) {
                const restTarget = nearestRestArea(pos.position);
                if (pos.position !== restTarget) {
                    return { type: "move", dir: pos.position < restTarget ? "right" : "left" };
                }
                return { type: "move", dir: pos.floor < v.floor ? "up" : "down" };
            }
            // Same side and floor — walk toward vision position
            if (pos.position === v.position) return { type: "wait" };
            return { type: "move", dir: pos.position < v.position ? "right" : "left" };
        }

        case "search": {
            // Search the current segment — read a book
            const search = getComponent<Searching>(world, entity, SEARCHING);
            if (search && search.active) {
                return { type: "read_book", bookIndex: search.bookIndex };
            }
            // Not actively searching — wait (search system will activate next tick)
            return { type: "wait" };
        }

        case "wander_mad": {
            // Erratic — random direction (caller should provide RNG, but
            // for now alternate based on tick parity)
            return { type: "move", dir: pos.position % 2n === 0n ? "right" : "left" };
        }

        case "socialize":
            // Stay put — socializing happens through bond accumulation in the relationship system
            return { type: "wait" };

        default:
            return null;
    }
}

// --- NPC GameState adapter ---

/**
 * Build a minimal GameState view from an NPC's ECS components.
 * Only the fields that resolveAction reads for NPC-relevant actions
 * (move, wait, eat, drink, read_book) are populated. Fields irrelevant
 * to NPCs get safe defaults.
 *
 * The returned object is mutable — resolveAction writes back into it.
 * Call writeBackNpcState after to sync changes to ECS components.
 */
export function buildNpcState(
    world: World,
    entity: Entity,
    globalState: { lightsOn: boolean; tick: number; day: number; seed: string },
): GameState | null {
    const pos = getComponent<Position>(world, entity, POSITION);
    const ident = getComponent<Identity>(world, entity, IDENTITY);
    if (!pos || !ident) return null;

    const psych = getComponent<Psychology>(world, entity, PSYCHOLOGY);
    const needs = getComponent<Needs>(world, entity, NEEDS);

    return {
        side: pos.side,
        position: pos.position,
        floor: pos.floor,
        tick: globalState.tick,
        day: globalState.day,
        lightsOn: globalState.lightsOn,
        hunger: needs?.hunger ?? 0,
        thirst: needs?.thirst ?? 0,
        exhaustion: needs?.exhaustion ?? 0,
        morale: psych?.hope ?? 50,
        mortality: 100,
        despairing: false,
        dead: !ident.alive,
        heldBook: null,
        openBook: null,
        openPage: 0,
        dwellHistory: {},
        targetBook: { side: 0, position: 0n, floor: 0n, bookIndex: 0 },
        submissionsAttempted: 0,
        nonsensePagesRead: 0,
        totalMoves: 0,
        deaths: 0,
        deathCause: null,
        _mercyKiosks: {},
        _mercyKioskDone: true, // NPCs handle mercy kiosks via their own detection
        _mercyArrival: null,
        _despairDays: 0,
        falling: null,
        eventDeck: [],
        lastEvent: null,
        won: false,
        _readBlocked: false,
        _submissionWon: false,
        _lastMove: null,
    };
}

/**
 * Write resolveAction results back from the NPC GameState view
 * to the entity's ECS components.
 */
export function writeBackNpcState(
    world: World,
    entity: Entity,
    npcState: GameState,
): void {
    const pos = getComponent<Position>(world, entity, POSITION);
    if (pos) {
        pos.side = npcState.side;
        pos.position = npcState.position;
        pos.floor = npcState.floor;
    }
    const needs = getComponent<Needs>(world, entity, NEEDS);
    if (needs) {
        needs.exhaustion = npcState.exhaustion;
    }
}

/**
 * Run one NPC's action through the shared dispatch.
 * Translates intent → action → resolveAction → write back.
 * Returns the action taken (or null if NPC didn't act).
 */
export function tickNpcAction(
    world: World,
    entity: Entity,
    globalState: { lightsOn: boolean; tick: number; day: number; seed: string },
): Action | null {
    const action = behaviorToAction(world, entity);
    if (!action) return null;

    // Skip wait — no state mutation needed
    if (action.type === "wait") return action;

    const npcState = buildNpcState(world, entity, globalState);
    if (!npcState) return null;

    const ctx: ActionContext = { seed: globalState.seed, eventCards: [] };
    const result = resolveAction(npcState, action, ctx);

    if (result.resolved) {
        writeBackNpcState(world, entity, npcState);
    }

    return action;
}
