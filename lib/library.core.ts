/** Library geometry and segment generation.
 *
 * The library is two parallel corridors (side 0 and side 1) separated by an
 * infinite chasm. Each corridor is divided into discrete segments by rest areas.
 * Floors are stacked vertically; floor 0 is the bottom where the chasm ends and
 * the two sides connect via a bridge.
 *
 * Coordinates: { side, position, floor }
 *   side     : 0 or 1 (the two sides of the chasm)
 *   position : integer segment index along the corridor (unbounded)
 *   floor    : integer, 0 = bottom, increases upward
 *
 * Each segment contains:
 *   - A stretch of shelved corridor (~300 yards of books)
 *   - A rest area at the END of the segment (right boundary):
 *       clock, kiosk, bedroom (7 beds), bathroom, submission slot, stairs
 *
 * Movement:
 *   left      : position - 1 (blocked at position 0, which is a wall — or wrap?)
 *   right     : position + 1
 *   up        : floor + 1 (only from a rest area, i.e. right edge of segment)
 *   down      : floor - 1 (only from a rest area; blocked at floor 0)
 *   cross     : switch side (only at floor 0, only from a rest area)
 *
 * @module library.core
 */

/** A location in the library. */
export interface Location {
    side: number;
    position: number;
    floor: number;
}

/** Rest area descriptor within a segment. */
export interface RestArea {
    hasStairs: boolean;
    hasKiosk: boolean;
    bedsAvailable: number;
    hasZoroastrianText: boolean;
}

/** Segment descriptor returned by generateSegment. */
export interface Segment {
    side: number;
    position: number;
    floor: number;
    lightLevel: "dim" | "normal";
    restArea: RestArea | null;
    hasBridge: boolean;
    bookCount: number;
}

/** An RNG instance that can be forked by key. */
export interface Rng {
    next(): number;
}

export type Direction = "left" | "right" | "up" | "down" | "cross";

export const BOTTOM_FLOOR: number = 0;
export const BOOKS_PER_GALLERY: number   = 192;  // 24 wide × 8 tall — one shelf face
export const GALLERIES_PER_SEGMENT: number = 10; // gallery pages between rest areas
export const SEGMENT_BOOK_COUNT: number  = BOOKS_PER_GALLERY * GALLERIES_PER_SEGMENT; // 1920

/** True when a position falls on a rest area (kiosk, beds, stairs). */
export function isRestArea(position: number): boolean {
    return ((position % GALLERIES_PER_SEGMENT) + GALLERIES_PER_SEGMENT) % GALLERIES_PER_SEGMENT === 0;
}

export const DIRS: Record<string, Direction> = {
    LEFT:  "left",
    RIGHT: "right",
    UP:    "up",
    DOWN:  "down",
    CROSS: "cross",
};

/** Canonical string key for a location. */
export function locationKey({ side, position, floor }: Location): string {
    return `${side}:${position}:${floor}`;
}

/**
 * Generate a segment deterministically from its coordinates.
 *
 * @param {number} side
 * @param {number} position
 * @param {number} floor
 * @param {function} forkRng - (key: string) => rng instance
 * @returns {object} segment descriptor
 */
export function generateSegment(side: number, position: number, floor: number, forkRng: (key: string) => Rng): Segment {
    const rng = forkRng("seg:" + locationKey({ side, position, floor }));

    const lightLevel: "dim" | "normal" = rng.next() < 0.05 ? "dim" : "normal";

    // Rest area only at gallery boundaries (position % GALLERIES_PER_SEGMENT === 0)
    const atRestArea = isRestArea(position);
    const restArea: RestArea | null = atRestArea ? {
        hasStairs: true,
        hasKiosk: true,
        bedsAvailable: 7,
        hasZoroastrianText: position === 0,
    } : null;

    // Bridge only at floor 0 rest areas
    const hasBridge = floor === BOTTOM_FLOOR && atRestArea;

    return {
        side,
        position,
        floor,
        lightLevel,
        restArea,
        hasBridge,
        bookCount: BOOKS_PER_GALLERY,
    };
}

/** Returns available moves from a given location. */
export function availableMoves({ side, position, floor }: Location): Direction[] {
    const moves: Direction[] = [];

    moves.push(DIRS.LEFT);
    moves.push(DIRS.RIGHT);

    // stairs/bridge only accessible from rest areas
    if (isRestArea(position)) {
        if (floor > BOTTOM_FLOOR) moves.push(DIRS.DOWN);
        moves.push(DIRS.UP);
        if (floor === BOTTOM_FLOOR) moves.push(DIRS.CROSS);
    }

    return moves;
}

/** Apply a move to a location, returning new coordinates. */
export function applyMove({ side, position, floor }: Location, dir: Direction): Location {
    switch (dir) {
        case DIRS.LEFT:  return { side, position: position - 1, floor };
        case DIRS.RIGHT: return { side, position: position + 1, floor };
        case DIRS.UP:
            if (!isRestArea(position)) throw new Error("Stairs only accessible from rest areas");
            return { side, position, floor: floor + 1 };
        case DIRS.DOWN:
            if (floor <= BOTTOM_FLOOR) throw new Error("Cannot descend below floor 0");
            if (!isRestArea(position)) throw new Error("Stairs only accessible from rest areas");
            return { side, position, floor: floor - 1 };
        case DIRS.CROSS:
            if (floor !== BOTTOM_FLOOR) throw new Error("Can only cross at the bottom floor");
            if (!isRestArea(position)) throw new Error("Bridge only accessible from rest areas");
            return { side: side === 0 ? 1 : 0, position, floor };
        default:
            throw new Error(`Unknown direction: ${dir}`);
    }
}

/** Human-readable description of a location. */
export function describeLocation({ side, position, floor }: Location): string {
    const sideLabel = side === 0 ? "west" : "east";
    return `${sideLabel} corridor, segment ${position}, floor ${floor}`;
}
