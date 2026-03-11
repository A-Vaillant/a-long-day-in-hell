/**
 * Entity intersection system — spatial hash for cross-entity interactions.
 *
 * In the coroutine model, entities advance independently. Cross-entity
 * interactions (bond accumulation, group formation, social pressure,
 * witness events) only fire when two entities share a segment.
 *
 * This module provides:
 *   - spatialKey(): hash a position to a bucket key
 *   - buildSpatialHash(): index entity positions
 *   - findIntersections(): detect co-located entity pairs
 *   - processIntersections(): apply cross-entity effects
 *
 * Works with both ECS Position components and plain position objects
 * from solo coroutine states.
 *
 * @module intersection.core
 */

// --- Spatial key ---

export interface Locatable {
    side: number;
    position: bigint;
    floor: bigint;
}

/** Unique key for a segment. Same as buildLocationIndex in social.core. */
export function spatialKey(loc: Locatable): string {
    return `${loc.side}:${loc.position}:${loc.floor}`;
}

// --- Entity handle ---

/**
 * A lightweight entity reference for the intersection system.
 * Can represent a solo NPC or a group — anything with a position
 * and an ID for deduplication.
 */
export interface IntersectionEntity {
    id: string | number;
    pos: Locatable;
}

// --- Spatial hash ---

export interface SpatialHash {
    /** Segment key → list of entities at that segment. */
    buckets: Map<string, IntersectionEntity[]>;
}

/** Build a spatial hash from a list of entities. */
export function buildSpatialHash(entities: IntersectionEntity[]): SpatialHash {
    const buckets = new Map<string, IntersectionEntity[]>();
    for (const entity of entities) {
        const key = spatialKey(entity.pos);
        let list = buckets.get(key);
        if (!list) {
            list = [];
            buckets.set(key, list);
        }
        list.push(entity);
    }
    return { buckets };
}

// --- Intersection detection ---

/** A pair of entities occupying the same segment. */
export interface Intersection {
    a: IntersectionEntity;
    b: IntersectionEntity;
    key: string;
}

/**
 * Find all pairs of entities that share a segment.
 * Returns unique pairs (a,b) — no duplicates (b,a).
 */
export function findIntersections(hash: SpatialHash): Intersection[] {
    const results: Intersection[] = [];
    for (const [key, entities] of hash.buckets) {
        if (entities.length < 2) continue;
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                results.push({ a: entities[i], b: entities[j], key });
            }
        }
    }
    return results;
}

// --- Proximity queries ---

/**
 * Find all entities within `range` segments of a given position.
 * Same side + floor required (matches segmentDistance semantics).
 */
export function findNearby(
    hash: SpatialHash,
    pos: Locatable,
    range: number,
): IntersectionEntity[] {
    const results: IntersectionEntity[] = [];
    // Check each position within range
    for (let offset = -range; offset <= range; offset++) {
        const checkPos = pos.position + BigInt(offset);
        const key = `${pos.side}:${checkPos}:${pos.floor}`;
        const bucket = hash.buckets.get(key);
        if (bucket) {
            for (const entity of bucket) {
                results.push(entity);
            }
        }
    }
    return results;
}

/**
 * Check if any entity is within `range` of a position.
 * Excludes the entity with `excludeId` if provided.
 */
export function hasNearby(
    hash: SpatialHash,
    pos: Locatable,
    range: number,
    excludeId?: string | number,
): boolean {
    for (let offset = -range; offset <= range; offset++) {
        const checkPos = pos.position + BigInt(offset);
        const key = `${pos.side}:${checkPos}:${pos.floor}`;
        const bucket = hash.buckets.get(key);
        if (bucket) {
            for (const entity of bucket) {
                if (excludeId !== undefined && entity.id === excludeId) continue;
                return true;
            }
        }
    }
    return false;
}

// --- Sweep detection for moving entities ---

/**
 * Check if two entities moving along a corridor could have intersected
 * during a batch of ticks. Conservative: assumes they might have crossed
 * if their positions overlapped at any point during the interval.
 *
 * Both entities must be on the same side and floor.
 * Returns true if their position ranges [old, new] overlap.
 */
export function couldIntersect(
    aPrev: Locatable, aCurr: Locatable,
    bPrev: Locatable, bCurr: Locatable,
): boolean {
    // Different side or floor — no intersection possible
    if (aPrev.side !== bPrev.side) return false;
    if (aPrev.floor !== bPrev.floor) return false;
    // If either changed side/floor during the interval, skip
    // (floor/side transitions happen at rest areas, rare)
    if (aCurr.side !== aPrev.side || aCurr.floor !== aPrev.floor) return false;
    if (bCurr.side !== bPrev.side || bCurr.floor !== bPrev.floor) return false;

    // Check if 1D position ranges overlap
    const aMin = aPrev.position < aCurr.position ? aPrev.position : aCurr.position;
    const aMax = aPrev.position > aCurr.position ? aPrev.position : aCurr.position;
    const bMin = bPrev.position < bCurr.position ? bPrev.position : bCurr.position;
    const bMax = bPrev.position > bCurr.position ? bPrev.position : bCurr.position;

    return aMin <= bMax && bMin <= aMax;
}

// --- Intersection processing ---

/**
 * Callback signature for processing an intersection event.
 * The handler receives both entities and can apply cross-entity effects
 * (bond accumulation, social pressure, group formation checks, etc.)
 */
export type IntersectionHandler = (
    intersection: Intersection,
    ticks: number,
) => void;

/**
 * Process all intersections by calling the handler for each pair.
 * `ticks` is the number of ticks the entities were co-located (for scaling effects).
 */
export function processIntersections(
    intersections: Intersection[],
    handler: IntersectionHandler,
    ticks: number = 1,
): void {
    for (const intersection of intersections) {
        handler(intersection, ticks);
    }
}
