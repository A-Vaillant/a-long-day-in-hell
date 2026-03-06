/** Chasm freefall physics — pure logic, no DOM.
 *
 * Models acceleration, terminal velocity, grab attempts,
 * and landing at floor 0.
 *
 * @module chasm.core
 */

export const GRAVITY = 1;
export const TERMINAL_VELOCITY = 50;
export const GRAB_BASE_CHANCE = 0.8;
export const GRAB_SPEED_PENALTY = 0.015;
export const GRAB_DAMAGE_SPEED_THRESHOLD = 10; // no damage below this speed
export const GRAB_FAIL_MAX_MORTALITY_HIT = 25; // damage at terminal velocity
export const GRAB_FAIL_SPEED_REDUCTION = 0.3;  // lose 30% of speed on failed grab (above threshold)
export const LANDING_KILL_SPEED = 10;

/**
 * Create a default falling state.
 * @param {number} side - which side the player jumped from (0 or 1)
 * @returns {{ speed: number, floorsToFall: number, side: number }}
 */
export function defaultFallingState(side) {
    return { speed: 0, floorsToFall: 0, side: side };
}

/**
 * Advance one tick of freefall.
 * @param {{ speed: number }} fallingState
 * @param {number} currentFloor
 * @returns {{ newFloor: number, newSpeed: number, landed: boolean, fatal: boolean }}
 */
export function fallTick(fallingState, currentFloor) {
    const newSpeed = Math.min(fallingState.speed + GRAVITY, TERMINAL_VELOCITY);
    const newFloor = Math.max(0, currentFloor - newSpeed);
    const landed = newFloor === 0;
    const fatal = landed && newSpeed >= LANDING_KILL_SPEED;
    return { newFloor, newSpeed, landed, fatal };
}

/**
 * Calculate grab success chance at a given speed.
 * @param {number} speed - current falling speed in floors/tick
 * @returns {number} probability 0-1
 */
export function grabChance(speed) {
    return Math.max(0, GRAB_BASE_CHANCE - speed * GRAB_SPEED_PENALTY);
}

/**
 * Attempt to grab a railing while falling.
 * @param {number} speed
 * @param {{ next: () => number }} rng - PRNG with next() returning [0,1)
 * @returns {{ success: boolean, mortalityHit: number, speedAfter: number }}
 */
export function attemptGrab(speed, rng) {
    const chance = grabChance(speed);
    const roll = rng.next();
    if (roll < chance) {
        return { success: true, mortalityHit: 0, speedAfter: 0 };
    }
    // At low speed you just miss. At high speed you collide with the railing —
    // it hurts, but the impact bleeds off velocity.
    let mortalityHit = 0;
    let speedAfter = speed;
    if (speed >= GRAB_DAMAGE_SPEED_THRESHOLD) {
        const fraction = Math.min(1, (speed - GRAB_DAMAGE_SPEED_THRESHOLD) / (TERMINAL_VELOCITY - GRAB_DAMAGE_SPEED_THRESHOLD));
        mortalityHit = Math.round(fraction * GRAB_FAIL_MAX_MORTALITY_HIT);
        speedAfter = Math.round(speed * (1 - GRAB_FAIL_SPEED_REDUCTION));
    }
    return { success: false, mortalityHit, speedAfter };
}

/**
 * Altitude band for prose selection. Determines what you can see.
 * @param {number} floor
 * @returns {"abyss"|"deep"|"mid"|"low"|"near"|"bottom"}
 */
export function altitudeBand(floor) {
    if (floor <= 0)     return "bottom";
    if (floor <= 20)    return "near";
    if (floor <= 200)   return "low";
    if (floor <= 2000)  return "mid";
    if (floor <= 20000) return "deep";
    return "abyss";
}
