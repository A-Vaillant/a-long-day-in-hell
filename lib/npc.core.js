/** NPC system — other people trapped in the library. */
export const DISPOSITIONS = ["calm", "anxious", "mad", "catatonic"];
/** Box-Muller approximation via sum of 6 uniforms. */
function gaussianish(rng) {
    let sum = 0;
    for (let i = 0; i < 6; i++)
        sum += rng.next();
    return sum - 3;
}
const DEFAULT_SPAWN = { positionSpread: 20, floorSpread: 5, sameSide: false, idOffset: 0 };
/** Spawn NPCs near a player location. Names passed in from content. */
export function spawnNPCs(playerLoc, count, names, rng, config = DEFAULT_SPAWN) {
    const npcs = [];
    const usedNames = new Set();
    for (let i = 0; i < count; i++) {
        let nameIdx = Math.floor(rng.next() * names.length);
        // Avoid duplicate names when we have enough names
        if (usedNames.size < names.length) {
            while (usedNames.has(nameIdx)) {
                nameIdx = (nameIdx + 1) % names.length;
            }
        }
        usedNames.add(nameIdx);
        const posDelta = Math.round(gaussianish(rng) * config.positionSpread);
        const floorDelta = Math.round(gaussianish(rng) * config.floorSpread);
        const floor = Math.max(0, playerLoc.floor + floorDelta);
        npcs.push({
            id: config.idOffset + i,
            name: names[nameIdx],
            side: config.sameSide ? playerLoc.side : (rng.next() < 0.5 ? 0 : 1),
            position: playerLoc.position + posDelta,
            floor,
            disposition: "calm",
            daysMet: 0,
            lastSeenDay: 0,
            alive: true,
        });
    }
    return npcs;
}
/** Daily random walk for all living, non-catatonic NPCs. */
export function moveNPCs(npcs, rng) {
    return npcs.map(npc => {
        if (!npc.alive || npc.disposition === "catatonic") {
            return { ...npc };
        }
        const posDelta = Math.round((rng.next() - 0.5) * 10);
        const floorDelta = rng.next() < 0.3 ? (rng.next() < 0.5 ? -1 : 1) : 0;
        return {
            ...npc,
            position: npc.position + posDelta,
            floor: Math.max(0, npc.floor + floorDelta),
        };
    });
}
/** Filter NPCs at a specific location. */
export function getNPCsAt(npcs, side, position, floor) {
    return npcs.filter(n => n.side === side && n.position === position && n.floor === floor);
}
/**
 * Daily deterioration check. Chance of degrading increases with day count.
 */
export function deteriorate(npc, day, rng) {
    if (!npc.alive)
        return { ...npc };
    const result = { ...npc };
    const chance = Math.min(0.8, day / 100);
    const roll = rng.next();
    if (result.disposition === "catatonic") {
        if (roll < chance * 0.3) {
            result.alive = false;
        }
        return result;
    }
    if (roll < chance) {
        const idx = DISPOSITIONS.indexOf(result.disposition);
        if (idx < DISPOSITIONS.length - 1) {
            result.disposition = DISPOSITIONS[idx + 1];
        }
    }
    return result;
}
/** Get interaction text. Dialogue table passed in from content. */
export function interactText(npc, dialogue, rng) {
    const pool = npc.alive ? dialogue[npc.disposition] : dialogue.dead;
    const idx = Math.floor(rng.next() * pool.length);
    return pool[idx];
}
