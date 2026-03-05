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

import { seedFromString } from "./prng.core.js";
import { BOOKS_PER_GALLERY, isRestArea } from "./library.core.js";
import { PAGES_PER_BOOK } from "./book.core.js";

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
 * Prose templates for the life story page. Each is a function that takes
 * the story object and returns a ~150-word paragraph in corpus voice.
 * These read like the stories in content/stories.json.
 */
const PROSE_TEMPLATES = [
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
function gaussianSample(rng) {
    let u, v;
    do { u = rng.next(); } while (u === 0);
    v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate a life story and book coordinates from a seed string.
 *
 * @param {string} seed
 * @param {object} [opts]
 * @param {string} [opts.placement="gaussian"] - "gaussian" or "random"
 * @param {{ side: number, position: number, floor: number }} [opts.startLoc]
 * @returns {{
 *   name: string,
 *   occupation: string,
 *   hometown: string,
 *   causeOfDeath: string,
 *   lastThing: string,
 *   storyText: string,
 *   targetPage: number,
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

    const story = {
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

    // Book coordinates: derived independently so changing template pools
    // doesn't shift everyone's book.
    const coordRng  = seedFromString("coords:" + seed);

    let side, position, floor, bookIndex;

    if (placement === "random") {
        side      = coordRng.nextInt(2);
        position  = coordRng.nextInt(10000) - 5000;
        floor     = coordRng.nextInt(100);
        bookIndex = coordRng.nextInt(BOOKS_PER_GALLERY);
    } else {
        // Gaussian: centered on start, σ=200 segments, σ=2000 floors
        side      = coordRng.nextInt(2);
        position  = startLoc.position + Math.round(gaussianSample(coordRng) * 200);
        floor     = Math.max(0, startLoc.floor + Math.round(gaussianSample(coordRng) * 2000));
        bookIndex = coordRng.nextInt(BOOKS_PER_GALLERY);
    }

    // Rest areas have no shelves — nudge to nearest gallery
    if (isRestArea(position)) position += 1;

    story.placement = placement;
    story.bookCoords = { side, position, floor, bookIndex };

    return story;
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
