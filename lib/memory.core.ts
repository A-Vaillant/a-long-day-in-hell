/**
 * Memory system — witnessed events that leave psychological scars.
 *
 * NPCs (and the player) witness real simulation events: chasm jumps,
 * deaths, escapes, madness transitions. These create MemoryEntry
 * records that decay over time and apply ongoing hope/lucidity effects.
 *
 * Architecture notes:
 * - witnessSystem receives events from the bridge layer (not self-detected)
 * - memoryDecaySystem runs analytical batch math for godmode fast-forward
 * - The `contagious` flag on MemoryEntry is reserved for future
 *   cognitohazard propagation (memories that spread between NPCs)
 *
 * @module memory.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, query, addComponent } from "./ecs.core.ts";
import type { Position, Psychology, Relationships, Identity } from "./social.core.ts";
import {
    POSITION, PSYCHOLOGY, RELATIONSHIPS, IDENTITY,
    segmentDistance, canSeeAcrossChasm,
    type PrebuiltIndex, type AwarenessConfig, DEFAULT_AWARENESS,
} from "./social.core.ts";
import { applyShockToEntity, type ShockConfig, DEFAULT_SHOCKS } from "./psych.core.ts";

// --- Memory types ---

export const MEMORY_TYPES = {
    WITNESS_CHASM: "witnessChasm",
    FOUND_BODY: "foundBody",
    COMPANION_DIED: "companionDied",
    GROUP_DISSOLVED: "groupDissolved",
    WITNESS_ESCAPE: "witnessEscape",
    FOUND_WORDS: "foundWords",
    WITNESS_MADNESS: "witnessMadness",
    COMPANION_MAD: "companionMad",
} as const;

export type MemoryType = typeof MEMORY_TYPES[keyof typeof MEMORY_TYPES];

// --- Component ---

export const MEMORY = "memory";

export interface MemoryEntry {
    id: number;                 // unique ID for debugging/tracing
    type: MemoryType;
    tick: number;               // absolute tick when witnessed
    weight: number;             // current emotional weight (decays)
    initialWeight: number;      // original weight (for drain scaling)
    permanent: boolean;         // weight never decays below floor
    subject: Entity | null;     // who was involved
    contagious: boolean;        // reserved for cognitohazard propagation
}

export interface Memory {
    entries: MemoryEntry[];
    capacity: number;
    nextId: number;             // monotonic counter for entry IDs
}

// --- Config ---

export interface MemoryTypeConfig {
    initialWeight: number;
    decayRate: number;          // weight loss per tick
    floor: number;              // minimum weight for permanent memories
    permanent: boolean;
    contagious: boolean;        // reserved
    shockKey: string | null;    // acute shock on creation (from psych.core)
    hopeDrainPerTick: number;   // ongoing hope effect (negative = drain)
    lucidityDrainPerTick: number;
}

export interface MemoryConfig {
    capacity: number;
    types: Record<MemoryType, MemoryTypeConfig>;
    dedupWindow: number;        // ticks within which same type+subject is deduped
}

export const DEFAULT_MEMORY_TYPES: Record<MemoryType, MemoryTypeConfig> = {
    witnessChasm:    { initialWeight: 10, decayRate: 0.0001,  floor: 2.0, permanent: true,  contagious: false, shockKey: "witnessChasm",    hopeDrainPerTick: -0.00005, lucidityDrainPerTick: -0.00002 },
    foundBody:       { initialWeight: 5,  decayRate: 0.001,   floor: 0,   permanent: false, contagious: false, shockKey: "foundBody",       hopeDrainPerTick: -0.00003, lucidityDrainPerTick: 0 },
    companionDied:   { initialWeight: 12, decayRate: 0.00005, floor: 3.0, permanent: true,  contagious: false, shockKey: "companionDied",   hopeDrainPerTick: -0.00008, lucidityDrainPerTick: -0.00003 },
    groupDissolved:  { initialWeight: 6,  decayRate: 0.0005,  floor: 0,   permanent: false, contagious: false, shockKey: "groupDissolved",  hopeDrainPerTick: -0.00004, lucidityDrainPerTick: 0 },
    witnessEscape:   { initialWeight: 8,  decayRate: 0.0003,  floor: 0,   permanent: false, contagious: false, shockKey: "witnessEscape",   hopeDrainPerTick: 0.00006,  lucidityDrainPerTick: 0 },
    foundWords:      { initialWeight: 3,  decayRate: 0.002,   floor: 0,   permanent: false, contagious: false, shockKey: null,              hopeDrainPerTick: 0.00003,  lucidityDrainPerTick: 0 },
    witnessMadness:  { initialWeight: 7,  decayRate: 0.0003,  floor: 1.0, permanent: true,  contagious: false, shockKey: "witnessMadness",  hopeDrainPerTick: -0.00002, lucidityDrainPerTick: -0.00006 },
    companionMad:    { initialWeight: 9,  decayRate: 0.0002,  floor: 2.0, permanent: true,  contagious: false, shockKey: "companionMad",    hopeDrainPerTick: -0.00003, lucidityDrainPerTick: -0.00005 },
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
    capacity: 32,
    types: DEFAULT_MEMORY_TYPES,
    dedupWindow: 240,  // 1 day
};

// --- Helpers ---

/** Create a fresh Memory component. */
export function createMemory(capacity: number = 32): Memory {
    return { entries: [], capacity, nextId: 0 };
}

/** Add a memory entry, evicting lowest-weight non-permanent if over capacity. */
export function addMemory(mem: Memory, entry: MemoryEntry): void {
    mem.entries.push(entry);
    if (mem.entries.length > mem.capacity) {
        // Find lowest-weight non-permanent entry; break ties by oldest (lowest tick)
        let evictIdx = -1;
        let evictWeight = Infinity;
        let evictTick = Infinity;
        for (let i = 0; i < mem.entries.length; i++) {
            const e = mem.entries[i];
            if (e.permanent) continue;
            if (e.weight < evictWeight || (e.weight === evictWeight && e.tick < evictTick)) {
                evictWeight = e.weight;
                evictTick = e.tick;
                evictIdx = i;
            }
        }
        if (evictIdx >= 0) {
            mem.entries.splice(evictIdx, 1);
        }
        // If all entries are permanent and we're over capacity, drop the new one
        // (it was just pushed, so it's the last element)
        if (mem.entries.length > mem.capacity) {
            mem.entries.pop();
        }
    }
}

/** Check if entity has a recent memory of this type+subject (dedup). */
export function hasRecentMemory(
    mem: Memory,
    type: MemoryType,
    subject: Entity | null,
    currentTick: number,
    window: number = 240,
): boolean {
    for (const e of mem.entries) {
        if (e.type === type && e.subject === subject && (currentTick - e.tick) < window) {
            return true;
        }
    }
    return false;
}

/** Get strongest memory (highest current weight). */
export function strongestMemory(mem: Memory): MemoryEntry | null {
    let best: MemoryEntry | null = null;
    for (const e of mem.entries) {
        if (!best || e.weight > best.weight) best = e;
    }
    return best;
}

/** Count memories of a given type. */
export function countMemories(mem: Memory, type: MemoryType): number {
    let count = 0;
    for (const e of mem.entries) {
        if (e.type === type) count++;
    }
    return count;
}

// --- Witness events (input from bridge layer) ---

export interface WitnessEvent {
    type: MemoryType;
    subject: Entity;
    position: Position;
    /** If true, only entities bonded to subject witness this. */
    bondedOnly: boolean;
    /** Awareness range for witness detection. */
    range: "colocated" | "hearing" | "sight";
}

// --- Witness system ---

/**
 * Detect witnesses to events and create memories.
 *
 * The prebuilt index MUST be from the current tick. The system does not
 * build its own index — the caller is responsible for freshness. This is
 * enforced by requiring it as a non-optional parameter; passing stale
 * data is a caller bug, not a system concern.
 *
 * In batch mode (n > 1), the bridge layer should only emit events from
 * the current tick — retroactive event simulation is not supported.
 */
export function witnessSystem(
    world: World,
    events: WitnessEvent[],
    currentTick: number,
    prebuilt: PrebuiltIndex,
    config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
    shockConfig: ShockConfig = DEFAULT_SHOCKS,
): void {
    if (events.length === 0) return;

    // Build a position lookup from the prebuilt index entities
    const entityPositions = new Map<Entity, Position>();
    for (const tuple of prebuilt.entities) {
        const entity = tuple[0] as Entity;
        const pos = tuple[1] as Position;
        entityPositions.set(entity, pos);
    }

    for (const event of events) {
        const typeConfig = config.types[event.type];
        if (!typeConfig) continue;

        // Find witness candidates based on range
        // Uses entity scan (not numeric index) for BigInt safety
        const maxDist = event.range === "colocated" ? 0
            : event.range === "hearing" ? DEFAULT_AWARENESS.hearRange
            : DEFAULT_AWARENESS.sightRange;

        const witnesses: Entity[] = [];
        for (const [ent, pos] of entityPositions) {
            if (ent === event.subject) continue;
            const dist = segmentDistance(event.position, pos);
            if (dist <= maxDist) {
                witnesses.push(ent);
            } else if (event.range === "sight" && canSeeAcrossChasm(event.position, pos)) {
                witnesses.push(ent);
            }
        }

        // Filter for bondedOnly events
        if (event.bondedOnly) {
            const filtered: Entity[] = [];
            for (const ent of witnesses) {
                const rels = getComponent<Relationships>(world, ent, RELATIONSHIPS);
                if (!rels) continue;
                const bond = rels.bonds.get(event.subject);
                if (bond && bond.familiarity > 0) {
                    filtered.push(ent);
                }
            }
            witnesses.length = 0;
            for (const ent of filtered) witnesses.push(ent);
        }

        // Filter out dead entities
        const alive: Entity[] = [];
        for (const ent of witnesses) {
            const ident = getComponent<Identity>(world, ent, IDENTITY);
            if (ident && ident.alive) alive.push(ent);
        }

        // Create memories for each witness
        for (const ent of alive) {
            let mem = getComponent<Memory>(world, ent, MEMORY);
            if (!mem) {
                mem = createMemory(config.capacity);
                addComponent(world, ent, MEMORY, mem);
            }

            // Dedup check
            if (hasRecentMemory(mem, event.type, event.subject, currentTick, config.dedupWindow)) {
                continue;
            }

            const entry: MemoryEntry = {
                id: mem.nextId++,
                type: event.type,
                tick: currentTick,
                weight: typeConfig.initialWeight,
                initialWeight: typeConfig.initialWeight,
                permanent: typeConfig.permanent,
                subject: event.subject,
                contagious: typeConfig.contagious,
            };

            addMemory(mem, entry);

            // Apply acute shock
            if (typeConfig.shockKey) {
                applyShockToEntity(world, ent, typeConfig.shockKey, shockConfig);
            }
        }
    }
}

// --- Decay system ---

/**
 * Decay memory weights and apply ongoing psychological effects.
 *
 * Batch-safe: uses analytical trapezoid formula for cumulative drain
 * over n ticks. No per-tick iteration.
 */
export function memoryDecaySystem(
    world: World,
    config: MemoryConfig = DEFAULT_MEMORY_CONFIG,
    n: number = 1,
): void {
    const entities = query(world, [MEMORY, PSYCHOLOGY]);

    for (const tuple of entities) {
        const mem = tuple[1] as Memory;
        const psych = tuple[2] as Psychology;

        let i = 0;
        while (i < mem.entries.length) {
            const entry = mem.entries[i];
            const tc = config.types[entry.type];
            if (!tc) { i++; continue; }

            const wStart = entry.weight;
            const floor = entry.permanent ? tc.floor : 0;

            // Decay weight
            entry.weight = Math.max(floor, wStart - tc.decayRate * n);

            // Ongoing psychological effect: trapezoid integral
            // drain = rate * n * (wStart + wEnd) / (2 * wInitial)
            if (entry.initialWeight > 0) {
                const avgWeight = (wStart + entry.weight) / (2 * entry.initialWeight);
                psych.hope = Math.max(0, Math.min(100,
                    psych.hope + tc.hopeDrainPerTick * n * avgWeight));
                psych.lucidity = Math.max(0, Math.min(100,
                    psych.lucidity + tc.lucidityDrainPerTick * n * avgWeight));
            }

            // Evict zeroed non-permanent entries
            if (entry.weight <= 0 && !entry.permanent) {
                mem.entries.splice(i, 1);
                // don't increment i — next entry shifted into this slot
            } else {
                i++;
            }
        }
    }
}
