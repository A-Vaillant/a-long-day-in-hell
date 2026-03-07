/**
 * Knowledge component — accumulated facts that change NPC behavior.
 *
 * Knowledge is currency: it drives goal-directed behavior. An NPC with
 * a book vision has purpose; one without is just wandering.
 *
 * Each NPC has a life story (generated at spawn from their seed) and
 * a target book location derived from that story. The book vision
 * field tracks whether they've been told (or figured out) where it is.
 *
 * @module knowledge.core
 */

import { generateLifeStory, type LifeStory, type BookCoords } from "./lifestory.core.ts";

// --- Component ---

export const KNOWLEDGE = "knowledge";

export interface Knowledge {
    /** This entity's life story (generated at spawn, immutable). */
    lifeStory: LifeStory;
    /** Revealed book location. null = unknown. */
    bookVision: BookCoords | null;
    /** Is the vision accurate? False for mad NPC false visions. */
    visionAccurate: boolean;
    /** Has this entity picked up their book? */
    hasBook: boolean;
}

// --- Generation ---

/**
 * Generate an NPC's life story and target book from deterministic seed.
 * Uses the same machinery as player life story generation.
 *
 * @param globalSeed - game seed
 * @param npcId - NPC id (for deterministic per-NPC seeding)
 * @param startLoc - NPC's spawn location (for gaussian placement)
 */
export function generateNpcLifeStory(
    globalSeed: string,
    npcId: number,
    startLoc: { side: number; position: number; floor: number },
): LifeStory {
    const seed = globalSeed + ":npc:life:" + npcId;
    return generateLifeStory(seed, { placement: "gaussian", startLoc });
}

/**
 * Create a fresh Knowledge component for an NPC.
 * Book vision starts null — must be granted via divine revelation
 * or self-discovery.
 */
export function createKnowledge(
    globalSeed: string,
    npcId: number,
    startLoc: { side: number; position: number; floor: number },
): Knowledge {
    return {
        lifeStory: generateNpcLifeStory(globalSeed, npcId, startLoc),
        bookVision: null,
        visionAccurate: true,
        hasBook: false,
    };
}

/**
 * Grant a divine vision of book location.
 * If accurate, sets bookVision to the NPC's actual target book.
 * If false (for mad NPCs), sets a bogus location.
 */
/**
 * Check if an entity is at their book's segment location.
 * Compares side, position, floor (ignores bookIndex — they search the shelf).
 */
export function isAtBookSegment(
    knowledge: Knowledge,
    pos: { side: number; position: number; floor: number },
): boolean {
    const vision = knowledge.bookVision;
    if (!vision) return false;
    return pos.side === vision.side &&
           pos.position === vision.position &&
           pos.floor === vision.floor;
}

export function grantVision(
    knowledge: Knowledge,
    accurate: boolean,
    falseCoords?: BookCoords,
): void {
    if (accurate) {
        knowledge.bookVision = { ...knowledge.lifeStory.bookCoords };
        knowledge.visionAccurate = true;
    } else {
        knowledge.bookVision = falseCoords ?? null;
        knowledge.visionAccurate = false;
    }
}
