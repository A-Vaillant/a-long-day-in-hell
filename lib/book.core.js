/** Book content generation.
 *
 * Each book is identified by (side, position, floor, bookIndex).
 * Content is deterministic: same coordinates + global seed → same book.
 *
 * Physical properties (from the source text):
 *   11 pages × 40 lines × 80 characters = 35,200 characters per book.
 *   Character set: ~95 printable ASCII keyboard characters.
 *
 * Generating all 1.3M characters at once is ~1.3MB of string work per book.
 * Use generateBookPage() for lazy/streaming access.
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
 * @param {number} pageIndex   - 0-based page number (0–409)
 * @param {string} globalSeed  - the game's root seed string
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
 * The spine/cover looks identical for all books; this supplies the index for
 * display and future proximity-signal logic.
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

/**
 * Scan a page for the longest coherent-looking run: sequences of printable
 * words separated by spaces (heuristic: only [a-zA-Z ,.'!?-] for 4+ chars).
 * Returns null if nothing meaningful found.
 *
 * Used by the proximity-signal system to surface fragments near the player's book.
 *
 * @param {string} pageText
 * @returns {string|null}
 */
export function findCoherentFragment(pageText) {
    const match = pageText.match(/[a-zA-Z ,.'!?\-]{4,}/g);
    if (!match) return null;
    // Return longest match
    return match.reduce((best, s) => s.length > best.length ? s : best, "");
}

/**
 * English bigram frequency table (log-probability weights).
 * Top 40 bigrams from large English corpora, normalized so the max weight = 1.0.
 * Lowercase only — input is downcased before scoring.
 */
const BIGRAM_WEIGHTS = {
    "th":1.00,"he":0.95,"in":0.88,"er":0.84,"an":0.82,
    "re":0.78,"on":0.75,"nd":0.72,"en":0.70,"at":0.68,
    "ou":0.65,"ed":0.63,"ha":0.61,"to":0.60,"or":0.58,
    "it":0.56,"is":0.55,"hi":0.53,"es":0.52,"ng":0.51,
    "st":0.49,"al":0.47,"te":0.46,"ar":0.44,"nt":0.43,
    "se":0.41,"co":0.40,"de":0.38,"ra":0.37,"ti":0.36,
    "ne":0.34,"ri":0.33,"li":0.32,"io":0.31,"le":0.30,
    "ve":0.29,"me":0.28,"no":0.27,"ta":0.26,"ea":0.25,
};

/**
 * Score a page's "sensibility" — how much it resembles English text.
 * Returns a float in [0, 1]. Pure random 95-charset text scores ~0.01–0.03.
 * Coherent English prose scores ~0.4–0.7. The target book scores high.
 *
 * Method: sum bigram weights for every consecutive lowercase letter pair,
 * divided by the number of letter pairs examined. Non-letter characters
 * are skipped (they break bigram chains but don't penalize).
 *
 * @param {string} pageText
 * @returns {number}
 */
export function scoreSensibility(pageText) {
    const text = pageText.toLowerCase();
    let score = 0;
    let pairs = 0;
    let prevLetter = "";

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch >= "a" && ch <= "z") {
            if (prevLetter) {
                pairs++;
                const bigram = prevLetter + ch;
                const w = BIGRAM_WEIGHTS[bigram];
                if (w !== undefined) score += w;
            }
            prevLetter = ch;
        } else {
            prevLetter = "";
        }
    }

    if (pairs === 0) return 0;
    return score / pairs;
}

/* ---- Dwell-time reading: morale effects from lingering on pages ---- */

/** Sensibility threshold: pages above this contain enough structure to reward. */
export const SENSIBILITY_THRESHOLD = 0.12;

/** Dwell time in ms before a page triggers its morale effect. */
export const DWELL_MS = 2000;

/** Base morale restored when dwelling on a sensible page. */
const DWELL_REWARD_BASE = 3;

/** Base morale penalty for dwelling on a nonsense page. */
const DWELL_PENALTY_BASE = 2;

/**
 * Compute morale delta from dwelling on a page.
 *
 * Sensible pages (score >= threshold) give a flat morale boost.
 * Nonsense pages (score < threshold) drain morale with diminishing returns:
 *   penalty = basePenalty / (1 + nonsensePagesRead)
 * So the first nonsense page hurts most, later ones fade toward zero.
 *
 * @param {number} sensibility - scoreSensibility() result for the page
 * @param {number} nonsensePagesRead - how many nonsense pages already dwelled on this session
 * @returns {{ delta: number, isNonsense: boolean }}
 */
export function dwellMoraleDelta(sensibility, nonsensePagesRead) {
    if (sensibility >= SENSIBILITY_THRESHOLD) {
        return { delta: DWELL_REWARD_BASE, isNonsense: false };
    }
    const penalty = DWELL_PENALTY_BASE / (1 + nonsensePagesRead);
    return { delta: -penalty, isNonsense: true };
}
