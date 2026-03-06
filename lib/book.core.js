/** Book content generation — word-based degraded stories.
 *
 * Each book is identified by (side, position, floor, bookIndex).
 * Content is deterministic: same coordinates + global seed → same book.
 *
 * Each page selects a story from the corpus, then degrades it by replacing
 * words with dictionary words. The edit level follows an exponential
 * distribution: most pages are word soup, a few are nearly intact.
 *
 * @module book.core
 */

import { seedFromString } from "./prng.core.js";

export const PAGES_PER_BOOK = 11;

/** Dwell time in ms before a page triggers its morale effect. */
export const DWELL_MS = 1000;

/* ---- Tokenization ---- */

/**
 * Tokenize text into word tokens, preserving punctuation attachment.
 * @param {string} text
 * @returns {Array<{ leading: string, word: string, trailing: string }>}
 */
export function tokenize(text) {
    const raw = text.split(/\s+/).filter(s => s.length > 0);
    return raw.map(chunk => {
        const m = chunk.match(/^([^a-zA-Z0-9]*)([a-zA-Z0-9](?:.*[a-zA-Z0-9])?)([^a-zA-Z0-9]*)$/);
        if (!m) {
            // Pure punctuation
            return { leading: "", word: chunk, trailing: "" };
        }
        return { leading: m[1], word: m[2], trailing: m[3] };
    });
}

/**
 * Detokenize tokens back into a string.
 * @param {Array<{ leading: string, word: string, trailing: string }>} tokens
 * @returns {string}
 */
export function detokenize(tokens) {
    return tokens.map(t => t.leading + t.word + t.trailing).join(" ");
}

/**
 * Apply capitalization pattern from original word to replacement.
 * - All caps → all caps
 * - First letter cap → first letter cap
 * - Otherwise → lowercase
 */
function applyCapitalization(original, replacement) {
    if (original.length === 0) return replacement;
    const allCaps = original === original.toUpperCase() && original !== original.toLowerCase();
    if (allCaps) return replacement.toUpperCase();
    if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
        return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
}

/* ---- Edit level distribution ---- */

/**
 * Pick an edit level using exponential distribution.
 * Most pages land at level 7-10 (word soup). Level 0-3 are rare (~2%).
 * Returns a float in [0, 1] representing replace probability.
 *
 * @param {object} rng
 * @returns {number} replaceProbability in [0, 1]
 */
function pickReplaceProbability(rng) {
    // Exponential sample biased toward high replacement
    // u in (0,1), -ln(u) is exponential(1), scale and clamp
    let u;
    do { u = rng.next(); } while (u === 0);
    const raw = -Math.log(u) * 0.3; // scale so most values < 1
    const level = Math.min(raw, 1.0); // clamp to [0, 1]
    // Invert: high raw → LOW replace probability (rare intact pages)
    // low raw → HIGH replace probability (common word soup)
    return 1.0 - level;
}

/* ---- Core generation ---- */

/**
 * Generate a single page of a book as degraded story text.
 *
 * @param {number} side
 * @param {number} position
 * @param {number} floor
 * @param {number} bookIndex
 * @param {number} pageIndex
 * @param {string} globalSeed
 * @param {Array<{ id: number, text: string }>} stories
 * @param {string[]} dictionary
 * @returns {{ text: string, storyId: number, editDistance: number }}
 */
export function generateBookPage(side, position, floor, bookIndex, pageIndex, globalSeed, stories, dictionary) {
    const rng = seedFromString(`${globalSeed}:book:${side}:${position}:${floor}:${bookIndex}:p${pageIndex}`);

    const storyId = rng.nextInt(stories.length);
    const story = stories[storyId];
    const tokens = tokenize(story.text);

    const replaceProbability = pickReplaceProbability(rng);

    let editDistance = 0;
    const degraded = tokens.map(t => {
        if (rng.next() < replaceProbability) {
            editDistance++;
            const replacement = dictionary[rng.nextInt(dictionary.length)];
            return {
                leading: t.leading,
                word: applyCapitalization(t.word, replacement),
                trailing: t.trailing,
            };
        }
        return t;
    });

    return {
        text: detokenize(degraded),
        storyId,
        editDistance,
    };
}

/**
 * Generate metadata for a book (deterministic, cheap).
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

/* ---- Fragment detection ---- */

/**
 * Find runs of 3+ consecutive original words in degraded text.
 * Compares word-by-word (ignoring punctuation/case).
 *
 * @param {Array<{ leading: string, word: string, trailing: string }>} degradedTokens
 * @param {Array<{ leading: string, word: string, trailing: string }>} originalTokens
 * @returns {Array<{ start: number, end: number, text: string }>}
 */
export function findOriginalFragments(degradedTokens, originalTokens) {
    const fragments = [];
    let runStart = -1;

    for (let i = 0; i < Math.min(degradedTokens.length, originalTokens.length); i++) {
        const match = degradedTokens[i].word.toLowerCase() === originalTokens[i].word.toLowerCase();
        if (match) {
            if (runStart === -1) runStart = i;
        } else {
            if (runStart !== -1 && i - runStart >= 3) {
                const slice = degradedTokens.slice(runStart, i);
                fragments.push({
                    start: runStart,
                    end: i,
                    text: detokenize(slice),
                });
            }
            runStart = -1;
        }
    }

    // Handle run at end
    const len = Math.min(degradedTokens.length, originalTokens.length);
    if (runStart !== -1 && len - runStart >= 3) {
        const slice = degradedTokens.slice(runStart, len);
        fragments.push({
            start: runStart,
            end: len,
            text: detokenize(slice),
        });
    }

    return fragments;
}

/* ---- Dwell-time reading: morale effects ---- */

/** Base morale restored when dwelling on a low-edit-distance page. */
const DWELL_REWARD_BASE = 3;

/** Base morale penalty for dwelling on a high-edit-distance page. */
const DWELL_PENALTY_BASE = 2;

/**
 * Edit distance threshold (as fraction of total words).
 * Pages with edit fraction below this reward morale.
 */
export const EDIT_THRESHOLD = 0.3;

/**
 * Compute morale delta from dwelling on a page.
 *
 * Low edit distance (< 30% words replaced) → morale boost.
 * High edit distance (>= 30%) → morale drain with diminishing returns.
 *
 * @param {number} editDistance - number of words replaced
 * @param {number} totalWords - total word count in the story
 * @param {number} nonsensePagesRead - how many nonsense pages dwelled on
 * @returns {{ delta: number, isNonsense: boolean }}
 */
export function dwellMoraleDelta(editDistance, totalWords, nonsensePagesRead) {
    const editFraction = totalWords > 0 ? editDistance / totalWords : 1;
    if (editFraction < EDIT_THRESHOLD) {
        return { delta: DWELL_REWARD_BASE, isNonsense: false };
    }
    const penalty = DWELL_PENALTY_BASE / (1 + nonsensePagesRead);
    return { delta: -penalty, isNonsense: true };
}
