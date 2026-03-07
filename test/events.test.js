import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    createDeck,
    drawEvent,
} from "../lib/events.core.ts";

// --- helpers ---

function stubRng(values) {
    let i = 0;
    return { next() { return values[i++ % values.length]; } };
}

/** Minimal test cards — structure matches content/text.json shape. */
const TEST_CARDS = [
    { id: 0,  text: "sound 0",  type: "sound",       morale: -1 },
    { id: 1,  text: "sound 1",  type: "sound"                    },
    { id: 2,  text: "atmo 0",   type: "atmospheric"              },
    { id: 3,  text: "atmo 1",   type: "atmospheric", morale: -2  },
    { id: 4,  text: "sight 0",  type: "sighting",    morale: 1   },
    { id: 5,  text: "sight 1",  type: "sighting"                 },
    { id: 6,  text: "atmo 2",   type: "atmospheric"              },
    { id: 7,  text: "sound 2",  type: "sound",       morale: -1  },
    { id: 8,  text: "atmo 3",   type: "atmospheric"              },
    { id: 9,  text: "sight 2",  type: "sighting"                 },
    { id: 10, text: "atmo 4",   type: "atmospheric"              },
    { id: 11, text: "atmo 5",   type: "atmospheric", morale: -1  },
    { id: 12, text: "sound 3",  type: "sound"                    },
    { id: 13, text: "atmo 6",   type: "atmospheric"              },
    { id: 14, text: "sight 3",  type: "sighting",    morale: -2  },
    { id: 15, text: "atmo 7",   type: "atmospheric"              },
];
const CARD_COUNT = TEST_CARDS.length;

// --- createDeck ---

describe("createDeck", () => {
    it("returns array of all card indices", () => {
        const rng = stubRng([0.5, 0.3, 0.7, 0.1, 0.9]);
        const deck = createDeck(CARD_COUNT, rng);
        assert.strictEqual(deck.length, CARD_COUNT);
        const sorted = [...deck].sort((a, b) => a - b);
        for (let i = 0; i < sorted.length; i++) {
            assert.strictEqual(sorted[i], i);
        }
    });

    it("shuffles (not identity order with varied RNG)", () => {
        const rng = stubRng([0.9, 0.1, 0.7, 0.3, 0.5, 0.8, 0.2, 0.6, 0.4, 0.15,
                             0.85, 0.35, 0.65, 0.45, 0.75, 0.25, 0.55, 0.95, 0.05, 0.5]);
        const deck = createDeck(CARD_COUNT, rng);
        const identity = Array.from({ length: CARD_COUNT }, (_, i) => i);
        let same = 0;
        for (let i = 0; i < deck.length; i++) {
            if (deck[i] === identity[i]) same++;
        }
        assert.ok(same < deck.length, "deck should be shuffled");
    });
});

// --- drawEvent ---

describe("drawEvent", () => {
    it("returns null event when RNG roll is above threshold", () => {
        const rng = stubRng([0.9]);
        const deck = [0, 1, 2, 3, 4];
        const result = drawEvent(deck, TEST_CARDS, rng);
        assert.strictEqual(result.event, null);
        assert.deepStrictEqual(result.deck, deck, "deck unchanged on no-draw");
    });

    it("draws from deck when RNG roll is below threshold", () => {
        const rng = stubRng([0.1]);
        const deck = [3, 1, 4, 0, 2];
        const result = drawEvent(deck, TEST_CARDS, rng);
        assert.ok(result.event !== null);
        assert.strictEqual(result.event.id, TEST_CARDS[2].id, "draws last element of deck");
        assert.strictEqual(result.deck.length, 4, "deck shrinks by one");
    });

    it("refills and reshuffles when deck is empty", () => {
        const rng = stubRng([0.1, 0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6, 0.9, 0.15,
                             0.85, 0.35, 0.65, 0.45, 0.75, 0.25, 0.55, 0.95, 0.05, 0.5]);
        const result = drawEvent([], TEST_CARDS, rng);
        assert.ok(result.event !== null);
        assert.strictEqual(result.deck.length, CARD_COUNT - 1);
    });

    it("cycles through all events before repeating", () => {
        const seen = new Set();
        let deck = Array.from({ length: CARD_COUNT }, (_, i) => i);
        const alwaysDraw = stubRng([0.0]);

        for (let i = 0; i < CARD_COUNT; i++) {
            const result = drawEvent(deck, TEST_CARDS, alwaysDraw);
            assert.ok(result.event !== null);
            seen.add(result.event.id);
            deck = result.deck;
        }
        assert.strictEqual(seen.size, CARD_COUNT, "all events seen exactly once");
        assert.strictEqual(deck.length, 0, "deck exhausted");
    });
});
