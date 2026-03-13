/**
 * Action resolver — executes Actions against game state.
 *
 * This is the single point where player/NPC actions become state mutations.
 * Keybindings and screen handlers call Actions.resolve(action) instead of
 * directly mutating state. The underlying Tick/Surv/Chasm/Lib calls are
 * unchanged — this is purely a routing layer.
 *
 * Returns { resolved: true/false, screen?: string } to tell the caller
 * what screen to navigate to (if any).
 */

import { state } from "./state.js";
import { Lib } from "./library.js";
import { Surv } from "./survival.js";
import { Tick } from "./tick.js";
import { Chasm } from "./chasm.js";
import { Events } from "./events.js";
import { Despair } from "./despairing.js";
import { PRNG } from "./prng.js";
import { Book } from "./book.js";
import { Social } from "./social.js";

// Auto-drink threshold — aligned with NPC needs system (needs.core.ts).
// Hunger stays manual: starvation is a real consequence of mindless walking.
const AUTO_DRINK_THRESHOLD = 50;

/**
 * Resolve a single action. Returns result object.
 *
 * @param {import("../../lib/action.core.ts").Action} action
 * @returns {{ resolved: boolean, screen?: string, data?: any }}
 */
function resolve(action) {
    switch (action.type) {
        case "move":
            return resolveMove(action.dir);
        case "wait":
            return resolveWait();
        case "sleep":
            return resolveSleep();
        case "eat":
            return resolveEat();
        case "drink":
            return resolveDrink();
        case "alcohol":
            return resolveAlcohol();
        case "read_book":
            return resolveReadBook(action.bookIndex);
        case "take_book":
            return resolveTakeBook(action.bookIndex);
        case "drop_book":
            return resolveDropBook();
        case "submit":
            return resolveSubmit();
        case "chasm_jump":
            return resolveChasmJump();
        case "grab_railing":
            return resolveGrabRailing();
        case "throw_book":
            return resolveThrowBook();
        case "fall_wait":
            return resolveFallWait();
        case "talk":
            return resolveTalk(action.npcId, action.approach);
        case "spend_time":
            return resolveSpendTime(action.npcId);
        case "recruit":
            return resolveRecruit(action.npcId);
        case "dismiss":
            return resolveDismiss(action.npcId);
        default:
            return { resolved: false };
    }
}

function resolveMove(dir) {
    const loc = { side: state.side, position: state.position, floor: state.floor };
    const available = Lib.availableMoves(loc);
    if (available.indexOf(dir) === -1) return { resolved: false };

    const dest = Lib.applyMove(loc, dir);
    state._lastMove = dir;
    state.side = dest.side;
    state.position = dest.position;
    state.floor = dest.floor;
    Tick.onMove();
    if (dir === "up") Surv.exhaust(1.5);
    else if (dir === "down") Surv.exhaust(0.75);

    // Forced sleep — player passed out, show the screen
    if (state._passedOut) {
        state._passedOut = false;
        return { resolved: true, screen: "Passing Out" };
    }

    // Auto-drink at rest area kiosks (no extra tick cost, mirrors NPC behavior).
    // Hunger stays manual — starvation is the cost of mindless walking.
    if (Lib.isRestArea(state.position) && state.lightsOn) {
        if (state.thirst >= AUTO_DRINK_THRESHOLD) Surv.onDrink();
    }

    return { resolved: true, screen: "Corridor" };
}

function resolveWait() {
    Tick.onMove();
    if (state._passedOut) {
        state._passedOut = false;
        return { resolved: true, screen: "Passing Out" };
    }
    return { resolved: true, screen: "Wait" };
}

function resolveSleep() {
    if (!Surv.canSleep()) return { resolved: false };
    Tick.onSleep();
    return { resolved: true, screen: "Sleep" };
}

function resolveEat() {
    if (!Lib.isRestArea(state.position) || !state.lightsOn) return { resolved: false };
    Tick.advance(1);
    Surv.onEat();
    return { resolved: true, screen: "Kiosk Get Food" };
}

function resolveDrink() {
    if (!Lib.isRestArea(state.position) || !state.lightsOn) return { resolved: false };
    Tick.advance(1);
    Surv.onDrink();
    return { resolved: true, screen: "Kiosk Get Drink" };
}

function resolveAlcohol() {
    if (!Lib.isRestArea(state.position) || !state.lightsOn) return { resolved: false };
    Tick.advance(1);
    Surv.onAlcohol();
    return { resolved: true, screen: "Kiosk Get Alcohol" };
}

function resolveReadBook(bookIndex) {
    if (!state.lightsOn) return { resolved: false };
    if (Despair.isReadingBlocked()) {
        state._readBlocked = true;
        return { resolved: true, screen: "Corridor" };
    }
    state.openBook = {
        side: state.side, position: state.position,
        floor: state.floor, bookIndex: bookIndex,
    };
    state.openPage = 1;
    return { resolved: true, screen: "Shelf Open Book" };
}

function resolveTakeBook(bookIndex) {
    if (!state.lightsOn) return { resolved: false };
    state.heldBook = {
        side: state.side, position: state.position,
        floor: state.floor, bookIndex: bookIndex,
    };
    return { resolved: true };
}

function resolveDropBook() {
    state.heldBook = null;
    return { resolved: true };
}

function resolveSubmit() {
    if (!Lib.isRestArea(state.position) || !state.heldBook) return { resolved: false };
    state.submissionsAttempted = (state.submissionsAttempted || 0) + 1;
    state._submissionWon = false;
    const hb = state.heldBook;
    const tb = state.targetBook;
    if (hb && hb.side === tb.side && hb.position === tb.position &&
        hb.floor === tb.floor && hb.bookIndex === tb.bookIndex) {
        state._submissionWon = true;
    }
    return { resolved: true, screen: "Submission Attempt" };
}

function resolveChasmJump() {
    if (state.floor <= 0n) return { resolved: false };
    Chasm.jump(state.side);
    return { resolved: true, screen: "Falling" };
}

function resolveGrabRailing() {
    if (!state.falling) return { resolved: false };
    const result = Chasm.grab(Social.getQuicknessGrabBonus());
    if (result.success) {
        return { resolved: true, screen: "Corridor", data: result };
    }
    state._grabFailed = { mortalityHit: result.mortalityHit };
    return { resolved: true, data: result };
}

function resolveThrowBook() {
    Chasm.throwBook();
    return { resolved: true };
}

function resolveFallWait() {
    // Preserve trauma damage
    const mortalityBefore = state.mortality;
    Tick.onMove();
    state.mortality = Math.min(state.mortality, mortalityBefore);

    if (state.dead) return { resolved: true, screen: "Death" };
    if (!state.falling) return { resolved: true, screen: "Corridor" };
    return { resolved: true, screen: "Falling" };
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

function resolveTalk(npcId, approach) {
    if (state.dead) return { resolved: false };
    const result = Social.talk(npcId, approach);
    if (!result.success) return { resolved: false, data: result };
    Tick.advance(2);
    pinNpc(npcId);
    return { resolved: true, data: result };
}

function resolveSpendTime(npcId) {
    if (state.dead) return { resolved: false };
    const result = Social.spendTimeWith(npcId);
    if (!result.success) return { resolved: false, data: result };
    Tick.advance(result.ticksSpent);
    pinNpc(npcId);
    return { resolved: true, data: result };
}

function resolveRecruit(npcId) {
    if (state.dead) return { resolved: false };
    const result = Social.recruit(npcId);
    if (!result.success) return { resolved: false, data: result };
    Tick.advance(1);
    return { resolved: true, data: result };
}

function resolveDismiss(npcId) {
    if (state.dead) return { resolved: false };
    const result = Social.dismissFromGroup(npcId);
    if (!result.success) return { resolved: false, data: result };
    Tick.advance(1);
    return { resolved: true, data: result };
}

export const Actions = { resolve };
