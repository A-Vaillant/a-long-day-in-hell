/** Despairing condition — mechanics that activate when morale hits 0.
 *
 * All effects are configurable via the CONFIG export. Simulation tests
 * can override values to design backwards from desired outcomes.
 *
 * Systems:
 *   1. Sticky recovery — morale recovers slower while despairing
 *   2. Stat description corruption — sidebar lies about stat values
 *   3. Reading block — can't bring yourself to read while despairing
 *   4. Chasm seduction — jump prompt changes, confirmation removed
 *
 * @module despairing.core
 */

/** Shape of the tunable CONFIG object. */
export interface DespairingConfig {
    /** Ambient morale drain per move tick. The monotony of hell. */
    ambientDrain: number;
    /** Morale recovery multiplier while despairing (applied to sleep recovery). */
    sleepRecoveryMult: number;
    /** Morale threshold to exit despairing (must reach this to clear flag). */
    exitThreshold: number;
    /** Max random offset added to stat display values while despairing. */
    statCorruptionRange: number;
    /** Probability [0,1] that a stat descriptor is replaced with a wrong one. */
    statCorruptionChance: number;
    /** Probability [0,1] that reading is blocked per attempt while despairing. */
    readBlockChance: number;
    /** Whether chasm jump confirmation is skipped while despairing. */
    chasmSkipConfirm: boolean;
    /** Alcohol morale boost (flat). */
    alcoholMoraleBoost: number;
    /** Alcohol despairing exit: can alcohol alone clear despairing? */
    alcoholClearsDespairing: boolean;
}

/** Minimal stat shape consumed by applyAlcohol. */
export interface AlcoholStats {
    morale: number;
    despairing: boolean;
    [key: string]: unknown;
}

/** Survival functions expected by simulate(). */
export interface SurvivalFns {
    defaultStats(): AlcoholStats;
    applyMoveTick(stats: AlcoholStats): AlcoholStats;
    applySleep(stats: AlcoholStats): AlcoholStats;
    applyResurrection(stats: AlcoholStats): AlcoholStats;
    applyEat(stats: AlcoholStats): AlcoholStats;
    applyDrink(stats: AlcoholStats): AlcoholStats;
}

/** Tick state shape. */
export interface SimTickState {
    tick: number;
    day: number;
}

/** Tick functions expected by simulate(). */
export interface TickFns {
    TICKS_PER_DAY: number;
    LIGHTS_ON_TICKS?: number;
    defaultTickState(): SimTickState;
    advanceTick(state: SimTickState, n: number): { state: SimTickState; events: string[] };
    isLightsOn(tick: number): boolean;
    isResetHour(tick: number): boolean;
}

/** Player behavior overrides for simulate(). */
export interface SimBehavior {
    eats?: boolean;
    drinks?: boolean;
    sleeps?: boolean;
    eatAt?: number;
    drinkAt?: number;
    sleepAt?: number;
    nonsensePerDay?: number;
    sensiblePerDay?: number;
}

/** Options for simulate(). */
export interface SimulateOpts {
    /** Number of days to simulate. */
    days?: number;
    /** Player behavior overrides. */
    behavior?: SimBehavior;
}

/** Per-day stats recorded by simulate(). */
export interface DayStat {
    day: number;
    morale: number;
    despairing: boolean;
    hunger: number;
    thirst: number;
    exhaustion: number;
    mortality: number;
    dead: boolean;
    nonsensePagesRead: number;
}

/** Return value of simulate(). */
export interface SimulateResult {
    finalStats: AlcoholStats;
    dayStats: DayStat[];
}

/** Tunable parameters. Override fields for simulation/testing. */
export const CONFIG: DespairingConfig = {
    /** Ambient morale drain per move tick. The monotony of hell. */
    ambientDrain: 0.15,

    /** Morale recovery multiplier while despairing (applied to sleep recovery). */
    sleepRecoveryMult: 0.3,

    /** Morale threshold to exit despairing (must reach this to clear flag). */
    exitThreshold: 15,

    /** Max random offset added to stat display values while despairing. */
    statCorruptionRange: 25,

    /** Probability [0,1] that a stat descriptor is replaced with a wrong one. */
    statCorruptionChance: 0.4,

    /** Probability [0,1] that reading is blocked per attempt while despairing. */
    readBlockChance: 0.7,

    /** Whether chasm jump confirmation is skipped while despairing. */
    chasmSkipConfirm: true,

    /** Alcohol morale boost (flat). */
    alcoholMoraleBoost: 20,

    /** Alcohol despairing exit: can alcohol alone clear despairing? */
    alcoholClearsDespairing: true,
};

/**
 * Apply ambient morale drain for one move tick.
 * The library is inherently soul-crushing. Existing in it costs you.
 *
 * @param {number} morale — current morale (0–100)
 * @returns {number} — new morale value
 */
export function applyAmbientDrain(morale: number): number {
    return Math.max(0, morale - CONFIG.ambientDrain);
}

/**
 * Apply despairing modifier to sleep morale recovery.
 * When despairing, morale recovers at a fraction of the normal rate.
 *
 * @param {number} baseDelta — the normal morale gain from one sleep hour
 * @param {boolean} isDespairing
 * @returns {number}
 */
export function modifySleepRecovery(baseDelta: number, isDespairing: boolean): number {
    if (!isDespairing || baseDelta <= 0) return baseDelta;
    return baseDelta * CONFIG.sleepRecoveryMult;
}

/**
 * Whether despairing should be cleared given current morale.
 * Requires exceeding exitThreshold, creating hysteresis —
 * you enter at 0, but must climb higher to escape.
 *
 * @param {number} morale
 * @returns {boolean}
 */
export function shouldClearDespairing(morale: number): boolean {
    return morale >= CONFIG.exitThreshold;
}

/**
 * Corrupt a stat value for display purposes. Adds random noise
 * so the player can't trust their sidebar.
 *
 * @param {number} trueValue — actual stat value (0–100)
 * @param {number} rngValue — random float in [0,1) for noise magnitude
 * @returns {number} — corrupted display value, clamped to [0,100]
 */
export function corruptStatValue(trueValue: number, rngValue: number): number {
    const offset = (rngValue - 0.5) * 2 * CONFIG.statCorruptionRange;
    return Math.max(0, Math.min(100, trueValue + offset));
}

/**
 * Whether a stat descriptor should be swapped for a wrong one.
 *
 * @param {number} rngValue — random float in [0,1)
 * @returns {boolean}
 */
export function shouldCorruptDescriptor(rngValue: number): boolean {
    return rngValue < CONFIG.statCorruptionChance;
}

/**
 * Whether a book reading attempt is blocked.
 *
 * @param {boolean} isDespairing
 * @param {number} rngValue — random float in [0,1)
 * @returns {boolean}
 */
export function isReadingBlocked(isDespairing: boolean, rngValue: number): boolean {
    if (!isDespairing) return false;
    return rngValue < CONFIG.readBlockChance;
}

/**
 * Whether chasm jump should skip confirmation prompt.
 *
 * @param {boolean} isDespairing
 * @returns {boolean}
 */
export function chasmSkipsConfirm(isDespairing: boolean): boolean {
    if (!isDespairing) return false;
    return CONFIG.chasmSkipConfirm;
}

/**
 * Apply alcohol consumption. Boosts morale, can clear despairing.
 *
 * @param {object} stats — { morale, despairing, ... }
 * @returns {object} — new stats with morale/despairing updated
 */
export function applyAlcohol(stats: AlcoholStats): AlcoholStats {
    let morale = Math.min(100, stats.morale + CONFIG.alcoholMoraleBoost);
    let despairing = stats.despairing;
    if (CONFIG.alcoholClearsDespairing && shouldClearDespairing(morale)) {
        despairing = false;
    }
    return { ...stats, morale, despairing };
}

/**
 * Simulate N days of survival with configurable behavior.
 * Runs a tight loop of ticks with eat/drink/sleep decisions.
 *
 * @param {object} opts
 * @param {number} opts.days — number of days to simulate
 * @param {object} [opts.behavior] — player behavior overrides
 * @param {boolean} [opts.behavior.eats=true] — whether player eats when hungry
 * @param {boolean} [opts.behavior.drinks=true] — whether player drinks when thirsty
 * @param {boolean} [opts.behavior.sleeps=true] — whether player sleeps when exhausted
 * @param {number} [opts.behavior.eatAt=70] — hunger threshold to eat
 * @param {number} [opts.behavior.drinkAt=70] — thirst threshold to drink
 * @param {number} [opts.behavior.sleepAt=80] — exhaustion threshold to sleep
 * @param {number} [opts.behavior.nonsensePerDay=0] — nonsense pages dwelled on per day
 * @param {number} [opts.behavior.sensiblePerDay=0] — sensible pages dwelled on per day
 * @param {object} [opts.survivalFns] — survival core functions (applyMoveTick, applySleep, etc.)
 * @param {object} [opts.tickFns] — tick core functions (advanceTick, isLightsOn, etc.)
 * @returns {{ log: object[], finalStats: object, dayStats: object[] }}
 */
export function simulate(opts: SimulateOpts, survFns: SurvivalFns, tickFns: TickFns): SimulateResult {
    const days = opts.days || 10;
    const beh: Required<SimBehavior> = Object.assign({
        eats: true, drinks: true, sleeps: true,
        eatAt: 70, drinkAt: 70, sleepAt: 80,
        nonsensePerDay: 0, sensiblePerDay: 0,
    }, opts.behavior);

    let stats: AlcoholStats = survFns.defaultStats();
    let tickState: SimTickState = tickFns.defaultTickState();
    let nonsensePagesRead = 0;
    const dayStats: DayStat[] = [];
    let currentDay = 1;
    let diedThisDay = false;
    let wasDespairing = false;

    function applySleepWithDespairing(): void {
        const wasDespairing = stats.despairing;
        const moraleBefore = stats.morale;
        stats = survFns.applySleep(stats);
        if (wasDespairing) {
            // applySleep gave full recovery; scale it down
            const fullGain = stats.morale - moraleBefore;
            if (fullGain > 0) {
                const effectiveGain = fullGain * CONFIG.sleepRecoveryMult;
                stats = { ...stats, morale: Math.max(0, moraleBefore + effectiveGain), despairing: true };
            }
            if (shouldClearDespairing(stats.morale)) {
                stats = { ...stats, despairing: false };
            }
        }
    }

    function recordDay(): void {
        dayStats.push({
            day: currentDay,
            morale: stats.morale,
            despairing: (stats.despairing as boolean) || wasDespairing,
            hunger: stats.hunger as number,
            thirst: stats.thirst as number,
            exhaustion: stats.exhaustion as number,
            mortality: stats.mortality as number,
            dead: diedThisDay,
            nonsensePagesRead,
        });
    }

    for (let d = 0; d < days; d++) {
        let awakeTicks = 0;
        diedThisDay = false;
        wasDespairing = false;
        const readingsThisDay = { nonsense: 0, sensible: 0 };

        // Compute reading intervals: spread N readings evenly across 160 awake ticks
        const awakeTicksPerDay = tickFns.LIGHTS_ON_TICKS || 160;
        const nonsenseInterval = beh.nonsensePerDay > 0 ? Math.floor(awakeTicksPerDay / beh.nonsensePerDay) : 0;
        const sensibleInterval = beh.sensiblePerDay > 0 ? Math.floor(awakeTicksPerDay / beh.sensiblePerDay) : 0;

        for (let t = 0; t < tickFns.TICKS_PER_DAY; t++) {
            const result = tickFns.advanceTick(tickState, 1);
            tickState = result.state;

            if (result.events.includes("dawn")) {
                nonsensePagesRead = Math.floor(nonsensePagesRead / 2);
                if (stats.dead) {
                    stats = survFns.applyResurrection(stats);
                }
                currentDay++;
            }

            if (stats.dead) {
                diedThisDay = true;
                continue;
            }

            if (stats.despairing) wasDespairing = true;

            const lightsOn = tickFns.isLightsOn(tickState.tick);
            const isResetHour = tickFns.isResetHour(tickState.tick);

            if (isResetHour || !lightsOn) {
                if (beh.sleeps) applySleepWithDespairing();
                continue;
            }

            // Awake tick
            awakeTicks++;
            stats = survFns.applyMoveTick(stats);
            if (stats.dead) { diedThisDay = true; continue; }

            // Ambient morale drain — the monotony of hell
            stats = { ...stats, morale: applyAmbientDrain(stats.morale) };
            if (stats.morale <= 0) stats = { ...stats, despairing: true };

            // Eat/drink
            if (beh.eats && (stats.hunger as number) >= beh.eatAt) {
                stats = survFns.applyEat(stats);
            }
            if (beh.drinks && (stats.thirst as number) >= beh.drinkAt) {
                stats = survFns.applyDrink(stats);
            }

            // Reading: all books are symbol slop, minor morale drain with diminishing returns
            if (nonsenseInterval > 0 && readingsThisDay.nonsense < beh.nonsensePerDay &&
                awakeTicks % nonsenseInterval === 0) {
                const penalty = 2 / (1 + nonsensePagesRead);
                stats = { ...stats, morale: Math.max(0, Math.min(100, stats.morale - penalty)) };
                nonsensePagesRead++;
                readingsThisDay.nonsense++;
            }

            // Voluntary nap if exhausted
            if (beh.sleeps && (stats.exhaustion as number) >= beh.sleepAt) {
                applySleepWithDespairing();
            }
        }

        recordDay();
    }

    return { finalStats: stats, dayStats };
}
