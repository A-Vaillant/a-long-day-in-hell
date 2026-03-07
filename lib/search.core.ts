/**
 * NPC book searching — browsing shelves for legible text.
 *
 * Reads intent from the INTENT component. Only acts when
 * intent.behavior === "search". The intent arbiter decides
 * when to search; this system executes it.
 *
 * Each tick an active searcher examines one book (samples a page),
 * scores it for legibility via bigram frequency analysis, and gets
 * a hope boost proportional to how readable it is.
 *
 * Multiple NPCs at the same position claim non-overlapping book
 * indices so they don't redundantly check the same books.
 *
 * @module search.core
 */

import type { Entity, World } from "./ecs.core.ts";
import { getComponent, query } from "./ecs.core.ts";
import { seedFromString } from "./prng.core.ts";
import { CHARSET } from "./book.core.ts";
import {
    POSITION, IDENTITY, PSYCHOLOGY,
    type Position, type Identity, type Psychology,
} from "./social.core.ts";
import { PERSONALITY, type Personality } from "./personality.core.ts";
import { INTENT, type Intent } from "./intent.core.ts";
import { BOOKS_PER_GALLERY } from "./library.core.ts";

// --- Bigram scoring ---

/**
 * Top English bigrams with approximate relative frequencies.
 * Frequencies normalized so the max is ~1.0.
 */
const BIGRAMS: Record<string, number> = {
    th: 1.00, he: 0.87, in: 0.72, er: 0.69, an: 0.65,
    re: 0.57, on: 0.53, at: 0.50, en: 0.49, nd: 0.48,
    ti: 0.47, es: 0.46, or: 0.44, te: 0.43, of: 0.42,
    ed: 0.41, is: 0.40, it: 0.39, al: 0.38, ar: 0.37,
    st: 0.36, to: 0.35, nt: 0.34, ng: 0.33, se: 0.32,
    ha: 0.31, as: 0.30, ou: 0.29, io: 0.28, le: 0.27,
    ve: 0.26, co: 0.25, me: 0.24, de: 0.23, hi: 0.22,
    ri: 0.21, ro: 0.20, ic: 0.19, ne: 0.18, ea: 0.17,
    ra: 0.16, ce: 0.15, li: 0.14, ch: 0.13, ll: 0.12,
    be: 0.11, ma: 0.10, si: 0.09, om: 0.08, ur: 0.07,
};

/**
 * Score a text sample for English legibility using bigram frequency.
 * Returns 0.0 (pure noise) to ~1.0 (natural English prose).
 *
 * Random 95-char ASCII scores ~0.01–0.02.
 * English prose scores ~0.35–0.55.
 *
 * Samples up to `sampleLen` characters from the start of text.
 */
export function scoreBigram(text: string, sampleLen: number = 400): number {
    const sample = text.substring(0, sampleLen).toLowerCase();
    if (sample.length < 2) return 0;

    let score = 0;
    let pairs = 0;

    for (let i = 0; i < sample.length - 1; i++) {
        const a = sample[i];
        const b = sample[i + 1];
        if (a >= 'a' && a <= 'z' && b >= 'a' && b <= 'z') {
            const bigram = a + b;
            score += BIGRAMS[bigram] || 0;
            pairs++;
        }
    }

    if (pairs === 0) return 0;
    return score / pairs;
}

// --- Fast PRNG-direct scoring (no string allocation) ---

/** Map charset index → lowercase letter index (0–25), or -1 if not a letter. */
const CHARSET_TO_LOWER: Int8Array = new Int8Array(95);
for (let i = 0; i < 95; i++) {
    const code = i + 32;  // printable ASCII starts at 32
    if (code >= 65 && code <= 90) CHARSET_TO_LOWER[i] = code - 65;       // A-Z
    else if (code >= 97 && code <= 122) CHARSET_TO_LOWER[i] = code - 97;  // a-z
    else CHARSET_TO_LOWER[i] = -1;
}

/** 26×26 bigram lookup: BIGRAM_TABLE[a*26 + b] = frequency. */
const BIGRAM_TABLE = new Float32Array(26 * 26);
for (const [bg, freq] of Object.entries(BIGRAMS)) {
    const a = bg.charCodeAt(0) - 97;
    const b = bg.charCodeAt(1) - 97;
    if (a >= 0 && a < 26 && b >= 0 && b < 26) {
        BIGRAM_TABLE[a * 26 + b] = freq;
    }
}

/**
 * Score a book page for legibility directly from PRNG, without generating text.
 * Produces identical scores to scoreBigram(generateBookPage(...), 400) but
 * avoids all string allocation. ~10x faster for NPC search.
 */
/**
 * Score a book page for legibility directly from PRNG, without generating text.
 * Produces identical scores to scoreBigram(generateBookPage(...), sampleLen) but
 * avoids all string allocation.
 */
export function scoreFromSeed(
    globalSeed: string,
    side: number, position: number, floor: number,
    bookIndex: number, pageIndex: number,
    sampleLen: number = 400,
): number {
    const rng = seedFromString(`${globalSeed}:book:${side}:${position}:${floor}:${bookIndex}:p${pageIndex}`);
    const n = CHARSET.length;

    // Mirror generateBookPage: generates lines of 80 chars, joined with \n.
    // scoreBigram(text, sampleLen) takes first sampleLen chars of that joined string.
    // Newlines break bigram pairs (not a letter → reset prevLetter).
    let score = 0;
    let pairs = 0;
    let prevLetter = -1;
    let outputPos = 0;
    let lineCol = 0;

    while (outputPos < sampleLen) {
        if (lineCol < 80) {
            const charIdx = rng.nextInt(n);
            const letter = CHARSET_TO_LOWER[charIdx];
            if (letter >= 0 && prevLetter >= 0) {
                score += BIGRAM_TABLE[prevLetter * 26 + letter];
                pairs++;
            }
            prevLetter = letter;
            lineCol++;
            outputPos++;
        } else {
            prevLetter = -1;
            lineCol = 0;
            outputPos++;
        }
    }

    if (pairs === 0) return 0;
    return score / pairs;
}


// --- ECS Component ---

export const SEARCHING = "searching";

export interface Searching {
    /** Current book index being examined (0–191 within gallery). */
    bookIndex: number;
    /** Ticks spent searching at current position. */
    ticksSearched: number;
    /** Max ticks before patience runs out. */
    patience: number;
    /** Whether actively searching (managed by this system based on intent). */
    active: boolean;
    /** Best legibility score found this search session. */
    bestScore: number;
}

// --- Config ---

export interface SearchConfig {
    /** Bonus patience per unit of openness (0–1). */
    opennessPatienceBonus: number;
    /** Bonus patience per unit of patience (1 - pace). */
    pacePatienceBonus: number;
    /** Base patience in ticks. */
    basePatienceTicks: number;
    /** Hope boost per unit of legibility score. */
    hopePerLegibility: number;
    /** Legibility threshold below which nothing registers. */
    legibilityFloor: number;
    /** Max hope boost per single book find. */
    maxHopeBoost: number;
}

export const DEFAULT_SEARCH: SearchConfig = {
    basePatienceTicks: 8,
    opennessPatienceBonus: 10,
    pacePatienceBonus: 6,
    hopePerLegibility: 40,
    legibilityFloor: 0.10,
    maxHopeBoost: 8,
};

// --- Helpers ---

interface Rng {
    next(): number;
    nextInt(n: number): number;
}

/**
 * Compute patience from personality traits.
 */
export function computePatience(
    personality: Personality | null,
    config: SearchConfig = DEFAULT_SEARCH,
): number {
    if (!personality) return config.basePatienceTicks;
    const paceBonus = (1 - personality.pace) * config.pacePatienceBonus;
    const openBonus = personality.openness * config.opennessPatienceBonus;
    return Math.max(3, Math.min(30, Math.round(config.basePatienceTicks + paceBonus + openBonus)));
}

/**
 * Claim a non-overlapping book index for an NPC at a position.
 * Returns -1 if all books in the gallery are claimed.
 */
export function claimBookIndex(
    claimed: Set<number>,
    rng: Rng,
): number {
    if (claimed.size >= BOOKS_PER_GALLERY) return -1;
    const start = rng.nextInt(BOOKS_PER_GALLERY);
    for (let i = 0; i < BOOKS_PER_GALLERY; i++) {
        const idx = (start + i) % BOOKS_PER_GALLERY;
        if (!claimed.has(idx)) {
            claimed.add(idx);
            return idx;
        }
    }
    return -1;
}

export type PageSampler = (
    side: number, position: number, floor: number,
    bookIndex: number, pageIndex: number,
) => string;

/** Fast scorer that bypasses page generation — returns legibility score directly. */
export type ScoreFn = (
    side: number, position: number, floor: number,
    bookIndex: number, pageIndex: number,
) => number;

// --- System ---

/**
 * Run one tick of NPC book searching.
 *
 * Only acts on entities whose INTENT behavior is "search".
 * When intent switches to search, this system activates the SEARCHING
 * component. When intent switches away, searching deactivates.
 *
 * Flow per entity with search intent:
 * 1. If not yet active: initialize (claim book, set patience).
 * 2. Sample current book's first page, score bigrams.
 * 3. If legible: hope boost, record bestScore, emit event.
 * 4. Advance to next unclaimed book or exhaust patience.
 *
 * When `scoreFn` is provided, it bypasses samplePage + scoreBigram
 * for a ~10x speedup (no string allocation).
 */
export function searchSystem(
    world: World,
    rng: Rng,
    samplePage: PageSampler,
    config: SearchConfig = DEFAULT_SEARCH,
    scoreFn?: ScoreFn,
): SearchEvent[] {
    const events: SearchEvent[] = [];

    // Build per-position claimed sets from all active searchers
    const claimedByPos = new Map<string, Set<number>>();

    const entities = query(world, [SEARCHING, POSITION, IDENTITY, PSYCHOLOGY]);

    // First pass: register already-active searchers' claimed books
    for (const tuple of entities) {
        const search = tuple[1] as Searching;
        const pos = tuple[2] as Position;
        if (!search.active) continue;
        const key = `${pos.side}:${pos.position}:${pos.floor}`;
        if (!claimedByPos.has(key)) claimedByPos.set(key, new Set());
        claimedByPos.get(key)!.add(search.bookIndex);
    }

    // Second pass: tick each searcher
    for (const tuple of entities) {
        const entity = tuple[0] as Entity;
        const search = tuple[1] as Searching;
        const pos = tuple[2] as Position;
        const ident = tuple[3] as Identity;
        const psych = tuple[4] as Psychology;

        // Read intent
        const intent = getComponent<Intent>(world, entity, INTENT);
        const wantsSearch = intent && intent.behavior === "search";

        // Deactivate if intent changed away from search
        if (!wantsSearch) {
            if (search.active) {
                const posKey = `${pos.side}:${pos.position}:${pos.floor}`;
                const claimed = claimedByPos.get(posKey);
                if (claimed) claimed.delete(search.bookIndex);
                search.active = false;
            }
            continue;
        }

        if (!ident.alive) { search.active = false; continue; }

        const posKey = `${pos.side}:${pos.position}:${pos.floor}`;
        if (!claimedByPos.has(posKey)) claimedByPos.set(posKey, new Set());
        const claimed = claimedByPos.get(posKey)!;

        // Start searching (intent says search, but not yet active)
        if (!search.active) {
            const personality = getComponent<Personality>(world, entity, PERSONALITY);
            search.patience = computePatience(personality, config);
            search.ticksSearched = 0;
            search.bestScore = 0;
            const idx = claimBookIndex(claimed, rng);
            if (idx === -1) continue;
            search.bookIndex = idx;
            search.active = true;
        }

        // Score the book (fast path skips string allocation)
        const score = scoreFn
            ? scoreFn(pos.side, pos.position, pos.floor, search.bookIndex, 0)
            : scoreBigram(samplePage(pos.side, pos.position, pos.floor, search.bookIndex, 0));

        if (score > config.legibilityFloor) {
            const boost = Math.min(config.maxHopeBoost, score * config.hopePerLegibility);
            psych.hope = Math.min(100, psych.hope + boost);
            if (score > search.bestScore) search.bestScore = score;
            events.push({
                entity,
                name: ident.name,
                bookIndex: search.bookIndex,
                score,
                hopeBoost: boost,
                position: { ...pos },
            });
        }

        search.ticksSearched++;

        // Advance to next book or exhaust patience
        if (search.ticksSearched >= search.patience) {
            search.active = false;
            claimed.delete(search.bookIndex);
        } else {
            claimed.delete(search.bookIndex);
            const nextIdx = claimBookIndex(claimed, rng);
            if (nextIdx === -1) {
                search.active = false;
            } else {
                search.bookIndex = nextIdx;
            }
        }
    }

    return events;
}

// --- Events ---

export interface SearchEvent {
    entity: Entity;
    name: string;
    bookIndex: number;
    score: number;
    hopeBoost: number;
    position: Position;
}
