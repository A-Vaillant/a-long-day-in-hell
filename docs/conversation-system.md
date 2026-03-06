# Conversation System

## Two Modes of Speech

### 1. Muttering (Ambient, Passive)
NPCs produce ambient utterances based on disposition. Dark Souls style — you overhear things. Not directed at you. Heard within hearing range (3 segments).

- **Calm**: idle chatter, observations about books, small talk. Flavor text. No mechanical effect — or very mild hope sustain?
- **Anxious**: worried muttering, nervous questions to nobody. Mild contagion? Or just atmosphere.
- **Mad**: ranting, shouting, incoherent declarations. This is the Direite recruitment vector. Heard at shout range (6 segments). Replaces passive `socialPressureSystem` — the lucidity erosion IS hearing mad speech, not a magical aura.
- **Catatonic**: silence. Very rare single words. When they do speak, it's devastating (hope shock).

**Open question**: Does muttering carry mechanical weight, or is it purely atmospheric with the real damage coming from conversation?

### 2. Conversation (Active, Intentional)
You turn to someone and talk to them. Requires co-location. This is the real interaction — and the real danger.

Conversation is an action in the shared action space. Player can initiate it manually. NPCs initiate it automatically (some probability per tick when co-located with someone).

What happens in conversation depends on both participants' dispositions and what they know.

**Open question**: Is conversation a single action ("talk to X") or does it have sub-structure (topics, back-and-forth)?

## Knowledge / Cognitohazards

### KNOWLEDGE Component
A Set of keys representing things an entity has learned. Some knowledge is useful, some is dangerous, some is both.

Knowledge types:
- **Cognitohazards**: Information that damages you on acquisition. You learn it once; the shock fires once. Not habituated — you can't un-learn it.
  - `libraryScale` — the true size of the library (Took's revelation). Massive hope hit.
  - `chasmNature` — what actually happens when you jump. Hope hit.
  - `direiteNature` — understanding what the mad ones are, that it's contagious. Lucidity hit? Or does understanding it protect you?
  - `resurrectionImplication` — the full weight of what immortality means here. Hope.

- **Practical knowledge**: Information that unlocks mechanics or helps survival.
  - `kiosk_[item]` — how to get specific items from kiosks
  - `stairs_exist` — that stairs exist at rest areas (you might not know this initially?)
  - `submission_slot` — that you can submit books
  - `book_search_strategy` — tips from NPCs about searching methods

- **Social knowledge**: Information about other entities.
  - Who someone is, what they've seen, where they've been
  - This could be how you learn about distant areas without visiting them

### Transmission
Conversation with someone who knows something you don't has a chance of transmitting that knowledge. The chance depends on:
- Topic relevance (are they talking about it?)
- Familiarity (do they trust you enough to share?)
- Their disposition (mad people blurt things out; calm people are more measured)

Cognitohazards spread faster from mad/anxious NPCs — they can't help talking about the terrible thing they learned. Calm NPCs might withhold dangerous knowledge.

### What Makes Took Special
Took isn't special mechanically — she's an NPC who happens to know `libraryScale` and is catatonic *because* she learned it. If you manage to have a conversation with her (co-located, she's catatonic so she barely responds, but there's a small chance), she transmits `libraryScale` and you take the hit.

Any NPC could become Took. The knowledge spreads through the population. Whoever learns it and survives becomes a carrier.

## Dire Dan as Cognitohazard

Dire Dan isn't information — he's an experience. Being around someone who's gone mad, especially someone you knew when they were calm, is its own kind of damage. This is the `companionMad` shock source, already in the habituation system.

But there's a knowledge component too: `direiteNature` — understanding that madness is contagious, that it could happen to you. That meta-awareness is the cognitohazard. You learn it by witnessing someone go mad, or by being told about it.

## Replacing socialPressureSystem

Currently `socialPressureSystem` is a passive aura: 2+ mad within shout range erodes lucidity. This should be replaced by:

1. Mad NPCs **mutter/shout** at shout range — ambient speech events
2. Hearing mad speech triggers `madRant` shock (habituated — you get used to the noise)
3. Actually **conversing** with a mad NPC is a different, stronger shock — and might transmit cognitohazards

The distinction: you can hear ranting from 6 corridors away and it wears on you. But sitting down and trying to talk to a mad person is a different thing entirely.

## Player Actions

- **Talk** (co-located) — initiate conversation with an NPC. Triggers conversation mechanics: knowledge exchange, disposition-based effects, potential shock.
- **Listen** (hearing range) — passive. You hear what nearby NPCs mutter. Automatic.

NPCs do both automatically. The player chooses when to talk but always listens.

## Open Questions

1. Can you choose NOT to listen? (Covering ears, walking away — or is hearing range inescapable?)
2. Does calm conversation actively restore hope/lucidity, or just slow decay?
3. How much sub-structure does a conversation have? Single action with probabilistic outcome, or multi-step?
4. Can you ask about specific topics, or is conversation content disposition-driven?
5. Should knowledge have a "depth" — surface understanding vs. full comprehension, with deeper understanding being more dangerous?
6. How does the player learn what they've learned? A knowledge log? Or is it implicit in the prose?
