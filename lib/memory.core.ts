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
import type { BookCoords } from "./lifestory.core.ts";
import { seedFromString } from "./prng.core.ts";
import {
    POSITION, PSYCHOLOGY, RELATIONSHIPS, IDENTITY,
    segmentDistance, canSeeAcrossChasm,
    type PrebuiltIndex, type AwarenessConfig, DEFAULT_AWARENESS,
} from "./social.core.ts";
import { applyShockToEntity, type ShockConfig, DEFAULT_SHOCKS } from "./psych.core.ts";
import { perDay, days as daysToTicks } from "./scale.core.ts";

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
    MET_SOMEONE: "metSomeone",
    PILGRIMAGE_FAILURE: "pilgrimageFailure",
    REACHED_MERCY: "reachedMercy",
    BOOK_VISION: "bookVision",
    SEARCH_PROGRESS: "searchProgress",
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

export type BookVisionState = "granted" | "pilgrimaging" | "arrived" | "searching" | "exhausted" | "found";

export interface BookVisionEntry extends MemoryEntry {
    type: "bookVision";
    coords: BookCoords | null;
    accurate: boolean;
    vague: boolean;
    radius: number;
    state: BookVisionState;
}

export interface SearchProgressEntry extends MemoryEntry {
    type: "searchProgress";
    searchedSegments: Set<string>;
    bestScore: number;
    bestWords: string[];
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

// Memory rates expressed in per-day real-time units, converted to per-tick.
// decayRate: how fast the memory weight decays. hopeDrainPerTick/lucidityDrainPerTick: ongoing psych effects.
const D = perDay; // shorthand
export const DEFAULT_MEMORY_TYPES: Record<MemoryType, MemoryTypeConfig> = {
    witnessChasm:    { initialWeight: 10, decayRate: D(0.024),   floor: 2.0, permanent: true,  contagious: false, shockKey: "witnessChasm",    hopeDrainPerTick: D(-0.012),  lucidityDrainPerTick: D(-0.0048) },
    foundBody:       { initialWeight: 5,  decayRate: D(0.24),    floor: 0,   permanent: false, contagious: false, shockKey: "foundBody",       hopeDrainPerTick: D(-0.0072), lucidityDrainPerTick: 0 },
    companionDied:   { initialWeight: 12, decayRate: D(0.012),   floor: 3.0, permanent: true,  contagious: false, shockKey: "companionDied",   hopeDrainPerTick: D(-0.0192), lucidityDrainPerTick: D(-0.0072) },
    groupDissolved:  { initialWeight: 6,  decayRate: D(0.12),    floor: 0,   permanent: false, contagious: false, shockKey: "groupDissolved",  hopeDrainPerTick: D(-0.0096), lucidityDrainPerTick: 0 },
    witnessEscape:   { initialWeight: 8,  decayRate: D(0.072),   floor: 0,   permanent: false, contagious: false, shockKey: "witnessEscape",   hopeDrainPerTick: D(0.0144),  lucidityDrainPerTick: 0 },
    foundWords:      { initialWeight: 3,  decayRate: D(0.48),    floor: 0,   permanent: false, contagious: false, shockKey: null,              hopeDrainPerTick: D(0.0072),  lucidityDrainPerTick: 0 },
    witnessMadness:  { initialWeight: 7,  decayRate: D(0.072),   floor: 1.0, permanent: true,  contagious: false, shockKey: "witnessMadness",  hopeDrainPerTick: D(-0.0048), lucidityDrainPerTick: D(-0.0144) },
    companionMad:    { initialWeight: 9,  decayRate: D(0.048),   floor: 2.0, permanent: true,  contagious: false, shockKey: "companionMad",    hopeDrainPerTick: D(-0.0072), lucidityDrainPerTick: D(-0.012) },
    metSomeone:          { initialWeight: 2,  decayRate: D(0.192),   floor: 0,   permanent: false, contagious: false, shockKey: null,                  hopeDrainPerTick: D(0.0024),  lucidityDrainPerTick: 0 },
    pilgrimageFailure:   { initialWeight: 15, decayRate: D(0.006),   floor: 5.0, permanent: true,  contagious: false, shockKey: "pilgrimageFailure",   hopeDrainPerTick: D(-0.024),  lucidityDrainPerTick: D(-0.024) },
    reachedMercy:        { initialWeight: 6,  decayRate: D(0.048),   floor: 0,   permanent: false, contagious: false, shockKey: null,                  hopeDrainPerTick: D(0.024),   lucidityDrainPerTick: 0 },
    bookVision:          { initialWeight: 10, decayRate: 0,          floor: 10,  permanent: true,  contagious: false, shockKey: null,                  hopeDrainPerTick: D(0.012),   lucidityDrainPerTick: 0 },
    searchProgress:      { initialWeight: 3,  decayRate: 0,          floor: 3,   permanent: true,  contagious: true,  shockKey: null,                  hopeDrainPerTick: 0,          lucidityDrainPerTick: 0 },
};

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
    capacity: 32,
    types: DEFAULT_MEMORY_TYPES,
    dedupWindow: daysToTicks(1),  // 1 day
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
    window: number = daysToTicks(1),
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

// --- Book vision and search progress helpers ---

/** Segment key for search sets. */
export function segmentKey(side: number, position: bigint, floor: bigint): string {
    return `${side}:${position}:${floor}`;
}

/** Find the bookVision entry in a Memory component. */
export function getBookVision(mem: Memory): BookVisionEntry | null {
    for (const e of mem.entries) {
        if (e.type === "bookVision") return e as BookVisionEntry;
    }
    return null;
}

/**
 * Find or create the searchProgress entry in a Memory component.
 * @param create - if true, create entry when missing
 */
export function getSearchProgress(mem: Memory, create: boolean = false): SearchProgressEntry | null {
    for (const e of mem.entries) {
        if (e.type === "searchProgress") return e as SearchProgressEntry;
    }
    if (!create) return null;
    const tc = DEFAULT_MEMORY_CONFIG.types["searchProgress"];
    const entry: SearchProgressEntry = {
        id: mem.nextId++,
        type: "searchProgress",
        tick: 0,
        weight: tc.initialWeight,
        initialWeight: tc.initialWeight,
        permanent: tc.permanent,
        subject: null,
        contagious: tc.contagious,
        searchedSegments: new Set(),
        bestScore: 0,
        bestWords: [],
    };
    addMemory(mem, entry);
    return entry;
}

/** Grant a book vision — creates or replaces the bookVision entry. */
export function grantBookVision(
    mem: Memory,
    coords: BookCoords,
    tick: number,
    opts?: { accurate?: boolean },
): void {
    // Remove existing bookVision entry if present
    mem.entries = mem.entries.filter(e => e.type !== "bookVision");
    const tc = DEFAULT_MEMORY_CONFIG.types["bookVision"];
    const entry: BookVisionEntry = {
        id: mem.nextId++,
        type: "bookVision",
        tick,
        weight: tc.initialWeight,
        initialWeight: tc.initialWeight,
        permanent: tc.permanent,
        subject: null,
        contagious: tc.contagious,
        coords: { ...coords },
        accurate: opts?.accurate ?? true,
        vague: false,
        radius: 0,
        state: "granted",
    };
    addMemory(mem, entry);
}

/** Grant a vague book vision with jittered position. */
export function grantVagueBookVision(
    mem: Memory,
    coords: BookCoords,
    radius: number,
    tick: number,
): void {
    // Jitter position deterministically
    const jitterRng = seedFromString("vague:" + coords.side + ":" + coords.position + ":" + coords.floor);
    const jitter = BigInt(jitterRng.nextInt(radius * 2 + 1) - radius);
    const jitteredCoords = {
        ...coords,
        position: coords.position + jitter,
    };

    mem.entries = mem.entries.filter(e => e.type !== "bookVision");
    const tc = DEFAULT_MEMORY_CONFIG.types["bookVision"];
    const entry: BookVisionEntry = {
        id: mem.nextId++,
        type: "bookVision",
        tick,
        weight: tc.initialWeight,
        initialWeight: tc.initialWeight,
        permanent: tc.permanent,
        subject: null,
        contagious: tc.contagious,
        coords: jitteredCoords,
        accurate: true,
        vague: true,
        radius,
        state: "granted",
    };
    addMemory(mem, entry);
}

/** Check if position matches the book vision's segment (ignores bookIndex). */
export function isAtBookSegment(
    entry: BookVisionEntry | null,
    pos: { side: number; position: bigint; floor: bigint },
): boolean {
    if (!entry || !entry.coords) return false;
    return pos.side === entry.coords.side &&
           pos.position === entry.coords.position &&
           pos.floor === entry.coords.floor;
}

/** Check if position is within a vague vision's search radius. */
export function isInVisionRadius(
    entry: BookVisionEntry | null,
    pos: { side: number; position: bigint; floor: bigint },
): boolean {
    if (!entry || !entry.coords || !entry.vague) return false;
    if (pos.side !== entry.coords.side) return false;
    if (pos.floor !== entry.coords.floor) return false;
    const dist = pos.position > entry.coords.position
        ? pos.position - entry.coords.position
        : entry.coords.position - pos.position;
    return dist <= BigInt(entry.radius);
}

/** Mark a segment as searched in the searchProgress entry. */
export function markSegmentSearched(mem: Memory, side: number, position: bigint, floor: bigint): void {
    const entry = getSearchProgress(mem, true)!;
    entry.searchedSegments.add(segmentKey(side, position, floor));
}

/** Check if a segment has been searched. */
export function isSegmentSearched(mem: Memory, side: number, position: bigint, floor: bigint): boolean {
    const entry = getSearchProgress(mem);
    if (!entry) return false;
    return entry.searchedSegments.has(segmentKey(side, position, floor));
}

/** Share search progress from source to target. Returns number of new segments learned. */
export function shareSearchProgress(source: Memory, target: Memory): number {
    const srcEntry = getSearchProgress(source);
    if (!srcEntry) return 0;
    const tgtEntry = getSearchProgress(target, true)!;
    let learned = 0;
    for (const seg of srcEntry.searchedSegments) {
        if (!tgtEntry.searchedSegments.has(seg)) {
            tgtEntry.searchedSegments.add(seg);
            learned++;
        }
    }
    return learned;
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
