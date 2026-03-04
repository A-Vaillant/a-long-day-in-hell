/** Survival stat system: Hunger, Thirst, Exhaustion, Morale.
 *
 * All stats are 0–100. They deplete on actions. At 0 they impose morale
 * penalties. Morale at 0 sets the Despairing condition (stubbed).
 *
 * Depletion rates (per action):
 *   - Move/Wait: Thirst -2, Hunger -0.5, Exhaustion -1
 *   - Sleep:     restores Exhaustion to 100, Hunger -5 (time passes)
 *   - Eat:       Hunger +40
 *   - Drink:     Thirst +40
 *
 * Morale penalties (applied each move when stat = 0):
 *   - Hunger 0:     Morale -2/move
 *   - Thirst 0:     Morale -4/move  (worse)
 *   - Exhaustion 0: Morale -1/move
 *
 * @module survival.core
 */

export const STAT_MAX = 100;
export const STAT_MIN = 0;

/** Default starting state. */
export function defaultStats() {
    return {
        hunger:     80,
        thirst:     80,
        exhaustion: 90,
        morale:     100,
        despairing: false,
    };
}

/**
 * Clamp a value between STAT_MIN and STAT_MAX.
 * @param {number} v
 * @returns {number}
 */
function clamp(v) {
    return Math.max(STAT_MIN, Math.min(STAT_MAX, v));
}

/**
 * Apply depletion for a move or wait action.
 * Returns a new stats object (does not mutate).
 *
 * @param {object} stats
 * @returns {object}
 */
export function applyMove(stats) {
    let { hunger, thirst, exhaustion, morale, despairing } = stats;

    hunger     = clamp(hunger     - 0.5);
    thirst     = clamp(thirst     - 2);
    exhaustion = clamp(exhaustion - 1);

    // Morale penalties for zeroed stats
    if (hunger     <= STAT_MIN) morale = clamp(morale - 2);
    if (thirst     <= STAT_MIN) morale = clamp(morale - 4);
    if (exhaustion <= STAT_MIN) morale = clamp(morale - 1);

    if (morale <= STAT_MIN) despairing = true;

    return { hunger, thirst, exhaustion, morale, despairing };
}

/**
 * Apply effects of sleeping (one full rest).
 * Exhaustion restored, hunger ticks down (time passes), thirst ticks down.
 *
 * @param {object} stats
 * @returns {object}
 */
export function applySleep(stats) {
    let { hunger, thirst, exhaustion, morale, despairing } = stats;

    exhaustion = STAT_MAX;
    hunger     = clamp(hunger - 10);
    thirst     = clamp(thirst - 8);

    // Small morale boost from rest
    morale = clamp(morale + 5);
    if (morale > STAT_MIN) despairing = false;

    return { hunger, thirst, exhaustion, morale, despairing };
}

/**
 * Apply eating (consuming one food item from kiosk).
 *
 * @param {object} stats
 * @returns {object}
 */
export function applyEat(stats) {
    return { ...stats, hunger: clamp(stats.hunger + 40) };
}

/**
 * Apply drinking (consuming one drink item from kiosk).
 *
 * @param {object} stats
 * @returns {object}
 */
export function applyDrink(stats) {
    return { ...stats, thirst: clamp(stats.thirst + 40) };
}

/**
 * Get a severity label for a stat value.
 * Used for UI warnings.
 *
 * @param {number} value
 * @returns {"critical"|"low"|"ok"}
 */
export function severity(value) {
    if (value <= 10) return "critical";
    if (value <= 30) return "low";
    return "ok";
}

/**
 * Get all active warning messages for a stats object.
 * Returns array of strings (empty if all ok).
 *
 * @param {object} stats
 * @returns {string[]}
 */
export function getWarnings(stats) {
    const w = [];
    if (severity(stats.thirst)     === "critical") w.push("You are desperately thirsty.");
    else if (severity(stats.thirst) === "low")     w.push("You are thirsty.");
    if (severity(stats.hunger)     === "critical") w.push("You are desperately hungry.");
    else if (severity(stats.hunger) === "low")     w.push("You are hungry.");
    if (severity(stats.exhaustion) === "critical") w.push("You can barely keep your eyes open.");
    else if (severity(stats.exhaustion) === "low") w.push("You are exhausted.");
    if (stats.despairing)                          w.push("You have given up hope.");
    return w;
}
