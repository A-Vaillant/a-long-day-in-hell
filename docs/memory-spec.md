---
title: Memory system specification
description: Original spec for ECS witness events and psychological scar memories
status: stale
last-updated: 2026-03-08
---

# Memory System — ECS Witness Events & Psychological Scars

## Overview

Replace the random event deck with an ECS-driven memory system. NPCs (and the player) witness real events in the simulation — chasm jumps, deaths, escapes, madness — and form lasting memories that affect their psychology over time.

## Component: MEMORY

```ts
export const MEMORY = "memory";

export interface Memory {
    entries: MemoryEntry[];
    capacity: number;          // max entries, default 32
}

export interface MemoryEntry {
    type: MemoryType;
    tick: number;              // absolute tick when witnessed
    weight: number;            // current emotional weight (decays)
    initialWeight: number;     // original weight
    permanent: boolean;        // weight never decays below floor
    subject: Entity | null;    // who was involved
    contagious: boolean;       // reserved for cognitohazard propagation (deferred)
}
```

## Memory Types

| Type | Trigger | Range | Permanent | Initial Weight |
|------|---------|-------|-----------|----------------|
| `witnessChasm` | Someone jumps into the chasm | sight | yes | 10 |
| `foundBody` | Dead NPC at your location | colocated | no | 5 |
| `companionDied` | Bonded NPC dies | bond (any range) | yes | 12 |
| `groupDissolved` | Your group breaks apart | self | no | 6 |
| `witnessEscape` | Someone submits their book and escapes | hearing (3 segments) | no | 8 |
| `foundWords` | You find words in a book | self | no | 3 |
| `witnessMadness` | Nearby NPC goes mad | colocated | yes (floor 1) | 7 |
| `companionMad` | Bonded NPC goes mad | bond (any range) | yes (floor 2) | 9 |

## Decay & Psychological Effects

Each memory decays linearly per tick. The psychological drain scales with current weight relative to initial weight:

```
weight_new = max(floor, weight - decayRate * n)
effective_drain = hopeDrain * (weight / initialWeight) * n
```

For batch mode, cumulative drain uses the trapezoid: `drain * n * (w_start + w_end) / (2 * w_initial)`. No per-tick iteration.

### Tuning Table

| Type | decayRate | floor | hopeDrain/tick | lucidityDrain/tick | shockKey |
|------|-----------|-------|----------------|--------------------|----|
| witnessChasm | 0.0001 | 2.0 | -0.00005 | -0.00002 | witnessChasm |
| foundBody | 0.001 | 0 | -0.00003 | 0 | foundBody (new) |
| companionDied | 0.00005 | 3.0 | -0.00008 | -0.00003 | companionDied (new) |
| groupDissolved | 0.0005 | 0 | -0.00004 | 0 | groupDissolved (new) |
| witnessEscape | 0.0003 | 0 | **+0.00006** | 0 | witnessEscape (new, positive) |
| foundWords | 0.002 | 0 | **+0.00003** | 0 | none |
| witnessMadness | 0.0003 | 1.0 | -0.00002 | -0.00006 | witnessMadness (new) |
| companionMad | 0.0002 | 2.0 | -0.00003 | -0.00005 | companionMad |

Positive drain = hope *gain*. Witnessing escape is genuinely hopeful.

## witnessSystem

```ts
export function witnessSystem(
    world: World,
    events: WitnessEvent[],
    currentTick: number,
    config?: MemoryConfig,
    prebuilt?: PrebuiltIndex,
): void
```

**Input**: `WitnessEvent[]` — collected by the bridge layer from existing systems (escapes, deaths, chasm jumps, madness transitions, group dissolutions).

```ts
export interface WitnessEvent {
    type: MemoryType;
    subject: Entity;
    position: Position;
    bondedOnly: boolean;     // companionDied, companionMad: only bonded witnesses
    range: "colocated" | "hearing" | "sight";
}
```

**Logic**:
1. Early return if no events.
2. Reuse prebuilt location index.
3. For each event, find witnesses at the appropriate range.
4. For `bondedOnly` events, filter to entities bonded to the subject.
5. Dedup: skip if same type+subject within 240 ticks (1 day).
6. Create MemoryEntry, evict lowest-weight non-permanent if over capacity.
7. Apply acute shock via `psych.core.ts` if shockKey is set.

## memoryDecaySystem

```ts
export function memoryDecaySystem(
    world: World,
    config?: MemoryConfig,
    n?: number,
): void
```

Runs per tick after witnessSystem. Decays all memory weights, applies ongoing psychological effects, evicts zeroed non-permanent entries.

Batch-safe: uses analytical trapezoid formula for cumulative drain over n ticks.

## Bridge Integration (social.js)

### Event Collection

The bridge already detects escapes, chasm jumps, deaths. Refactor into `WitnessEvent[]` emissions:

- `checkEscapes()` → `witnessEscape` at escape position, range: hearing
- Chasm jump start → `witnessChasm` at jump position, range: sight
- NPC death → `foundBody` at death position, range: colocated; `companionDied` bondedOnly
- Disposition transition to "mad" → `witnessMadness` at position, range: colocated; `companionMad` bondedOnly
- Group dissolution → `groupDissolved` for each former member, range: self
- Search word find → `foundWords` for the finder, range: self

### Call Order

```
// ... existing systems ...
witnessSystem(world, witnessEvents, currentTick, undefined, prebuilt);
memoryDecaySystem(world, undefined, n);
```

### Spawn

Add `MEMORY` component to all entities (player + NPCs) at init.

## New Shock Sources (psych.core.ts)

```ts
foundBody:       { lucidity: -0.3, hope: -0.5, habitRate: 1.2 },
companionDied:   { lucidity: -0.8, hope: -3,   habitRate: 0.1 },
groupDissolved:  { lucidity: 0,    hope: -1.5, habitRate: 0.5 },
witnessEscape:   { lucidity: 0.5,  hope: 3,    habitRate: 0 },
witnessMadness:  { lucidity: -1,   hope: -0.5, habitRate: 0.4 },
```

## Deferred: Cognitohazards

The `contagious` flag on MemoryEntry is the architectural hook. Future implementation:
- Entities with contagious memories who are socializing can propagate weakened copies to co-located listeners.
- `witnessMadness` would be contagious — hearing about madness erodes lucidity.
- Propagation rolls based on listener's openness, speaker's lucidity, bond strength.
- No schema changes needed; the data model supports this.

## Test Surface

1. **Memory CRUD**: create, add, capacity eviction, dedup
2. **Decay math**: linear decay, floor clamping, batch analytical formula
3. **Witness detection**: colocated, hearing range, sight range, bondedOnly filtering
4. **Psychological effects**: hope/lucidity drain scaling with weight
5. **Batch mode**: verify analytical decay matches tick-by-tick
6. **Integration**: events from escape/death/chasm/madness create correct memories
7. **Edge cases**: self not witnessing own event, dead entities don't witness, permanent memories survive eviction
