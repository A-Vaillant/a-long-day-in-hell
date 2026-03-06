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

import type { Entity, World } from "./ecs.core.js";
import { getComponent } from "./ecs.core.js";
import {
    POSITION, IDENTITY, PSYCHOLOGY, RELATIONSHIPS, GROUP,
    type Position, type Identity, type Psychology, type Relationships, type Bond,
    type BondConfig, type DispositionThresholds,
    DEFAULT_BOND, DEFAULT_THRESHOLDS,
    coLocated, getOrCreateBond, deriveDisposition, applyShock,
} from "./social.core.js";

export interface Rng {
    next(): number;
}

// --- Action results ---

export type ActionResult =
    | { type: "ok" }
    | { type: "rejected"; reason: string }
    | { type: "impossible"; reason: string };

function ok(): ActionResult { return { type: "ok" }; }
function rejected(reason: string): ActionResult { return { type: "rejected", reason }; }
function impossible(reason: string): ActionResult { return { type: "impossible", reason }; }

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
export function inviteAcceptance(
    targetPsych: Psychology,
    targetAlive: boolean,
    bondToSource: Bond | undefined,
    thresholds: DispositionThresholds = DEFAULT_THRESHOLDS,
): number {
    if (!targetAlive) return 0;

    const disp = deriveDisposition(targetPsych, targetAlive, thresholds);

    // Base probability from disposition
    let base: number;
    switch (disp) {
        case "calm": base = 0.7; break;
        case "anxious": base = 0.4; break;
        case "mad": base = 0; break;
        case "catatonic": base = 0; break;
        default: return 0;
    }

    if (base === 0) return 0;

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
export function invite(
    world: World,
    source: Entity,
    target: Entity,
    rng: Rng,
    bondConfig: BondConfig = DEFAULT_BOND,
    thresholds: DispositionThresholds = DEFAULT_THRESHOLDS,
): ActionResult {
    const srcPos = getComponent<Position>(world, source, POSITION);
    const tgtPos = getComponent<Position>(world, target, POSITION);
    const srcIdent = getComponent<Identity>(world, source, IDENTITY);
    const tgtIdent = getComponent<Identity>(world, target, IDENTITY);
    const tgtPsych = getComponent<Psychology>(world, target, PSYCHOLOGY);
    const srcRels = getComponent<Relationships>(world, source, RELATIONSHIPS);
    const tgtRels = getComponent<Relationships>(world, target, RELATIONSHIPS);

    if (!srcPos || !tgtPos) return impossible("missing position");
    if (!srcIdent || !tgtIdent) return impossible("missing identity");
    if (!srcIdent.alive) return impossible("source is dead");
    if (!tgtIdent.alive) return impossible("target is dead");
    if (!tgtPsych) return impossible("target has no psychology");
    if (!coLocated(srcPos, tgtPos)) return impossible("not co-located");

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
        if (disp === "mad") return rejected("hostile");
        if (disp === "catatonic") return rejected("unresponsive");
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
export function dismiss(
    world: World,
    source: Entity,
    target: Entity,
    bondConfig: BondConfig = DEFAULT_BOND,
): ActionResult {
    const srcIdent = getComponent<Identity>(world, source, IDENTITY);
    const tgtIdent = getComponent<Identity>(world, target, IDENTITY);
    if (!srcIdent?.alive) return impossible("source is dead");
    if (!tgtIdent?.alive) return impossible("target is dead");

    const srcRels = getComponent<Relationships>(world, source, RELATIONSHIPS);
    const tgtRels = getComponent<Relationships>(world, target, RELATIONSHIPS);
    const tgtPsych = getComponent<Psychology>(world, target, PSYCHOLOGY);

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

    // Hope shock to the abandoned
    if (tgtPsych) {
        const srcRel = tgtRels?.bonds.get(source);
        const hopeLoss = srcRel ? Math.min(15, 3 + srcRel.familiarity / 10) : 3;
        applyShock(tgtPsych, 0, -hopeLoss);
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
export function attack(
    world: World,
    source: Entity,
    target: Entity,
    bondConfig: BondConfig = DEFAULT_BOND,
): ActionResult {
    const srcPos = getComponent<Position>(world, source, POSITION);
    const tgtPos = getComponent<Position>(world, target, POSITION);
    const srcIdent = getComponent<Identity>(world, source, IDENTITY);
    const tgtIdent = getComponent<Identity>(world, target, IDENTITY);

    if (!srcPos || !tgtPos) return impossible("missing position");
    if (!srcIdent?.alive) return impossible("source is dead");
    if (!tgtIdent?.alive) return impossible("target is dead");
    if (!coLocated(srcPos, tgtPos)) return impossible("not co-located");

    // Kill target
    tgtIdent.alive = false;

    // Psychological cost to attacker
    const srcPsych = getComponent<Psychology>(world, source, PSYCHOLOGY);
    const srcRels = getComponent<Relationships>(world, source, RELATIONSHIPS);

    if (srcPsych) {
        let hopeCost = 5; // base cost of violence
        let lucidityCost = 2;
        if (srcRels) {
            const bond = srcRels.bonds.get(target);
            if (bond && bond.familiarity > 0) {
                // Killing someone you know costs more
                hopeCost += Math.floor(bond.familiarity / 5);
                lucidityCost += Math.floor(bond.familiarity / 10);
            }
        }
        applyShock(srcPsych, -lucidityCost, -hopeCost);
    }

    // Target remembers
    const tgtRels = getComponent<Relationships>(world, target, RELATIONSHIPS);
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

// --- AI decision-making ---

/**
 * AI action types — what an NPC might choose to do on a given tick.
 */
export type AIAction =
    | { action: "idle" }
    | { action: "wander"; direction: number }  // -1 or +1 position delta
    | { action: "approach"; target: Entity }
    | { action: "flee"; from: Entity }
    | { action: "invite"; target: Entity }
    | { action: "dismiss"; target: Entity }
    | { action: "attack"; target: Entity };

/**
 * Decide what an AI entity should do this tick.
 *
 * Decision is based on psychology, bonds, and who's at the same location.
 * This is the NPC's "brain" — it produces an action, the caller executes it.
 */
export function decideAction(
    world: World,
    entity: Entity,
    coLocatedEntities: Entity[],
    rng: Rng,
    thresholds: DispositionThresholds = DEFAULT_THRESHOLDS,
): AIAction {
    const psych = getComponent<Psychology>(world, entity, PSYCHOLOGY);
    const ident = getComponent<Identity>(world, entity, IDENTITY);
    if (!psych || !ident || !ident.alive) return { action: "idle" };

    const disp = deriveDisposition(psych, true, thresholds);
    const rels = getComponent<Relationships>(world, entity, RELATIONSHIPS);
    const group = getComponent(world, entity, GROUP);

    switch (disp) {
        case "catatonic":
            // Catatonic entities do nothing
            return { action: "idle" };

        case "mad": {
            // Mad entities: attack if co-located with non-mad, otherwise idle (anchor)
            if (coLocatedEntities.length > 0) {
                // Find a non-mad, alive target
                for (const other of coLocatedEntities) {
                    const otherPsych = getComponent<Psychology>(world, other, PSYCHOLOGY);
                    const otherIdent = getComponent<Identity>(world, other, IDENTITY);
                    if (!otherPsych || !otherIdent?.alive) continue;
                    const otherDisp = deriveDisposition(otherPsych, true, thresholds);
                    if (otherDisp !== "mad" && otherDisp !== "catatonic") {
                        // Only attack with some probability — not every tick
                        if (rng.next() < 0.3) {
                            return { action: "attack", target: other };
                        }
                    }
                }
            }
            // Mad NPCs anchor — they don't wander
            return { action: "idle" };
        }

        case "anxious": {
            // Anxious: seek companionship or flee from mad
            // Check for mad entities — flee if present
            for (const other of coLocatedEntities) {
                const otherPsych = getComponent<Psychology>(world, other, PSYCHOLOGY);
                const otherIdent = getComponent<Identity>(world, other, IDENTITY);
                if (!otherPsych || !otherIdent?.alive) continue;
                const otherDisp = deriveDisposition(otherPsych, true, thresholds);
                if (otherDisp === "mad") {
                    return { action: "flee", from: other };
                }
            }

            // If not in a group, try to invite someone co-located with positive bond
            if (!group && rels) {
                for (const other of coLocatedEntities) {
                    const bond = rels.bonds.get(other);
                    if (bond && bond.affinity > 5 && bond.familiarity > 3) {
                        if (rng.next() < 0.2) {
                            return { action: "invite", target: other };
                        }
                    }
                }
            }

            // Wander with some probability
            if (rng.next() < 0.3) {
                return { action: "wander", direction: rng.next() < 0.5 ? -1 : 1 };
            }
            return { action: "idle" };
        }

        case "calm": {
            // Calm: social, exploratory
            // Flee from mad
            for (const other of coLocatedEntities) {
                const otherPsych = getComponent<Psychology>(world, other, PSYCHOLOGY);
                const otherIdent = getComponent<Identity>(world, other, IDENTITY);
                if (!otherPsych || !otherIdent?.alive) continue;
                const otherDisp = deriveDisposition(otherPsych, true, thresholds);
                if (otherDisp === "mad") {
                    if (rng.next() < 0.5) {
                        return { action: "flee", from: other };
                    }
                }
            }

            // If not in a group, try to invite co-located entities
            if (!group && rels) {
                for (const other of coLocatedEntities) {
                    const bond = rels.bonds.get(other);
                    const otherPsych = getComponent<Psychology>(world, other, PSYCHOLOGY);
                    const otherIdent = getComponent<Identity>(world, other, IDENTITY);
                    if (!otherPsych || !otherIdent?.alive) continue;
                    const otherDisp = deriveDisposition(otherPsych, true, thresholds);
                    if (otherDisp === "mad" || otherDisp === "catatonic") continue;

                    if (bond && bond.affinity > 3) {
                        if (rng.next() < 0.3) {
                            return { action: "invite", target: other };
                        }
                    } else if (!bond || bond.familiarity < 1) {
                        // Strangers: small chance to invite
                        if (rng.next() < 0.1) {
                            return { action: "invite", target: other };
                        }
                    }
                }
            }

            // Wander
            if (rng.next() < 0.4) {
                return { action: "wander", direction: rng.next() < 0.5 ? -1 : 1 };
            }
            return { action: "idle" };
        }

        default:
            return { action: "idle" };
    }
}
