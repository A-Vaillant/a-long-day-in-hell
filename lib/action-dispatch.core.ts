/**
 * Unified action dispatch — the single source of truth for game mechanics.
 *
 * Both the browser (src/js/actions.js) and the headless simulator
 * (lib/simulator.core.ts) call applyAction(). Screen transitions and
 * boundary event dispatch are caller concerns.
 *
 * @module action-dispatch.core
 */

import type { Action } from "./action.core.ts";
import type { TickEvent } from "./tick.core.ts";
import type { FallingState } from "./chasm.core.ts";
import type { EventCard } from "./events.core.ts";
import type { Entity, World } from "./ecs.core.ts";

// --- Interfaces ---

export interface BookCoords {
    side: number;
    position: bigint;
    floor: bigint;
    bookIndex: number;
}

export interface GameState {
    side: number;
    position: bigint;
    floor: bigint;
    tick: number;
    day: number;
    lightsOn: boolean;
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;
    despairing: boolean;
    dead: boolean;
    heldBook: BookCoords | null;
    openBook: BookCoords | null;
    openPage: number;
    dwellHistory: Record<string, boolean>;
    targetBook: BookCoords;
    submissionsAttempted: number;
    nonsensePagesRead: number;
    totalMoves: number;
    deaths: number;
    deathCause: string | null;
    _mercyKiosks: Record<string, boolean>;
    _mercyKioskDone: boolean;
    _mercyArrival: string | null;
    _despairDays: number;
    falling: FallingState | null;
    eventDeck: number[];
    lastEvent: EventCard | null;
    won: boolean;
    _readBlocked: boolean;
    _submissionWon: boolean;
    _lastMove: string | null;
    npcs?: any[];
}

export interface ActionContext {
    seed: string;
    eventCards: EventCard[];
    world?: World;
    resolveEntity?: (npcId: number) => Entity | undefined;
    playerEntity?: Entity;
    quicknessBonus?: number;
}

export interface DispatchResult {
    resolved: boolean;
    screen?: string;
    tickEvents: TickEvent[];
    ticksConsumed: number;
    data?: any;
}

// --- Helpers ---

function unresolved(): DispatchResult {
    return { resolved: false, tickEvents: [], ticksConsumed: 0 };
}

// --- Main dispatch ---

export function applyAction(
    state: GameState,
    action: Action | { type: string; [k: string]: any },
    ctx: ActionContext,
): DispatchResult {
    switch (action.type) {
        default:
            return unresolved();
    }
}
