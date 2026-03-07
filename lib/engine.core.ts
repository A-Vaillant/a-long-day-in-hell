/**
 * Engine core — pure logic, no DOM.
 *
 * Defines the GameState interface, Screen contract, and batch tick
 * processing with boundary event registry.
 *
 * @module engine.core
 */

import { advanceTick } from "./tick.core.ts";
import type { NPC, Disposition } from "./npc.core.ts";
import type { EventCard } from "./events.core.ts";

// Re-export NPC types for consumers
export type { NPC, Disposition };
export type { EventCard };

/* ---------- Book coordinates ---------- */

export interface BookCoords {
    side: number;
    position: number;
    floor: number;
    bookIndex: number;
}

/* ---------- Life story ---------- */

export interface LifeStory {
    name: string;
    occupation: string;
    hometown: string;
    causeOfDeath: string;
    lastThing: string;
    storyText: string;
    targetPage: number;
    placement: string;
    bookCoords: BookCoords;
}

/* ---------- Game state ---------- */

export interface GameState {
    // Identity
    seed: string;
    screen: string;

    // Position
    side: number;       // 0=west, 1=east
    position: number;   // segment index
    floor: number;      // 0=bottom, up

    // Navigation
    move: string;
    shelfOffset: number;

    // Books
    heldBook: BookCoords | null;
    openBook: BookCoords | null;
    openPage: number;
    bookNames: Record<string, string>;
    dwellHistory: Record<string, boolean>;

    // Survival
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;

    // Condition
    despairing: boolean;
    dead: boolean;
    deaths: number;
    deathCause: string | null;
    won: boolean;

    // Time
    tick: number;
    day: number;
    lightsOn: boolean;

    // Story
    lifeStory: LifeStory;
    targetBook: BookCoords;

    // Systems
    eventDeck: number[];
    lastEvent: EventCard | null;
    npcs: NPC[];
    submissionsAttempted: number;

    // Debug
    debug: boolean;
    _debugAllowed: boolean;

    // Transient
    _menuReturn?: string;
    _submissionWon?: boolean;
    _readBlocked?: boolean;
    _dwellFired?: { bookIndex: number; pageIndex: number } | null;
}

/* ---------- Screen contract ---------- */

export interface Screen {
    kind: "state" | "transition";
    enter?(): void;
    render(): string;
    afterRender?(): void;
    exit?(): void;
}

/* ---------- Boundary event registry ---------- */

export type BoundaryHandler = () => void;

export interface BoundaryRegistry {
    _handlers: Record<string, BoundaryHandler[]>;
    on(event: string, handler: BoundaryHandler): void;
    fire(event: string): void;
}

export function createBoundaryRegistry(): BoundaryRegistry {
    const registry: BoundaryRegistry = {
        _handlers: {},

        on(event: string, handler: BoundaryHandler) {
            if (!this._handlers[event]) this._handlers[event] = [];
            this._handlers[event].push(handler);
        },

        fire(event: string) {
            const handlers = this._handlers[event];
            if (!handlers) return;
            for (const handler of handlers) {
                try {
                    handler();
                } catch (err) {
                    console.error("Boundary handler error (" + event + "):", err);
                }
            }
        },
    };
    return registry;
}

/* ---------- Batch tick processing ---------- */

export interface TickResult {
    tickEvents: string[];
    days: number;
    finalTick: number;
    finalDay: number;
}

/** Safety cap: 10 in-game days. */
const MAX_ADVANCE_TICKS = 2400;

/**
 * Advance time by n ticks, firing boundary event handlers in chronological
 * order. Pure with respect to its own state — handlers are closures that
 * may mutate external state.
 */
export function processTime(
    tickState: { tick: number; day: number },
    n: number,
    registry: BoundaryRegistry,
): TickResult {
    const clamped = Math.min(Math.max(1, n), MAX_ADVANCE_TICKS);
    const result = advanceTick(tickState, clamped);

    for (const event of result.events) {
        registry.fire(event);
    }

    return {
        tickEvents: result.events,
        days: result.state.day - tickState.day,
        finalTick: result.state.tick,
        finalDay: result.state.day,
    };
}
