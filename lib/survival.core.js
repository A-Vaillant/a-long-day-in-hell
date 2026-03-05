/** Survival stat system: Hunger, Thirst, Exhaustion, Morale, Mortality.
 *
 * All stats are 0–100.
 *
 * Hunger and Thirst count UPWARD — 0 = sated/quenched, 100 = peak suffering.
 * Exhaustion counts UPWARD — 0 = fully rested, 100 = total collapse.
 * Morale counts DOWNWARD — 100 = fine, 0 = despairing.
 * Mortality counts DOWNWARD — 100 = alive, 0 = dead.
 *
 * Depletion rates (per tick):
 *   Move/Wait: Thirst +0.11, Hunger +0.05, Exhaustion +0.25
 *   Sleep (per hour):
 *     Exhaustion → 0, Hunger +0.5, Thirst +0.4, Morale +5
 *   Eat:   Hunger -40 (relief)
 *   Drink: Thirst -40 (relief)
 *
 * Rate targets:
 *   Thirst: 0→100 in ~720 ticks (~3 days) without drinking
 *   Hunger: 0→100 in ~1600 ticks (~6.7 days) without eating
 *   Exhaustion: 0→100 in ~400 ticks (~1.7 days) — enforces sleep rhythm
 *
 * Conditions:
 *   Parched   — thirst >= 100
 *   Starving  — hunger >= 100
 *   Despairing — morale <= 0 (non-lethal)
 *
 * Mortality:
 *   Activates when Parched or Starving. Drains toward 0.
 *   Rates:
 *     Parched only:  -0.83/tick (~0.5 days to death)
 *     Starving only: -0.42/tick (~1 day to death)
 *     Both:          -1.67/tick (~0.25 days to death)
 *   Resets to 100 when neither Parched nor Starving.
 *   Mortality = 0 → dead = true.
 *
 * Morale penalties (per move when stat maxed):
 *   Hunger 100:     Morale -2
 *   Thirst 100:     Morale -4
 *   Exhaustion 100: Morale -1
 *
 * @module survival.core
 */

export const STAT_MAX = 100;
export const STAT_MIN = 0;

// Growth rates per tick (hunger/thirst/exhaustion go UP)
const THIRST_RATE     = 0.11;
const HUNGER_RATE     = 0.05;
const EXHAUSTION_RATE = 0.25;

// Mortality drain rates per tick
const MORTALITY_PARCHED_ONLY  = 0.83;
const MORTALITY_STARVING_ONLY = 0.42;
const MORTALITY_BOTH          = 1.67;

/** Default starting state — hunger/thirst/exhaustion start at 0 (no suffering). */
export function defaultStats() {
    return {
        hunger:     0,
        thirst:     0,
        exhaustion: 0,
        morale:     100,
        mortality:  100,
        despairing: false,
        dead:       false,
    };
}

function clamp(v) {
    return Math.max(STAT_MIN, Math.min(STAT_MAX, v));
}

function applyMortality(stats) {
    let { thirst, hunger, mortality, dead } = stats;
    const isParched  = thirst  >= STAT_MAX;
    const isStarving = hunger  >= STAT_MAX;

    if (!isParched && !isStarving) {
        mortality = STAT_MAX;
    } else {
        const rate = (isParched && isStarving) ? MORTALITY_BOTH
                   : isParched                 ? MORTALITY_PARCHED_ONLY
                                               : MORTALITY_STARVING_ONLY;
        mortality = clamp(mortality - rate);
        if (mortality <= STAT_MIN) dead = true;
    }
    return { ...stats, mortality, dead };
}

/**
 * Apply depletion for a move or wait action.
 * Returns a new stats object (does not mutate).
 *
 * @param {object} stats
 * @returns {object}
 */
export function applyMoveTick(stats) {
    let { hunger, thirst, exhaustion, morale, despairing } = stats;

    hunger     = clamp(hunger     + HUNGER_RATE);
    thirst     = clamp(thirst     + THIRST_RATE);
    exhaustion = clamp(exhaustion + EXHAUSTION_RATE);

    if (hunger     >= STAT_MAX) morale = clamp(morale - 2);
    if (thirst     >= STAT_MAX) morale = clamp(morale - 4);
    if (exhaustion >= STAT_MAX) morale = clamp(morale - 1);

    if (morale <= STAT_MIN) despairing = true;

    return applyMortality({ ...stats, hunger, thirst, exhaustion, morale, despairing });
}

/**
 * Apply effects of one sleep-hour.
 * Called once per TICKS_PER_HOUR ticks of sleep.
 *
 * @param {object} stats
 * @returns {object}
 */
export function applySleep(stats) {
    let { hunger, thirst, morale, despairing } = stats;

    hunger = clamp(hunger + 0.5);
    thirst = clamp(thirst + 0.4);
    morale = clamp(morale + 5);
    if (morale > STAT_MIN) despairing = false;

    return applyMortality({ ...stats, hunger, thirst, exhaustion: STAT_MIN, morale, despairing });
}

/**
 * Restore all stats to starting values (used at resurrection).
 *
 * @returns {object}
 */
export function applyResurrection() {
    return defaultStats();
}

/**
 * Apply eating (consuming one food item).
 *
 * @param {object} stats
 * @returns {object}
 */
export function applyEat(stats) {
    return applyMortality({ ...stats, hunger: clamp(stats.hunger - 40) });
}

/**
 * Apply drinking (consuming one drink item).
 *
 * @param {object} stats
 * @returns {object}
 */
export function applyDrink(stats) {
    return applyMortality({ ...stats, thirst: clamp(stats.thirst - 40) });
}

/** Base morale boost from alcohol. */
const ALCOHOL_MORALE_BOOST = 20;

/**
 * Apply drinking alcohol. Boosts morale, also quenches some thirst.
 *
 * @param {object} stats
 * @returns {object}
 */
export function applyAlcohol(stats) {
    let morale = Math.min(STAT_MAX, stats.morale + ALCOHOL_MORALE_BOOST);
    let thirst = clamp(stats.thirst - 20);
    return applyMortality({ ...stats, morale, thirst });
}

/**
 * Get a severity label for a hunger/thirst/exhaustion value (higher = worse).
 *
 * @param {number} value
 * @returns {"critical"|"low"|"ok"}
 */
export function severity(value) {
    if (value >= 90) return "critical";
    if (value >= 70) return "low";
    return "ok";
}

/**
 * Get all active warning/condition messages for a stats object.
 *
 * @param {object} stats
 * @returns {string[]}
 */
export function getWarnings(stats) {
    const w = [];
    if (stats.thirst >= STAT_MAX)                    w.push("Your mouth is dust. You need water.");
    else if (severity(stats.thirst) === "critical") w.push("You are desperately thirsty.");
    else if (severity(stats.thirst) === "low")      w.push("You are thirsty.");
    if (stats.hunger >= STAT_MAX)                    w.push("Your body is eating itself. You need food.");
    else if (severity(stats.hunger) === "critical") w.push("You are desperately hungry.");
    else if (severity(stats.hunger) === "low")      w.push("You are hungry.");
    if (severity(stats.exhaustion) === "critical")  w.push("You can barely keep your eyes open.");
    else if (severity(stats.exhaustion) === "low")  w.push("You are exhausted.");
    if (stats.despairing)                           w.push("Nothing matters. None of this matters.");
    return w;
}

/**
 * Whether the mortality bar should be shown.
 *
 * @param {object} stats
 * @returns {boolean}
 */
export function showMortality(stats) {
    return stats.thirst >= STAT_MAX || stats.hunger >= STAT_MAX;
}

/**
 * Match a value against a threshold table.
 * Table entries: [{ min, word, level }], checked in order (first match wins).
 * For rising stats (hunger/thirst/exhaustion), higher = worse, use `min` as >=.
 * For falling stats (morale), caller inverts before calling.
 *
 * @param {number} value
 * @param {{ min: number, word: string, level: string }[]} table
 * @returns {{ word: string, level: string }}
 */
export function describeFromTable(value, table) {
    for (var i = 0; i < table.length; i++) {
        if (value >= table[i].min) return { word: table[i].word, level: table[i].level };
    }
    // fallback: last entry
    var last = table[table.length - 1];
    return { word: last.word, level: last.level };
}
