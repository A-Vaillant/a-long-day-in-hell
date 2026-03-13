/** Physical scale constants derived from the source material.
 *
 * All geometry and time constants for the library originate here.
 * Other modules (tick, library, screens) import from this file
 * rather than defining their own magic numbers.
 *
 * Source: "A Short Stay in Hell" appendix + in-text descriptions.
 *
 * Physical layout per the book:
 *   - Book spine thickness: 1.5 inches
 *   - Shelf height: 1.5 feet (8 shelves fit in a ~12ft ceiling)
 *   - Shelf length: 200 feet per section
 *   - Rest area (kiosk): clock, kiosk, 7-bed bedroom, bathroom,
 *     submission slot, stairs — roughly 100 ft of corridor
 *   - Distance between rest areas: ~300 yards (900 ft)
 *   - Character set: 95 printable ASCII
 *   - Book: 410 pages × 40 lines × 80 chars = 1,312,000 characters
 *   - Total books: 95^1,312,000
 *   - Library width: ~7.16^1,297,369 light-years (two corridors)
 *
 * @module scale.core
 */

// ---- Book dimensions ----

/** Printable ASCII characters (space through tilde). */
export const CHARSET_SIZE: number = 95;

export const PAGES_PER_BOOK: number = 410;
export const LINES_PER_PAGE: number = 40;
export const CHARS_PER_LINE: number = 80;

/** Total characters in one book. */
export const CHARS_PER_BOOK: number = PAGES_PER_BOOK * LINES_PER_PAGE * CHARS_PER_LINE; // 1,312,000

// ---- Physical shelf geometry ----

/** Book spine thickness in inches. */
export const BOOK_SPINE_INCHES: number = 1.5;

/** Total shelf length in feet between two kiosks (from the book). */
export const SHELF_LENGTH_FT: number = 200;

/** Shelves stacked vertically per wall. */
export const SHELVES_PER_WALL: number = 8;

/** Shelf height in feet (floor-to-floor per shelf). */
export const SHELF_HEIGHT_FT: number = 1.5;

/** Columns of books visible per gallery (one screen-width). */
export const BOOKS_PER_SHELF_ROW: number = 25;

/**
 * Books per gallery (one traversable position = one screen of books).
 * 25 columns × 8 shelves = 200 books.
 */
export const BOOKS_PER_GALLERY: number = BOOKS_PER_SHELF_ROW * SHELVES_PER_WALL; // 200

/** Shelving galleries (non-kiosk) per segment. */
export const SHELVING_PER_SEGMENT: number = 16;

// ---- Segment geometry (kiosk to kiosk) ----

/** Approximate distance between rest areas in yards (from the book). */
export const KIOSK_SPACING_YARDS: number = 300;

/**
 * Positions per segment: K + 16 shelving galleries = 17 positions from
 * one kiosk to the next. Position 0 (mod 17) is a rest area (kiosk);
 * positions 1–16 are shelving galleries.
 *
 * 16 galleries × 200 books + kiosk = ~300 yards of corridor.
 */
export const GALLERIES_PER_SEGMENT: number = SHELVING_PER_SEGMENT + 1; // 17

/** Total books between two kiosks (16 shelving galleries × 200). */
export const BOOKS_PER_SEGMENT: number = SHELVING_PER_SEGMENT * BOOKS_PER_GALLERY; // 3,200

// ---- Time ----

/**
 * Ticks per hour. 1 tick = 1 minute.
 *
 * Each gallery is a few paces of shelf. At browsing pace, 1 minute
 * per gallery. Movement mode may traverse multiple galleries per tick.
 */
export const TICKS_PER_HOUR: number = 60;

export const HOURS_PER_DAY: number = 24;

/** Ticks in a full calendar day (6am to 6am). */
export const TICKS_PER_DAY: number = TICKS_PER_HOUR * HOURS_PER_DAY; // 1440

/** Hour the day starts (lights come on, resurrection). */
export const DAY_START_HOUR: number = 6;

/** Hour lights go out. */
export const LIGHTS_OFF_HOUR: number = 22;

/** Ticks of waking daylight (6am–10pm = 16 hours). */
export const WAKING_TICKS: number = (LIGHTS_OFF_HOUR - DAY_START_HOUR) * TICKS_PER_HOUR; // 960

/** Tick at which the reset hour begins (5am = 23 hours after day start). */
export const RESET_HOUR_TICK: number = TICKS_PER_DAY - TICKS_PER_HOUR; // 1380

// ---- Rate conversion ----
// Define rates in real-time units (per-minute, per-hour, per-day),
// convert to per-tick at system boundaries. Changing tick resolution
// (TICKS_PER_HOUR) requires no retuning.

/** Convert a per-day rate to a per-tick rate. */
export function perDay(rate: number): number {
    return rate / TICKS_PER_DAY;
}

/** Convert a per-hour rate to a per-tick rate. */
export function perHour(rate: number): number {
    return rate / TICKS_PER_HOUR;
}

/** Convert a per-minute rate to a per-tick rate. (Identity at 1 tick/min.) */
export function perMinute(rate: number): number {
    return rate / (TICKS_PER_HOUR / 60);
}

/** Convert a duration in hours to ticks. */
export function hours(h: number): number {
    return Math.round(h * TICKS_PER_HOUR);
}

/** Convert a duration in minutes to ticks. */
export function minutes(m: number): number {
    return Math.round(m * TICKS_PER_HOUR / 60);
}

/** Convert a duration in days to ticks. */
export function days(d: number): number {
    return Math.round(d * TICKS_PER_DAY);
}

// ---- Library address space ----

/** Number of addressable floors for book placement. Movement is unbounded. */
export const FLOORS: number = 100_000;

/** Maximum position index (total segments, ±half from origin). */
export const MAX_BOOK_POSITION: bigint = 10_000_000_000n; // ±5B segments

/** Minimum floor for player book placement. */
export const BOOK_FLOOR_MIN: bigint = 2000n;

/** Maximum floor for player book placement. */
export const BOOK_FLOOR_MAX: bigint = 95000n;

// ---- Movement ----

/**
 * Base positions traversed per tick at walking pace.
 * Modified by quickness and movement mode (walk/run/sprint).
 */
export const BASE_SPEED: number = 1;

/** Segments (kiosk-to-kiosk) a walker covers in one waking day. */
export const SEGMENTS_PER_WAKING_DAY: number = Math.floor(WAKING_TICKS / GALLERIES_PER_SEGMENT);

/**
 * Positions a walker covers in one waking day (at base speed).
 */
export const POSITIONS_PER_WAKING_DAY: number = WAKING_TICKS * BASE_SPEED; // 960

// ---- Distance formatting ----

/**
 * Convert a distance in positions to a human-readable time string.
 * Assumes base walking speed (1 position/tick).
 *
 * @param positions - distance in gallery positions
 * @returns e.g. "3 segments", "14 days' walk", "2,500 years of walking"
 */
export function distanceToHumanTime(positions: bigint): string {
    const segments = positions / BigInt(GALLERIES_PER_SEGMENT);
    const days = positions / BigInt(POSITIONS_PER_WAKING_DAY);

    if (segments < 2n) {
        return commas(positions) + " position" + (positions === 1n ? "" : "s");
    } else if (days < 2n) {
        return commas(segments) + " segment" + (segments === 1n ? "" : "s");
    } else if (days < 365n) {
        return commas(days) + " days' walk";
    } else {
        const years = days / 365n;
        return commas(years) + " year" + (years === 1n ? "" : "s") + " of walking";
    }
}

/** Format a bigint with comma separators. */
function commas(n: bigint): string {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
