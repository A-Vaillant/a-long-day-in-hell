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

const SEGMENT_BOOK_COUNT = 640;
const FLOORS_TOTAL = 1000; // effectively unbounded; use large number for coord gen

/**
 * Generate a life story and book coordinates from a seed string.
 *
 * @param {string} seed
 * @returns {{
 *   name: string,
 *   occupation: string,
 *   hometown: string,
 *   causeOfDeath: string,
 *   lastThing: string,
 *   bookCoords: { side: number, position: number, floor: number, bookIndex: number }
 * }}
 */
export function generateLifeStory(seed) {
    const rng = seedFromString("life:" + seed);
    const pick = (arr) => arr[rng.nextInt(arr.length)];

    const firstName = pick(FIRST_NAMES);
    const lastName  = pick(LAST_NAMES);

    // Book coordinates: derived independently so changing template pools
    // doesn't shift everyone's book.
    const coordRng  = seedFromString("coords:" + seed);
    const side      = coordRng.nextInt(2);
    // Position: spread across a wide range so players rarely start near their book
    const position  = coordRng.nextInt(10000) - 5000;
    const floor     = coordRng.nextInt(100);
    const bookIndex = coordRng.nextInt(SEGMENT_BOOK_COUNT);

    return {
        name:         `${firstName} ${lastName}`,
        occupation:   pick(OCCUPATIONS),
        hometown:     pick(HOMETOWNS),
        causeOfDeath: pick(CAUSE_OF_DEATH),
        lastThing:    pick(LAST_THINGS),
        bookCoords:   { side, position, floor, bookIndex },
    };
}

/**
 * Format a life story as a short prose paragraph.
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
