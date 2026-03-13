/** Survival stat system: Hunger, Thirst, Exhaustion, Morale, Mortality.
 *
 * All stats are 0–100.
 *
 * Hunger and Thirst count UPWARD — 0 = sated/quenched, 100 = peak suffering.
 * Exhaustion counts UPWARD — 0 = fully rested, 100 = total collapse.
 * Morale counts DOWNWARD — 100 = fine, 0 = despairing.
 * Mortality counts DOWNWARD — 100 = alive, 0 = dead.
 *
 * Depletion rates (real-time, converted to per-tick via scale.core):
 *   Thirst: 0→100 in ~4 days without drinking
 *   Hunger: 0→100 in ~8 days without eating
 *   Exhaustion: 0→100 in ~1.7 days — enforces sleep rhythm
 *   Eat:   Hunger -40 (relief)
 *   Drink: Thirst -40 (relief)
 *
 * Conditions:
 *   Parched   — thirst >= 100
 *   Starving  — hunger >= 100
 *   Despairing — morale <= 0 (non-lethal)
 *
 * Mortality:
 *   Activates when Parched or Starving. Drains toward 0.
 *   Rates:
 *     Parched only:  ~12 hours to death
 *     Starving only: ~1 day to death
 *     Both:          ~6 hours to death
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

/** The shape of survival stats tracked for an entity. */
export interface SurvivalStats {
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;
    despairing: boolean;
    dead: boolean;
}

/** A severity level for a stat value. */
export type Severity = "critical" | "low" | "ok";

/** A single entry in a threshold table for {@link describeFromTable}. */
export interface ThresholdEntry {
    min: number;
    word: string;
    level: string;
}

/** Result of {@link describeFromTable}. */
export interface ThresholdResult {
    word: string;
    level: string;
}

export const STAT_MAX: number = 100;
export const STAT_MIN: number = 0;

// Growth rates expressed in real-time units, converted to per-tick.
// Thirst: 0→100 in ~4 days.  Hunger: 0→100 in ~8 days.
// Exhaustion: 0→100 in ~1.7 waking days.
import { perDay, WAKING_TICKS as _WAKING_TICKS, TICKS_PER_HOUR as _TPH } from "./scale.core.ts";

const THIRST_RATE: number     = perDay(100 / 4);     // ~4 days to full
const HUNGER_RATE: number     = perDay(100 / 8);     // ~8 days to full
const EXHAUSTION_RATE: number = perDay(100 / 1.7);   // ~1.7 days to collapse

// Mortality drain rates: how fast you die once starving/parched.
// Parched only: ~12 hours. Starving only: ~1 day. Both: ~6 hours.
const MORTALITY_PARCHED_ONLY: number  = perDay(100 / 0.5);  // 12 hours
const MORTALITY_STARVING_ONLY: number = perDay(100 / 1);    // 1 day
const MORTALITY_BOTH: number          = perDay(100 / 0.25); // 6 hours

/** Default starting state — hunger/thirst/exhaustion start at 0 (no suffering). */
export function defaultStats(): SurvivalStats {
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

function clamp(v: number): number {
    return Math.max(STAT_MIN, Math.min(STAT_MAX, v));
}

function applyMortality(stats: SurvivalStats): SurvivalStats {
    const isParched: boolean  = stats.thirst  >= STAT_MAX;
    const isStarving: boolean = stats.hunger  >= STAT_MAX;

    if (!isParched && !isStarving) {
        stats.mortality = STAT_MAX;
    } else {
        const rate: number = (isParched && isStarving) ? MORTALITY_BOTH
                   : isParched                 ? MORTALITY_PARCHED_ONLY
                                               : MORTALITY_STARVING_ONLY;
        stats.mortality = clamp(stats.mortality - rate);
        if (stats.mortality <= STAT_MIN) stats.dead = true;
    }
    return stats;
}

/**
 * Apply depletion for a move or wait action.
 * Returns a new stats object (does not mutate).
 *
 * @param {SurvivalStats} stats
 * @returns {SurvivalStats}
 */
export function applyMoveTick(stats: SurvivalStats): SurvivalStats {
    stats.hunger     = clamp(stats.hunger     + HUNGER_RATE);
    stats.thirst     = clamp(stats.thirst     + THIRST_RATE);
    stats.exhaustion = clamp(stats.exhaustion + EXHAUSTION_RATE);

    if (stats.hunger     >= STAT_MAX) stats.morale = clamp(stats.morale - 2);
    if (stats.thirst     >= STAT_MAX) stats.morale = clamp(stats.morale - 4);
    if (stats.exhaustion >= STAT_MAX) stats.morale = clamp(stats.morale - 1);

    if (stats.morale <= STAT_MIN) stats.despairing = true;

    return applyMortality(stats);
}

/**
 * Apply morale/mortality effects from current need levels.
 * Does NOT accumulate needs — use when ECS needsSystem handles accumulation.
 */
export function applyMoraleTick(stats: SurvivalStats): SurvivalStats {
    if (stats.hunger     >= STAT_MAX) stats.morale = clamp(stats.morale - 2);
    if (stats.thirst     >= STAT_MAX) stats.morale = clamp(stats.morale - 4);
    if (stats.exhaustion >= STAT_MAX) stats.morale = clamp(stats.morale - 1);

    if (stats.morale <= STAT_MIN) stats.despairing = true;

    return applyMortality(stats);
}

/**
 * Apply effects of one sleep-hour.
 * Called once per TICKS_PER_HOUR ticks of sleep.
 *
 * @param {SurvivalStats} stats
 * @returns {SurvivalStats}
 */
export function applySleep(stats: SurvivalStats, inBedroom: boolean = false): SurvivalStats {
    stats.hunger = clamp(stats.hunger + 0.5);
    stats.thirst = clamp(stats.thirst + 0.4);
    stats.exhaustion = STAT_MIN;
    // Sleeping on the corridor floor gives nothing. A bed helps a little.
    if (inBedroom) stats.morale = clamp(stats.morale + 1);
    if (stats.morale > STAT_MIN) stats.despairing = false;

    return applyMortality(stats);
}

/**
 * Restore physical stats at resurrection; morale is preserved.
 * Death is not an escape from despair.
 *
 * @param {SurvivalStats} stats — pre-death stats (morale, despairing carried over)
 * @returns {SurvivalStats}
 */
export function applyResurrection(stats: SurvivalStats): SurvivalStats {
    const d = defaultStats();
    stats.hunger = d.hunger;
    stats.thirst = d.thirst;
    stats.exhaustion = d.exhaustion;
    stats.mortality = 100;
    stats.dead = false;
    // morale and despairing preserved — death is not an escape
    return stats;
}

/**
 * Apply eating (consuming one food item).
 *
 * @param {SurvivalStats} stats
 * @returns {SurvivalStats}
 */
export function applyEat(stats: SurvivalStats): SurvivalStats {
    stats.hunger = clamp(stats.hunger - 40);
    return applyMortality(stats);
}

/**
 * Apply drinking (consuming one drink item).
 *
 * @param {SurvivalStats} stats
 * @returns {SurvivalStats}
 */
export function applyDrink(stats: SurvivalStats): SurvivalStats {
    stats.thirst = clamp(stats.thirst - 40);
    return applyMortality(stats);
}

/** Base morale boost from alcohol. */
const ALCOHOL_MORALE_BOOST: number = 20;

/**
 * Apply drinking alcohol. Boosts morale, also quenches some thirst.
 *
 * @param {SurvivalStats} stats
 * @returns {SurvivalStats}
 */
export function applyAlcohol(stats: SurvivalStats): SurvivalStats {
    stats.morale = Math.min(STAT_MAX, stats.morale + ALCOHOL_MORALE_BOOST);
    stats.thirst = clamp(stats.thirst - 20);
    return applyMortality(stats);
}

/** Result of applyReadNonsense. */
export interface ReadNonsenseResult<T> {
    stats: T;
    nonsensePagesRead: number;
}

/**
 * Apply the morale penalty for reading a nonsense book page.
 * Diminishing drain: 2 / (1 + pagesAlreadyRead). Increments the counter.
 */
export function applyReadNonsense<T extends { morale: number; despairing: boolean }>(
    stats: T, nonsensePagesRead: number,
): ReadNonsenseResult<T> {
    const penalty = 2 / (1 + nonsensePagesRead);
    stats.morale = Math.max(STAT_MIN, Math.min(STAT_MAX, stats.morale - penalty));
    if (stats.morale <= 0) stats.despairing = true;
    return { stats, nonsensePagesRead: nonsensePagesRead + 1 };
}

/** Result of applyDawnReset. */
export interface DawnResetResult {
    nonsensePagesRead: number;
    despairDays: number;
}

/**
 * Dawn bookkeeping: halve nonsense fatigue, track consecutive despair days.
 */
export function applyDawnReset(nonsensePagesRead: number, despairing: boolean, despairDays: number): DawnResetResult {
    return {
        nonsensePagesRead: Math.floor(nonsensePagesRead / 2),
        despairDays: despairing ? despairDays + 1 : 0,
    };
}

/**
 * Get a severity label for a hunger/thirst/exhaustion value (higher = worse).
 *
 * @param {number} value
 * @returns {Severity}
 */
/** Minimum exhaustion required to voluntarily sleep during the day. */
export const SLEEP_EXHAUSTION_THRESHOLD: number = 30;

/** Tick at which "near bedtime" begins (1 hour before lights out). */
export const NEAR_BEDTIME_TICK: number = _WAKING_TICKS - _TPH; // 9:00 PM

/**
 * Whether the player can sleep voluntarily.
 * Always allowed when lights are off (it's dark, nothing else to do).
 * Always allowed in the hour before lights out (tick 150–159).
 * During the day, requires sufficient exhaustion.
 */
export function canSleep(exhaustion: number, lightsOn: boolean = true, tick: number = 0): boolean {
    if (!lightsOn) return true;
    if (tick >= NEAR_BEDTIME_TICK) return true;
    return exhaustion >= SLEEP_EXHAUSTION_THRESHOLD;
}

export function severity(value: number): Severity {
    if (value >= 90) return "critical";
    if (value >= 70) return "low";
    return "ok";
}

/**
 * Get all active warning/condition messages for a stats object.
 *
 * @param {SurvivalStats} stats
 * @returns {string[]}
 */
export function getWarnings(stats: SurvivalStats): string[] {
    const w: string[] = [];
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
 * @param {SurvivalStats} stats
 * @returns {boolean}
 */
export function showMortality(stats: SurvivalStats): boolean {
    return stats.thirst >= STAT_MAX || stats.hunger >= STAT_MAX;
}

/**
 * Match a value against a threshold table.
 * Table entries: [{ min, word, level }], checked in order (first match wins).
 * For rising stats (hunger/thirst/exhaustion), higher = worse, use `min` as >=.
 * For falling stats (morale), caller inverts before calling.
 *
 * @param {number} value
 * @param {ThresholdEntry[]} table
 * @returns {ThresholdResult}
 */
export function describeFromTable(value: number, table: ThresholdEntry[]): ThresholdResult {
    if (!table || table.length === 0) return { word: "???", level: "ok" };
    for (let i = 0; i < table.length; i++) {
        if (value >= table[i].min) return { word: table[i].word, level: table[i].level };
    }
    // fallback: last entry
    const last: ThresholdEntry = table[table.length - 1];
    return { word: last.word, level: last.level };
}
