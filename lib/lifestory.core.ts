/** Player life story generation.
 *
 * Derives a fill-in-the-blank life story from the global seed.
 * Also derives the player's "correct" book coordinates — the one book
 * in the library that contains their life story and is their escape ticket.
 *
 * The story text is a prose paragraph matching the corpus voice,
 * interpolated from template pools. It becomes one page in the target book.
 *
 * @module lifestory.core
 */

import { seedFromString, type Xoshiro128ss } from "./prng.core.ts";
import { BOOKS_PER_GALLERY, isRestArea } from "./library.core.ts";
import { PAGES_PER_BOOK } from "./book.core.ts";
import { bigAbs } from "./bigint-utils.core.ts";

export interface BookCoords {
    side: number;
    position: bigint;
    floor: bigint;
    bookIndex: number;
}

export interface StartLocation {
    side: number;
    position: bigint;
    floor: bigint;
}

export interface LifeStoryOptions {
    placement?: "gaussian" | "random";
    startLoc?: StartLocation;
}

export interface LifeStory {
    name: string;
    occupation: string;
    hometown: string;
    causeOfDeath: string;
    lastThing: string;
    storyText: string;
    targetPage: number;
    placement: string;
    bookCoords: BookCoords;
    /** Where the player wakes up — derived from bookCoords, not the origin. */
    playerStart: StartLocation;
}

// Template pools
const FIRST_NAMES: readonly string[] = [
    "Alma","Cedric","Dolores","Edmund","Fatima","Gordon","Helena","Ivan",
    "Judith","Kaspar","Leonora","Marcus","Nadia","Oliver","Priya","Quentin",
    "Rosa","Sebastian","Thea","Ulrich","Vera","Walter","Xenia","Yusuf","Zara",
];

const LAST_NAMES: readonly string[] = [
    "Ashby","Brant","Crane","Dahl","Ellison","Ferris","Gould","Harlow",
    "Ingram","Janssen","Keane","Lund","Marsh","Noel","Okafor","Pratt",
    "Quinn","Rowe","Strand","Thorn","Ueda","Voss","Ward","Xiao","Yuen",
];

const OCCUPATIONS: readonly string[] = [
    "librarian","schoolteacher","electrician","bus driver","accountant",
    "nurse","carpenter","postal worker","journalist","farmer",
    "chemist","translator","architect","cook","taxi driver",
    "dentist","watchmaker","bookbinder","radio operator","cartographer",
];

const HOMETOWNS: readonly string[] = [
    "a small town on the coast","a city you mostly tried to leave",
    "a suburb that no longer exists","a valley that flooded years later",
    "a neighborhood that changed while you were away",
    "a village your parents never stopped talking about",
    "a town whose name you could never spell correctly",
    "somewhere flat, with good light in the mornings",
];

const CAUSE_OF_DEATH: readonly string[] = [
    "a stroke, in the night, without warning",
    "a car accident on a road you'd driven a hundred times",
    "a long illness you pretended wasn't serious",
    "a fall — stupid, domestic, final",
    "a heart that simply stopped, as hearts do",
    "cancer, which took its time",
    "pneumonia, in a winter that was otherwise mild",
    "an accident at work that shouldn't have been possible",
];

const LAST_THINGS: readonly string[] = [
    "You were thinking about what to have for dinner.",
    "You had meant to call someone back.",
    "You were in the middle of a sentence.",
    "You had just put on a pot of coffee.",
    "You were looking out a window.",
    "You were tired, but not unusually so.",
    "You had a book open on the table.",
    "You were making a list.",
];

interface StoryFields {
    name: string;
    occupation: string;
    hometown: string;
    causeOfDeath: string;
    lastThing: string;
}

/**
 * Prose templates for the life story page. Each is a function that takes
 * the story object and returns a ~150-word paragraph in corpus voice.
 * These read like the stories in content/stories.json.
 */
const PROSE_TEMPLATES: readonly ((s: StoryFields) => string)[] = [
    (s) => `Your name was ${s.name}. You were a ${s.occupation}, from ${s.hometown}. You got up in the morning and went to work and came home and did it again. There were people you loved and a few you did not and most you never thought about at all. You had a window you liked to look out of. You had a drawer full of things you meant to organize. You died of ${s.causeOfDeath}. ${s.lastThing} The last day was not remarkable. You did not know it was the last day. Nobody does. Somewhere in this library there is a book that contains every detail of your life, every word you spoke, every morning you woke and every night you did not. Most of its pages are silence. The parts that mattered fit in a paragraph. This is that paragraph.`,

    (s) => `${s.name} was a ${s.occupation} from ${s.hometown}. Not a good one or a bad one. Competent. Present. The kind of person who showed up and did the work and went home without making a fuss. There was a kitchen with a window and a view that was not beautiful but was familiar, which is better. There were years that passed without anything happening worth writing down, and those were the good years. The death was ${s.causeOfDeath}. Quick enough. ${s.lastThing} The body was found and dealt with and the kitchen window looked out on the same view and the drawer stayed full of things that would never be organized. That is the whole story. It fits on a page. Most lives do.`,

    (s) => `You were a ${s.occupation}. You lived in ${s.hometown}. Your name was ${s.name} and you carried it without thinking about it, the way you carried your keys or your face. You were born and for a while you were small and then you were not. You learned a trade. You had hands that could do things. You had a routine that held your days together like string. Then you died of ${s.causeOfDeath}. ${s.lastThing} There was no time to be surprised. There was barely time to notice. One moment you were a person with a name and a trade and a place in the world, and the next you were in a library that went on forever, looking for a book that contained everything you were. This is what it says. This is all of it.`,

    (s) => `The life of ${s.name}, a ${s.occupation}: born in ${s.hometown}. Lived there or near there for most of it. Moved once, maybe twice. Had a coat that was too warm for spring but you wore it anyway. Had a way of making coffee that no one else did exactly the same. Had opinions about weather. Died of ${s.causeOfDeath} on a day that was otherwise ordinary. ${s.lastThing} The things you owned were put in boxes. The boxes were put somewhere. The coffee was made differently after that, by someone else, in the same kitchen, and the difference was small enough that only you would have noticed, and you were not there to notice it.`,

    (s) => `This is the part where it says your name was ${s.name}. This is the part where it says you were a ${s.occupation} from ${s.hometown}, and that you died of ${s.causeOfDeath}. ${s.lastThing} This is the part where it tries to say something true about what it was like to be you, to have your particular hands and your particular way of walking into a room. But a book is not a life. A book is marks on a page. You were not marks on a page. You were a person who stood in kitchens and looked out windows and forgot things and remembered other things at the wrong time. The book cannot hold that. It tries. This is it trying.`,

    (s) => `${s.name} died of ${s.causeOfDeath}. Before that, a life: ${s.occupation}, from ${s.hometown}. A bed that was slept in. A door that was opened and closed. Coffee or tea, depending on the year. Certain songs on the radio that meant something once. A way of folding towels. A preference for one chair over another. ${s.lastThing} None of this is important. All of this is important. That is the problem with lives — everything matters exactly as much as everything else, which is to say not much, which is to say completely. The book does not rank the moments. It just holds them. Page after page of held moments, most of them quiet, most of them ordinary, all of them yours.`,
];

/**
 * Box-Muller transform: two uniform [0,1) → one standard normal sample.
 * Returns a value from approximately N(0,1).
 */
function gaussianSample(rng: Xoshiro128ss): number {
    let u: number, v: number;
    do { u = rng.next(); } while (u === 0);
    v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate a life story and book coordinates from a seed string.
 *
 * @param {string} seed
 * @param {LifeStoryOptions} [opts]
 * @returns {LifeStory}
 */
export function generateLifeStory(seed: string, opts?: LifeStoryOptions): LifeStory {
    const placement = (opts && opts.placement) || "gaussian";
    const startLoc: StartLocation = (opts && opts.startLoc) || { side: 0, position: 0n, floor: 10n };

    const rng: Xoshiro128ss = seedFromString("life:" + seed);
    const pick = <T>(arr: readonly T[]): T => arr[rng.nextInt(arr.length)];

    const firstName = pick(FIRST_NAMES);
    const lastName  = pick(LAST_NAMES);

    const story: StoryFields & { storyText?: string; targetPage?: number; placement?: string; bookCoords?: BookCoords; playerStart?: StartLocation } = {
        name:         `${firstName} ${lastName}`,
        occupation:   pick(OCCUPATIONS),
        hometown:     pick(HOMETOWNS),
        causeOfDeath: pick(CAUSE_OF_DEATH),
        lastThing:    pick(LAST_THINGS),
    };

    // Generate prose text from templates
    const template = PROSE_TEMPLATES[rng.nextInt(PROSE_TEMPLATES.length)];
    story.storyText = template(story);

    // Which page of the target book holds the life story (0-indexed)
    story.targetPage = rng.nextInt(PAGES_PER_BOOK);

    // Book coordinates: derived from story text itself.
    // The content determines where the book lives in the library.
    const coordRng: Xoshiro128ss = seedFromString("coords:" + story.storyText);

    let side: number, position: bigint, floor: bigint, bookIndex: number;

    // Book is placed randomly anywhere in the library.
    // Player start is derived from book coords via stone-throw + power-law ring.
    side      = coordRng.nextInt(2);
    position  = BigInt(coordRng.nextInt(10_000_000_000) - 5_000_000_000);
    floor     = BigInt(coordRng.nextInt(10_000));
    bookIndex = coordRng.nextInt(BOOKS_PER_GALLERY);

    // Rest areas have no shelves — nudge to nearest gallery
    if (isRestArea(position)) position += 1n;

    // Player start: stone-throw + power-law ring around book.
    //
    // Step 1 — stone throw: uniform distance in [666_666, 666_666_666] segments.
    // Step 2 — power-law ring: additional offset = stoneR * 66^u, u∈[0,1).
    //   Combined range: ~666k to ~44 billion segments from the book.
    //   That's years to ~750,000 years of walking. Cosmologically lost.
    //
    // Floor offset: uniform ±30 (vertical search is brutal; keep it humane).
    const spawnRng: Xoshiro128ss = seedFromString("spawn:" + story.storyText);
    const stoneR = 666_666 + Math.floor(spawnRng.next() * (666_666_666 - 666_666));
    const powerU = spawnRng.next();
    const ringR  = Math.floor(stoneR * Math.pow(66, powerU));
    const dir    = spawnRng.next() < 0.5 ? 1n : -1n;
    const floorOffset = BigInt(Math.floor(spawnRng.next() * 61) - 30);
    const playerSide  = coordRng.nextInt(2);
    const playerPos   = position + dir * BigInt(ringR);
    const playerFloor = floor + floorOffset < 0n ? 0n : floor + floorOffset;

    // Gaussian "easy mode": override player start to near-book (for testing/accessibility).
    let playerStart: StartLocation;
    if (placement === "gaussian") {
        const easyRng: Xoshiro128ss = seedFromString("easy:" + story.storyText);
        const easyPos   = position + BigInt(Math.round(gaussianSample(easyRng) * 50));
        const easyFloor = floor + BigInt(Math.round(gaussianSample(easyRng) * 15));
        playerStart = { side: playerSide, position: easyPos, floor: easyFloor < 0n ? 0n : easyFloor };
    } else {
        playerStart = { side: playerSide, position: playerPos, floor: playerFloor };
    }

    story.placement = placement;
    story.bookCoords = { side, position, floor, bookIndex };
    story.playerStart = playerStart;

    return story as LifeStory;
}

/**
 * Generate a life story for an NPC.
 *
 * Deterministic from NPC id + global seed. Uses the same template pools
 * as the player's story but seeded differently so each NPC gets their own
 * name, occupation, cause of death, story text, and book coordinates.
 *
 * Book coordinates use "random" placement (uniform across the library)
 * since NPCs don't have a "start location" like the player does.
 *
 * @param {number} npcId
 * @param {string} globalSeed
 * @returns {LifeStory}
 */
export function generateNPCLifeStory(npcId: number, globalSeed: string): LifeStory {
    const seed = `npc:${npcId}:${globalSeed}`;
    return generateLifeStory(seed, { placement: "random" });
}

/**
 * Compute the distance (in segments + floors) between a location and book coords.
 * This is a simple Manhattan distance — segments walked + floors climbed.
 * Does not account for having to reach a rest area for stairs or the
 * chasm crossing at floor 0.
 *
 * @param {{ side: number, position: number, floor: number }} loc
 * @param {BookCoords} book
 * @returns {number}
 */
export function distanceToBook(
    loc: { side: number; position: bigint; floor: bigint },
    book: BookCoords,
): bigint {
    const segDist = bigAbs(loc.position - book.position);
    const floorDist = bigAbs(loc.floor - book.floor);
    // Crossing the chasm costs going down to floor 0 and back up
    const crossCost = loc.side !== book.side
        ? loc.floor + book.floor  // down to 0 + back up to target floor
        : 0n;
    return segDist + floorDist + crossCost;
}

/**
 * Format a life story as a short prose paragraph (for the Life Story screen).
 *
 * @param {LifeStory} story
 * @returns {string}
 */
export function formatLifeStory(story: LifeStory): string {
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
