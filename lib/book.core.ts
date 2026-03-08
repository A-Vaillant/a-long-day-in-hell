/** Book content generation — random printable ASCII.
 *
 * Each book is identified by (side, position, floor, bookIndex).
 * Content is deterministic: same coordinates + global seed → same book.
 *
 * Physical properties (from the source text):
 *   410 pages × 40 lines × 80 characters = 1,312,000 characters per book.
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

import { seedFromString } from "./prng.core.ts";
import type { Xoshiro128ss } from "./prng.core.ts";

/** Metadata for a single book identified by its coordinates. */
export interface BookMeta {
    side: number;
    position: bigint;
    floor: bigint;
    bookIndex: number;
}

export const PAGES_PER_BOOK: number  = 410;
export const LINES_PER_PAGE: number  = 40;
export const CHARS_PER_LINE: number  = 80;
export const CHARS_PER_PAGE: number  = LINES_PER_PAGE * CHARS_PER_LINE; // 3200
export const CHARS_PER_BOOK: number  = PAGES_PER_BOOK * CHARS_PER_PAGE; // 1,312,000

/**
 * The 95-character printable ASCII set (codepoints 32–126).
 * This matches what the book describes as "about 95 possible characters
 * on a standard keyboard."
 */
export const CHARSET: string = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join("");

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
export function generateBookPage(
    side: number,
    position: bigint,
    floor: bigint,
    bookIndex: number,
    pageIndex: number,
    globalSeed: string,
    maxChars?: number,
): string {
    const rng = seedFromString(`${globalSeed}:book:${side}:${position}:${floor}:${bookIndex}:p${pageIndex}`);
    const n: number = CHARSET.length;
    const limit = maxChars ?? CHARS_PER_PAGE;
    const lines: string[] = [];
    let total = 0;
    for (let l = 0; l < LINES_PER_PAGE && total < limit; l++) {
        const lineLen = Math.min(CHARS_PER_LINE, limit - total);
        let line = "";
        for (let c = 0; c < lineLen; c++) {
            line += CHARSET[rng.nextInt(n)];
        }
        lines.push(line);
        total += lineLen;
    }
    return lines.join("\n");
}

// --- Life story book: tedious page generation ---

interface StoryFields {
    name: string;
    occupation: string;
    hometown: string;
    causeOfDeath: string;
}

// Page phases — a 410-page life has structure.
// ~2% birth/childhood, ~5% youth, ~80% working life, ~8% aging, ~5% death
const PHASE_BIRTH_END    = 8;    // pages 0–7
const PHASE_YOUTH_END    = 28;   // pages 8–27
const PHASE_WORKING_END  = 375;  // pages 28–374
const PHASE_AGING_END    = 400;  // pages 375–399
// pages 400–409: death

const BIRTH_LINES: readonly string[] = [
    "You were born. It was not remarkable.",
    "There was a room and you were in it. You were very small.",
    "Someone held you. You don't remember who.",
    "The world was large and loud and bright.",
    "You cried. Someone came. This was the arrangement.",
    "You learned to walk. You fell down. You got up. You fell down again.",
    "The house had a smell. Years later you would almost remember it.",
    "You were given a name. {name}. It fit well enough.",
    "There were faces above you. They seemed enormous.",
    "You learned words. They came slowly, then all at once.",
    "Someone sang to you. You don't remember the song.",
    "There was a blanket you wouldn't let go of.",
    "The floor was very far away. Then it wasn't.",
    "You put things in your mouth. Most of them were not food.",
    "There was a window. The light came through it every morning.",
];

const YOUTH_LINES: readonly string[] = [
    "You went to school. It was large and smelled like chalk.",
    "You had a friend. You can't remember their last name now.",
    "Someone taught you to read. The letters stopped being shapes.",
    "You lived in {hometown}. It seemed like the whole world.",
    "There was a summer that lasted forever. Then it ended.",
    "You learned things. Most of them you would forget.",
    "Someone was unkind to you. You thought about it for years.",
    "You ran somewhere. You can't remember where or why, only the running.",
    "There was a teacher you liked. You never told them.",
    "The days were long. The years were short. You didn't notice yet.",
    "You had a bicycle, or wanted one. The details blur.",
    "You discovered you were good at something. It didn't matter what.",
    "Someone moved away. The empty desk stayed empty for a week.",
    "You grew. Your clothes stopped fitting. New ones appeared.",
    "There was a test. You passed it or you didn't. It didn't matter.",
];

const FILLERS: readonly string[] = [
    "Things happened. Things continued to happen.",
    "You ate something. Later you ate something else.",
    "A day passed. Another day passed. They were similar.",
    "You said something to someone. They said something back.",
    "You went to a place and then you came home.",
    "Nothing in particular occurred.",
    "You had a thought but it wasn't important.",
    "The weather was the weather.",
    "You did your work. It was adequate.",
    "Someone asked how you were. You said fine.",
    "You forgot something. It didn't matter.",
    "There was a sound but you didn't look up.",
    "You slept and then you didn't.",
    "A year passed. It felt like a week.",
    "You were tired. You were often tired.",
    "You misplaced something and found it again.",
    "There was a Tuesday. It was like the other Tuesdays.",
    "You made something. It was ordinary.",
    "The light changed. You didn't notice.",
    "Someone left. Someone else arrived. It evened out.",
    "You opened a door. You closed it behind you.",
    "A conversation happened. You forgot most of it.",
    "You waited for something. It came or it didn't.",
    "The room was the same room it had been yesterday.",
    "You carried something from one place to another.",
    "There was a noise outside. You ignored it.",
    "You looked at a clock. It said a time.",
    "Breakfast, then work, then not-work, then sleep.",
    "Your hands did what they always did.",
    "Someone said your name. You turned around.",
];

const OCCUPATION_FILLERS: readonly string[] = [
    "You did your work as a {occupation}. It was the same as yesterday.",
    "Your hands did the thing they knew how to do.",
    "Someone needed a {occupation}. You were there.",
    "The work of a {occupation} is mostly waiting.",
    "You were a {occupation}. The work did not change.",
    "A {occupation}'s day has a shape. Yours had that shape.",
];

const RARE_LINES: readonly string[] = [
    "Once, something almost happened.",
    "You laughed, but you couldn't remember why later.",
    "Someone you loved was in the next room. You didn't go in.",
    "For a moment you felt something you couldn't name.",
    "You looked out a window. It was still there.",
    "A dog barked somewhere. You wondered whose it was.",
    "You almost said something important. The moment passed.",
    "There was a smell that reminded you of something. It went away.",
    "You stood in a doorway longer than you needed to.",
    "The sun came through at an angle you hadn't seen before.",
];

const AGING_LINES: readonly string[] = [
    "Your hands were slower now. You pretended not to notice.",
    "A doctor said something. You nodded. You forgot what it was.",
    "The stairs took longer than they used to.",
    "You sat down more often. Standing up took planning.",
    "Someone called you 'sir' or 'ma'am' and meant it differently now.",
    "The mirror showed someone you almost recognized.",
    "You lost a word. It came back later, when you didn't need it.",
    "Your back hurt. It had hurt for years. You stopped mentioning it.",
    "The things you used to do quickly, you now did carefully.",
    "There were pills. You took them at the same time each day.",
    "Mornings were harder. The bed was more persuasive.",
    "You repeated a story. No one told you it was the third time.",
    "The neighborhood had changed. You weren't sure when.",
    "Someone helped you with something you used to do alone.",
    "You napped in the afternoon. You hadn't planned to.",
];

const DEATH_LINES: readonly string[] = [
    "Something was wrong. You didn't know what yet.",
    "There was a feeling you hadn't felt before.",
    "You were very tired. More tired than usual.",
    "The room seemed farther away than it should have been.",
    "You sat down. You did not get up.",
    "It was a {causeOfDeath}.",
    "The last thought was not profound. It was ordinary.",
    "There was no tunnel. No light. Just a stopping.",
    "You did not know it was happening. That was the mercy of it.",
    "The body did what bodies do. It stopped.",
    "Everything went quiet. Not peaceful — just quiet.",
    "You had been meaning to do something. You didn't do it.",
    "The world continued. You did not.",
    "It was over before you could be afraid.",
    "And then you were somewhere else. And the library went on forever.",
];

/**
 * Interpolate {name}, {occupation}, {hometown}, {causeOfDeath} in a template.
 */
function interpolate(template: string, fields: StoryFields): string {
    return template
        .replace(/\{name\}/g, fields.name)
        .replace(/\{occupation\}/g, fields.occupation)
        .replace(/\{hometown\}/g, fields.hometown)
        .replace(/\{causeOfDeath\}/g, fields.causeOfDeath);
}

/**
 * Pick a sentence for this page based on life phase.
 *
 * The 410 pages map to a life arc:
 *   0–7:     birth/infancy
 *   8–27:    youth/school
 *   28–374:  working life (the bulk — tedious)
 *   375–399: aging
 *   400–409: death
 */
function pickSentence(
    pageIndex: number,
    fields: StoryFields,
    rng: Xoshiro128ss,
    pick: (arr: readonly string[]) => string,
): string {
    if (pageIndex < PHASE_BIRTH_END) {
        return interpolate(pick(BIRTH_LINES), fields);
    }
    if (pageIndex < PHASE_YOUTH_END) {
        // Youth: mostly youth lines, occasional rare line
        if (rng.next() < 0.1) return interpolate(pick(RARE_LINES), fields);
        return interpolate(pick(YOUTH_LINES), fields);
    }
    if (pageIndex < PHASE_WORKING_END) {
        // Working life: the vast tedious middle
        const roll = rng.next();
        if (roll < 0.06) return interpolate(pick(RARE_LINES), fields);
        if (roll < 0.20) return interpolate(pick(OCCUPATION_FILLERS), fields);
        return interpolate(pick(FILLERS), fields);
    }
    if (pageIndex < PHASE_AGING_END) {
        // Aging: mostly aging lines, some working-life bleed
        const roll = rng.next();
        if (roll < 0.15) return interpolate(pick(FILLERS), fields);
        if (roll < 0.25) return interpolate(pick(RARE_LINES), fields);
        return interpolate(pick(AGING_LINES), fields);
    }
    // Death
    const roll = rng.next();
    if (roll < 0.2) return interpolate(pick(AGING_LINES), fields);
    return interpolate(pick(DEATH_LINES), fields);
}

/**
 * Generate a page of life-story content for a life-story book.
 *
 * Each page is deterministic from storyText + pageIndex. The storyText
 * seeds the RNG so every person's tedium is uniquely their own.
 *
 * Pages follow a life arc: birth → youth → working life → aging → death.
 *
 * @param {string} storyText - the real story prose (used as seed)
 * @param {StoryFields} fields - name, occupation, hometown, causeOfDeath
 * @param {number} pageIndex - 0-based page number
 * @returns {string} page content, line-broken at CHARS_PER_LINE
 */
export function generateStoryPage(
    storyText: string,
    fields: StoryFields,
    pageIndex: number,
): string {
    const rng = seedFromString(`story-page:${pageIndex}:${storyText}`);

    const pick = (arr: readonly string[]) => arr[rng.nextInt(arr.length)];

    // Build sentences until we fill the page
    const sentences: string[] = [];
    let charCount = 0;
    const target = CHARS_PER_PAGE;

    while (charCount < target) {
        const line = pickSentence(pageIndex, fields, rng, pick);
        sentences.push(line);
        charCount += line.length + 1;
    }

    // Join into a block of text, then wrap to CHARS_PER_LINE
    const raw = sentences.join(" ");
    const lines: string[] = [];
    let pos = 0;
    while (pos < raw.length && lines.length < LINES_PER_PAGE) {
        lines.push(raw.slice(pos, pos + CHARS_PER_LINE));
        pos += CHARS_PER_LINE;
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
export function bookMeta(side: number, position: bigint, floor: bigint, bookIndex: number): BookMeta {
    return { side, position, floor, bookIndex };
}
