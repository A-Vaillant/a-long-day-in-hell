/** Tick / time-of-day system.
 *
 * One tick = one player action. The day runs from 6:00am (tick 0) to the
 * following 6:00am (tick 240). Lights go out at 10:00pm (tick 160).
 *
 * Boundary events emitted by advanceTick:
 *   "lightsOut" — tick crossed LIGHTS_OFF_TICK
 *   "dawn"      — tick crossed TICKS_PER_DAY (day incremented, tick wrapped)
 *
 * @module tick.core
 */

export const TICKS_PER_HOUR  = 10;
export const HOURS_PER_DAY   = 24;
export const TICKS_PER_DAY   = TICKS_PER_HOUR * HOURS_PER_DAY; // 240
export const DAY_START_HOUR  = 6;   // 6:00am
export const LIGHTS_OFF_HOUR = 22;  // 10:00pm
export const LIGHTS_ON_TICKS = (LIGHTS_OFF_HOUR - DAY_START_HOUR) * TICKS_PER_HOUR; // 160

/** @returns {{ tick: number, day: number }} */
export function defaultTickState() {
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
export function advanceTick(state, n) {
    let { tick, day } = state;
    const events = [];

    const newAbsolute = tick + n;

    // Check lights-out boundary (only fires once per call)
    // Walk through all day boundaries crossed. Each day emits lightsOut (if
    // not already past it) and dawn. Supports multi-day skips (fugue states).
    let cursor = tick;
    let remaining = n;

    while (remaining > 0) {
        const dawnAt      = TICKS_PER_DAY   - cursor;
        const lightsOutAt = LIGHTS_ON_TICKS - cursor; // negative when already past lights-out

        if (remaining < dawnAt) {
            // Does not reach dawn this iteration
            if (cursor < LIGHTS_ON_TICKS && remaining >= lightsOutAt) {
                events.push("lightsOut");
            }
            cursor += remaining;
            remaining = 0;
        } else {
            // Reaches (or exactly hits) dawn
            if (cursor < LIGHTS_ON_TICKS) events.push("lightsOut");
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
export function isLightsOn(tick) {
    return tick < LIGHTS_ON_TICKS;
}

/**
 * Convert a tick value to a 12-hour clock string.
 * Tick 0 = 6:00 AM, tick 160 = 10:00 PM, tick 239 = 5:50 AM.
 *
 * @param {number} tick
 * @returns {string}  e.g. "6:00 AM", "10:40 PM"
 */
export function tickToTimeString(tick) {
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
export function ticksUntilDawn(tick) {
    return TICKS_PER_DAY - tick;
}

/**
 * Number of whole hours remaining until dawn.
 *
 * @param {number} tick
 * @returns {number}
 */
export function hoursUntilDawn(tick) {
    return Math.ceil(ticksUntilDawn(tick) / TICKS_PER_HOUR);
}
