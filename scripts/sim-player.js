#!/usr/bin/env node
/**
 * Player-centric social simulation — what does the game actually feel like?
 *
 * Outputs a day-by-day narrative from the player's perspective:
 * who you can see, who's nearby, what you hear, what happens to you.
 *
 * Usage:
 *   node scripts/sim-player.js [--entities N] [--days N] [--seed S] [--json]
 *
 * Default: human-readable narrative to stdout.
 * --json: structured JSON to stdout instead.
 */

import { seedFromString } from "../lib/prng.core.js";
import {
    createWorld, spawn, addComponent, getComponent, entitiesWith,
} from "../lib/ecs.core.js";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP, PLAYER, AI,
    deriveDisposition, psychologyDecaySystem, relationshipSystem,
    groupFormationSystem, socialPressureSystem,
    segmentDistance, canSeeAcrossChasm,
    DEFAULT_AWARENESS,
} from "../lib/social.core.js";
import { HABITUATION } from "../lib/psych.core.js";
import { PERSONALITY, generatePersonality } from "../lib/personality.core.js";
import {
    decideAction, buildAwareness, invite, dismiss, attack,
} from "../lib/actions.core.js";

// --- CLI ---

const args = process.argv.slice(2);
function arg(name, fallback) {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const ENTITY_COUNT = Number(arg("entities", 12));
const MAX_DAYS = Number(arg("days", 150));
const SEED = arg("seed", "player-view");
const JSON_MODE = args.includes("--json");
const TICKS_PER_DAY = 240;

const NAMES = [
    "Elliott", "Larisa", "Biscuit", "Betty", "Rachel",
    "Sandra", "Jed", "Julia", "Took", "Wand",
    "Treacle", "Martha", "Dale", "Connie", "Howard",
    "Mercer", "Alma", "Cedric", "Dolores", "Edmund",
    "Fatima", "Gordon", "Helena", "Ivan",
];

function pickUniqueName(rng, usedNames) {
    const available = NAMES.filter(n => !usedNames.has(n));
    if (available.length === 0) return NAMES[Math.floor(rng.next() * NAMES.length)];
    return available[Math.floor(rng.next() * available.length)];
}

// --- World setup ---

function gaussianish(rng) {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += rng.next();
    return sum - 3;
}

function createSocialWorld(seed, entityCount) {
    const world = createWorld();
    const rng = seedFromString(seed + ":spawn");

    const player = spawn(world);
    addComponent(world, player, IDENTITY, { name: "You", alive: true });
    addComponent(world, player, PSYCHOLOGY, { lucidity: 100, hope: 100 });
    addComponent(world, player, POSITION, { side: 0, position: 0, floor: 0 });
    addComponent(world, player, RELATIONSHIPS, { bonds: new Map() });
    addComponent(world, player, HABITUATION, { exposures: new Map() });
    addComponent(world, player, PERSONALITY, generatePersonality(seedFromString(seed + ":personality:player")));
    addComponent(world, player, PLAYER, {});

    const usedNames = new Set(["You"]);
    for (let i = 0; i < entityCount - 1; i++) {
        const e = spawn(world);
        const name = pickUniqueName(rng, usedNames);
        usedNames.add(name);
        const posDelta = Math.round(gaussianish(rng) * 3);
        addComponent(world, e, IDENTITY, { name, alive: true });
        addComponent(world, e, PSYCHOLOGY, { lucidity: 100, hope: 100 });
        addComponent(world, e, POSITION, { side: 0, position: posDelta, floor: 0 });
        addComponent(world, e, RELATIONSHIPS, { bonds: new Map() });
        addComponent(world, e, HABITUATION, { exposures: new Map() });
        addComponent(world, e, PERSONALITY, generatePersonality(seedFromString(seed + ":personality:" + name)));
        addComponent(world, e, AI, {});
    }
    return world;
}

// --- Player awareness snapshot ---

function playerView(world, player) {
    const pos = getComponent(world, player, POSITION);
    const psych = getComponent(world, player, PSYCHOLOGY);
    const rels = getComponent(world, player, RELATIONSHIPS);
    const group = getComponent(world, player, GROUP);

    const allEntities = entitiesWith(world, IDENTITY);
    const coLocated = [];
    const nearby = [];    // hearing range, not co-located
    const visible = [];   // sight range, not nearby
    const acrossChasm = [];

    for (const e of allEntities) {
        if (e === player) continue;
        const ident = getComponent(world, e, IDENTITY);
        if (!ident.alive) continue;
        const ePos = getComponent(world, e, POSITION);
        if (!ePos) continue;
        const ePsych = getComponent(world, e, PSYCHOLOGY);
        const dist = segmentDistance(pos, ePos);
        const disp = ePsych ? deriveDisposition(ePsych, true) : "unknown";
        const bond = rels?.bonds.get(e);
        const eGroup = getComponent(world, e, GROUP);
        const inMyGroup = group && eGroup && group.groupId === eGroup.groupId;

        const info = {
            name: ident.name,
            disposition: disp,
            distance: dist,
            familiarity: bond ? Math.round(bond.familiarity * 10) / 10 : 0,
            affinity: bond ? Math.round(bond.affinity * 10) / 10 : 0,
            inGroup: !!inMyGroup,
        };

        if (dist === 0) {
            coLocated.push(info);
        } else if (dist <= DEFAULT_AWARENESS.hearRange) {
            nearby.push(info);
        } else if (dist <= DEFAULT_AWARENESS.sightRange) {
            visible.push(info);
        } else if (canSeeAcrossChasm(pos, ePos)) {
            acrossChasm.push({ name: ident.name, disposition: disp });
        }
    }

    return {
        position: `side ${pos.side}, segment ${pos.position}, floor ${pos.floor}`,
        lucidity: Math.round(psych.lucidity * 10) / 10,
        hope: Math.round(psych.hope * 10) / 10,
        disposition: deriveDisposition(psych, true),
        grouped: !!group,
        coLocated,
        nearby,
        visible,
        acrossChasm,
    };
}

// --- NPC systems (same as sim-social) ---

function moveAIEntities(world, rng) {
    const aiEntities = entitiesWith(world, AI);
    for (const e of aiEntities) {
        const ident = getComponent(world, e, IDENTITY);
        const psych = getComponent(world, e, PSYCHOLOGY);
        if (!ident.alive) continue;
        const disp = deriveDisposition(psych, true);
        if (disp === "catatonic" || disp === "mad") continue;
        const pos = getComponent(world, e, POSITION);
        const posDelta = Math.round((rng.next() - 0.5) * 4);
        const drift = pos.position > 15 ? -1 : pos.position < -15 ? 1 : 0;
        pos.position += posDelta + drift;
        const floorDelta = rng.next() < 0.1 ? (rng.next() < 0.5 ? -1 : 1) : 0;
        pos.floor = Math.max(0, pos.floor + floorDelta);
    }
}

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
                    const ti = getComponent(world, action.target, IDENTITY);
                    events.push({ tick, type: "invite", actor: ident.name, actorId: e, target: ti?.name, targetId: action.target });
                }
                break;
            }
            case "dismiss": {
                const result = dismiss(world, e, action.target);
                if (result.type === "ok") {
                    const ti = getComponent(world, action.target, IDENTITY);
                    events.push({ tick, type: "dismiss", actor: ident.name, actorId: e, target: ti?.name, targetId: action.target });
                }
                break;
            }
            case "attack": {
                const result = attack(world, e, action.target);
                if (result.type === "ok") {
                    const ti = getComponent(world, action.target, IDENTITY);
                    events.push({ tick, type: "attack", actor: ident.name, actorId: e, target: ti?.name, targetId: action.target });
                }
                break;
            }
            case "approach": {
                const tgtPos = getComponent(world, action.target, POSITION);
                if (pos && tgtPos) {
                    const dir = tgtPos.position > pos.position ? 1 : tgtPos.position < pos.position ? -1 : 0;
                    pos.position += dir;
                }
                break;
            }
            case "flee": {
                const fromPos = getComponent(world, action.from, POSITION);
                if (pos && fromPos) {
                    const dir = pos.position >= fromPos.position ? 1 : -1;
                    pos.position += dir * 2;
                }
                break;
            }
            case "wander": {
                if (pos) pos.position += action.direction;
                break;
            }
        }
    }
    return events;
}

function resurrectDead(world, rng) {
    const entities = entitiesWith(world, IDENTITY);
    const events = [];
    for (const e of entities) {
        const ident = getComponent(world, e, IDENTITY);
        if (ident.alive) continue;
        ident.alive = true;
        const pos = getComponent(world, e, POSITION);
        if (pos) {
            pos.position += Math.round((rng.next() - 0.5) * 20);
            pos.floor = Math.max(0, pos.floor + Math.round((rng.next() - 0.5) * 4));
            pos.side = rng.next() < 0.5 ? 0 : 1;
        }
        const psych = getComponent(world, e, PSYCHOLOGY);
        if (psych) psych.hope = Math.max(0, psych.hope - 5);
        events.push({ type: "resurrect", name: ident.name, entityId: e });
    }
    return events;
}

// --- Disposition tracking for transitions ---

function getAllDispositions(world) {
    const result = new Map();
    const entities = entitiesWith(world, IDENTITY);
    for (const e of entities) {
        const ident = getComponent(world, e, IDENTITY);
        const psych = getComponent(world, e, PSYCHOLOGY);
        if (!psych) continue;
        result.set(e, { name: ident.name, disp: deriveDisposition(psych, ident.alive) });
    }
    return result;
}

// --- Narrative formatting ---

function dispWord(d) {
    switch (d) {
        case "calm": return "calm";
        case "anxious": return "anxious";
        case "mad": return "raving";
        case "catatonic": return "catatonic";
        case "dead": return "dead";
        default: return d;
    }
}

function describeEntity(info) {
    let s = info.name;
    if (info.disposition !== "calm") s += ` (${dispWord(info.disposition)})`;
    if (info.inGroup) s += " [group]";
    if (info.familiarity > 5) s += ` — fam:${info.familiarity}`;
    if (info.affinity > 3 || info.affinity < -3) s += ` aff:${info.affinity}`;
    return s;
}

function narrateDay(day, view, events, transitions, player) {
    const lines = [];
    lines.push(`\n═══ Day ${day} ═══`);
    lines.push(`  ${view.position} | ${view.disposition} | lucidity ${view.lucidity} | hope ${view.hope}`);

    // Transitions the player would notice (visible/nearby/co-located)
    if (transitions.length > 0) {
        for (const t of transitions) {
            if (t.entityId === 0) {
                lines.push(`  !! You have become ${dispWord(t.to)}`);
            } else {
                lines.push(`  !! ${t.name} has become ${dispWord(t.to)}`);
            }
        }
    }

    // Who's here
    if (view.coLocated.length > 0) {
        lines.push(`  Here with you: ${view.coLocated.map(describeEntity).join(", ")}`);
    }
    if (view.nearby.length > 0) {
        lines.push(`  Nearby: ${view.nearby.map(describeEntity).join(", ")}`);
    }
    if (view.visible.length > 0) {
        lines.push(`  In the distance: ${view.visible.map(e => e.name + (e.disposition !== "calm" ? ` (${dispWord(e.disposition)})` : "")).join(", ")}`);
    }
    if (view.acrossChasm.length > 0) {
        lines.push(`  Across the chasm: ${view.acrossChasm.map(e => e.name).join(", ")}`);
    }

    // Events that involve the player or happen at player's location
    const playerEvents = events.filter(e =>
        e.targetId === player || e.actorId === player ||
        // Events at player's location
        view.coLocated.some(c => c.name === e.actor || c.name === e.target) ||
        view.nearby.some(c => c.name === e.actor || c.name === e.target)
    );

    for (const ev of playerEvents) {
        switch (ev.type) {
            case "invite":
                if (ev.actorId === player) lines.push(`  → You invite ${ev.target} to join`);
                else if (ev.targetId === player) lines.push(`  → ${ev.actor} invites you to join them`);
                else lines.push(`  → ${ev.actor} invites ${ev.target} to join`);
                break;
            case "dismiss":
                if (ev.actorId === player) lines.push(`  → You walk away from ${ev.target}`);
                else if (ev.targetId === player) lines.push(`  → ${ev.actor} walks away from you`);
                else lines.push(`  → ${ev.actor} walks away from ${ev.target}`);
                break;
            case "attack":
                if (ev.targetId === player) lines.push(`  !! ${ev.actor} attacks you!`);
                else if (ev.actorId === player) lines.push(`  → You attack ${ev.target}`);
                else lines.push(`  !! ${ev.actor} attacks ${ev.target}!`);
                break;
            case "flee":
                if (ev.actorId === player) lines.push(`  → You flee from ${ev.from}`);
                break;
            case "approach":
                if (ev.actorId === player) lines.push(`  → You move toward ${ev.target}`);
                break;
            case "resurrect":
                if (ev.entityId === player) lines.push(`  You wake up again.`);
                break;
        }
    }

    // Quiet day?
    const total = view.coLocated.length + view.nearby.length + view.visible.length;
    if (total === 0 && playerEvents.length === 0) {
        lines.push("  You are alone.");
    }

    if (view.grouped) {
        lines.push(`  You are part of a group.`);
    }

    return lines.join("\n");
}

// --- Simulated player behavior ---

/**
 * Simple player AI: makes plausible choices a real player might.
 * Not optimal — just "what would a person do?"
 *
 * - Invite co-located calm/anxious NPCs if not grouped
 * - Flee from co-located mad NPCs
 * - Dismiss group members who've gone mad
 * - Approach visible bonded entities if alone
 */
function simulatePlayerAction(world, player, tick, rng) {
    const pos = getComponent(world, player, POSITION);
    const psych = getComponent(world, player, PSYCHOLOGY);
    const rels = getComponent(world, player, RELATIONSHIPS);
    const group = getComponent(world, player, GROUP);
    if (!pos || !psych) return null;

    const allEntities = entitiesWith(world, IDENTITY);
    const aware = buildAwareness(world, player, allEntities);

    // Flee from co-located mad NPCs
    for (const other of aware.coLocated) {
        const oPsych = getComponent(world, other, PSYCHOLOGY);
        const oIdent = getComponent(world, other, IDENTITY);
        if (!oPsych || !oIdent?.alive) continue;
        if (deriveDisposition(oPsych, true) === "mad") {
            // Run away
            const oPos = getComponent(world, other, POSITION);
            if (oPos) {
                const dir = pos.position >= oPos.position ? 1 : -1;
                pos.position += dir * 2;
            }
            return { type: "flee", from: oIdent.name };
        }
    }

    // Dismiss group members who went mad
    if (group && rels) {
        for (const other of aware.coLocated) {
            const oGroup = getComponent(world, other, GROUP);
            if (!oGroup || oGroup.groupId !== group.groupId) continue;
            const oPsych = getComponent(world, other, PSYCHOLOGY);
            const oIdent = getComponent(world, other, IDENTITY);
            if (!oPsych || !oIdent?.alive) continue;
            if (deriveDisposition(oPsych, true) === "mad") {
                dismiss(world, player, other);
                return { type: "dismiss", target: oIdent.name };
            }
        }
    }

    // Invite co-located non-grouped calm/anxious NPCs (only if we're not already grouped)
    if (!group && rng.next() < 0.15) {
        for (const other of aware.coLocated) {
            const oGroup = getComponent(world, other, GROUP);
            if (oGroup) continue; // they're already in a group
            const oPsych = getComponent(world, other, PSYCHOLOGY);
            const oIdent = getComponent(world, other, IDENTITY);
            if (!oPsych || !oIdent?.alive) continue;
            const d = deriveDisposition(oPsych, true);
            if (d === "calm" || d === "anxious") {
                const result = invite(world, player, other, rng);
                if (result.type === "ok") {
                    return { type: "invite", target: oIdent.name };
                }
            }
        }
    }

    // Approach visible bonded entities if not grouped and no one co-located
    if (!group && aware.coLocated.length === 0 && rels) {
        for (const other of aware.visible) {
            const bond = rels.bonds.get(other);
            if (bond && bond.affinity > 5) {
                const oPos = getComponent(world, other, POSITION);
                const oIdent = getComponent(world, other, IDENTITY);
                if (oPos) {
                    const dir = oPos.position > pos.position ? 1 : oPos.position < pos.position ? -1 : 0;
                    pos.position += dir;
                }
                return { type: "approach", target: oIdent?.name };
            }
        }
    }

    return null;
}

// --- Main ---

function runSimulation() {
    const world = createSocialWorld(SEED, ENTITY_COUNT);
    const player = 0;
    let totalTick = 0;

    let prevDisps = getAllDispositions(world);
    const dayLog = [];
    let lastView = null;

    console.log(`A Long Day in Hell — Social Simulation (${ENTITY_COUNT} souls, seed "${SEED}")`);
    console.log(`${"─".repeat(60)}`);

    for (let day = 1; day <= MAX_DAYS; day++) {
        const dayEvents = [];
        const dayRng = seedFromString(SEED + ":day:" + day);

        // Dawn
        const resEvents = resurrectDead(world, dayRng);
        dayEvents.push(...resEvents.map(e => ({ ...e, tick: totalTick })));
        moveAIEntities(world, dayRng);

        // Player moves too — random walk, exploring the library
        const playerPos = getComponent(world, player, POSITION);
        const pDelta = Math.round((dayRng.next() - 0.5) * 4);
        const pDrift = playerPos.position > 15 ? -1 : playerPos.position < -15 ? 1 : 0;
        playerPos.position += pDelta + pDrift;

        // Tick loop
        for (let t = 0; t < TICKS_PER_DAY; t++) {
            totalTick++;
            const tickRng = seedFromString(SEED + ":tick:" + totalTick);
            psychologyDecaySystem(world);
            relationshipSystem(world, totalTick);
            groupFormationSystem(world);
            socialPressureSystem(world);
            if (t % 10 === 0) {
                const actionEvents = executeAIActions(world, totalTick, tickRng);
                dayEvents.push(...actionEvents);

                // Player acts too
                const playerAction = simulatePlayerAction(world, player, totalTick, tickRng);
                if (playerAction) {
                    dayEvents.push({ tick: totalTick, ...playerAction, actor: "You", actorId: player });
                }
            }
        }

        // Detect disposition transitions
        const currDisps = getAllDispositions(world);
        const transitions = [];
        for (const [e, curr] of currDisps) {
            const prev = prevDisps.get(e);
            if (prev && prev.disp !== curr.disp) {
                transitions.push({ name: curr.name, from: prev.disp, to: curr.disp, entityId: e });
            }
        }
        prevDisps = currDisps;

        // Player's view of the world
        const view = playerView(world, player);

        if (JSON_MODE) {
            dayLog.push({ day, view, transitions, eventCount: dayEvents.length });
        } else {
            // Determine what changed from player's perspective
            const playerInvolved = dayEvents.some(e => e.targetId === player || e.actorId === player);
            const companionChange = transitions.length > 0;
            const newFace = view.coLocated.some(c => {
                const prev = lastView?.coLocated || [];
                return !prev.some(p => p.name === c.name);
            });
            const lostFace = (lastView?.coLocated || []).some(c => {
                return !view.coLocated.some(p => p.name === c.name);
            });
            const dispChanged = view.disposition !== (lastView?.disposition || "calm");

            const interesting = day === 1 || playerInvolved || companionChange ||
                newFace || lostFace || dispChanged;

            const lastPrintedDay = dayLog.length > 0 ? dayLog[dayLog.length - 1].day : 0;
            const total = view.coLocated.length + view.nearby.length + view.visible.length;

            if (interesting) {
                console.log(narrateDay(day, view, dayEvents, transitions, player));
                dayLog.push({ day });
            } else if (day - lastPrintedDay >= 10) {
                // Periodic check-in
                if (total === 0) {
                    console.log(`\n  ... day ${day}: silence. Lucidity ${view.lucidity}, hope ${view.hope} ...`);
                } else if (view.coLocated.length > 0) {
                    const names = view.coLocated.map(c => c.name).join(", ");
                    console.log(`\n  ... day ${day}: still with ${names}. Lucidity ${view.lucidity}, hope ${view.hope} ...`);
                } else {
                    console.log(`\n  ... day ${day}: ${total} ${total === 1 ? "soul" : "souls"} in range. Lucidity ${view.lucidity}, hope ${view.hope} ...`);
                }
                dayLog.push({ day });
            }

            lastView = view;
        }

        // Early termination
        const allNpcs = [...currDisps.values()].filter((_, i) => i > 0);
        const active = allNpcs.filter(d => d.disp === "calm" || d.disp === "anxious" || d.disp === "mad");
        if (active.length === 0 && day > 1) {
            console.log(`\n  Everyone has gone silent. Day ${day}.`);
            break;
        }
    }

    // Final state
    const view = playerView(world, player);
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Final state — Day ${dayLog.length > 0 ? MAX_DAYS : "?"}`);
    console.log(`  ${view.disposition} | lucidity ${view.lucidity} | hope ${view.hope}`);
    const nearby = view.coLocated.length + view.nearby.length + view.visible.length;
    if (nearby === 0) {
        console.log("  No one in sight.");
    } else {
        console.log(`  ${nearby} ${nearby === 1 ? "soul" : "souls"} still visible.`);
    }

    if (JSON_MODE) {
        console.log(JSON.stringify(dayLog, null, 2));
    }
}

runSimulation();
