#!/usr/bin/env node
/**
 * Social physics simulation — headless runner for the ECS-based social system.
 *
 * Spawns entities, runs tick/day loops, reports emergent behavior:
 * group formation, disposition shifts, attacks, deaths, the arc.
 *
 * Usage:
 *   node scripts/sim-social.js [--entities N] [--days N] [--seed S] [--verbose]
 *
 * Output: JSON timeline to stdout. Human-readable log to stderr if --verbose.
 */

import { seedFromString } from "../lib/prng.core.js";
import {
    createWorld, spawn, addComponent, getComponent, entitiesWith,
} from "../lib/ecs.core.js";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP, PLAYER, AI,
    deriveDisposition, psychologyDecaySystem, relationshipSystem,
    groupFormationSystem, socialPressureSystem,
    DEFAULT_DECAY, DEFAULT_BOND, DEFAULT_GROUP, DEFAULT_THRESHOLDS,
} from "../lib/social.core.js";
import { HABITUATION } from "../lib/psych.core.js";
import {
    decideAction, buildAwareness, invite, dismiss, attack,
} from "../lib/actions.core.js";

// --- CLI args ---

const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const ENTITY_COUNT = Number(arg("entities", 12));
const MAX_DAYS = Number(arg("days", 100));
const SEED = arg("seed", "social-sim-default");
const VERBOSE = args.includes("--verbose");
const TICKS_PER_DAY = 240;

const NAMES = [
    "Elliott", "Larisa", "Biscuit", "Betty", "Rachel",
    "Sandra", "Jed", "Julia", "Took", "Wand",
    "Treacle", "Martha", "Dale", "Connie", "Howard",
    "Mercer", "Alma", "Cedric", "Dolores", "Edmund",
    "Fatima", "Gordon", "Helena", "Ivan",
];

// --- Setup ---

function log(...args) {
    if (VERBOSE) console.error(...args);
}

function gaussianish(rng) {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += rng.next();
    return sum - 3;
}

function createSocialWorld(seed, entityCount) {
    const world = createWorld();
    const rng = seedFromString(seed + ":spawn");

    // Player is entity 0
    const player = spawn(world);
    addComponent(world, player, IDENTITY, { name: "You", alive: true });
    addComponent(world, player, PSYCHOLOGY, { lucidity: 100, hope: 100 });
    addComponent(world, player, POSITION, { side: 0, position: 0, floor: 0 });
    addComponent(world, player, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, player, HABITUATION, { exposures: new Map() });
    addComponent(world, player, PLAYER, {});

    // NPCs
    for (let i = 0; i < entityCount - 1; i++) {
        const e = spawn(world);
        const nameIdx = Math.floor(rng.next() * NAMES.length);
        const posDelta = Math.round(gaussianish(rng) * 3); // tight cluster
        addComponent(world, e, IDENTITY, { name: NAMES[nameIdx], alive: true });
        addComponent(world, e, PSYCHOLOGY, { lucidity: 100, hope: 100 });
        addComponent(world, e, POSITION, {
            side: 0,               // all on same side initially
            position: posDelta,
            floor: 0,              // all on same floor initially
        });
        addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
        addComponent(world, e, HABITUATION, { exposures: new Map() });
        addComponent(world, e, AI, {});
    }

    return world;
}

function getDisposition(world, entity) {
    const psych = getComponent(world, entity, PSYCHOLOGY);
    const ident = getComponent(world, entity, IDENTITY);
    if (!psych || !ident) return "unknown";
    return deriveDisposition(psych, ident.alive);
}

function snapshot(world) {
    const entities = entitiesWith(world, IDENTITY);
    const snap = [];
    for (const e of entities) {
        const ident = getComponent(world, e, IDENTITY);
        const psych = getComponent(world, e, PSYCHOLOGY);
        const pos = getComponent(world, e, POSITION);
        const group = getComponent(world, e, GROUP);
        const rels = getComponent(world, e, RELATIONSHIPS);

        let bondCount = 0;
        let strongestBond = null;
        if (rels) {
            for (const [other, bond] of rels.bonds) {
                if (bond.familiarity > 1) bondCount++;
                if (!strongestBond || bond.affinity > strongestBond.affinity) {
                    const otherIdent = getComponent(world, other, IDENTITY);
                    strongestBond = {
                        target: otherIdent ? otherIdent.name : "?",
                        familiarity: Math.round(bond.familiarity * 10) / 10,
                        affinity: Math.round(bond.affinity * 10) / 10,
                    };
                }
            }
        }

        snap.push({
            id: e,
            name: ident.name,
            alive: ident.alive,
            disposition: psych ? deriveDisposition(psych, ident.alive) : "dead",
            lucidity: psych ? Math.round(psych.lucidity * 10) / 10 : 0,
            hope: psych ? Math.round(psych.hope * 10) / 10 : 0,
            position: pos ? `${pos.side}:${pos.position}:${pos.floor}` : "?",
            groupId: group ? group.groupId : null,
            bonds: bondCount,
            strongestBond,
        });
    }
    return snap;
}

function dispositionCounts(world) {
    const counts = { calm: 0, anxious: 0, mad: 0, catatonic: 0, dead: 0 };
    const entities = entitiesWith(world, IDENTITY);
    for (const e of entities) {
        if (getComponent(world, e, PLAYER)) continue; // skip player
        const d = getDisposition(world, e);
        counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
}

function groupCounts(world) {
    const groups = new Map();
    const entities = entitiesWith(world, GROUP);
    for (const e of entities) {
        const g = getComponent(world, e, GROUP);
        groups.set(g.groupId, (groups.get(g.groupId) || 0) + 1);
    }
    return groups.size;
}

// --- NPC movement (simple random walk for AI entities) ---

function moveAIEntities(world, rng) {
    const aiEntities = entitiesWith(world, AI);
    for (const e of aiEntities) {
        const ident = getComponent(world, e, IDENTITY);
        const psych = getComponent(world, e, PSYCHOLOGY);
        if (!ident.alive) continue;

        const disp = deriveDisposition(psych, true);
        // Catatonic and mad don't move (mad anchor per design)
        if (disp === "catatonic" || disp === "mad") continue;

        const pos = getComponent(world, e, POSITION);

        // Small random walk — NPCs stay in a neighborhood
        const posDelta = Math.round((rng.next() - 0.5) * 4);
        // Drift back toward center (soft boundary at ~20 segments)
        const drift = pos.position > 15 ? -1 : pos.position < -15 ? 1 : 0;
        pos.position += posDelta + drift;

        // Rare floor changes
        const floorDelta = rng.next() < 0.1 ? (rng.next() < 0.5 ? -1 : 1) : 0;
        pos.floor = Math.max(0, pos.floor + floorDelta);
    }
}

// --- AI action execution ---

function executeAIActions(world, tick, rng) {
    const aiEntities = entitiesWith(world, AI);
    const allEntities = entitiesWith(world, IDENTITY);
    const events = [];

    for (const e of aiEntities) {
        const ident = getComponent(world, e, IDENTITY);
        if (!ident.alive) continue;

        const pos = getComponent(world, e, POSITION);
        const aware = buildAwareness(world, e, allEntities);
        const action = decideAction(world, e, aware, rng);

        switch (action.action) {
            case "invite": {
                const result = invite(world, e, action.target, rng);
                if (result.type === "ok") {
                    const targetIdent = getComponent(world, action.target, IDENTITY);
                    events.push({
                        tick, type: "invite",
                        actor: ident.name, target: targetIdent?.name,
                    });
                }
                break;
            }
            case "dismiss": {
                const result = dismiss(world, e, action.target);
                if (result.type === "ok") {
                    const targetIdent = getComponent(world, action.target, IDENTITY);
                    events.push({
                        tick, type: "dismiss",
                        actor: ident.name, target: targetIdent?.name,
                    });
                }
                break;
            }
            case "attack": {
                const result = attack(world, e, action.target);
                if (result.type === "ok") {
                    const targetIdent = getComponent(world, action.target, IDENTITY);
                    events.push({
                        tick, type: "attack",
                        actor: ident.name, target: targetIdent?.name,
                    });
                }
                break;
            }
            case "approach": {
                // Move toward target
                const tgtPos = getComponent(world, action.target, POSITION);
                if (pos && tgtPos) {
                    const dir = tgtPos.position > pos.position ? 1 :
                                tgtPos.position < pos.position ? -1 : 0;
                    pos.position += dir;
                }
                const tgtIdent = getComponent(world, action.target, IDENTITY);
                events.push({
                    tick, type: "approach",
                    actor: ident.name, target: tgtIdent?.name,
                });
                break;
            }
            case "flee": {
                // Move away from threat
                const fromPos = getComponent(world, action.from, POSITION);
                if (pos && fromPos) {
                    const dir = pos.position >= fromPos.position ? 1 : -1;
                    pos.position += dir * 2;
                }
                const fromIdent = getComponent(world, action.from, IDENTITY);
                events.push({
                    tick, type: "flee",
                    actor: ident.name, from: fromIdent?.name,
                });
                break;
            }
            case "wander": {
                if (pos) pos.position += action.direction;
                break;
            }
            // idle: do nothing
        }
    }
    return events;
}

// --- Resurrection at dawn ---

function resurrectDead(world, rng) {
    const entities = entitiesWith(world, IDENTITY);
    const events = [];
    for (const e of entities) {
        const ident = getComponent(world, e, IDENTITY);
        if (ident.alive) continue;
        // Resurrect
        ident.alive = true;
        // Relocate randomly (canon: come back somewhere else)
        const pos = getComponent(world, e, POSITION);
        if (pos) {
            pos.position += Math.round((rng.next() - 0.5) * 20);
            pos.floor = Math.max(0, pos.floor + Math.round((rng.next() - 0.5) * 4));
            pos.side = rng.next() < 0.5 ? 0 : 1;
        }
        // Psychology: hope takes a hit from dying
        const psych = getComponent(world, e, PSYCHOLOGY);
        if (psych) {
            psych.hope = Math.max(0, psych.hope - 5);
        }
        events.push({ type: "resurrect", name: ident.name });
    }
    return events;
}

// --- Main simulation loop ---

function runSimulation() {
    const world = createSocialWorld(SEED, ENTITY_COUNT);
    const timeline = [];
    const daySnapshots = [];

    log(`Social simulation: ${ENTITY_COUNT} entities, ${MAX_DAYS} days, seed "${SEED}"`);
    log("---");

    let totalTick = 0;

    for (let day = 1; day <= MAX_DAYS; day++) {
        const dayEvents = [];
        const dayRng = seedFromString(SEED + ":day:" + day);

        // Dawn: resurrect dead, move NPCs
        const resEvents = resurrectDead(world, dayRng);
        dayEvents.push(...resEvents.map(e => ({ ...e, tick: totalTick })));
        moveAIEntities(world, dayRng);

        // Run ticks for this day
        for (let t = 0; t < TICKS_PER_DAY; t++) {
            totalTick++;
            const tickRng = seedFromString(SEED + ":tick:" + totalTick);

            // 1. Psychology decay
            psychologyDecaySystem(world);

            // 2. Relationship updates
            relationshipSystem(world, totalTick);

            // 3. Group formation
            groupFormationSystem(world);

            // 4. Social pressure (Direite effect)
            socialPressureSystem(world);

            // 5. AI actions (every 10 ticks — not every single tick)
            if (t % 10 === 0) {
                const actionEvents = executeAIActions(world, totalTick, tickRng);
                dayEvents.push(...actionEvents);
            }
        }

        // End-of-day snapshot
        const disp = dispositionCounts(world);
        const groups = groupCounts(world);
        const playerPsych = getComponent(world, 0, PSYCHOLOGY);
        const playerGroup = getComponent(world, 0, GROUP);

        const daySummary = {
            day,
            dispositions: disp,
            groups,
            playerLucidity: playerPsych ? Math.round(playerPsych.lucidity * 10) / 10 : 0,
            playerHope: playerPsych ? Math.round(playerPsych.hope * 10) / 10 : 0,
            playerGrouped: playerGroup !== undefined,
            events: dayEvents.length,
            attacks: dayEvents.filter(e => e.type === "attack").length,
            deaths: dayEvents.filter(e => e.type === "attack").length,
        };

        daySnapshots.push(daySummary);

        if (dayEvents.length > 0) {
            log(`Day ${day}: ${disp.calm}c ${disp.anxious}a ${disp.mad}m ${disp.catatonic}k ${disp.dead}d | ${groups} groups | ${dayEvents.length} events`);
            for (const ev of dayEvents) {
                if (ev.type !== "wander") {
                    log(`  ${ev.type}: ${ev.actor || ev.name}${ev.target ? " → " + ev.target : ""}${ev.from ? " (from " + ev.from + ")" : ""}`);
                }
            }
        } else {
            log(`Day ${day}: ${disp.calm}c ${disp.anxious}a ${disp.mad}m ${disp.catatonic}k ${disp.dead}d | ${groups} groups | quiet`);
        }

        // Early termination: all NPCs dead or catatonic
        const activeNpcs = disp.calm + disp.anxious + disp.mad;
        if (activeNpcs === 0 && day > 1) {
            log(`\nAll NPCs inactive by day ${day}. Simulation ends.`);
            break;
        }
    }

    // Final snapshot with full entity detail
    const finalSnap = snapshot(world);

    const output = {
        config: { entities: ENTITY_COUNT, days: MAX_DAYS, seed: SEED },
        timeline: daySnapshots,
        finalState: finalSnap,
        summary: {
            totalDays: daySnapshots.length,
            firstAnxious: daySnapshots.find(d => d.dispositions.anxious > 0)?.day || null,
            firstMad: daySnapshots.find(d => d.dispositions.mad > 0)?.day || null,
            firstCatatonic: daySnapshots.find(d => d.dispositions.catatonic > 0)?.day || null,
            firstDeath: daySnapshots.find(d => d.dispositions.dead > 0)?.day || null,
            totalAttacks: daySnapshots.reduce((a, d) => a + d.attacks, 0),
            peakGroups: Math.max(...daySnapshots.map(d => d.groups)),
            finalPlayerLucidity: daySnapshots[daySnapshots.length - 1]?.playerLucidity,
            finalPlayerHope: daySnapshots[daySnapshots.length - 1]?.playerHope,
        },
    };

    console.log(JSON.stringify(output, null, 2));
}

runSimulation();
