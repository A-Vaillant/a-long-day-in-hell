# Social System Design

## Thesis

The game's core loop shifts from solitary book-search to social survival. You are a social animal in an infinite library. You need people to stay sane, to learn things, to cover ground. People break. The search is still the goal, but the game is about the people you meet along the way.

Solo play is mechanically punishing — slow movement, morale drain. Companion play accelerates time, stabilizes morale, and unlocks knowledge. The tension: everyone you invest in will eventually deteriorate, go mad, or die. The library outlasts all relationships.

## Companion System

### Joining

When an NPC is present at your location, you can **invite** them. Acceptance depends on:
- Their disposition (calm: likely, anxious: coin flip, mad: refuses or attacks, catatonic: impossible)
- Your existing relationship (higher shared time = more likely)
- Whether they already have a companion (NPCs pair with each other too)

Maximum party size: 2 (you + 1). The book is about dyads — Soren/Rachel, Soren/Wand, Soren/Sandra. Groups exist in the background but you travel in pairs.

### Departure

Companions leave when:
- Their disposition worsens past a threshold relative to yours
- You've been together long enough that "there's nothing left to say" (the billion-year dissolution)
- They die and resurrect elsewhere (dawn reset can separate you)
- They jump into the chasm
- They go catatonic (they stop, you choose to stay or leave)
- Random chance, weighted by disposition and relationship length

Departure is not a failure state you can prevent indefinitely. It's entropy.

### Companion Activities

While traveling with a companion, all actions are shared. The key mechanic: **time acceleration**. Actions with a companion burn more ticks but accomplish more and sustain morale.

| Activity | Solo ticks | Companion ticks | Effect |
|----------|-----------|-----------------|--------|
| Move (corridor) | 1 | 1 | Same speed, but companion provides morale buffer |
| Search shelf | 1 | 5-10 | Check more books, companion might notice fragments |
| Rest (sit together) | 1 | 10-50 | Major morale restoration, relationship deepens |
| Walk (extended) | N/A | 20-100 | Move multiple segments, time passes in bulk, dialogue emerges |
| Give item | 1 | 1 | Transfer held item, relationship effect |

The time acceleration means days and weeks pass during companion activities. The game timescale shifts from hours to years. Solo, you're grinding tick by tick. Together, you're living.

### Survival During Time Skips

Survival stats (hunger, thirst, exhaustion) are **auto-managed** during companion activities. Kiosks are at every rest area, food is free and unlimited. When you walk or search with a companion, you're passing rest areas — you eat, drink, sleep in the bedrooms. This is implied, not simulated. The narrative skips over it because it's trivial.

Mechanically: companion time-skip actions reset hunger/thirst/exhaustion to comfortable levels on completion. Survival only threatens you when solo, falling, or separated from rest areas (deep exploration).

This mirrors the book: Soren never worries about food except during freefall. The kiosk always provides. Survival is a pressure on the alone and the falling, not on people living their lives.

## Relationship State

Per NPC, tracked in `state.npcs[id]`:

```
sharedTicks: number      // total ticks spent together
activitiesDone: {        // counts per activity type
  walk: number,
  search: number,
  rest: number,
  give: number,
}
knowledgeShared: string[] // recipe IDs they've taught you
disposition_when_met: Disposition  // snapshot for dialogue
met_day: number          // first encounter
last_together_day: number
departed: boolean        // left voluntarily
departed_reason: string  // "nothing left to say", "jumped", "went mad"
```

## NPC-NPC Relationships

NPCs form bonds with each other offscreen. When you encounter an NPC, they may:
- Be traveling with another NPC (pair)
- Reference someone they lost ("Biscuit stopped talking. I left him on floor 4.")
- Be part of a mad group (Direite pattern — 2-3 mad NPCs at same location)

Implementation: on daily tick, NPCs at the same location build a simple co-location counter. NPCs with high co-location travel together (move as unit). Mad NPCs with co-location form hostile groups.

## Knowledge Transfer

NPCs know things. Knowledge is recipes — specific items you can order from the kiosk once you know they're possible.

### Knowledge Table

| Recipe | Source | Requires | Effect |
|--------|--------|----------|--------|
| bone_knife | Any calm/anxious NPC, random chance | Lamb shank bone + cloth strips | Suicide tool, combat weapon |
| telescope | NPC with high sharedTicks | Kiosk lenses + tube | See NPCs/features 3 segments away |
| pillowcase_bag | Any NPC, early conversation | Pillowcase | +3 inventory slots |
| alcohol_flask | Any NPC who mentions drinking | Flask + alcohol | Portable morale boost, addictive? |
| cloth_strips | Trivial, any NPC | Bedsheet | Tying, binding, crafting component |
| bone_flute | NPC with disposition anxious+ | Turkey bones | Morale tool? Attracts/repels NPCs? |

Knowledge transfer happens probabilistically during companion activities. Higher sharedTicks = more likely to learn something. Each NPC has a seeded subset of knowledge they can share (not all NPCs know all recipes).

A calm NPC might say: "You can get bones from the kiosk. Ask for a lamb shank. The bone is good for... things."

A mad NPC might say: "THE KNIFE. THE KNIFE IS THE KEY. ORDER THE BONES." (Same knowledge, different framing. Still valid.)

A catatonic NPC shares nothing.

## Combat

Mad NPCs in groups (2+) at the same location become hostile. The Direite pattern.

Combat is simple and brutal:
- If you have a knife: you can fight. Kill attacker (they resurrect at dawn, elsewhere). You take morale damage from the act.
- If you don't: you flee (costs ticks, might fail) or die (resurrect at dawn).
- If your companion is present: they might help, flee, or freeze depending on disposition.
- Killing someone you have relationship history with costs more morale.

Combat is not the point. It's a consequence of social decay. The horror is that the person attacking you used to be calm. You might have walked with them.

**Spawn camping is canon.** If you resurrect among hostile mad NPCs, you're trapped in a death loop — killed repeatedly, seconds of consciousness each time. The escape is the chasm: tackle someone over the railing, fall, crash back in elsewhere. The chasm's role expands from suicide/despair to emergency escape from unwinnable social situations. This mirrors Soren's escape from the Direites exactly.

## Morale Rework

Current: morale drains from events and ticks, restored by sleep and kiosk.

New model:
- **Solo drain**: morale decays faster when alone. Baseline drain per tick while solo.
- **Companion buffer**: companion presence halves or eliminates passive morale drain.
- **Social restoration**: resting with a companion is the primary morale restore. Sleep alone barely helps.
- **Loss penalty**: when a companion departs, dies, or goes catatonic, sharp morale hit proportional to sharedTicks.
- **Violence cost**: killing an NPC costs morale. More if you knew them.
- **Despairing rework**: morale 0 still triggers despairing, but now it's harder to recover alone. You need someone to pull you back. "Are you real?"

## Dialogue Generation

Not scripted conversations. Contextual fragments based on state:

- **Disposition lines**: existing system, expanded per disposition
- **Relationship lines**: triggered by sharedTicks thresholds ("We've been walking a long time." / "Remember when we searched floor 7?")
- **Knowledge lines**: precede recipe transfer ("You can get anything from the kiosk, you know. Anything.")
- **Reference lines**: NPC mentions another NPC by name ("Have you seen Rachel? She was... she wasn't doing well.")
- **Departure lines**: spoken when leaving ("I think I need to walk alone for a while." / "There's nothing left to say, is there?")
- **Exhaustion lines**: as shared time accumulates past a threshold, dialogue quality degrades. Lines get shorter, less specific, more interchangeable. Silences appear ("..."). They repeat things they've said before. No UI indicator — the player feels the relationship dying through the text thinning out. By the time they leave, it's not a surprise.
- **Activity-specific**: emerge during walk/search/rest ("Look at this one — almost a word." / "The carpet is the same everywhere. I counted the patterns.")

Template system: `"${name} and I walked for ${days} days once. ${outcome}."` Filled from state. Stored in content JSON, not code.

## Time and Scale

The game currently runs in ticks (sub-day). With companion time acceleration, the player experiences:
- Solo: tick-by-tick, hours pass. Grinding.
- Companion walk: 20-100 ticks. Days to weeks.
- Companion rest: 10-50 ticks. Days.

Over a play session, the player might span months to years. NPC deterioration is keyed to days, so companions met early will degrade during the session. The player witnesses the arc.

Day counter display shifts: "Day 1" ... "Day 47" ... "Day 312" ... "Year 3" ... "Year 41."

## Player Actions (Updated)

At corridor with NPC present:
- `T` — talk/interact (initiates activity menu if not companion, dialogue if companion)
- `I` — invite to travel together (if not already companion)

With companion:
- `W` — walk together (extended movement, time passes)
- `S` — search together (bulk book checking)
- `R` — rest together (sit, morale restoration)
- `G` — give item
- `L` — leave companion (you walk away)

These replace or augment the existing movement keys contextually.

## Implementation Phases

### Phase 1: Companion Join/Leave (foundation)
- Invite mechanic, acceptance logic
- Companion follows player movement
- Departure conditions (disposition, time, random)
- Companion shown in sidebar
- Basic companion dialogue (reuse existing + relationship lines)

### Phase 2: Time Acceleration and Activities
- Walk/search/rest as companion activities
- Tick multiplication for companion actions
- Morale rework (solo drain, companion buffer, loss penalty)
- Day display scaling

### Phase 3: Knowledge Transfer
- Recipe table in content JSON
- Per-NPC knowledge seeding
- Transfer probability during activities
- Kiosk integration (can only order known recipes)

### Phase 4: Combat and Mad Groups
- NPC co-location tracking, group formation
- Hostile encounter at location with mad group
- Fight/flee resolution
- Knife as combat tool

### Phase 5: Dialogue Expansion
- Template system with state interpolation
- Reference lines (NPC mentions NPC)
- Activity-specific lines
- Departure lines

## What This Cuts

- Inventory milestone as designed (replaced by knowledge/recipe system — items come from kiosk, not loot)
- Complex item management (you carry: book, knife, bag, flask. That's it.)
- Any notion of the library as a puzzle to solve mechanically

## What This Preserves

- Library geometry, PRNG, book generation, target book
- Survival stats (hunger, thirst, exhaustion)
- Event deck (recontextualized: events happen during time skips)
- Death/resurrection cycle
- The chasm
- The search as nominal win condition
- Despairing condition

## Item Persistence

Items persist through death. You resurrect at dawn holding what you had. Knowledge persists permanently (it's in your head). This matches canon — the only thing that resets is books on shelves and dead bodies.

NPCs also retain their items through death/resurrection. A mad NPC with a knife is still armed when they come back.

## Design Philosophy

The social system isn't interesting because NPCs do cute things. It's interesting because the player is forced into decisions where every option costs something and the costs are people.

### Hard Choices the System Should Produce

**The mercy kill.** Your companion is going mad. You have a knife. They're about to become dangerous. Do you kill them now while they still know you, or do you wait and see if they stabilize — knowing that if they don't, they might kill you, or join other mad NPCs and become part of something you can't stop?

**The triage.** Two NPCs you know are at the same location. One is calm, one is anxious. You can only companion one. The other will drift. Whoever you don't pick deteriorates faster alone. You're choosing who lives longer.

**The blockade.** A mad group is forming near your target book's area. You can avoid it and search elsewhere (giving up your best lead), or push through and risk the death loop.

**The anchor.** Your companion is stable, your morale is good, but you're nowhere near your target book. Do you leave them to go search (losing the relationship, their morale drops without you) or stay in a place that's comfortable but unproductive?

**The cost of violence.** You can fight through the mad group. You have a knife. But every kill costs morale, and some of them might be people you knew when they were calm. The mechanically optimal play (clear the area, search the shelves) is emotionally expensive.

The system should generate these situations *emergently*, not through scripted triggers. Mad groups form because mad NPCs co-locate. The blockade happens because their random walk converged on your search area. The triage happens because disposition deterioration is probabilistic and two NPCs hit different stages at the same time. The player encounters dilemmas because the clockwork produced them, not because we wrote them.

### Emergent Behaviors Worth Building

**Cult formation.** Two or more mad NPCs at the same location become a group. They stop random-walking and anchor to that location. Anxious NPCs nearby get pulled in (accelerated deterioration to mad, then they anchor too). The group grows. This is the Direite pattern — it emerges from co-location rules, not scripted events.

## Open Questions

- Should the player be able to influence NPC disposition directly, or only slow deterioration?
- Can two mad NPCs form a "cult" that recruits anxious NPCs?
- Does the telescope actually help find your book, or is it social (see people at distance)?
- How does resurrection interact with companions? If you die and come back, is your companion gone?
- ~~Should there be a "deep time" endgame where all NPCs are dead and you're truly alone?~~ **Yes.** Finite NPCs, no replacements. The arc: people, fewer people, no people, solitude. The social system is the middle act. The endgame is you alone, opening books. The game ends when the player stops playing. That's the point.
