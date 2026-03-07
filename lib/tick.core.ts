/** Tick / time-of-day system.
 *
 * One tick = one player action. The day runs from 6:00am (tick 0) to the
 * following 6:00am (tick 240). Lights go out at 10:00pm (tick 160).
 *
 * Boundary events emitted by advanceTick:
 *   "lightsOut"  — tick crossed LIGHTS_OFF_TICK
 *   "resetHour"  — tick crossed RESET_HOUR_TICK (5:00 AM, enforced sleep + library reset)
 *   "dawn"       — tick crossed TICKS_PER_DAY (day incremented, tick wrapped)
 *
 * @module tick.core
 */

export interface TickState {
    tick: number;
    day: number;
}

export type TickEvent = "lightsOut" | "resetHour" | "dawn";

export interface AdvanceTickResult {
    state: TickState;
    events: TickEvent[];
}

export const TICKS_PER_HOUR: number  = 10;
export const HOURS_PER_DAY: number   = 24;
export const TICKS_PER_DAY: number   = TICKS_PER_HOUR * HOURS_PER_DAY; // 240
export const DAY_START_HOUR: number  = 6;   // 6:00am
export const LIGHTS_OFF_HOUR: number = 22;  // 10:00pm
export const LIGHTS_ON_TICKS: number = (LIGHTS_OFF_HOUR - DAY_START_HOUR) * TICKS_PER_HOUR; // 160
export const RESET_HOUR_TICK: number = TICKS_PER_DAY - TICKS_PER_HOUR; // 230 = 5:00 AM

/** @returns {{ tick: number, day: number }} */
export function defaultTickState(): TickState {
    return { tick: 0, day: 1 };
}

/**
 * Advance time by n ticks. Returns new state and any boundary events that
 * fired. Multiple events are possible if n is large (e.g. sleeping through
 * lights-out into dawn).
 *
 * Events fire in the order the boundaries were crossed. Each boundary fires
 * at most once per call regardless of n.
 *
 * @param {{ tick: number, day: number }} state
 * @param {number} n  Ticks to advance (must be > 0)
 * @returns {{ state: { tick: number, day: number }, events: string[] }}
 */
export function advanceTick(state: TickState, n: number): AdvanceTickResult {
    let { tick, day } = state;
    const events: TickEvent[] = [];

    const newAbsolute = tick + n;

    // Check lights-out boundary (only fires once per call)
    // Walk through all day boundaries crossed. Each day emits lightsOut (if
    // not already past it) and dawn. Supports multi-day skips (fugue states).
    let cursor = tick;
    let remaining = n;

    while (remaining > 0) {
        const dawnAt      = TICKS_PER_DAY    - cursor;
        const lightsOutAt = LIGHTS_ON_TICKS  - cursor;
        const resetAt     = RESET_HOUR_TICK  - cursor;

        if (remaining < dawnAt) {
            // Does not reach dawn this iteration
            if (cursor < LIGHTS_ON_TICKS && remaining >= lightsOutAt) {
                events.push("lightsOut");
            }
            if (cursor < RESET_HOUR_TICK && remaining >= resetAt) {
                events.push("resetHour");
            }
            cursor += remaining;
            remaining = 0;
        } else {
            // Reaches (or exactly hits) dawn
            if (cursor < LIGHTS_ON_TICKS) events.push("lightsOut");
            if (cursor < RESET_HOUR_TICK) events.push("resetHour");
            events.push("dawn");
            day += 1;
            remaining -= dawnAt;
            cursor = 0;
        }
    }

    tick = cursor;
    return { state: { tick, day }, events };
}

/**
 * Whether the lights are on at a given tick value.
 *
 * @param {number} tick
 * @returns {boolean}
 */
export function isLightsOn(tick: number): boolean {
    return tick < LIGHTS_ON_TICKS;
}

/**
 * Whether the given tick falls within the reset hour (5:00–6:00 AM).
 * During this hour sleep is enforced and the library resets.
 */
export function isResetHour(tick: number): boolean {
    return tick >= RESET_HOUR_TICK && tick < TICKS_PER_DAY;
}

/**
 * Convert a tick value to a 12-hour clock string.
 * Tick 0 = 6:00 AM, tick 160 = 10:00 PM, tick 239 = 5:50 AM.
 *
 * @param {number} tick
 * @returns {string}  e.g. "6:00 AM", "10:40 PM"
 */
export function tickToTimeString(tick: number): string {
    const totalMinutes = tick * (60 / TICKS_PER_HOUR);
    const absoluteMinutes = DAY_START_HOUR * 60 + totalMinutes;
    const hour24 = Math.floor(absoluteMinutes / 60) % 24;
    const minute = Math.floor(absoluteMinutes % 60);

    const ampm = hour24 < 12 ? "AM" : "PM";
    let hour12 = hour24 % 12;
    if (hour12 === 0) hour12 = 12;

    const mm = String(minute).padStart(2, "0");
    return `${hour12}:${mm} ${ampm}`;
}

/**
 * Number of ticks remaining until dawn (tick 240, i.e. next 6:00am).
 *
 * @param {number} tick
 * @returns {number}
 */
export function ticksUntilDawn(tick: number): number {
    return TICKS_PER_DAY - tick;
}

/**
 * Number of whole hours remaining until dawn.
 *
 * @param {number} tick
 * @returns {number}
 */
export function hoursUntilDawn(tick: number): number {
    return Math.ceil(ticksUntilDawn(tick) / TICKS_PER_HOUR);
}
