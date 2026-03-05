# Event System Rework

## Current State

Flat deck of 20 cards. Fisher-Yates shuffle, 20% draw chance per move, auto-refill on exhaustion. Three types (`sound`, `atmospheric`, `sighting`) but no contextual awareness. 19/20 events are placeholder text.

**What it does:** roll dice on movement → maybe show text → maybe adjust morale.

**What it doesn't do:** react to anything. Same events at floor 0 and floor 99. Same events alone and next to an NPC. Same events at 2pm and 2am. Same events when calm and when despairing.

## Problems

1. **Context-blind.** No awareness of location, time, NPCs, player state, or recent history.
2. **No NPC integration.** 8 NPCs wander around but produce zero ambient signal. You should hear footsteps, muttering, weeping — or silence when alone.
3. **No spatial awareness.** The chasm is always one side away. Rest areas hum with kiosks. Galleries have books. None of this registers.
4. **No temporal awareness.** Lights-out should feel different. Dawn should feel different. Day 1 should feel different from day 30.
5. **No narrative arc.** Events don't build. There's no escalation, no sense of the library's hostility deepening.
6. **Morale bias is flat.** The deck has a fixed negative skew that doesn't adapt.

## Design Goals

Events should feel like **perception**, not like a card game. You're a person walking through an infinite library in hell. What do you notice?

- **Hear** footsteps echoing (NPC proximity), silence (isolation), mechanical hum (kiosk), wind from the chasm
- **See** flickering lights (dim segments), other people (NPCs at location or nearby), empty corridors stretching endlessly
- **Feel** the monotony wearing you down (day count), the creeping wrongness of despair (stat corruption already exists — events should mirror it)
- **Notice** things changing: NPCs deteriorating, sections you've visited before, the absence of things

## Proposed Architecture

### Event Sources (not a single deck)

Replace the single flat deck with **multiple event generators**, each producing candidates based on world state. A resolver picks which (if any) fires.

```
Sources:
  ambient(location, time, day)     → gallery hum, distant echoes, silence
  npc(nearbyNPCs, disposition)     → footsteps, muttering, screaming, nothing
  spatial(floor, restArea, chasm)  → kiosk buzz, wind from below, stairwell echo
  temporal(tick, day, lightsOn)    → lights flickering, darkness settling, dawn light
  psychological(morale, despair)   → intrusive thoughts, hallucinations, numbness
  discovery(booksRead, proximity)  → déjà vu near target, fragments, recognition
```

### Resolution

Each source returns `{ text, morale, priority, suppress? }` or null. Resolver:
1. Collect all non-null candidates
2. Higher priority wins ties
3. `suppress` flag can block lower-priority events (e.g., despairing hallucination overrides ambient)
4. Still probabilistic — not every move produces an event

### NPC Social Simulation (stretch goal)

NPCs already have disposition (calm → anxious → mad → catatonic → dead) and daily random walk. Extend:

- **Audible range**: NPCs within ±3 positions produce sound events scaled by distance
- **Disposition affects output**: calm NPCs produce neutral/comforting signals; mad NPCs produce disturbing ones; catatonic NPCs produce eerie silence
- **NPC-NPC interaction**: when two NPCs share a location, generate social events (argument, comfort, silence) — player sees aftermath if nearby
- **Familiarity**: track encounters, produce recognition events ("You've seen this person before")
- **Death events**: NPC death at player location is a major event; NPC death elsewhere is discovered later

### Content Structure

Move from flat array to structured pools in `content/events.json`:

```json
{
  "ambient": {
    "gallery": ["The shelves stretch endlessly ahead.", ...],
    "restArea": ["The kiosk hums faintly.", ...],
    "dim": ["Shadows pool between the shelves.", ...]
  },
  "npc": {
    "nearby": { "calm": [...], "anxious": [...], "mad": [...] },
    "atLocation": { "calm": [...], "anxious": [...], "mad": [...], "catatonic": [...] }
  },
  "temporal": {
    "lightsOut": [...],
    "dawn": [...],
    "lateDays": [...]
  },
  "psychological": {
    "despairing": [...],
    "lowMorale": [...],
    "highMorale": [...]
  },
  "discovery": {
    "nearTarget": [...],
    "fragment": [...]
  }
}
```

### Core Module Changes

The core module (`lib/events.core.ts`) stays pure — no game state coupling. But its interface expands:

```typescript
interface EventContext {
  location: { restArea: boolean; dimLight: boolean; floor: number };
  time: { lightsOn: boolean; tick: number; day: number };
  npcs: { atLocation: NpcSnapshot[]; nearby: NpcSnapshot[] };
  player: { morale: number; despairing: boolean; booksRead: number };
  proximity: { nearTarget: boolean; fragment: string | null };
}

interface EventPool {
  ambient: { gallery: string[]; restArea: string[]; dim: string[] };
  npc: { nearby: Record<string, string[]>; atLocation: Record<string, string[]> };
  // ...
}

function resolveEvent(ctx: EventContext, pool: EventPool, rng: Rng): EventResult | null;
```

The wrapper assembles `EventContext` from `window.state` and calls `resolveEvent`.

## Migration Path

1. **Phase 1**: Restructure `events.json` into pools. Keep flat draw as fallback for uncategorized events.
2. **Phase 2**: Add context assembly in wrapper — build `EventContext` from state each move.
3. **Phase 3**: Implement source generators in core. Each source is a pure function `(ctx, pool, rng) → candidate | null`.
4. **Phase 4**: Wire resolver. Replace `Events.draw()` internals.
5. **Phase 5**: Write content. Fill pools with real prose.
6. **Phase 6** (stretch): NPC social simulation extensions.

## Open Questions

- Should events have cooldowns? (e.g., don't repeat "footsteps" three moves in a row)
- Should some events chain? ("You hear footsteps" → next move → "They're closer" → "A figure rounds the corner")
- How much should despairing corrupt event text? (Already corrupt stat descriptions — could corrupt event text too, word substitution, hallucinated events)
- Do we persist event history for narrative callbacks? ("The same corridor. Again.")
