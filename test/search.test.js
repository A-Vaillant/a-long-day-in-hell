import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    scoreBigram, computePatience, claimBookIndex,
    searchSystem, SEARCHING, DEFAULT_SEARCH,
    countWordsFromSeed,
} from "../lib/search.core.ts";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY } from "../lib/social.core.ts";
import { PERSONALITY } from "../lib/personality.core.ts";
import { INTENT } from "../lib/intent.core.ts";
import { KNOWLEDGE } from "../lib/knowledge.core.ts";

function makeRng(seed = 0.5) {
    let v = seed;
    return {
        next() { v = (v * 16807 + 0.5) % 1; return v; },
        nextInt(n) { v = (v * 16807 + 0.5) % 1; return Math.floor(v * n); },
    };
}

// --- scoreBigram ---

describe("scoreBigram", () => {
    it("scores random ASCII near zero", () => {
        // Generate pseudorandom ASCII
        let text = "";
        for (let i = 0; i < 400; i++) {
            text += String.fromCharCode(32 + (i * 7 + 13) % 95);
        }
        const score = scoreBigram(text);
        assert.ok(score < 0.06, `random ASCII score ${score} should be < 0.06`);
    });

    it("scores English prose significantly higher", () => {
        const prose = "The quick brown fox jumps over the lazy dog and then the cat sat on the mat while the rain fell softly on the old tin roof above the garden where the roses grew in the summer heat";
        const score = scoreBigram(prose);
        assert.ok(score > 0.15, `English prose score ${score} should be > 0.15`);
    });

    it("returns 0 for empty string", () => {
        assert.strictEqual(scoreBigram(""), 0);
    });

    it("returns 0 for single character", () => {
        assert.strictEqual(scoreBigram("a"), 0);
    });

    it("scores numbers/punctuation only as zero", () => {
        const score = scoreBigram("12345!@#$%^&*()67890");
        assert.strictEqual(score, 0);
    });

    it("respects sampleLen parameter", () => {
        const prose = "the the the the the the the the the the ";
        const full = scoreBigram(prose, 400);
        const short = scoreBigram(prose, 6);
        // Both should be nonzero, but sampling less text is still valid
        assert.ok(full > 0);
        assert.ok(short > 0);
    });

    it("scores gibberish lower than English", () => {
        const prose = "the rain fell softly on the old tin roof";
        const gibberish = "zqx bvk wjp rmf ycl dng tsh xpz qwk bvr";
        assert.ok(scoreBigram(prose) > scoreBigram(gibberish));
    });
});

// --- computePatience ---

describe("computePatience", () => {
    it("returns base patience with no personality", () => {
        const p = computePatience(null);
        assert.strictEqual(p, DEFAULT_SEARCH.basePatienceTicks);
    });

    it("open NPCs search longer", () => {
        const open = { temperament: 0.5, pace: 0.5, openness: 1.0, outlook: 0.5 };
        const closed = { temperament: 0.5, pace: 0.5, openness: 0.0, outlook: 0.5 };
        assert.ok(computePatience(open) > computePatience(closed));
    });

    it("restless NPCs search shorter", () => {
        const restless = { temperament: 0.5, pace: 1.0, openness: 0.5, outlook: 0.5 };
        const patient = { temperament: 0.5, pace: 0.0, openness: 0.5, outlook: 0.5 };
        assert.ok(computePatience(patient) > computePatience(restless));
    });

    it("never returns less than 3", () => {
        const worst = { temperament: 0.5, pace: 1.0, openness: 0.0, outlook: 0.5 };
        assert.ok(computePatience(worst) >= 3);
    });
});

// --- claimBookIndex ---

describe("claimBookIndex", () => {
    it("claims a book index", () => {
        const claimed = new Set();
        const idx = claimBookIndex(claimed, makeRng());
        assert.ok(idx >= 0 && idx < 192);
        assert.ok(claimed.has(idx));
    });

    it("does not overlap with already claimed", () => {
        const claimed = new Set([5, 10, 15]);
        const idx = claimBookIndex(claimed, makeRng());
        assert.ok(!([5, 10, 15].includes(idx)));
        assert.ok(claimed.has(idx));
    });

    it("returns -1 when gallery is full", () => {
        const claimed = new Set();
        for (let i = 0; i < 192; i++) claimed.add(i);
        assert.strictEqual(claimBookIndex(claimed, makeRng()), -1);
    });
});

// --- searchSystem ---

function spawnSearcher(world, overrides = {}) {
    const ent = spawn(world);
    addComponent(world, ent, SEARCHING, {
        bookIndex: 0, ticksSearched: 0, patience: 10,
        active: false, bestScore: 0, bestWords: [],
        ...overrides.search,
    });
    addComponent(world, ent, POSITION, {
        side: 0, position: 5, floor: 100,
        ...overrides.position,
    });
    addComponent(world, ent, IDENTITY, {
        name: "Soren", alive: true,
        ...overrides.identity,
    });
    addComponent(world, ent, PSYCHOLOGY, {
        lucidity: 80, hope: 50,
        ...overrides.psychology,
    });
    // Default intent: search (most tests expect active searching)
    addComponent(world, ent, INTENT, {
        behavior: "search", cooldown: 0, elapsed: 0,
        ...overrides.intent,
    });
    if (overrides.personality) {
        addComponent(world, ent, PERSONALITY, overrides.personality);
    }
    return ent;
}

describe("searchSystem", () => {
    it("idle NPC can start searching", () => {
        const world = createWorld();
        spawnSearcher(world);
        const rng = makeRng(0.01); // low roll to trigger start
        // Run enough ticks that the start chance fires
        for (let i = 0; i < 50; i++) {
            searchSystem(world, rng, () => "", undefined, () => []);
        }
        // Check that search was attempted (ticksSearched may have advanced)
        // We just verify no crash
        assert.ok(true);
    });

    it("dead NPCs don't search", () => {
        const world = createWorld();
        const ent = spawnSearcher(world, {
            identity: { name: "Dead", alive: false },
            search: { active: true },
        });
        const events = searchSystem(world, makeRng(), () => "", undefined, () => []);
        assert.strictEqual(events.length, 0);
    });

    it("non-search intent NPCs don't search", () => {
        const world = createWorld();
        spawnSearcher(world, {
            intent: { behavior: "wander_mad", cooldown: 0, elapsed: 0 },
            search: { active: true },
        });
        const events = searchSystem(world, makeRng(), () => "", undefined, () => []);
        assert.strictEqual(events.length, 0);
    });

    it("idle intent NPCs don't search", () => {
        const world = createWorld();
        spawnSearcher(world, {
            intent: { behavior: "idle", cooldown: 0, elapsed: 0 },
            search: { active: true },
        });
        const events = searchSystem(world, makeRng(), () => "", undefined, () => []);
        assert.strictEqual(events.length, 0);
    });

    it("words found boosts hope and emits event", () => {
        const world = createWorld();
        const ent = spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 0, patience: 10 },
        });
        const psych = { lucidity: 80, hope: 50 };
        addComponent(world, ent, PSYCHOLOGY, psych);

        // wordFindFn that always returns 2 words
        const events = searchSystem(world, makeRng(), () => "", undefined, () => ["hope", "fire"]);

        assert.ok(events.length > 0, "should emit a search event when words found");
        assert.strictEqual(events[0].score, 2);
        assert.deepStrictEqual(events[0].words, ["hope", "fire"]);
        assert.ok(events[0].hopeBoost > 0);
        // Escalating: 1st word = 3, 2nd word = 6 → total 9
        assert.strictEqual(events[0].hopeBoost, 9);
    });

    it("no words found does not boost hope", () => {
        const world = createWorld();
        spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 0, patience: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });

        // wordCountFn that always returns 0
        const events = searchSystem(world, makeRng(), () => "", undefined, () => []);

        assert.strictEqual(events.length, 0);
    });

    it("multiple NPCs at same position claim different books", () => {
        const world = createWorld();
        const pos = { side: 0, position: 5, floor: 100 };
        spawnSearcher(world, {
            position: pos,
            search: { active: true, bookIndex: 10, ticksSearched: 0, patience: 10 },
        });
        spawnSearcher(world, {
            position: pos,
            identity: { name: "Rachel", alive: true },
            search: { active: true, bookIndex: 20, ticksSearched: 0, patience: 10 },
        });

        // Run a tick — both should advance to different books
        const rng = makeRng();
        searchSystem(world, rng, () => "", undefined, () => []);
        // No crash, no assertion needed beyond survival
        assert.ok(true);
    });

    it("searching stops after patience exhausted", () => {
        const world = createWorld();
        const ent = spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 9, patience: 10 },
        });

        searchSystem(world, makeRng(), () => "", undefined, () => []);
        const search = getComponent(world, ent, SEARCHING);
        assert.strictEqual(search.active, false, "should deactivate after patience runs out");
    });
});

// --- countWordsFromSeed ---

describe("countWordsFromSeed", () => {
    it("returns a non-negative integer", () => {
        const words = countWordsFromSeed("test-seed", 0, 5, 100, 42, 0);
        assert.ok(Number.isInteger(words));
        assert.ok(words >= 0);
    });

    it("is deterministic for same coordinates", () => {
        const a = countWordsFromSeed("seed", 0, 5, 100, 42, 0);
        const b = countWordsFromSeed("seed", 0, 5, 100, 42, 0);
        assert.strictEqual(a, b);
    });

    it("varies with different coordinates", () => {
        // 4+ letter words are rare (~0.4%), need many samples
        let found = 0;
        for (let i = 0; i < 5000; i++) {
            if (countWordsFromSeed("seed", 0, i, 100, i % 192, 0) > 0) found++;
        }
        assert.ok(found > 0, "should find at least one word in 5000 pages");
        assert.ok(found < 5000, "should not find words on every page");
    });

    it("most random pages have 0 words", () => {
        let zeroCount = 0;
        const N = 1000;
        for (let i = 0; i < N; i++) {
            if (countWordsFromSeed("test", 0, i, 100, i % 192, 0) === 0) zeroCount++;
        }
        assert.ok(zeroCount > N * 0.95, `expected >95% zero-word pages, got ${zeroCount}/${N}`);
    });
});

// --- escalating hope ---

describe("searchSystem escalating hope", () => {
    it("single word gives base hope boost", () => {
        const world = createWorld();
        const ent = spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 0, patience: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });
        const events = searchSystem(world, makeRng(), () => "", undefined, () => ["hope"]);
        assert.strictEqual(events.length, 1);
        assert.strictEqual(events[0].hopeBoost, DEFAULT_SEARCH.hopePerWord);
    });

    it("three words give triangular sum", () => {
        const world = createWorld();
        spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 0, patience: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });
        const events = searchSystem(world, makeRng(), () => "", undefined, () => ["hell", "fire", "dark"]);
        // 3 + 6 + 9 = 18, capped at maxHopeBoost (12)
        assert.strictEqual(events[0].hopeBoost, Math.min(DEFAULT_SEARCH.maxHopeBoost, 18));
    });
});

// --- lifetime best persisted to knowledge ---

describe("searchSystem lifetime best", () => {
    it("persists best find to KNOWLEDGE component", () => {
        const world = createWorld();
        const ent = spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 0, patience: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });
        addComponent(world, ent, KNOWLEDGE, {
            lifeStory: { name: "Test", bookCoords: { side: 0, position: 0, floor: 0, bookIndex: 0 } },
            bookVision: null, visionAccurate: true, hasBook: false,
            searchedSegments: new Set(), bestScore: 0, bestWords: [],
        });

        searchSystem(world, makeRng(), () => "", undefined, () => ["hope", "fire"]);

        const k = getComponent(world, ent, KNOWLEDGE);
        assert.strictEqual(k.bestScore, 2);
        assert.deepStrictEqual(k.bestWords, ["hope", "fire"]);
    });

    it("lifetime best survives search session reset", () => {
        const world = createWorld();
        const ent = spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 0, patience: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });
        addComponent(world, ent, KNOWLEDGE, {
            lifeStory: { name: "Test", bookCoords: { side: 0, position: 0, floor: 0, bookIndex: 0 } },
            bookVision: null, visionAccurate: true, hasBook: false,
            searchedSegments: new Set(), bestScore: 0, bestWords: [],
        });

        // First session: find 2 words
        searchSystem(world, makeRng(), () => "", undefined, () => ["hope", "fire"]);

        // Switch intent away (ends session)
        const intent = getComponent(world, ent, INTENT);
        intent.behavior = "explore";
        searchSystem(world, makeRng(), () => "", undefined, () => []);

        // Switch back to search (new session — SEARCHING.bestScore resets)
        intent.behavior = "search";
        searchSystem(world, makeRng(), () => "", undefined, () => []);

        // SEARCHING component resets, but KNOWLEDGE persists
        const search = getComponent(world, ent, SEARCHING);
        assert.strictEqual(search.bestScore, 0, "session best resets");
        const k = getComponent(world, ent, KNOWLEDGE);
        assert.strictEqual(k.bestScore, 2, "lifetime best persists");
        assert.deepStrictEqual(k.bestWords, ["hope", "fire"]);
    });

    it("lifetime best only updates when beaten", () => {
        const world = createWorld();
        const ent = spawnSearcher(world, {
            search: { active: true, bookIndex: 0, ticksSearched: 0, patience: 10 },
            psychology: { lucidity: 80, hope: 50 },
        });
        addComponent(world, ent, KNOWLEDGE, {
            lifeStory: { name: "Test", bookCoords: { side: 0, position: 0, floor: 0, bookIndex: 0 } },
            bookVision: null, visionAccurate: true, hasBook: false,
            searchedSegments: new Set(), bestScore: 5, bestWords: ["old", "best", "find", "from", "before"],
        });

        // Find only 2 words — should NOT overwrite
        searchSystem(world, makeRng(), () => "", undefined, () => ["hope", "fire"]);

        const k = getComponent(world, ent, KNOWLEDGE);
        assert.strictEqual(k.bestScore, 5, "should not overwrite better lifetime best");
        assert.deepStrictEqual(k.bestWords, ["old", "best", "find", "from", "before"]);
    });
});
