/**
 * Universal action types — shared between player input and NPC AI.
 *
 * An Action is what an entity *does* in a tick. Both player keybindings
 * and NPC intent resolution produce Actions. The game loop resolves them
 * through the same path.
 *
 * Actions are data — they don't mutate state. Resolution is handled by
 * the game layer (browser: screens.js/tick.js, headless: simulator.core.ts).
 *
 * Categories:
 *   - tick actions: consume a game tick (move, wait, eat, drink, sleep)
 *   - instant actions: no tick cost (take book, drop book, open book)
 *   - multi-tick actions: advance multiple ticks (sleep)
 *
 * @module action.core
 */

import type { Direction } from "./library.core.ts";

// --- Action types ---

export interface MoveAction { type: "move"; dir: Direction; }
export interface WaitAction { type: "wait"; }
export interface SleepAction { type: "sleep"; }
export interface EatAction { type: "eat"; }
export interface DrinkAction { type: "drink"; }
export interface AlcoholAction { type: "alcohol"; }

/** Open a book on the shelf (UI navigation, no tick). */
export interface ReadBookAction { type: "read_book"; bookIndex: number; }
/** Take a book from the shelf or swap held book (no tick). */
export interface TakeBookAction { type: "take_book"; bookIndex: number; }
/** Put held book back (no tick). */
export interface DropBookAction { type: "drop_book"; }
/** Submit held book at rest area slot. */
export interface SubmitAction { type: "submit"; }

/** Jump into the chasm. */
export interface ChasmJumpAction { type: "chasm_jump"; }
/** Attempt to grab a railing while falling. */
export interface GrabRailingAction { type: "grab_railing"; }
/** Throw held book while falling (no tick). */
export interface ThrowBookAction { type: "throw_book"; }
/** Wait one tick while falling. */
export interface FallWaitAction { type: "fall_wait"; }

// --- Social actions (NPC + player during possession) ---

/** Seek out a specific entity (move toward them). */
export interface SeekCompanionAction { type: "seek_companion"; targetId: number; }
/** Flee from nearby threats (mad NPCs, etc). */
export interface FleeAction { type: "flee"; }

export type Action =
    | MoveAction
    | WaitAction
    | SleepAction
    | EatAction
    | DrinkAction
    | AlcoholAction
    | ReadBookAction
    | TakeBookAction
    | DropBookAction
    | SubmitAction
    | ChasmJumpAction
    | GrabRailingAction
    | ThrowBookAction
    | FallWaitAction
    | SeekCompanionAction
    | FleeAction;

/** Actions that consume a game tick. */
export const TICK_ACTIONS: Set<Action["type"]> = new Set([
    "move", "wait", "sleep", "eat", "drink", "alcohol",
    "submit", "fall_wait",
]);

/** Actions that are instant (no tick cost). */
export const INSTANT_ACTIONS: Set<Action["type"]> = new Set([
    "read_book", "take_book", "drop_book", "throw_book",
    "chasm_jump", "grab_railing",
]);

/**
 * Whether an action costs a tick.
 * Social actions (seek_companion, flee) cost ticks because they involve movement.
 */
export function costsTick(action: Action): boolean {
    if (TICK_ACTIONS.has(action.type)) return true;
    if (INSTANT_ACTIONS.has(action.type)) return false;
    // Social actions default to tick-costing (they involve movement)
    return true;
}
