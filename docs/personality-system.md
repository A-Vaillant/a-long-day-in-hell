# Personality System

## Core Idea

Each entity has fixed personality traits derived from their life story seed. These traits determine long-term compatibility between entities. Compatibility governs whether a bond stabilizes or erodes under familiarity fatigue.

Personality is who you were. Disposition is what hell does to you.

## Traits

Derived from the entity's seed (same PRNG lineage as their life story book). Fixed at spawn. Player traits come from the game seed — same seed that places your book generates your soul.

Candidate axes (all 0-1 continuous):

- **Temperament**: withdrawn (0) ↔ volatile (1) — stress response. Withdrawn people go quiet under pressure. Volatile people lash out or cling.
- **Pace**: patient (0) ↔ restless (1) — tolerance for staying in one place. Restless entities want to move. Patient ones are content to wait.
- **Openness**: guarded (0) ↔ open (1) — how readily you let people in. Affects invite acceptance and bond formation speed.
- **Outlook**: accepting (0) ↔ resistant (1) — how you frame being in hell. Accepters find peace faster. Resisters fight harder but burn out.

Four axes = 4D personality vector per entity.

## Compatibility

Compatibility between two entities is a function of their trait vectors. Not simple distance — some trait combinations mesh, others clash.

Possible rules:
- Similar temperament = compatible (you respond to stress the same way)
- Similar pace = compatible (you want the same things day to day)
- Openness: one open + one guarded can work (complementary), two guarded = slow to bond
- Outlook: mixed is interesting — an accepter can stabilize a resister, but a resister can also drag an accepter down

Compatibility score: 0-1, where 1 = perfect mesh, 0 = guaranteed friction.

## Familiarity Fatigue

Current system: co-location always increases affinity. This is wrong for long-term bonds.

Proposed: affinity gain per tick scales with a fatigue factor.

```
fatigueThreshold = compatibility * maxFamiliarity
// e.g., compatibility 0.8 → fatigue kicks in at familiarity 80

if familiarity < fatigueThreshold:
    affinity += normalRate
else:
    // Diminishing returns, eventually friction
    overshoot = (familiarity - fatigueThreshold) / (maxFamiliarity - fatigueThreshold)
    affinity += normalRate * (1 - overshoot * 2)
    // At max familiarity with low compatibility: affinity actively erodes
```

High compatibility (0.9): fatigue threshold at 90, almost never erodes. These bonds last.

Low compatibility (0.3): fatigue threshold at 30. After brief familiarity, friction starts. Bond erodes. You get sick of each other.

Medium compatibility (0.6): stable for a while, slow erosion. The relationship has a lifespan.

## Effect on Group Dynamics

- Early game: everyone bonds easily (familiarity is low, no fatigue yet). Big groups form.
- Mid game: low-compatibility bonds erode. Groups shed members naturally. Personality friction drives people apart without external force.
- Late game: only high-compatibility pairs survive. These are the stable bonds.

The player experiences this as: you click with some people and not others. Elliott is easy to be around forever. Jed gets on your nerves after two weeks. You don't know why (you don't see the numbers). It just feels that way.

## Life Story Connection

The player's personality traits come from the same seed as their life story. This means:
- Your personality is deterministic per playthrough
- It's consistent with the prose in your book (a restless, volatile person has a different life story than a patient, guarded one)
- NPCs with similar life stories have similar personalities (proximity in seed space ≈ proximity in trait space?)

## Open Questions

1. Should the player see their own traits? Probably not directly — maybe through sidebar descriptors.
2. Do traits affect anything besides compatibility? Could temperament influence which disposition you tend toward? (Volatile → faster madness, withdrawn → faster catatonia?)
3. Should traits shift over time? The doc says fixed, but extreme experiences (going mad, dying repeatedly) might leave a mark. Or is that what disposition already covers?
4. How many axes is right? Four feels like a lot for a 7DRL. Three might suffice. Two is too simple.
5. NPC dialogue could reflect personality — a restless NPC mutters about moving on, a patient one talks about waiting it out.
