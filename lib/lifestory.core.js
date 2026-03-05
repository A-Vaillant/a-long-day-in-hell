/** Player life story generation.
 *
 * Derives a fill-in-the-blank life story from the global seed.
 * Also derives the player's "correct" book coordinates — the one book
 * in the library that contains their life story and is their escape ticket.
 *
 * The story is intentionally sparse and template-driven for now.
 * Coordinates are hashed from the seed so they're stable per run.
 *
 * @module lifestory.core
 */

import { seedFromString } from "./prng.core.js";
import { SEGMENT_BOOK_COUNT } from "./library.core.js";

// Template pools
const FIRST_NAMES = [
    "Alma","Cedric","Dolores","Edmund","Fatima","Gordon","Helena","Ivan",
    "Judith","Kaspar","Leonora","Marcus","Nadia","Oliver","Priya","Quentin",
    "Rosa","Sebastian","Thea","Ulrich","Vera","Walter","Xenia","Yusuf","Zara",
];

const LAST_NAMES = [
    "Ashby","Brant","Crane","Dahl","Ellison","Ferris","Gould","Harlow",
    "Ingram","Janssen","Keane","Lund","Marsh","Noel","Okafor","Pratt",
    "Quinn","Rowe","Strand","Thorn","Ueda","Voss","Ward","Xiao","Yuen",
];

const OCCUPATIONS = [
    "librarian","schoolteacher","electrician","bus driver","accountant",
    "nurse","carpenter","postal worker","journalist","farmer",
    "chemist","translator","architect","cook","taxi driver",
    "dentist","watchmaker","bookbinder","radio operator","cartographer",
];

const HOMETOWNS = [
    "a small town on the coast","a city you mostly tried to leave",
    "a suburb that no longer exists","a valley that flooded years later",
    "a neighborhood that changed while you were away",
    "a village your parents never stopped talking about",
    "a town whose name you could never spell correctly",
    "somewhere flat, with good light in the mornings",
];

const CAUSE_OF_DEATH = [
    "a stroke, in the night, without warning",
    "a car accident on a road you'd driven a hundred times",
    "a long illness you pretended wasn't serious",
    "a fall — stupid, domestic, final",
    "a heart that simply stopped, as hearts do",
    "cancer, which took its time",
    "pneumonia, in a winter that was otherwise mild",
    "an accident at work that shouldn't have been possible",
];

const LAST_THINGS = [
    "You were thinking about what to have for dinner.",
    "You had meant to call someone back.",
    "You were in the middle of a sentence.",
    "You had just put on a pot of coffee.",
    "You were looking out a window.",
    "You were tired, but not unusually so.",
    "You had a book open on the table.",
    "You were making a list.",
];

/**
 * Box-Muller transform: two uniform [0,1) → one standard normal sample.
 * Returns a value from approximately N(0,1).
 */
function gaussianSample(rng) {
    let u, v;
    do { u = rng.next(); } while (u === 0);
    v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate a life story and book coordinates from a seed string.
 *
 * Placement modes:
 *   "gaussian" — target book is placed in a Gaussian distribution around the
 *                player's starting position. A brute-force scanner checking
 *                nearby books can find it.
 *   "random"   — target book is placed anywhere in the library. Recovery
 *                requires inverting the LCG (reading the source code).
 *
 * @param {string} seed
 * @param {object} [opts]
 * @param {string} [opts.placement="gaussian"] - "gaussian" or "random"
 * @param {{ side: number, position: number, floor: number }} [opts.startLoc] - player start (for gaussian)
 * @returns {{
 *   name: string,
 *   occupation: string,
 *   hometown: string,
 *   causeOfDeath: string,
 *   lastThing: string,
 *   placement: string,
 *   bookCoords: { side: number, position: number, floor: number, bookIndex: number }
 * }}
 */
export function generateLifeStory(seed, opts) {
    const placement = (opts && opts.placement) || "gaussian";
    const startLoc = (opts && opts.startLoc) || { side: 0, position: 0, floor: 10 };

    const rng = seedFromString("life:" + seed);
    const pick = (arr) => arr[rng.nextInt(arr.length)];

    const firstName = pick(FIRST_NAMES);
    const lastName  = pick(LAST_NAMES);

    // Book coordinates: derived independently so changing template pools
    // doesn't shift everyone's book.
    const coordRng  = seedFromString("coords:" + seed);

    let side, position, floor, bookIndex;

    if (placement === "random") {
        side      = coordRng.nextInt(2);
        position  = coordRng.nextInt(10000) - 5000;
        floor     = coordRng.nextInt(100);
        bookIndex = coordRng.nextInt(SEGMENT_BOOK_COUNT);
    } else {
        // Gaussian: centered on start, σ=50 segments, σ=15 floors
        side      = coordRng.nextInt(2);
        position  = startLoc.position + Math.round(gaussianSample(coordRng) * 50);
        floor     = Math.max(0, startLoc.floor + Math.round(gaussianSample(coordRng) * 15));
        bookIndex = coordRng.nextInt(SEGMENT_BOOK_COUNT);
    }

    return {
        name:         `${firstName} ${lastName}`,
        occupation:   pick(OCCUPATIONS),
        hometown:     pick(HOMETOWNS),
        causeOfDeath: pick(CAUSE_OF_DEATH),
        lastThing:    pick(LAST_THINGS),
        placement,
        bookCoords:   { side, position, floor, bookIndex },
    };
}

/**
 * Format a life story as a short prose paragraph (for the Life Story screen).
 *
 * @param {ReturnType<typeof generateLifeStory>} story
 * @returns {string}
 */
export function formatLifeStory(story) {
    return [
        `Your name was ${story.name}.`,
        `You were a ${story.occupation}, from ${story.hometown}.`,
        `You died of ${story.causeOfDeath}.`,
        story.lastThing,
        ``,
        `Somewhere in this library is a book that contains every detail of your life — `,
        `every word you ever spoke, every thought you kept to yourself, every morning `,
        `you woke up and made coffee or didn't. Find it. Submit it. Go home.`,
    ].join(" ");
}

const CHARS_PER_LINE = 80;
const LINES_PER_PAGE = 40;

/**
 * Word-wrap text to fit within CHARS_PER_LINE, preserving blank lines.
 * Returns an array of lines.
 */
function wordWrap(text) {
    const result = [];
    const paragraphs = text.split("\n");
    for (const para of paragraphs) {
        if (para.trim() === "") {
            result.push("");
            continue;
        }
        const words = para.split(/\s+/);
        let line = "";
        for (const word of words) {
            if (line.length === 0) {
                line = word;
            } else if (line.length + 1 + word.length <= CHARS_PER_LINE) {
                line += " " + word;
            } else {
                result.push(line);
                line = word;
            }
        }
        if (line.length > 0) result.push(line);
    }
    return result;
}

/**
 * Pad a line to exactly CHARS_PER_LINE with trailing spaces.
 */
function padLine(line) {
    if (line.length >= CHARS_PER_LINE) return line.slice(0, CHARS_PER_LINE);
    return line + " ".repeat(CHARS_PER_LINE - line.length);
}

/**
 * Generate a page of the target book as a string (40 lines × 80 chars).
 * Page 0 is the title page. Pages 1+ contain the life story prose.
 * All pages are whitespace-padded to exactly LINES_PER_PAGE × CHARS_PER_LINE.
 *
 * @param {ReturnType<typeof generateLifeStory>} story
 * @param {number} pageIndex - 0-based (0..PAGES_PER_BOOK-1)
 * @returns {string}
 */
export function generateBookPage(story, pageIndex) {
    const lines = [];

    if (pageIndex === 0) {
        // Title page: centered-ish
        for (let i = 0; i < 15; i++) lines.push("");
        lines.push("The Life of " + story.name);
        lines.push("");
        lines.push("a " + story.occupation + ",");
        lines.push("from " + story.hometown);
    } else {
        // Prose pages — for now, page 1 gets the full summary, rest are blank
        if (pageIndex === 1) {
            const prose = [
                "Your name was " + story.name + ".",
                "You were a " + story.occupation + ", from " + story.hometown + ".",
                "You died of " + story.causeOfDeath + ".",
                story.lastThing,
                "",
                "Somewhere in this library is a book that contains every detail",
                "of your life -- every word you ever spoke, every thought you kept",
                "to yourself, every morning you woke up and made coffee or didn't.",
                "",
                "This is that book.",
                "",
                "Most of it is blank. That is not a flaw. Your life, in the end,",
                "was mostly silence. The parts that mattered fit on a few pages.",
                "The rest is whitespace. Margins. The quiet between sentences.",
                "",
                "Find it. Submit it. Go home.",
            ].join("\n");
            const wrapped = wordWrap(prose);
            for (const l of wrapped) lines.push(l);
        }
        // Other pages: blank (whitespace padding below fills them)
    }

    // Pad to exactly LINES_PER_PAGE lines, each padded to CHARS_PER_LINE
    while (lines.length < LINES_PER_PAGE) lines.push("");
    return lines.slice(0, LINES_PER_PAGE).map(padLine).join("\n");
}
