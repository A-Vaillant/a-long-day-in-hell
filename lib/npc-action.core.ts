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
import { POSITION, IDENTITY, type Position, type Identity } from "./social.core.ts";
import { MOVEMENT, type Movement } from "./movement.core.ts";
import { SEARCHING, type Searching } from "./search.core.ts";
import { SLEEP, type Sleep } from "./sleep.core.ts";
import { MEMORY, type Memory, getBookVision, type BookVisionEntry } from "./memory.core.ts";
import { isRestArea } from "./library.core.ts";
import type { Direction } from "./library.core.ts";
import { nearestRestArea } from "./sleep.core.ts";

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
