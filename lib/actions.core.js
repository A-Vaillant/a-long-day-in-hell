/**
 * Action system — the shared action space for all entities.
 *
 * Actions are the verbs of the simulation. Both player input and AI
 * decision-making resolve to the same action types. The physics don't
 * care who chose the action.
 *
 * Actions modify components (position, relationships, psychology) but
 * don't read from DOM or game state. Pure logic.
 *
 * @module actions.core
 */
import { getComponent } from "./ecs.core.js";
import { POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP, DEFAULT_BOND, DEFAULT_THRESHOLDS, DEFAULT_AWARENESS, coLocated, getOrCreateBond, deriveDisposition, segmentDistance, } from "./social.core.js";
import { HABITUATION, applyShock as applyHabituatedShock, } from "./psych.core.js";
function ok() { return { type: "ok" }; }
function rejected(reason) { return { type: "rejected", reason }; }
function impossible(reason) { return { type: "impossible", reason }; }
// --- Invite ---
/**
 * Acceptance probability based on target's psychology and bond to source.
 * Returns a number 0-1.
 *
 * Factors:
 * - Target's disposition (calm = receptive, anxious = uncertain, mad = hostile, catatonic = impossible)
 * - Target's affinity toward source (higher = more likely)
 * - Target's familiarity with source (knowing someone helps)
 */
export function inviteAcceptance(targetPsych, targetAlive, bondToSource, thresholds = DEFAULT_THRESHOLDS) {
    if (!targetAlive)
        return 0;
    const disp = deriveDisposition(targetPsych, targetAlive, thresholds);
    // Base probability from disposition
    let base;
    switch (disp) {
        case "calm":
            base = 0.7;
            break;
        case "anxious":
            base = 0.4;
            break;
        case "mad":
            base = 0;
            break;
        case "catatonic":
            base = 0;
            break;
        default: return 0;
    }
    if (base === 0)
        return 0;
    // Modify by bond
    if (bondToSource) {
        // Affinity: -100 to +100, map to -0.3 to +0.3
        const affinityMod = (bondToSource.affinity / 100) * 0.3;
        // Familiarity: 0 to 100, map to 0 to +0.2
        const familiarityMod = (bondToSource.familiarity / 100) * 0.2;
        base = Math.max(0, Math.min(1, base + affinityMod + familiarityMod));
    }
    return base;
}
/**
 * Attempt to invite a target entity to join source's group.
 * Requires co-location and both alive.
 *
 * On success: boosts mutual affinity (the act of joining is bonding).
 * On rejection: small negative affinity hit to source (sting of rejection).
 */
export function invite(world, source, target, rng, bondConfig = DEFAULT_BOND, thresholds = DEFAULT_THRESHOLDS) {
    const srcPos = getComponent(world, source, POSITION);
    const tgtPos = getComponent(world, target, POSITION);
    const srcIdent = getComponent(world, source, IDENTITY);
    const tgtIdent = getComponent(world, target, IDENTITY);
    const tgtPsych = getComponent(world, target, PSYCHOLOGY);
    const srcRels = getComponent(world, source, RELATIONSHIPS);
    const tgtRels = getComponent(world, target, RELATIONSHIPS);
    if (!srcPos || !tgtPos)
        return impossible("missing position");
    if (!srcIdent || !tgtIdent)
        return impossible("missing identity");
    if (!srcIdent.alive)
        return impossible("source is dead");
    if (!tgtIdent.alive)
        return impossible("target is dead");
    if (!tgtPsych)
        return impossible("target has no psychology");
    if (!coLocated(srcPos, tgtPos))
        return impossible("not co-located");
    // Get target's bond to source (their feelings about us)
    const tgtBondToSrc = tgtRels ? tgtRels.bonds.get(source) : undefined;
    const acceptance = inviteAcceptance(tgtPsych, tgtIdent.alive, tgtBondToSrc, thresholds);
    const roll = rng.next();
    if (roll >= acceptance) {
        // Rejected — small sting
        if (srcRels) {
            const bond = getOrCreateBond(srcRels, target, 0);
            bond.affinity = Math.max(bondConfig.minAffinity, bond.affinity - 2);
        }
        const disp = deriveDisposition(tgtPsych, true, thresholds);
        if (disp === "mad")
            return rejected("hostile");
        if (disp === "catatonic")
            return rejected("unresponsive");
        return rejected("declined");
    }
    // Accepted — mutual affinity boost
    const affinityBoost = 5;
    if (srcRels) {
        const bond = getOrCreateBond(srcRels, target, 0);
        bond.affinity = Math.min(bondConfig.maxAffinity, bond.affinity + affinityBoost);
        bond.familiarity = Math.min(bondConfig.maxFamiliarity, bond.familiarity + 1);
    }
    if (tgtRels) {
        const bond = getOrCreateBond(tgtRels, source, 0);
        bond.affinity = Math.min(bondConfig.maxAffinity, bond.affinity + affinityBoost);
        bond.familiarity = Math.min(bondConfig.maxFamiliarity, bond.familiarity + 1);
    }
    return ok();
}
// --- Dismiss ---
/**
 * Voluntarily leave a companion. Source walks away from target.
 *
 * Asymmetric affinity impact: the one being left takes a bigger hit.
 */
export function dismiss(world, source, target, bondConfig = DEFAULT_BOND) {
    const srcIdent = getComponent(world, source, IDENTITY);
    const tgtIdent = getComponent(world, target, IDENTITY);
    if (!srcIdent?.alive)
        return impossible("source is dead");
    if (!tgtIdent?.alive)
        return impossible("target is dead");
    const srcRels = getComponent(world, source, RELATIONSHIPS);
    const tgtRels = getComponent(world, target, RELATIONSHIPS);
    const tgtPsych = getComponent(world, target, PSYCHOLOGY);
    // Source: mild guilt
    if (srcRels) {
        const bond = srcRels.bonds.get(target);
        if (bond) {
            bond.affinity = Math.max(bondConfig.minAffinity, bond.affinity - 3);
        }
    }
    // Target: sharper hit — being left hurts
    if (tgtRels) {
        const bond = tgtRels.bonds.get(source);
        if (bond) {
            const loss = 5 + Math.floor(bond.familiarity / 10); // worse if they knew you well
            bond.affinity = Math.max(bondConfig.minAffinity, bond.affinity - loss);
        }
    }
    // Hope shock to the abandoned (habituated)
    if (tgtPsych) {
        const tgtHabit = getComponent(world, target, HABITUATION);
        applyHabituatedShock(tgtPsych, tgtHabit, "beingDismissed");
    }
    return ok();
}
// --- Attack ---
/**
 * Attack another entity. Brutal, simple.
 *
 * Kills the target (alive = false). Costs the attacker hope (violence
 * is psychologically expensive). Costs more if there's a bond.
 *
 * The target's bond to the attacker flips to strong negative affinity
 * (they remember being killed when they resurrect).
 */
export function attack(world, source, target, bondConfig = DEFAULT_BOND) {
    const srcPos = getComponent(world, source, POSITION);
    const tgtPos = getComponent(world, target, POSITION);
    const srcIdent = getComponent(world, source, IDENTITY);
    const tgtIdent = getComponent(world, target, IDENTITY);
    if (!srcPos || !tgtPos)
        return impossible("missing position");
    if (!srcIdent?.alive)
        return impossible("source is dead");
    if (!tgtIdent?.alive)
        return impossible("target is dead");
    if (!coLocated(srcPos, tgtPos))
        return impossible("not co-located");
    // Kill target
    tgtIdent.alive = false;
    // Psychological cost to attacker (habituated)
    const srcPsych = getComponent(world, source, PSYCHOLOGY);
    const srcRels = getComponent(world, source, RELATIONSHIPS);
    if (srcPsych) {
        const srcHabit = getComponent(world, source, HABITUATION);
        applyHabituatedShock(srcPsych, srcHabit, "committingViolence");
    }
    // Target remembers
    const tgtRels = getComponent(world, target, RELATIONSHIPS);
    if (tgtRels) {
        const bond = getOrCreateBond(tgtRels, source, 0);
        bond.affinity = Math.max(bondConfig.minAffinity, bond.affinity - 50);
    }
    // Attacker's feelings: guilt if they had positive affinity
    if (srcRels) {
        const bond = srcRels.bonds.get(target);
        if (bond && bond.affinity > 0) {
            bond.affinity = Math.max(0, bond.affinity - 20);
        }
    }
    return ok();
}
/**
 * Build awareness sets for an entity based on position and awareness config.
 */
export function buildAwareness(world, entity, allEntities, awareness = DEFAULT_AWARENESS) {
    const pos = getComponent(world, entity, POSITION);
    if (!pos)
        return { coLocated: [], nearby: [], visible: [] };
    const result = { coLocated: [], nearby: [], visible: [] };
    for (const other of allEntities) {
        if (other === entity)
            continue;
        const otherIdent = getComponent(world, other, IDENTITY);
        if (!otherIdent?.alive)
            continue;
        const otherPos = getComponent(world, other, POSITION);
        if (!otherPos)
            continue;
        const dist = segmentDistance(pos, otherPos);
        if (dist === 0) {
            result.coLocated.push(other);
            result.nearby.push(other);
            result.visible.push(other);
        }
        else if (dist <= awareness.hearRange) {
            result.nearby.push(other);
            result.visible.push(other);
        }
        else if (dist <= awareness.sightRange) {
            result.visible.push(other);
        }
    }
    return result;
}
/**
 * Decide what an AI entity should do this tick.
 *
 * Uses awareness ranges: entities see others at distance and decide to
 * approach or flee before they're co-located. Invites and attacks require
 * co-location. Flee and approach work on sight range.
 */
export function decideAction(world, entity, awareness, rng, thresholds = DEFAULT_THRESHOLDS) {
    const psych = getComponent(world, entity, PSYCHOLOGY);
    const ident = getComponent(world, entity, IDENTITY);
    if (!psych || !ident || !ident.alive)
        return { action: "idle" };
    const disp = deriveDisposition(psych, true, thresholds);
    const rels = getComponent(world, entity, RELATIONSHIPS);
    const group = getComponent(world, entity, GROUP);
    const pos = getComponent(world, entity, POSITION);
    switch (disp) {
        case "catatonic":
            return { action: "idle" };
        case "mad": {
            // Mad: attack co-located non-mad, otherwise anchor
            for (const other of awareness.coLocated) {
                const otherPsych = getComponent(world, other, PSYCHOLOGY);
                const otherIdent = getComponent(world, other, IDENTITY);
                if (!otherPsych || !otherIdent?.alive)
                    continue;
                const otherDisp = deriveDisposition(otherPsych, true, thresholds);
                if (otherDisp !== "mad" && otherDisp !== "catatonic") {
                    if (rng.next() < 0.3) {
                        return { action: "attack", target: other };
                    }
                }
            }
            return { action: "idle" };
        }
        case "anxious": {
            // Flee from visible mad entities
            for (const other of awareness.visible) {
                const otherPsych = getComponent(world, other, PSYCHOLOGY);
                const otherIdent = getComponent(world, other, IDENTITY);
                if (!otherPsych || !otherIdent?.alive)
                    continue;
                if (deriveDisposition(otherPsych, true, thresholds) === "mad") {
                    return { action: "flee", from: other };
                }
            }
            // Approach visible entities with positive bond (seek companionship)
            if (!group && rels && pos) {
                for (const other of awareness.visible) {
                    if (awareness.coLocated.includes(other))
                        continue; // already here
                    const bond = rels.bonds.get(other);
                    if (bond && bond.affinity > 3 && bond.familiarity > 2) {
                        if (rng.next() < 0.4) {
                            return { action: "approach", target: other };
                        }
                    }
                }
            }
            // Invite co-located bonded entities
            if (!group && rels) {
                for (const other of awareness.coLocated) {
                    const bond = rels.bonds.get(other);
                    if (bond && bond.affinity > 5 && bond.familiarity > 3) {
                        if (rng.next() < 0.2) {
                            return { action: "invite", target: other };
                        }
                    }
                }
            }
            if (rng.next() < 0.3) {
                return { action: "wander", direction: rng.next() < 0.5 ? -1 : 1 };
            }
            return { action: "idle" };
        }
        case "calm": {
            // Flee from visible mad (with some courage)
            for (const other of awareness.visible) {
                const otherPsych = getComponent(world, other, PSYCHOLOGY);
                const otherIdent = getComponent(world, other, IDENTITY);
                if (!otherPsych || !otherIdent?.alive)
                    continue;
                if (deriveDisposition(otherPsych, true, thresholds) === "mad") {
                    if (rng.next() < 0.5) {
                        return { action: "flee", from: other };
                    }
                }
            }
            // Approach visible entities (social, curious)
            if (!group && rels && pos) {
                for (const other of awareness.visible) {
                    if (awareness.coLocated.includes(other))
                        continue;
                    const otherPsych = getComponent(world, other, PSYCHOLOGY);
                    const otherIdent = getComponent(world, other, IDENTITY);
                    if (!otherPsych || !otherIdent?.alive)
                        continue;
                    const otherDisp = deriveDisposition(otherPsych, true, thresholds);
                    if (otherDisp === "mad" || otherDisp === "catatonic")
                        continue;
                    const bond = rels.bonds.get(other);
                    // Approach people you know, or strangers (curiosity)
                    if (bond && bond.affinity > 3) {
                        if (rng.next() < 0.5) {
                            return { action: "approach", target: other };
                        }
                    }
                    else if (!bond || bond.familiarity < 1) {
                        if (rng.next() < 0.2) {
                            return { action: "approach", target: other };
                        }
                    }
                }
            }
            // Invite co-located entities
            if (!group && rels) {
                for (const other of awareness.coLocated) {
                    const otherPsych = getComponent(world, other, PSYCHOLOGY);
                    const otherIdent = getComponent(world, other, IDENTITY);
                    if (!otherPsych || !otherIdent?.alive)
                        continue;
                    const otherDisp = deriveDisposition(otherPsych, true, thresholds);
                    if (otherDisp === "mad" || otherDisp === "catatonic")
                        continue;
                    const bond = rels.bonds.get(other);
                    if (bond && bond.affinity > 3) {
                        if (rng.next() < 0.3) {
                            return { action: "invite", target: other };
                        }
                    }
                    else if (!bond || bond.familiarity < 1) {
                        if (rng.next() < 0.1) {
                            return { action: "invite", target: other };
                        }
                    }
                }
            }
            if (rng.next() < 0.4) {
                return { action: "wander", direction: rng.next() < 0.5 ? -1 : 1 };
            }
            return { action: "idle" };
        }
        default:
            return { action: "idle" };
    }
}
