/* Browser bundle for prng.core — exposes window._PRNGCore.
 * Prefixed 00_ so tweego includes it before prng.js (alphabetical order).
 * The pure logic is duplicated here; prng.core.js is the canonical ES module
 * source used by tests. Keep them in sync.
 */

(function () {
    "use strict";

    function hash(str) {
        let h = 0xdeadbeef;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9);
        }
        h ^= h >>> 16;
        h = Math.imul(h, 0x85ebca6b);
        h ^= h >>> 13;
        h = Math.imul(h, 0xc2b2ae35);
        h ^= h >>> 16;
        return h >>> 0;
    }

    function makeXoshiro128ss(a, b, c, d) {
        let s0 = a, s1 = b, s2 = c, s3 = d;
        return {
            next() {
                const t = s1 << 9;
                let r = s0 * 5;
                r = ((r << 7) | (r >>> 25)) * 9;
                s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
                s2 ^= t;
                s3 = (s3 << 11) | (s3 >>> 21);
                return (r >>> 0) / 0x100000000;
            },
            nextInt(n) { return Math.floor(this.next() * n); },
            fork(key) {
                const s = hash(key + String(this.nextInt(0xffffffff)));
                return makeXoshiro128ss(
                    hash("a" + s), hash("b" + s),
                    hash("c" + s), hash("d" + s)
                );
            }
        };
    }

    window._PRNGCore = {
        hash,
        makeXoshiro128ss,
        seedFromString(str) {
            return makeXoshiro128ss(
                hash(str + "a"), hash(str + "b"),
                hash(str + "c"), hash(str + "d")
            );
        }
    };

    const BOTTOM_FLOOR = 0;
    const SEGMENT_BOOK_COUNT = 640;
    const DIRS = { LEFT: "left", RIGHT: "right", UP: "up", DOWN: "down", CROSS: "cross" };

    function locationKey({ side, position, floor }) {
        return `${side}:${position}:${floor}`;
    }

    function generateSegment(side, position, floor, forkRng) {
        const rng = forkRng("seg:" + locationKey({ side, position, floor }));
        const lightLevel = rng.next() < 0.05 ? "dim" : "normal";
        return {
            side, position, floor,
            lightLevel,
            restArea: {
                hasSubmissionSlot: true,
                hasStairs: true,
                hasKiosk: true,
                bedsAvailable: 7,
                hasZoroastrianText: position === 0,
            },
            hasBridge: floor === BOTTOM_FLOOR,
            bookCount: SEGMENT_BOOK_COUNT,
        };
    }

    function availableMoves({ side, position, floor }) {
        const moves = [DIRS.LEFT, DIRS.RIGHT, DIRS.UP];
        if (floor > BOTTOM_FLOOR) moves.push(DIRS.DOWN);
        if (floor === BOTTOM_FLOOR) moves.push(DIRS.CROSS);
        return moves;
    }

    function applyMove({ side, position, floor }, dir) {
        switch (dir) {
            case DIRS.LEFT:  return { side, position: position - 1, floor };
            case DIRS.RIGHT: return { side, position: position + 1, floor };
            case DIRS.UP:    return { side, position, floor: floor + 1 };
            case DIRS.DOWN:
                if (floor <= BOTTOM_FLOOR) throw new Error("Cannot descend below floor 0");
                return { side, position, floor: floor - 1 };
            case DIRS.CROSS:
                if (floor !== BOTTOM_FLOOR) throw new Error("Can only cross at the bottom floor");
                return { side: side === 0 ? 1 : 0, position, floor };
            default: throw new Error(`Unknown direction: ${dir}`);
        }
    }

    function describeLocation({ side, position, floor }) {
        return `${side === 0 ? "west" : "east"} corridor, segment ${position}, floor ${floor}`;
    }

    window._LibraryCore = {
        DIRS, BOTTOM_FLOOR, SEGMENT_BOOK_COUNT,
        locationKey, generateSegment, availableMoves, applyMove, describeLocation,
    };

    // ---- BookCore ----

    const PAGES_PER_BOOK = 410;
    const LINES_PER_PAGE = 40;
    const CHARS_PER_LINE = 80;
    const CHARS_PER_PAGE = LINES_PER_PAGE * CHARS_PER_LINE;
    const CHARS_PER_BOOK = PAGES_PER_BOOK * CHARS_PER_PAGE;
    const CHARSET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join("");

    function generateBookPage(side, position, floor, bookIndex, pageIndex, forkRng) {
        const rng = forkRng(`book:${side}:${position}:${floor}:${bookIndex}:p${pageIndex}`);
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

    function bookMeta(side, position, floor, bookIndex) {
        return { side, position, floor, bookIndex };
    }

    function findCoherentFragment(pageText) {
        const match = pageText.match(/[a-zA-Z ,.'!?\-]{4,}/g);
        if (!match) return null;
        return match.reduce((best, s) => s.length > best.length ? s : best, "");
    }

    window._BookCore = {
        PAGES_PER_BOOK, LINES_PER_PAGE, CHARS_PER_LINE, CHARS_PER_PAGE, CHARS_PER_BOOK, CHARSET,
        generateBookPage, bookMeta, findCoherentFragment,
    };

    // ---- LifeStoryCore ----

    const _LS_FIRST_NAMES = [
        "Alma","Cedric","Dolores","Edmund","Fatima","Gordon","Helena","Ivan",
        "Judith","Kaspar","Leonora","Marcus","Nadia","Oliver","Priya","Quentin",
        "Rosa","Sebastian","Thea","Ulrich","Vera","Walter","Xenia","Yusuf","Zara",
    ];
    const _LS_LAST_NAMES = [
        "Ashby","Brant","Crane","Dahl","Ellison","Ferris","Gould","Harlow",
        "Ingram","Janssen","Keane","Lund","Marsh","Noel","Okafor","Pratt",
        "Quinn","Rowe","Strand","Thorn","Ueda","Voss","Ward","Xiao","Yuen",
    ];
    const _LS_OCCUPATIONS = [
        "librarian","schoolteacher","electrician","bus driver","accountant",
        "nurse","carpenter","postal worker","journalist","farmer",
        "chemist","translator","architect","cook","taxi driver",
        "dentist","watchmaker","bookbinder","radio operator","cartographer",
    ];
    const _LS_HOMETOWNS = [
        "a small town on the coast","a city you mostly tried to leave",
        "a suburb that no longer exists","a valley that flooded years later",
        "a neighborhood that changed while you were away",
        "a village your parents never stopped talking about",
        "a town whose name you could never spell correctly",
        "somewhere flat, with good light in the mornings",
    ];
    const _LS_CAUSE_OF_DEATH = [
        "a stroke, in the night, without warning",
        "a car accident on a road you'd driven a hundred times",
        "a long illness you pretended wasn't serious",
        "a fall — stupid, domestic, final",
        "a heart that simply stopped, as hearts do",
        "cancer, which took its time",
        "pneumonia, in a winter that was otherwise mild",
        "an accident at work that shouldn't have been possible",
    ];
    const _LS_LAST_THINGS = [
        "You were thinking about what to have for dinner.",
        "You had meant to call someone back.",
        "You were in the middle of a sentence.",
        "You had just put on a pot of coffee.",
        "You were looking out a window.",
        "You were tired, but not unusually so.",
        "You had a book open on the table.",
        "You were making a list.",
    ];

    function generateLifeStory(seed) {
        const rng = window._PRNGCore.seedFromString("life:" + seed);
        const pick = (arr) => arr[rng.nextInt(arr.length)];
        const coordRng = window._PRNGCore.seedFromString("coords:" + seed);
        return {
            name:         pick(_LS_FIRST_NAMES) + " " + pick(_LS_LAST_NAMES),
            occupation:   pick(_LS_OCCUPATIONS),
            hometown:     pick(_LS_HOMETOWNS),
            causeOfDeath: pick(_LS_CAUSE_OF_DEATH),
            lastThing:    pick(_LS_LAST_THINGS),
            bookCoords: {
                side:      coordRng.nextInt(2),
                position:  coordRng.nextInt(10000) - 5000,
                floor:     coordRng.nextInt(100),
                bookIndex: coordRng.nextInt(SEGMENT_BOOK_COUNT),
            },
        };
    }

    function formatLifeStory(story) {
        return `Your name was ${story.name}. You were a ${story.occupation}, from ${story.hometown}. ` +
               `You died of ${story.causeOfDeath}. ${story.lastThing} ` +
               `Somewhere in this library is a book that contains every detail of your life. Find it. Submit it. Go home.`;
    }

    window._LifeStoryCore = { generateLifeStory, formatLifeStory };

    // ---- SurvivalCore ----

    const STAT_MAX = 100;
    const STAT_MIN = 0;
    function _clamp(v) { return Math.max(STAT_MIN, Math.min(STAT_MAX, v)); }

    function survivalDefaults() {
        return { hunger: 80, thirst: 80, exhaustion: 90, morale: 100, despairing: false };
    }

    function survivalApplyMove(stats) {
        let { hunger, thirst, exhaustion, morale, despairing } = stats;
        hunger     = _clamp(hunger     - 0.5);
        thirst     = _clamp(thirst     - 2);
        exhaustion = _clamp(exhaustion - 1);
        if (hunger     <= STAT_MIN) morale = _clamp(morale - 2);
        if (thirst     <= STAT_MIN) morale = _clamp(morale - 4);
        if (exhaustion <= STAT_MIN) morale = _clamp(morale - 1);
        if (morale <= STAT_MIN) despairing = true;
        return { hunger, thirst, exhaustion, morale, despairing };
    }

    function survivalApplySleep(stats) {
        let { hunger, thirst, morale, despairing } = stats;
        hunger = _clamp(hunger - 10);
        thirst = _clamp(thirst - 8);
        morale = _clamp(morale + 5);
        if (morale > STAT_MIN) despairing = false;
        return { hunger, thirst, exhaustion: STAT_MAX, morale, despairing };
    }

    function survivalApplyEat(stats)   { return { ...stats, hunger: _clamp(stats.hunger + 40) }; }
    function survivalApplyDrink(stats) { return { ...stats, thirst: _clamp(stats.thirst + 40) }; }

    function survivalSeverity(v) {
        if (v <= 10) return "critical";
        if (v <= 30) return "low";
        return "ok";
    }

    function survivalWarnings(stats) {
        const w = [];
        const sev = survivalSeverity;
        if (sev(stats.thirst)     === "critical") w.push("You are desperately thirsty.");
        else if (sev(stats.thirst) === "low")     w.push("You are thirsty.");
        if (sev(stats.hunger)     === "critical") w.push("You are desperately hungry.");
        else if (sev(stats.hunger) === "low")     w.push("You are hungry.");
        if (sev(stats.exhaustion) === "critical") w.push("You can barely keep your eyes open.");
        else if (sev(stats.exhaustion) === "low") w.push("You are exhausted.");
        if (stats.despairing)                     w.push("You have given up hope.");
        return w;
    }

    window._SurvivalCore = {
        STAT_MAX, STAT_MIN,
        survivalDefaults, survivalApplyMove, survivalApplySleep,
        survivalApplyEat, survivalApplyDrink, survivalSeverity, survivalWarnings,
    };
}());
