/** Event deck — shuffled atmospheric encounters drawn on move. */

export interface EventCard {
    id: number;
    text: string;
    type: "atmospheric" | "sound" | "sighting";
    morale?: number;
}

export interface Rng {
    next(): number;
}

/** Draw probability per move (~1 event per segment of 17 galleries). */
const DRAW_CHANCE = 0.06;

/** Fisher-Yates shuffle, returns new array. */
function shuffle(arr: number[], rng: Rng): number[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng.next() * (i + 1));
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
    }
    return a;
}

/** Create a shuffled deck of indices for a given card count. */
export function createDeck(cardCount: number, rng: Rng): number[] {
    const indices = Array.from({ length: cardCount }, (_, i) => i);
    return shuffle(indices, rng);
}

/**
 * Attempt to draw an event. Returns updated deck and drawn card (or null).
 * Deck auto-refills when exhausted.
 * Cards array is passed in — core module has no hardcoded text.
 */
export function drawEvent(
    deck: number[],
    cards: EventCard[],
    rng: Rng,
): { deck: number[]; event: EventCard | null } {
    const roll = rng.next();
    if (roll >= DRAW_CHANCE) {
        return { deck, event: null };
    }

    let d = deck;
    if (d.length === 0) {
        d = createDeck(cards.length, rng);
    }

    const idx = d[d.length - 1];
    return {
        deck: d.slice(0, -1),
        event: cards[idx],
    };
}
