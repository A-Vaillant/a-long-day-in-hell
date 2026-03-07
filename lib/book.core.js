/** Book content generation — random printable ASCII.
 *
 * Each book is identified by (side, position, floor, bookIndex).
 * Content is deterministic: same coordinates + global seed → same book.
 *
 * Physical properties (from the source text):
 *   11 pages × 40 lines × 80 characters = 35,200 characters per book.
 *   Character set: ~95 printable ASCII keyboard characters.
 *
 * "Most books are just a random collection of symbols."
 *
 * Collision resistance: page RNGs are seeded directly from a rich string
 * (globalSeed + full coordinates), producing four independent 32-bit hashes.
 * This gives 2^128 effective key space — no birthday-paradox risk.
 *
 * @module book.core
 */

import { seedFromString } from "./prng.core.js";

export const PAGES_PER_BOOK  = 11;
export const LINES_PER_PAGE  = 40;
export const CHARS_PER_LINE  = 80;
export const CHARS_PER_PAGE  = LINES_PER_PAGE * CHARS_PER_LINE; // 3200
export const CHARS_PER_BOOK  = PAGES_PER_BOOK * CHARS_PER_PAGE; // 35,200

/**
 * The 95-character printable ASCII set (codepoints 32–126).
 * This matches what the book describes as "about 95 possible characters
 * on a standard keyboard."
 */
export const CHARSET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join("");

/**
 * Generate a single page of a book as a string of CHARS_PER_PAGE characters.
 * Lines are separated by '\n' so the result is 40 lines of 80 chars each.
 *
 * @param {number} side
 * @param {number} position
 * @param {number} floor
 * @param {number} bookIndex  - 0-based index within the segment
 * @param {number} pageIndex  - 0-based page number (0–10)
 * @param {string} globalSeed - the game's root seed string
 * @returns {string}
 */
export function generateBookPage(side, position, floor, bookIndex, pageIndex, globalSeed) {
    const rng = seedFromString(`${globalSeed}:book:${side}:${position}:${floor}:${bookIndex}:p${pageIndex}`);
    const n = CHARSET.length;
    const lines = [];
    for (let l = 0; l < LINES_PER_PAGE; l++) {
        let line = "";
        for (let c = 0; c < CHARS_PER_LINE; c++) {
            line += CHARSET[rng.nextInt(n)];
        }
        lines.push(line);
    }
    return lines.join("\n");
}

/**
 * Generate metadata for a book (deterministic, cheap — no character generation).
 *
 * @param {number} side
 * @param {number} position
 * @param {number} floor
 * @param {number} bookIndex
 * @returns {{ side, position, floor, bookIndex }}
 */
export function bookMeta(side, position, floor, bookIndex) {
    return { side, position, floor, bookIndex };
}
