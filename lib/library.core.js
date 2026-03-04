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

export const BOTTOM_FLOOR = 0;
export const REST_AREA_INTERVAL = 1; // every segment boundary has a rest area
export const SEGMENT_BOOK_COUNT = 640; // ~300 yards, 32 books/shelf, 20 shelves

export const DIRS = {
    LEFT:  "left",
    RIGHT: "right",
    UP:    "up",
    DOWN:  "down",
    CROSS: "cross",
};

/** Canonical string key for a location. */
export function locationKey({ side, position, floor }) {
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
export function generateSegment(side, position, floor, forkRng) {
    const rng = forkRng("seg:" + locationKey({ side, position, floor }));

    // Lighting: occasionally a section has flickering or dim lights
    const lightLevel = rng.next() < 0.05 ? "dim" : "normal";

    // The rest area at the right boundary of this segment
    const restArea = {
        hasSubmissionSlot: true,   // always present per the book
        hasStairs: true,           // always present per the book
        hasKiosk: true,            // always present per the book
        bedsAvailable: 7,          // always 7 per the book
        // A Zoroastrian text is guaranteed on every floor (per the book's rules)
        hasZoroastrianText: position === 0, // place it at position 0 each floor
    };

    // Is there a bridge to the other side? Only at floor 0, at every rest area.
    const hasBridge = floor === BOTTOM_FLOOR;

    return {
        side,
        position,
        floor,
        lightLevel,
        restArea,
        hasBridge,
        bookCount: SEGMENT_BOOK_COUNT,
    };
}

/** Returns available moves from a given location. */
export function availableMoves({ side, position, floor }) {
    const moves = [];

    // left/right always available (library is unbounded in both directions)
    // position 0 is not a wall — the library extends infinitely left too
    moves.push(DIRS.LEFT);
    moves.push(DIRS.RIGHT);

    // up/down only at rest area (right edge) — we treat every segment as having
    // a rest area at its right boundary, so up/down always available
    if (floor > BOTTOM_FLOOR) moves.push(DIRS.DOWN);
    moves.push(DIRS.UP);

    // cross only at bottom floor
    if (floor === BOTTOM_FLOOR) moves.push(DIRS.CROSS);

    return moves;
}

/** Apply a move to a location, returning new coordinates. */
export function applyMove({ side, position, floor }, dir) {
    switch (dir) {
        case DIRS.LEFT:  return { side, position: position - 1, floor };
        case DIRS.RIGHT: return { side, position: position + 1, floor };
        case DIRS.UP:    return { side, position, floor: floor + 1 };
        case DIRS.DOWN:
            if (floor <= BOTTOM_FLOOR) throw new Error("Cannot descend below floor 0");
            return { side, position, floor: floor - 1 };
        case DIRS.CROSS:
            if (floor !== BOTTOM_FLOOR) throw new Error("Can only cross at the bottom floor");
            return { side: side === 0 ? 1 : 0, position, floor };
        default:
            throw new Error(`Unknown direction: ${dir}`);
    }
}

/** Human-readable description of a location. */
export function describeLocation({ side, position, floor }) {
    const sideLabel = side === 0 ? "west" : "east";
    return `${sideLabel} corridor, segment ${position}, floor ${floor}`;
}
