/**
 * NPC sleep system — bedrooms, co-sleeping familiarity, morale effects.
 *
 * Each rest area has a 7-bed bedroom. When lights go out, NPCs at rest
 * areas claim beds and sleep until dawn. Co-sleeping with familiar NPCs
 * boosts hope; sleeping alone penalizes it.
 *
 * NPCs have a "home" rest area they prefer to return to. The return_home
 * behavior (scored in intent.core.ts) drives them back as evening approaches.
 * Home shifts if they repeatedly sleep elsewhere.
 *
 * @module sleep.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, query } from "./ecs.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS,
    type Position, type Identity, type Psychology, type Relationships,
    getOrCreateBond,
    DEFAULT_BOND,
} from "./social.core.ts";
import { applyShockToEntity, type ShockConfig, DEFAULT_SHOCKS } from "./psych.core.ts";
import { isRestArea } from "./library.core.ts";

// --- Component ---

export const SLEEP = "sleep";

export interface HomeLocation {
    side: number;
    position: number;
    floor: number;
}

export interface Sleep {
    /** Full coordinates of this NPC's home rest area. */
    home: HomeLocation;
    /** Bed index (0–6) if currently sleeping, null otherwise. */
    bedIndex: number | null;
    /** Whether currently asleep. */
    asleep: boolean;
    /** Entity IDs of NPCs sharing the same bedroom this night. */
    coSleepers: Entity[];
    /** Consecutive nights slept at a non-home rest area. */
    awayStreak: number;
    /** Nomadic NPCs don't return home and aren't penalized for sleeping alone. */
    nomadic: boolean;
}

// --- Config ---

export interface SleepConfig {
    /** Beds per rest area bedroom. */
    bedsPerBedroom: number;
    /** Hope boost per co-sleeper with positive familiarity. */
    coSleeperHopeBoost: number;
    /** Hope penalty for sleeping alone. */
    aloneHopePenalty: number;
    /** Familiarity bump per co-sleeper per night (on top of normal tick accumulation). */
    coSleeperFamiliarityBump: number;
    /** Max hope boost from co-sleeping per night. */
    maxCoSleepHopeBoost: number;
    /** Consecutive away nights before home shifts. */
    homeShiftThreshold: number;
}

export const DEFAULT_SLEEP: SleepConfig = {
    bedsPerBedroom: 7,
    coSleeperHopeBoost: 2.0,
    aloneHopePenalty: 3.0,
    coSleeperFamiliarityBump: 5.0,
    maxCoSleepHopeBoost: 8.0,
    homeShiftThreshold: 3,
};

// --- Helpers ---

/** Nearest rest area to a position. */
export function nearestRestArea(position: number): number {
    return Math.round(position / 10) * 10;
}

/** Distance in segments between a position and a rest area. */
export function distanceToRestArea(position: number, restArea: number): number {
    return Math.abs(position - restArea);
}

// --- Systems ---

/**
 * Lights-out: NPCs at rest areas claim beds and fall asleep.
 * NPCs not at rest areas stay awake (no bed).
 *
 * Call once when lights go out (tick crosses LIGHTS_OFF_TICK).
 * Returns sleep events for logging.
 */
export function sleepOnsetSystem(
    world: World,
    config: SleepConfig = DEFAULT_SLEEP,
): SleepOnsetEvent[] {
    const events: SleepOnsetEvent[] = [];

    // Group sleepers by rest area key (side:position:floor)
    const byRestArea = new Map<string, { entity: Entity; sleep: Sleep; pos: Position; ident: Identity }[]>();

    const entities = query(world, [SLEEP, POSITION, IDENTITY]);
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const sleep = tuple[1] as Sleep;
        const pos = tuple[2] as Position;
        const ident = tuple[3] as Identity;

        if (!ident.alive) continue;
        if (!isRestArea(pos.position)) {
            // Not at a rest area — no bed
            sleep.asleep = false;
            sleep.bedIndex = null;
            sleep.coSleepers = [];
            continue;
        }

        const key = `${pos.side}:${pos.position}:${pos.floor}`;
        if (!byRestArea.has(key)) byRestArea.set(key, []);
        byRestArea.get(key)!.push({ entity, sleep, pos, ident });
    }

    // Assign beds per rest area
    for (const [key, sleepers] of byRestArea) {
        const bedCount = Math.min(sleepers.length, config.bedsPerBedroom);

        // First bedCount NPCs get beds (arrival order = entity order)
        for (let i = 0; i < sleepers.length; i++) {
            const s = sleepers[i];
            if (i < bedCount) {
                s.sleep.bedIndex = i;
                s.sleep.asleep = true;
                // Record co-sleepers (everyone else with a bed at this location)
                s.sleep.coSleepers = sleepers
                    .filter((other, j) => j !== i && j < bedCount)
                    .map(other => other.entity);
            } else {
                // No bed available — sleep on the floor (still "at rest area" but no bed)
                s.sleep.bedIndex = null;
                s.sleep.asleep = true;
                s.sleep.coSleepers = [];
            }
        }

        // Emit events
        const names = sleepers.slice(0, bedCount).map(s => s.ident.name);
        if (names.length > 0) {
            events.push({
                restAreaKey: key,
                position: { ...sleepers[0].pos },
                sleeperNames: names,
                overflow: sleepers.length - bedCount,
            });
        }
    }

    return events;
}

/**
 * Dawn: resolve sleep effects — familiarity bumps, hope changes, home shifts.
 * Call once at dawn, before resetNeedsAtDawn.
 * Returns wake events for logging.
 */
export function sleepWakeSystem(
    world: World,
    currentTick: number,
    config: SleepConfig = DEFAULT_SLEEP,
): SleepWakeEvent[] {
    const events: SleepWakeEvent[] = [];

    const entities = query(world, [SLEEP, POSITION, IDENTITY, PSYCHOLOGY]);
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const sleep = tuple[1] as Sleep;
        const pos = tuple[2] as Position;
        const ident = tuple[3] as Identity;
        const psych = tuple[4] as Psychology;

        if (!sleep.asleep) continue;

        const rels = getComponent<Relationships>(world, entity, RELATIONSHIPS);

        // Co-sleeper familiarity + hope
        let hopeChange = 0;
        const coSleeperNames: string[] = [];

        if (sleep.coSleepers.length > 0 && rels) {
            for (const other of sleep.coSleepers) {
                const otherIdent = getComponent<Identity>(world, other, IDENTITY);
                if (otherIdent) coSleeperNames.push(otherIdent.name);

                // Familiarity bump (overnight bonding)
                const bond = getOrCreateBond(rels, other, currentTick);
                bond.familiarity = Math.min(
                    DEFAULT_BOND.maxFamiliarity,
                    bond.familiarity + config.coSleeperFamiliarityBump,
                );
                bond.lastContact = currentTick;

                // Hope boost scales with existing familiarity
                const familiarityFactor = Math.min(1, bond.familiarity / 10);
                hopeChange += config.coSleeperHopeBoost * familiarityFactor;
            }
            hopeChange = Math.min(config.maxCoSleepHopeBoost, hopeChange);
        } else if (sleep.bedIndex !== null) {
            // Slept alone in a bed — routed through habituation
            const impact = applyShockToEntity(world, entity, "sleepAlone");
            hopeChange = impact.hope;
        }
        // No bed at all (overflow) — worse than alone, also habituates
        if (sleep.bedIndex === null) {
            const impact = applyShockToEntity(world, entity, "sleepNoBed");
            hopeChange = impact.hope;
        }

        // Co-sleeping hope boost applied directly (not a shock)
        if (hopeChange > 0) {
            psych.hope = Math.max(0, Math.min(100, psych.hope + hopeChange));
        }

        // Home shift: if sleeping at a different rest area, track streak (not nomadic)
        const atHome = isRestArea(pos.position) &&
            pos.side === sleep.home.side &&
            pos.position === sleep.home.position &&
            pos.floor === sleep.home.floor;

        if (!sleep.nomadic && isRestArea(pos.position) && !atHome) {
            sleep.awayStreak++;
            if (sleep.awayStreak >= config.homeShiftThreshold) {
                sleep.home = { side: pos.side, position: pos.position, floor: pos.floor };
                sleep.awayStreak = 0;
            }
        } else {
            sleep.awayStreak = 0;
        }

        events.push({
            entity,
            name: ident.name,
            hopeChange,
            coSleepers: coSleeperNames,
            atHome,
        });

        // Reset sleep state for next day
        sleep.asleep = false;
        sleep.bedIndex = null;
        sleep.coSleepers = [];
    }

    return events;
}

// --- Events ---

export interface SleepOnsetEvent {
    restAreaKey: string;
    position: Position;
    sleeperNames: string[];
    overflow: number;
}

export interface SleepWakeEvent {
    entity: Entity;
    name: string;
    hopeChange: number;
    coSleepers: string[];
    atHome: boolean;
}
