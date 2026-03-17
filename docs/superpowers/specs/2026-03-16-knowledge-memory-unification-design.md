# Knowledge-memory unification

## Problem

Three ECS components model overlapping concerns:

- **Knowledge** — `bookVision`, `searchedSegments`, `bestScore`, `bestWords`, `pilgrimageExhausted`, `visionVague`, `visionRadius`, `hasBook`, `lifeStory`
- **Memory** — entries like `foundWords`, `pilgrimageFailure`, `reachedMercy` with psychological weight
- **Searching** — active search state (`bookIndex`, `ticksSearched`, `patience`, `bestScore`, `bestWords`)

`bestScore`/`bestWords` is duplicated between Knowledge and Searching. `searchedSegments` is behavioral data on Knowledge that triggers narrative outcomes on Memory. `pilgrimageExhausted` is a Knowledge field that creates a Memory entry. `foundWords` exists as both a Memory type and Knowledge fields. The boundary between "what I know" and "what I remember" is artificial — knowledge is a memory with behavioral side effects.

The "player is an NPC" design principle requires all these systems to work identically for player and NPC entities. Currently the player has no Knowledge component. Unifying Knowledge into Memory makes both entity types use the same mechanism.

## Design

### Knowledge component deleted

Every field moves elsewhere:

| Field | Destination | Rationale |
|-------|-------------|-----------|
| `lifeStory` | Identity component | It's who you are, not something you learned |
| `bookVision`, `visionAccurate`, `visionVague`, `visionRadius`, `hasBook`, `pilgrimageExhausted` | `BookVisionEntry` on Memory | Stateful memory with progression |
| `searchedSegments`, `bestScore`, `bestWords` | `SearchProgressEntry` on Memory | Accumulated experience |

### MemoryEntry type hierarchy

The base `MemoryEntry` interface stays unchanged. Subtypes extend it with typed data:

```typescript
// Base (unchanged)
interface MemoryEntry {
    id: number;
    type: MemoryType;
    tick: number;
    weight: number;
    initialWeight: number;
    permanent: boolean;
    subject: Entity | null;
    contagious: boolean;
}

// Book vision — stateful progression
interface BookVisionEntry extends MemoryEntry {
    type: "bookVision";
    coords: BookCoords | null;
    accurate: boolean;
    vague: boolean;
    radius: number;
    state: "granted" | "pilgrimaging" | "arrived" | "searching" | "exhausted" | "found";
}

// Search progress — accumulated behavioral data
interface SearchProgressEntry extends MemoryEntry {
    type: "searchProgress";
    searchedSegments: Set<string>;
    bestScore: number;
    bestWords: string[];
}
```

Other memory types (`witnessChasm`, `foundBody`, etc.) remain plain `MemoryEntry` — no extra data needed.

### New memory type configs

```typescript
bookVision: {
    initialWeight: 10,
    decayRate: 0,        // never decays — you don't forget your purpose
    floor: 10,
    permanent: true,
    contagious: false,
    shockKey: null,
    hopeDrainPerTick: D(0.012),    // positive: having purpose sustains hope
    lucidityDrainPerTick: 0,
}

searchProgress: {
    initialWeight: 3,
    decayRate: 0,
    floor: 3,
    permanent: true,
    contagious: true,     // can be shared between NPCs (replaces shareSearchKnowledge)
    shockKey: null,
    hopeDrainPerTick: 0,
    lucidityDrainPerTick: 0,
}
```

`bookVision` has positive hope drain — having a vision gives purpose. This replaces the pilgrim hope floor mechanic in `social.core.ts` and `solo-coroutine.core.ts`. When state becomes `"exhausted"`, the memory config changes (or the hope drain inverts). Implementation detail: either use a different memory type for the exhausted state, or have the decay system check the `state` field.

Simpler approach for the hope floor replacement: the `bookVision` entry is `permanent: true` with positive hope drain while `state` is `"granted"` through `"searching"`. When `state` becomes `"exhausted"`, the entry's type changes to `pilgrimageFailure` (the existing devastating memory type). This avoids conditional drain logic — the type change swaps the config.

### Identity gains lifeStory

```typescript
interface Identity {
    name: string;
    alive: boolean;
    free?: boolean;
    lifeStory?: LifeStory;  // moved from Knowledge
}
```

Optional because not all entities have life stories (the player entity in current code, generic entities in tests).

### Searching component — minor changes

Searching keeps its activity state (`bookIndex`, `ticksSearched`, `patience`, `active`). Remove `bestScore`/`bestWords` — those now live on the `SearchProgressEntry` memory. The search system writes to the memory instead of the component.

### Helper functions

Replace Knowledge helpers with Memory-based equivalents:

```typescript
// Find the bookVision memory entry for an entity
function getBookVision(mem: Memory): BookVisionEntry | null

// Find the searchProgress memory entry for an entity
function getSearchProgress(mem: Memory): SearchProgressEntry | null

// Grant a vision (creates or updates bookVision entry)
function grantVision(mem: Memory, coords: BookCoords, opts?: { vague?: boolean, radius?: number, tick?: number }): void

// Grant a vague vision (convenience wrapper)
function grantVagueVision(mem: Memory, coords: BookCoords, radius: number, tick: number): void

// Check if entity is at their book's segment
function isAtBookSegment(entry: BookVisionEntry, pos: { side: number, position: bigint, floor: bigint }): boolean

// Check if entity is within vague vision radius
function isInVisionRadius(entry: BookVisionEntry, pos: { side: number, position: bigint, floor: bigint }): boolean

// Mark a segment as searched
function markSearched(mem: Memory, side: number, position: bigint, floor: bigint): void

// Check if a segment has been searched
function isSearched(mem: Memory, side: number, position: bigint, floor: bigint): boolean

// Share search knowledge (contagious memory transfer)
function shareSearchKnowledge(source: Memory, target: Memory): number
```

These have the same signatures as the current Knowledge helpers (modulo taking `Memory` instead of `Knowledge`), easing migration.

### Consumer migration

Each system that reads Knowledge switches to reading Memory:

**Intent system** (`intent.core.ts`):
- Pilgrimage scorer: `getBookVision(mem)` instead of `knowledge.bookVision`
- Check `entry.state` instead of `knowledge.pilgrimageExhausted`
- Check `entry.vague` + `isInVisionRadius` for search-yield logic

**Movement system** (`movement.core.ts`):
- Pilgrimage pathfinding: read coords from `getBookVision(mem).coords`
- `hasBook` check: `entry.state === "found"` or a dedicated state

**Search system** (`search.core.ts`):
- Read/write `getSearchProgress(mem)` instead of Knowledge fields
- `markSearched` writes to memory
- `bestScore`/`bestWords` update on memory entry

**Social decay** (`social.core.ts`, `solo-coroutine.core.ts`):
- Pilgrim hope floor: check for `bookVision` memory with non-exhausted state
- Replace `!knowledge.pilgrimageExhausted` with `entry.state !== "exhausted"`

**Interaction** (`interaction.core.ts`):
- `shareSearchKnowledge`: read source's `searchProgress` memory, merge into target's

**Social bridge** (`social.js`):
- `grantVision`: create `bookVision` memory entry
- `checkEscapes`: read `bookVision` memory state, update on exhaustion
- Mercy kiosk detection: read `bookVision` memory coords
- `createKnowledge` calls → replaced with memory creation

**Action dispatch** (`action-dispatch.core.ts`):
- Currently doesn't touch Knowledge directly. No change needed.

### Player entity

At game start, the player entity gets:
- A `bookVision` memory entry with coords from `lifeStory.bookCoords`, state `"granted"`
- A `searchProgress` memory entry (empty segments, zero best score)

This means the player has the same data structures as NPCs. In future sim mode, the intent system can read these and drive the player autonomously.

### Migration strategy

1. Add new memory entry subtypes and helper functions to `memory.core.ts`
2. Add `lifeStory` to Identity interface
3. Migrate consumers one at a time (intent, movement, search, social decay, interaction, social bridge)
4. Each migration: update the system to read from Memory, update tests, verify
5. After all consumers migrated: delete `knowledge.core.ts`, remove KNOWLEDGE component creation from social.js
6. Keep `knowledge.core.ts` importable (but deprecated) during migration so unconverted tests still compile

### What does NOT change

- `MemoryEntry` base interface — unchanged
- `Memory` component (`entries[]`, `capacity`, `nextId`) — unchanged
- Existing memory types (`witnessChasm`, `foundBody`, etc.) — unchanged
- `memoryDecaySystem`, `witnessSystem` — unchanged (they operate on base `MemoryEntry`)
- `Searching` component — keeps activity state, loses `bestScore`/`bestWords`
- `Habituation` / `Psychology` — unchanged
- `action-dispatch.core.ts` — unchanged
