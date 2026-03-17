import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    MEMORY, MEMORY_TYPES, DEFAULT_MEMORY_CONFIG, createMemory, addMemory,
    grantBookVision, grantVagueBookVision, getBookVision, isInVisionRadius,
    segmentKey, getSearchProgress,
} from "../lib/memory.core.ts";
import { DEFAULT_SHOCKS, attenuateShock, applyShock, HABITUATION } from "../lib/psych.core.ts";
import { createWorld, spawn, addComponent, getComponent } from "../lib/ecs.core.ts";
import { POSITION, IDENTITY, PSYCHOLOGY, psychologyDecaySystem } from "../lib/social.core.ts";
import { generateLifeStory, generateNpcLifeStory } from "../lib/lifestory.core.ts";
import { PLAYABLE_ADDRESS_MAX } from "../lib/invertible.core.ts";
import { PERSONALITY } from "../lib/personality.core.ts";
import { INTENT, evaluateIntent, getAvailableBehaviors } from "../lib/intent.core.ts";

const _playerStory = generateLifeStory("pf-test-seed");
const TEST_PLAYER_RAW = _playerStory.rawBookAddress;
const TEST_RANDOM_ORIGIN = PLAYABLE_ADDRESS_MAX / 2n;

describe("pilgrimageFailure memory type", () => {
    it("MEMORY_TYPES includes PILGRIMAGE_FAILURE", () => {
        assert.equal(MEMORY_TYPES.PILGRIMAGE_FAILURE, "pilgrimageFailure");
    });

    it("config exists in DEFAULT_MEMORY_TYPES", () => {
        const tc = DEFAULT_MEMORY_CONFIG.types["pilgrimageFailure"];
        assert.ok(tc, "pilgrimageFailure config should exist");
        assert.equal(tc.permanent, true, "should be permanent");
        assert.ok(tc.initialWeight >= 10, "should have high weight: " + tc.initialWeight);
        assert.equal(tc.shockKey, "pilgrimageFailure");
    });
});

describe("pilgrimageFailure shock", () => {
    it("shock source exists in DEFAULT_SHOCKS", () => {
        const source = DEFAULT_SHOCKS["pilgrimageFailure"];
        assert.ok(source, "pilgrimageFailure shock should exist");
    });

    it("first exposure is devastating — drives lucidity to near zero", () => {
        const source = DEFAULT_SHOCKS["pilgrimageFailure"];
        const impact = attenuateShock(source, 0);
        assert.ok(impact.lucidity <= -40, "lucidity impact should be >= 40 damage: " + impact.lucidity);
        assert.ok(impact.hope <= -40, "hope impact should be >= 40 damage: " + impact.hope);
    });

    it("shock barely habituates — this kind of loss doesn't numb", () => {
        const source = DEFAULT_SHOCKS["pilgrimageFailure"];
        const first = attenuateShock(source, 0);
        const tenth = attenuateShock(source, 10);
        assert.ok(tenth.lucidity <= first.lucidity * 0.5,
            "tenth exposure should still be at least half of first");
    });
});

describe("pilgrim hope floor after exhaustion", () => {
    it("hope floor removed when bookVision state is exhausted", () => {
        const world = createWorld();
        const entity = spawn(world);
        addComponent(world, entity, POSITION, { side: 0, position: 0n, floor: 10n });
        addComponent(world, entity, IDENTITY, { name: "Pilgrim", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 10, hope: 5 });
        const mem = createMemory();
        const story = generateNpcLifeStory("seed", 0, { side: 0, position: 0n, floor: 10n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        grantBookVision(mem, story.bookCoords, 0);
        getBookVision(mem).state = "exhausted";
        addComponent(world, entity, MEMORY, mem);

        // Run psychology decay — should NOT enforce pilgrim hope floor
        psychologyDecaySystem(world);

        const psych = getComponent(world, entity, PSYCHOLOGY);
        assert.ok(psych.hope < 20, "hope should be allowed below pilgrim floor when exhausted: " + psych.hope);
    });
});

function makeRng(val = 0.5) {
    return { next() { return val; }, nextInt(n) { return Math.floor(val * n); } };
}

describe("pilgrimage failure integration", () => {
    it("full vague pilgrimage cycle: vision → in radius → search intent → exhaustion → mad", () => {
        const world = createWorld();
        const entity = spawn(world);

        const story = generateNpcLifeStory("integ-seed", 42, { side: 0, position: 100n, floor: 50n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        const mem = createMemory();
        grantVagueBookVision(mem, story.bookCoords, 50, 0);
        const vision = getBookVision(mem);
        const visionPos = vision.coords.position;
        const visionFloor = vision.coords.floor;
        const visionSide = vision.coords.side;

        addComponent(world, entity, POSITION, { side: visionSide, position: visionPos + 5n, floor: visionFloor });
        addComponent(world, entity, IDENTITY, { name: "Seeker", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 80, hope: 80 });
        addComponent(world, entity, INTENT, { behavior: "idle", cooldown: 0, elapsed: 0 });
        addComponent(world, entity, PERSONALITY, { temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5 });
        addComponent(world, entity, HABITUATION, { exposures: new Map() });
        addComponent(world, entity, MEMORY, mem);

        // Verify: pilgrimage should NOT score (within radius → search takes over)
        const behaviors = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim = behaviors.find(b => b.behavior === "pilgrimage");
        assert.equal(pilgrim, undefined, "pilgrimage should yield within vision radius");

        // Verify: search SHOULD score
        const search = behaviors.find(b => b.behavior === "search");
        assert.ok(search, "search should be available");

        // Simulate: mark 60%+ of vision zone as searched
        const radius = vision.radius;
        const needed = Math.ceil((radius * 2 + 1) * 0.6);
        const sp = getSearchProgress(mem, true);
        for (let i = 0; i < needed; i++) {
            const segPos = visionPos - BigInt(radius) + BigInt(i);
            sp.searchedSegments.add(segmentKey(visionSide, segPos, visionFloor));
        }

        // Count searched in zone
        const radiusBig = BigInt(radius);
        let searchedInZone = 0;
        let totalInZone = 0;
        for (let offset = -radiusBig; offset <= radiusBig; offset++) {
            totalInZone++;
            const segPos2 = visionPos + offset;
            if (sp.searchedSegments.has(segmentKey(visionSide, segPos2, visionFloor))) {
                searchedInZone++;
            }
        }
        assert.ok(searchedInZone >= totalInZone * 0.6,
            "should have searched enough: " + searchedInZone + "/" + totalInZone);

        // Simulate trauma (what checkEscapes would do)
        vision.state = "exhausted";
        vision.coords = null;
        const pfConfig = DEFAULT_MEMORY_CONFIG.types["pilgrimageFailure"];
        vision.type = "pilgrimageFailure";
        vision.weight = pfConfig.initialWeight;
        vision.initialWeight = pfConfig.initialWeight;

        const psych = getComponent(world, entity, PSYCHOLOGY);
        applyShock(psych, getComponent(world, entity, HABITUATION), "pilgrimageFailure");

        assert.ok(psych.lucidity <= 10, "lucidity should be near zero: " + psych.lucidity);
        assert.ok(psych.hope <= 10, "hope should be near zero: " + psych.hope);

        // Verify: pilgrimage no longer scores
        const behaviors2 = getAvailableBehaviors(world, entity, makeRng());
        const pilgrim2 = behaviors2.find(b => b.behavior === "pilgrimage");
        assert.equal(pilgrim2, undefined, "pilgrimage should be excluded after exhaustion");
    });

    it("exact path: found state → rest area → trauma", () => {
        const world = createWorld();
        const entity = spawn(world);

        const story = generateNpcLifeStory("exact-seed", 7, { side: 0, position: 100n, floor: 50n }, TEST_PLAYER_RAW, TEST_RANDOM_ORIGIN);
        const mem = createMemory();
        grantBookVision(mem, story.bookCoords, 0);
        const vision = getBookVision(mem);
        vision.state = "found";

        addComponent(world, entity, POSITION, { side: vision.coords.side, position: 0n, floor: vision.coords.floor });
        addComponent(world, entity, IDENTITY, { name: "ExactSeeker", alive: true, free: false });
        addComponent(world, entity, PSYCHOLOGY, { lucidity: 70, hope: 60 });
        addComponent(world, entity, INTENT, { behavior: "pilgrimage", cooldown: 0, elapsed: 0 });
        addComponent(world, entity, PERSONALITY, { temperament: 0.5, pace: 0.5, openness: 0.5, outlook: 0.5 });
        addComponent(world, entity, HABITUATION, { exposures: new Map() });
        addComponent(world, entity, MEMORY, mem);

        // Simulate exact path trauma
        vision.state = "exhausted";
        vision.coords = null;
        const pfConfig = DEFAULT_MEMORY_CONFIG.types["pilgrimageFailure"];
        vision.type = "pilgrimageFailure";
        vision.weight = pfConfig.initialWeight;
        vision.initialWeight = pfConfig.initialWeight;

        const psych = getComponent(world, entity, PSYCHOLOGY);
        applyShock(psych, getComponent(world, entity, HABITUATION), "pilgrimageFailure");

        assert.ok(psych.lucidity <= 5, "lucidity should be devastated: " + psych.lucidity);
        assert.ok(psych.hope <= 5, "hope should be devastated: " + psych.hope);
    });
});
