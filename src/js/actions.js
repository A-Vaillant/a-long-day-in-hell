/**
 * Action resolver — executes Actions against game state.
 *
 * Thin browser adapter over the shared applyAction() core. Constructs
 * an ActionContext from browser singletons, dispatches boundary events,
 * and runs social physics for time consumed.
 */

import { state } from "./state.js";
import { Social } from "./social.js";
import { applyAction } from "../../lib/action-dispatch.core.ts";
import { isResetHour, TICKS_PER_HOUR } from "../../lib/tick.core.ts";
import { Engine } from "./engine.js";
import { PRNG } from "./prng.js";

function buildCtx() {
    return {
        seed: PRNG.getSeed(),
        eventCards: [],  // Events currently disabled in browser
        world: Social.getWorld ? Social.getWorld() : undefined,
        resolveEntity: Social.getNpcEntity ? Social.getNpcEntity.bind(Social) : undefined,
        playerEntity: Social.getPlayerEntity ? Social.getPlayerEntity() : undefined,
        quicknessBonus: Social.getQuicknessGrabBonus ? Social.getQuicknessGrabBonus() : 0,
    };
}

/** Pin an NPC to the player's position (they don't wander off mid-conversation). */
function pinNpc(npcId) {
    const npc = state.npcs && state.npcs.find(function (n) { return n.id === npcId; });
    if (npc) {
        npc.side = state.side;
        npc.position = state.position;
        npc.floor = state.floor;
        Social.syncNpcPositions();
    }
}

/**
 * Resolve a single action. Returns a DispatchResult.
 *
 * @param {import("../../lib/action.core.ts").Action} action
 * @returns {import("../../lib/action-dispatch.core.ts").DispatchResult}
 */
function resolve(action) {
    // Sleep is a loop: advance one hour at a time until dawn or day boundary
    if (action.type === "sleep") {
        const inBedroom = state._lastScreen === "Bedroom";
        const startDay = state.day;
        const allEvents = [];
        let totalTicks = 0;

        while (!isResetHour(state.tick) && !state.dead && state.day === startDay) {
            const ctx = buildCtx();
            const r = applyAction(state, { type: "sleep", inBedroom }, ctx);
            if (!r.resolved) break;

            for (const ev of r.tickEvents) {
                Engine._boundary.fire(ev);
                allEvents.push(ev);
            }
            Social.onTick(r.ticksConsumed);
            totalTicks += r.ticksConsumed;

            // Pass-out guard: resetHour boundary may have set _passedOut
            if (state._passedOut) {
                state._passedOut = false;
                return { resolved: true, screen: "Passing Out", tickEvents: allEvents, ticksConsumed: totalTicks };
            }
        }

        return { resolved: true, screen: "Sleep", tickEvents: allEvents, ticksConsumed: totalTicks };
    }

    const ctx = buildCtx();
    const result = applyAction(state, action, ctx);

    if (!result.resolved) return result;

    // Dispatch boundary events
    for (const ev of result.tickEvents) {
        Engine._boundary.fire(ev);
    }

    // Run social physics for ticks consumed
    if (result.ticksConsumed > 0) {
        Social.onTick(result.ticksConsumed);
    }

    // Pin NPC for social actions
    if (action.type === "talk" || action.type === "spend_time" ||
        action.type === "recruit" || action.type === "dismiss") {
        pinNpc(action.npcId);
    }

    // Pass-out guard: resetHour boundary may have set _passedOut
    if (state._passedOut) {
        state._passedOut = false;
        result.resolved = true;
        result.screen = "Passing Out";
    }

    return result;
}

export const Actions = { resolve };
