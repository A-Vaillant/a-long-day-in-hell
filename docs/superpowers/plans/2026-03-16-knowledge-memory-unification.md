# Knowledge-memory unification implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Knowledge ECS component into the Memory system. Book visions, search progress, and life stories move from Knowledge fields into typed MemoryEntry subtypes and the Identity component. Then delete `knowledge.core.ts`.

**Architecture:** `BookVisionEntry` and `SearchProgressEntry` extend `MemoryEntry` with typed data. Systems that read `KNOWLEDGE` switch to reading from `MEMORY` via helper functions (`getBookVision`, `getSearchProgress`). `lifeStory` moves to `Identity`. Migration is consumer-by-consumer with tests at each step.

**Tech Stack:** TypeScript core modules (`lib/*.core.ts`), JS bridge (`src/js/`), node:test

**Spec:** `docs/superpowers/specs/2026-03-16-knowledge-memory-unification-design.md`

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/memory.core.ts` | Modify | Add `BookVisionEntry`, `SearchProgressEntry`, `bookVision`/`searchProgress` memory types, helper functions |
| `lib/social.core.ts` | Modify | Add `lifeStory` to Identity, change pilgrim hope floor to read from Memory |
| `lib/intent.core.ts` | Modify | Pilgrimage scorer reads from Memory instead of Knowledge |
| `lib/movement.core.ts` | Modify | Pilgrimage pathfinding reads from Memory instead of Knowledge |
| `lib/search.core.ts` | Modify | Read/write `SearchProgressEntry` on Memory, remove `bestScore`/`bestWords` from Searching |
| `lib/interaction.core.ts` | Modify | `shareSearchKnowledge` reads from Memory |
| `lib/solo-coroutine.core.ts` | Modify | Pilgrim hope floor reads from Memory |
| `src/js/social.js` | Modify | Replace `createKnowledge` with memory creation, rewrite `grantVision`/`checkEscapes` to use Memory |
| `src/js/godmode-detect.js` | Modify | Read pilgrimage state from Memory |
| `lib/knowledge.core.ts` | Delete | All functionality moved to memory.core.ts and social.core.ts |
| `test/memory-knowledge.test.js` | Create | Tests for new entry types and helpers |
| Various test files | Modify | Replace Knowledge imports/usage with Memory |

---

## Chunk 1: Memory entry subtypes and Identity.lifeStory

### Task 1: Add BookVisionEntry and SearchProgressEntry types

**Files:**
- Modify: `lib/memory.core.ts`
- Create: `test/memory-knowledge.test.js`

- [ ] **Step 1: Write tests for new types and helpers**

Create `test/memory-knowledge.test.js`:

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    MEMORY_TYPES, MEMORY, createMemory, addMemory, DEFAULT_MEMORY_CONFIG,
    getBookVision, getSearchProgress,
    grantBookVision, grantVagueBookVision,
    isAtBookSegment, isInVisionRadius,
    markSegmentSearched, isSegmentSearched,
    shareSearchProgress, segmentKey,
} from "../lib/memory.core.ts";

describe("BookVisionEntry", () => {
    it("MEMORY_TYPES includes BOOK_VISION", () => {
        assert.equal(MEMORY_TYPES.BOOK_VISION, "bookVision");
    });

    it("config exists in DEFAULT_MEMORY_TYPES", () => {
        const tc = DEFAULT_MEMORY_CONFIG.types["bookVision"];
        assert.ok(tc, "bookVision config should exist");
        assert.equal(tc.permanent, true);
        assert.ok(tc.hopeDrainPerTick > 0, "should have positive hope drain (purpose)");
    });

    it("grantBookVision creates an entry with coords and state", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantBookVision(mem, coords, 0);
        const entry = getBookVision(mem);
        assert.ok(entry, "should have bookVision entry");
        assert.deepEqual(entry.coords, coords);
        assert.equal(entry.state, "granted");
        assert.equal(entry.accurate, true);
        assert.equal(entry.vague, false);
        assert.equal(entry.radius, 0);
    });

    it("grantVagueBookVision sets vague flag and radius", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantVagueBookVision(mem, coords, 50, 0);
        const entry = getBookVision(mem);
        assert.ok(entry);
        assert.equal(entry.vague, true);
        assert.equal(entry.radius, 50);
        assert.equal(entry.state, "granted");
        // Position should be jittered
        assert.equal(entry.coords.side, coords.side);
        assert.equal(entry.coords.floor, coords.floor);
    });

    it("getBookVision returns null when no entry", () => {
        const mem = createMemory();
        assert.equal(getBookVision(mem), null);
    });

    it("only one bookVision entry at a time (overwrites)", () => {
        const mem = createMemory();
        const c1 = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        const c2 = { side: 1, position: 200n, floor: 60n, bookIndex: 3 };
        grantBookVision(mem, c1, 0);
        grantBookVision(mem, c2, 100);
        const entry = getBookVision(mem);
        assert.ok(entry);
        assert.deepEqual(entry.coords, c2);
    });

    it("isAtBookSegment checks side/position/floor", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantBookVision(mem, coords, 0);
        const entry = getBookVision(mem);
        assert.equal(isAtBookSegment(entry, { side: 0, position: 100n, floor: 50n }), true);
        assert.equal(isAtBookSegment(entry, { side: 0, position: 101n, floor: 50n }), false);
        assert.equal(isAtBookSegment(entry, { side: 1, position: 100n, floor: 50n }), false);
    });

    it("isInVisionRadius checks vague radius", () => {
        const mem = createMemory();
        const coords = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        grantVagueBookVision(mem, coords, 50, 0);
        const entry = getBookVision(mem);
        assert.equal(isInVisionRadius(entry, { side: 0, position: 110n, floor: 50n }), true);
        assert.equal(isInVisionRadius(entry, { side: 0, position: 500n, floor: 50n }), false);
        assert.equal(isInVisionRadius(entry, { side: 1, position: 100n, floor: 50n }), false);
    });

    it("isInVisionRadius returns false for non-vague vision", () => {
        const mem = createMemory();
        grantBookVision(mem, { side: 0, position: 100n, floor: 50n, bookIndex: 5 }, 0);
        const entry = getBookVision(mem);
        assert.equal(isInVisionRadius(entry, { side: 0, position: 100n, floor: 50n }), false);
    });
});

describe("SearchProgressEntry", () => {
    it("MEMORY_TYPES includes SEARCH_PROGRESS", () => {
        assert.equal(MEMORY_TYPES.SEARCH_PROGRESS, "searchProgress");
    });

    it("getSearchProgress creates entry on first access", () => {
        const mem = createMemory();
        const entry = getSearchProgress(mem, true);
        assert.ok(entry);
        assert.equal(entry.searchedSegments.size, 0);
        assert.equal(entry.bestScore, 0);
        assert.deepEqual(entry.bestWords, []);
    });

    it("markSegmentSearched adds to set", () => {
        const mem = createMemory();
        markSegmentSearched(mem, 0, 100n, 50n);
        const entry = getSearchProgress(mem);
        assert.ok(entry);
        assert.equal(entry.searchedSegments.has(segmentKey(0, 100n, 50n)), true);
    });

    it("isSegmentSearched checks the set", () => {
        const mem = createMemory();
        markSegmentSearched(mem, 0, 100n, 50n);
        assert.equal(isSegmentSearched(mem, 0, 100n, 50n), true);
        assert.equal(isSegmentSearched(mem, 0, 101n, 50n), false);
    });

    it("shareSearchProgress merges segments", () => {
        const source = createMemory();
        const target = createMemory();
        markSegmentSearched(source, 0, 100n, 50n);
        markSegmentSearched(source, 0, 101n, 50n);
        markSegmentSearched(target, 0, 100n, 50n);
        const learned = shareSearchProgress(source, target);
        assert.equal(learned, 1); // only 101 was new
        assert.equal(isSegmentSearched(target, 0, 101n, 50n), true);
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- --test-name-pattern "BookVisionEntry|SearchProgressEntry"`

- [ ] **Step 3: Implement types and helpers in memory.core.ts**

Add to `MEMORY_TYPES`:
```typescript
BOOK_VISION: "bookVision",
SEARCH_PROGRESS: "searchProgress",
```

Add to `DEFAULT_MEMORY_TYPES`:
```typescript
bookVision:      { initialWeight: 10, decayRate: 0,         floor: 10,  permanent: true,  contagious: false, shockKey: null, hopeDrainPerTick: D(0.012),  lucidityDrainPerTick: 0 },
searchProgress:  { initialWeight: 3,  decayRate: 0,         floor: 3,   permanent: true,  contagious: true,  shockKey: null, hopeDrainPerTick: 0,         lucidityDrainPerTick: 0 },
```

Add entry subtypes after the `MemoryEntry` interface:

```typescript
import type { BookCoords } from "./lifestory.core.ts";

export type BookVisionState = "granted" | "pilgrimaging" | "arrived" | "searching" | "exhausted" | "found";

export interface BookVisionEntry extends MemoryEntry {
    type: "bookVision";
    coords: BookCoords | null;
    accurate: boolean;
    vague: boolean;
    radius: number;
    state: BookVisionState;
}

export interface SearchProgressEntry extends MemoryEntry {
    type: "searchProgress";
    searchedSegments: Set<string>;
    bestScore: number;
    bestWords: string[];
}
```

Add helper functions after the existing helpers:

```typescript
/** Segment key for search sets. */
export function segmentKey(side: number, position: bigint, floor: bigint): string {
    return `${side}:${position}:${floor}`;
}

/** Find the bookVision entry in a Memory component. */
export function getBookVision(mem: Memory): BookVisionEntry | null {
    for (const e of mem.entries) {
        if (e.type === "bookVision") return e as BookVisionEntry;
    }
    return null;
}

/**
 * Find or create the searchProgress entry in a Memory component.
 * @param create - if true, create entry when missing
 */
export function getSearchProgress(mem: Memory, create: boolean = false): SearchProgressEntry | null {
    for (const e of mem.entries) {
        if (e.type === "searchProgress") return e as SearchProgressEntry;
    }
    if (!create) return null;
    const tc = DEFAULT_MEMORY_CONFIG.types["searchProgress"];
    const entry: SearchProgressEntry = {
        id: mem.nextId++,
        type: "searchProgress",
        tick: 0,
        weight: tc.initialWeight,
        initialWeight: tc.initialWeight,
        permanent: tc.permanent,
        subject: null,
        contagious: tc.contagious,
        searchedSegments: new Set(),
        bestScore: 0,
        bestWords: [],
    };
    addMemory(mem, entry);
    return entry;
}

/** Grant a book vision — creates or replaces the bookVision entry. */
export function grantBookVision(
    mem: Memory,
    coords: BookCoords,
    tick: number,
    opts?: { accurate?: boolean },
): void {
    // Remove existing bookVision entry if present
    mem.entries = mem.entries.filter(e => e.type !== "bookVision");
    const tc = DEFAULT_MEMORY_CONFIG.types["bookVision"];
    const entry: BookVisionEntry = {
        id: mem.nextId++,
        type: "bookVision",
        tick,
        weight: tc.initialWeight,
        initialWeight: tc.initialWeight,
        permanent: tc.permanent,
        subject: null,
        contagious: tc.contagious,
        coords: { ...coords },
        accurate: opts?.accurate ?? true,
        vague: false,
        radius: 0,
        state: "granted",
    };
    addMemory(mem, entry);
}

/** Grant a vague book vision with jittered position. */
export function grantVagueBookVision(
    mem: Memory,
    coords: BookCoords,
    radius: number,
    tick: number,
): void {
    // Jitter position deterministically
    const jitterRng = seedFromString("vague:" + coords.side + ":" + coords.position + ":" + coords.floor);
    const jitter = BigInt(jitterRng.nextInt(radius * 2 + 1) - radius);
    const jitteredCoords = {
        ...coords,
        position: coords.position + jitter,
    };

    mem.entries = mem.entries.filter(e => e.type !== "bookVision");
    const tc = DEFAULT_MEMORY_CONFIG.types["bookVision"];
    const entry: BookVisionEntry = {
        id: mem.nextId++,
        type: "bookVision",
        tick,
        weight: tc.initialWeight,
        initialWeight: tc.initialWeight,
        permanent: tc.permanent,
        subject: null,
        contagious: tc.contagious,
        coords: jitteredCoords,
        accurate: true,
        vague: true,
        radius,
        state: "granted",
    };
    addMemory(mem, entry);
}

/** Check if position matches the book vision's segment (ignores bookIndex). */
export function isAtBookSegment(
    entry: BookVisionEntry | null,
    pos: { side: number; position: bigint; floor: bigint },
): boolean {
    if (!entry || !entry.coords) return false;
    return pos.side === entry.coords.side &&
           pos.position === entry.coords.position &&
           pos.floor === entry.coords.floor;
}

/** Check if position is within a vague vision's search radius. */
export function isInVisionRadius(
    entry: BookVisionEntry | null,
    pos: { side: number; position: bigint; floor: bigint },
): boolean {
    if (!entry || !entry.coords || !entry.vague) return false;
    if (pos.side !== entry.coords.side) return false;
    if (pos.floor !== entry.coords.floor) return false;
    const dist = pos.position > entry.coords.position
        ? pos.position - entry.coords.position
        : entry.coords.position - pos.position;
    return dist <= BigInt(entry.radius);
}

/** Mark a segment as searched in the searchProgress entry. */
export function markSegmentSearched(mem: Memory, side: number, position: bigint, floor: bigint): void {
    const entry = getSearchProgress(mem, true)!;
    entry.searchedSegments.add(segmentKey(side, position, floor));
}

/** Check if a segment has been searched. */
export function isSegmentSearched(mem: Memory, side: number, position: bigint, floor: bigint): boolean {
    const entry = getSearchProgress(mem);
    if (!entry) return false;
    return entry.searchedSegments.has(segmentKey(side, position, floor));
}

/** Share search progress from source to target. Returns number of new segments learned. */
export function shareSearchProgress(source: Memory, target: Memory): number {
    const srcEntry = getSearchProgress(source);
    if (!srcEntry) return 0;
    const tgtEntry = getSearchProgress(target, true)!;
    let learned = 0;
    for (const seg of srcEntry.searchedSegments) {
        if (!tgtEntry.searchedSegments.has(seg)) {
            tgtEntry.searchedSegments.add(seg);
            learned++;
        }
    }
    return learned;
}
```

Add `import { seedFromString } from "./prng.core.ts";` to the imports at the top.

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Run full suite: `npm test`**

- [ ] **Step 6: Commit**

```bash
git add lib/memory.core.ts test/memory-knowledge.test.js
git commit -m "feat(memory): add BookVisionEntry, SearchProgressEntry types and helpers"
```

### Task 2: Add lifeStory to Identity

**Files:**
- Modify: `lib/social.core.ts` (Identity interface)
- Modify: `test/memory-knowledge.test.js`

- [ ] **Step 1: Write test**

Add to `test/memory-knowledge.test.js`:

```javascript
import { IDENTITY } from "../lib/social.core.ts";

describe("Identity.lifeStory", () => {
    it("Identity interface accepts lifeStory field", () => {
        const ident = { name: "Test", alive: true, free: false, lifeStory: { name: "Test", storyText: "Once..." } };
        assert.equal(ident.lifeStory.name, "Test");
    });
});
```

- [ ] **Step 2: Add lifeStory to Identity interface**

In `lib/social.core.ts`, modify the Identity interface:

```typescript
export interface Identity {
    name: string;
    alive: boolean;
    /** Entity has submitted their book and left the library. */
    free: boolean;
    /** Life story (generated at spawn, immutable). Moved from Knowledge. */
    lifeStory?: LifeStory;
}
```

Add the import at the top of `social.core.ts`:
```typescript
import type { LifeStory } from "./lifestory.core.ts";
```

- [ ] **Step 3: Run tests, verify they pass**

- [ ] **Step 4: Commit**

```bash
git add lib/social.core.ts test/memory-knowledge.test.js
git commit -m "feat(identity): add optional lifeStory field"
```

---

## Chunk 2: Migrate core systems

### Task 3: Migrate intent system

**Files:**
- Modify: `lib/intent.core.ts`
- Modify: `test/knowledge.test.js` (pilgrimage intent scorer tests)

The pilgrimage scorer currently reads `ctx.knowledge.bookVision`, `ctx.knowledge.pilgrimageExhausted`, `ctx.knowledge.visionVague`, `ctx.knowledge.visionRadius`. It needs to read from a `BookVisionEntry` obtained from `ctx.memory` instead.

- [ ] **Step 1: Add `memory` to ScorerContext**

In `lib/intent.core.ts`, add to the `ScorerContext` interface:

```typescript
/** Memory component (for bookVision lookup). */
memory: Memory | null;
```

Add import:
```typescript
import { MEMORY, type Memory, getBookVision, type BookVisionEntry } from "./memory.core.ts";
```

- [ ] **Step 2: Update pilgrimage scorer**

Replace the `pilgrimage` scorer to read from memory:

```typescript
pilgrimage(ctx) {
    // Try memory-based bookVision first, fall back to knowledge for migration
    let vision: BookVisionEntry | null = null;
    if (ctx.memory) {
        vision = getBookVision(ctx.memory);
    }

    // Memory path
    if (vision) {
        if (!vision.coords) return -Infinity;
        if (vision.state === "exhausted") return -Infinity;
        if (vision.state === "found") return 2.5; // heading to submit
        // Vague vision + within search radius → yield to search
        if (vision.vague && ctx.position) {
            const v = vision.coords;
            if (ctx.position.side === v.side && ctx.position.floor === v.floor) {
                const dist = ctx.position.position > v.position
                    ? ctx.position.position - v.position
                    : v.position - ctx.position.position;
                if (dist <= BigInt(vision.radius)) {
                    return -Infinity;
                }
            }
        }
        // Exact vision + at location → no need to travel
        if (!vision.vague && ctx.position) {
            const v = vision.coords;
            if (ctx.position.side === v.side &&
                ctx.position.position === v.position &&
                ctx.position.floor === v.floor) {
                return -Infinity;
            }
        }
        return 2.5;
    }

    // Legacy Knowledge fallback (during migration)
    if (!ctx.knowledge || !ctx.knowledge.bookVision) return -Infinity;
    if (ctx.knowledge.pilgrimageExhausted) return -Infinity;
    if (ctx.knowledge.hasBook) return 2.5;
    if (ctx.knowledge.visionVague && ctx.position) {
        const v = ctx.knowledge.bookVision;
        if (ctx.position.side === v.side && ctx.position.floor === v.floor) {
            const dist = ctx.position.position > v.position
                ? ctx.position.position - v.position
                : v.position - ctx.position.position;
            if (dist <= BigInt(ctx.knowledge.visionRadius)) {
                return -Infinity;
            }
        }
    }
    if (!ctx.knowledge.visionVague && ctx.position) {
        const v = ctx.knowledge.bookVision;
        if (ctx.position.side === v.side &&
            ctx.position.position === v.position &&
            ctx.position.floor === v.floor) {
            return -Infinity;
        }
    }
    return 2.5;
},
```

Note: legacy fallback stays during migration so existing tests pass before all consumers are converted. It will be removed in the final cleanup task.

- [ ] **Step 3: Wire memory into ScorerContext in evaluateIntent and getAvailableBehaviors**

In `evaluateIntent`, add `memory` parameter and pass to context. In `getAvailableBehaviors`, read MEMORY component and pass.

In `evaluateIntent` signature, add after `knowledge`:
```typescript
memory: Memory | null = null,
```

In context construction:
```typescript
const ctx: ScorerContext = {
    psych, alive, disposition, needs, personality, intent, rng,
    position, sleep, knowledge, tick, hasCompanion, memory,
};
```

In `intentSystem`, read the MEMORY component:
```typescript
const memory = getComponent<Memory>(world, entity, MEMORY);
```

Pass it to `evaluateIntent`:
```typescript
const result = evaluateIntent(
    intent, psych, ident.alive, needs ?? null, personality ?? null, rng, config,
    undefined, position ?? null, sleep ?? null, tick, knowledge ?? null, hasCompanion,
    memory ?? null,
);
```

In `getAvailableBehaviors`, similarly read MEMORY and pass to context.

- [ ] **Step 4: Update tests in test/knowledge.test.js**

The existing pilgrimage scorer tests use Knowledge. Add parallel tests that use Memory:

```javascript
import { MEMORY, createMemory, grantBookVision, grantVagueBookVision, getBookVision } from "../lib/memory.core.ts";

it("pilgrimage scores high with bookVision memory", () => {
    const world = createWorld();
    const entity = makeEntity(world);
    const mem = createMemory();
    grantBookVision(mem, { side: 1, position: 500n, floor: 30n, bookIndex: 2 }, 0);
    addComponent(world, entity, MEMORY, mem);
    const results = getAvailableBehaviors(world, entity, makeRng());
    const pilgrim = results.find(r => r.behavior === "pilgrimage");
    assert.ok(pilgrim, "pilgrimage should score with bookVision memory");
    assert.ok(pilgrim.score >= 2.0);
});

it("pilgrimage excluded with exhausted bookVision memory", () => {
    const world = createWorld();
    const entity = makeEntity(world);
    const mem = createMemory();
    grantBookVision(mem, { side: 0, position: 500n, floor: 30n, bookIndex: 2 }, 0);
    getBookVision(mem).state = "exhausted";
    addComponent(world, entity, MEMORY, mem);
    const results = getAvailableBehaviors(world, entity, makeRng());
    const pilgrim = results.find(r => r.behavior === "pilgrimage");
    assert.equal(pilgrim, undefined);
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --test-name-pattern "pilgrimage"`

- [ ] **Step 6: Run full suite: `npm test`**

- [ ] **Step 7: Commit**

```bash
git add lib/intent.core.ts test/knowledge.test.js
git commit -m "feat(intent): pilgrimage scorer reads from Memory (with Knowledge fallback)"
```

### Task 4: Migrate movement system

**Files:**
- Modify: `lib/movement.core.ts`

The movement system reads `bookVision` and `hasBook` from Knowledge via the `MovementInput` interface. Add a parallel path that reads from a `BookVisionEntry`.

- [ ] **Step 1: Add bookVisionEntry to MovementInput**

In `lib/movement.core.ts`, add to `MovementInput`:
```typescript
/** BookVision from Memory (preferred over bookVision/hasBook fields). */
bookVisionEntry?: BookVisionEntry | null;
```

Import:
```typescript
import { type BookVisionEntry } from "./memory.core.ts";
```

- [ ] **Step 2: Update resolveTarget and computeMovement**

In `resolveTarget`, add memory path before the knowledge fallback:

```typescript
} else if (behavior === "pilgrimage") {
    // Memory-based bookVision (preferred)
    const bve = input.bookVisionEntry;
    if (bve && bve.coords) {
        if (bve.state === "found") {
            mov.targetPosition = nearestRestArea(pos.position);
        } else if (pos.side !== bve.coords.side || pos.floor !== bve.coords.floor) {
            mov.targetPosition = nearestRestArea(pos.position);
        } else {
            mov.targetPosition = bve.coords.position;
        }
    } else if (hasBook) {
        // Legacy Knowledge fallback
        mov.targetPosition = nearestRestArea(pos.position);
    } else if (bookVision) {
        // Legacy Knowledge fallback
        // ... existing code ...
    }
}
```

Similarly update the batch mode pilgrimage section to read `bve.coords` when available.

- [ ] **Step 3: Wire bookVisionEntry in movementSystem**

Where the system constructs `MovementInput`, read from MEMORY:

```typescript
const memory = getComponent<Memory>(world, entity, MEMORY);
const bookVisionEntry = memory ? getBookVision(memory) : null;
```

Pass `bookVisionEntry` in the input.

- [ ] **Step 4: Run movement tests**

Run: `npm test -- --test-name-pattern "movement|pilgrimage movement"`

- [ ] **Step 5: Commit**

```bash
git add lib/movement.core.ts
git commit -m "feat(movement): pilgrimage pathfinding reads from Memory (with Knowledge fallback)"
```

### Task 5: Migrate social decay (pilgrim hope floor)

**Files:**
- Modify: `lib/social.core.ts`
- Modify: `lib/solo-coroutine.core.ts`

- [ ] **Step 1: Update social.core.ts pilgrim hope floor**

In `psychologyDecaySystem`, replace the Knowledge-based pilgrim hope floor:

```typescript
// Pilgrims have purpose — hope can't drop below catatonic threshold
const knowledge = getComponent<Knowledge>(world, entity, KNOWLEDGE);
const memory = getComponent<Memory>(world, entity, MEMORY);
const bookVision = memory ? getBookVision(memory) : null;
const hasPurpose = (bookVision && bookVision.state !== "exhausted") ||
                   (knowledge && knowledge.bookVision && identity.alive && !knowledge.pilgrimageExhausted);
if (hasPurpose) {
    const pilgrimHopeFloor = 20;
    if (psychology.hope < pilgrimHopeFloor) {
        psychology.hope = pilgrimHopeFloor;
    }
}
```

Add imports:
```typescript
import { MEMORY, type Memory, getBookVision } from "./memory.core.ts";
```

- [ ] **Step 2: Update solo-coroutine.core.ts**

The solo coroutine has its own pilgrim hope floor. This one reads from a `SoloState.knowledge` field. Add a parallel `SoloState.memory` field and read bookVision from it. Keep the Knowledge fallback.

- [ ] **Step 3: Run tests**

Run: `npm test -- --test-name-pattern "hope floor|pilgrim"`

- [ ] **Step 4: Commit**

```bash
git add lib/social.core.ts lib/solo-coroutine.core.ts
git commit -m "feat(social): pilgrim hope floor reads from Memory (with Knowledge fallback)"
```

### Task 6: Migrate search system

**Files:**
- Modify: `lib/search.core.ts`

The search system writes `bestScore`/`bestWords` to both the Searching component and Knowledge. It also calls `markSearched` on Knowledge. Switch both to Memory.

- [ ] **Step 1: Update search system to write to Memory**

Replace the Knowledge writes:

```typescript
// Persist lifetime best to searchProgress memory
const mem = getComponent<Memory>(world, entity, MEMORY);
if (mem) {
    const sp = getSearchProgress(mem, true)!;
    if (foundWords.length > sp.bestScore) {
        sp.bestScore = foundWords.length;
        sp.bestWords = [...foundWords];
    }
}
```

Replace `markSearched(knowledge, ...)` with:
```typescript
const mem = getComponent<Memory>(world, entity, MEMORY);
if (mem) markSegmentSearched(mem, pos.side, pos.position, pos.floor);
```

Also update the `isSearched` check in the intent scorer (already done in Task 3 if wired correctly, but verify).

Add imports:
```typescript
import { MEMORY, type Memory, getSearchProgress, markSegmentSearched } from "./memory.core.ts";
```

- [ ] **Step 2: Run search tests**

Run: `npm test -- --test-name-pattern "search"`

- [ ] **Step 3: Commit**

```bash
git add lib/search.core.ts
git commit -m "feat(search): write bestScore and searchedSegments to Memory"
```

### Task 7: Migrate interaction system

**Files:**
- Modify: `lib/interaction.core.ts`

`shareSearchKnowledge` reads from Knowledge. Replace with Memory.

- [ ] **Step 1: Replace shareSearchKnowledge call**

In the talk result computation, replace:
```typescript
const playerKnow = getComponent<Knowledge>(world, player, KNOWLEDGE);
const npcKnow = getComponent<Knowledge>(world, npc, KNOWLEDGE);
if (playerKnow && npcKnow) {
    segmentsLearned = shareSearchKnowledge(npcKnow, playerKnow);
    segmentsShared = shareSearchKnowledge(playerKnow, npcKnow);
}
```

With:
```typescript
const playerMem = getComponent<Memory>(world, player, MEMORY);
const npcMem = getComponent<Memory>(world, npc, MEMORY);
if (playerMem && npcMem) {
    segmentsLearned = shareSearchProgress(npcMem, playerMem);
    segmentsShared = shareSearchProgress(playerMem, npcMem);
}
```

Add imports, remove Knowledge imports.

- [ ] **Step 2: Run interaction tests**

Run: `npm test -- --test-name-pattern "interaction|talk"`

- [ ] **Step 3: Commit**

```bash
git add lib/interaction.core.ts
git commit -m "feat(interaction): shareSearchKnowledge uses Memory"
```

---

## Chunk 3: Migrate social.js bridge

### Task 8: Rewrite social.js to use Memory instead of Knowledge

**Files:**
- Modify: `src/js/social.js`

This is the largest single migration. The bridge creates Knowledge components, grants visions, checks escapes, detects mercy kiosks — all via Knowledge. Every use switches to Memory.

- [ ] **Step 1: Replace createKnowledge with Memory + Identity setup**

Where `social.js` calls `createKnowledge(...)` (lines ~78 and ~141), replace with:
1. Generate the life story via `generateNpcLifeStory()`
2. Store it on the Identity component's `lifeStory` field
3. Create a Memory component with `createMemory()`
4. Optionally create a SearchProgress entry

For the player entity (line ~78):
```javascript
const playerStory = generateLifeStory(state.seed);
const playerIdent = { name: "Player", alive: true, free: false, lifeStory: playerStory };
addComponent(world, playerEntity, IDENTITY, playerIdent);
const playerMem = createMemory();
// Player starts with book vision
grantBookVision(playerMem, playerStory.bookCoords, 0);
addComponent(world, playerEntity, MEMORY, playerMem);
```

For NPCs (line ~141), similar pattern with `generateNpcLifeStory()`.

- [ ] **Step 2: Replace grantVision bridge method**

The `grantVision(npcId, { accurate, vague })` method reads Knowledge and calls `grantVagueVision`/`applyVision`. Replace with Memory operations:

```javascript
grantVision(npcId, { accurate = true, vague = true } = {}) {
    const ent = npcEntities.get(npcId);
    if (ent === undefined || !world) return false;
    const ident = getComponent(world, ent, IDENTITY);
    if (!ident || ident.free || !ident.lifeStory) return false;
    let mem = getComponent(world, ent, MEMORY);
    if (!mem) { mem = createMemory(); addComponent(world, ent, MEMORY, mem); }
    if (accurate && vague) {
        grantVagueBookVision(mem, ident.lifeStory.bookCoords, 50, state.tick);
    } else if (accurate) {
        grantBookVision(mem, ident.lifeStory.bookCoords, state.tick);
    }
    // Divine inspiration: immediate hope boost
    const psych = getComponent(world, ent, PSYCHOLOGY);
    if (psych) { psych.hope = Math.min(100, psych.hope + 40); }
    return true;
},
```

- [ ] **Step 3: Replace checkEscapes**

Rewrite `checkEscapes` to read `BookVisionEntry` from Memory instead of Knowledge fields. Same logic, different data source. The key changes:
- `knowledge.bookVision` → `getBookVision(mem)`
- `knowledge.pilgrimageExhausted` → `entry.state === "exhausted"`
- `knowledge.visionVague` → `entry.vague`
- `knowledge.visionRadius` → `entry.radius`
- `knowledge.searchedSegments.has(key)` → `isSegmentSearched(mem, ...)`
- `knowledge.hasBook` → `entry.state === "found"`
- On exhaustion: `entry.state = "exhausted"` then mutate type to `"pilgrimageFailure"`
- On exact path pickup: `entry.state = "found"`

- [ ] **Step 4: Replace mercy kiosk NPC detection**

The mercy kiosk loop reads `knowledge.bookVision`. Replace with `getBookVision(mem)`.

- [ ] **Step 5: Replace disposition check for pilgrimage**

Line ~444: `const onPilgrimage = !!(knowledge && knowledge.bookVision && ident.alive)` → read from Memory.

- [ ] **Step 6: Update imports**

Remove Knowledge imports. Add:
```javascript
import {
    MEMORY, createMemory, addMemory, getBookVision, getSearchProgress,
    grantBookVision, grantVagueBookVision, isAtBookSegment, isInVisionRadius,
    isSegmentSearched, markSegmentSearched, DEFAULT_MEMORY_CONFIG,
} from "../../lib/memory.core.ts";
import { generateNpcLifeStory } from "../../lib/knowledge.core.ts"; // still need this for life story gen
import { generateLifeStory } from "../../lib/lifestory.core.ts";
```

Wait — `generateNpcLifeStory` is in knowledge.core.ts. It needs to move. Since it's just a thin wrapper around `generateLifeStory`, move it to `lifestory.core.ts` or inline it. For now, keep importing from knowledge.core.ts (it won't be deleted until the final cleanup).

- [ ] **Step 7: Remove KNOWLEDGE component creation**

Stop calling `addComponent(world, ent, KNOWLEDGE, ...)` for new entities. BUT — other systems still read KNOWLEDGE during migration (the legacy fallbacks). So during this task, still create Knowledge components alongside Memory ones. The final task removes them.

Actually, simpler: since Tasks 3-7 added fallbacks, the systems read Memory first and fall back to Knowledge. We can stop creating Knowledge components NOW and the fallbacks will find nothing on Knowledge, which returns -Infinity / null / false (safe defaults). The Memory entries will be the primary source.

Test carefully after removing Knowledge creation.

- [ ] **Step 8: Run tests**

Run: `npm test`

- [ ] **Step 9: Commit**

```bash
git add src/js/social.js
git commit -m "refactor(social): replace Knowledge with Memory for book vision and search"
```

### Task 9: Update godmode-detect.js

**Files:**
- Modify: `src/js/godmode-detect.js`

- [ ] **Step 1: Update pilgrimage detection**

The detector checks `oldKnow.pilgrimageExhausted` / `newKnow.pilgrimageExhausted`. Since Knowledge is gone, check the NPC's components for a bookVision memory with state `"exhausted"`.

But godmode-detect works with snapshot data (`npc.components.knowledge`), not live ECS. The snapshot serialization will need updating. Check how `godmode.js` creates snapshots and what fields it stores.

This may need the snapshot to include memory entries. For now, check if `npc.components.knowledge` still exists in snapshots (it won't after Task 8 stops creating Knowledge). If the detector breaks, update it to read from `npc.components.memory` instead.

- [ ] **Step 2: Run godmode tests**

Run: `npm test -- --test-name-pattern "godmode"`

- [ ] **Step 3: Commit**

```bash
git add src/js/godmode-detect.js
git commit -m "feat(godmode): detect pilgrimage state from Memory"
```

---

## Chunk 4: Cleanup

### Task 10: Remove Knowledge fallbacks and delete knowledge.core.ts

**Files:**
- Modify: `lib/intent.core.ts` — remove Knowledge fallback from pilgrimage scorer
- Modify: `lib/movement.core.ts` — remove Knowledge fallback
- Modify: `lib/social.core.ts` — remove Knowledge import and fallback
- Modify: `lib/solo-coroutine.core.ts` — remove Knowledge references
- Modify: `lib/search.core.ts` — remove Knowledge imports
- Modify: `lib/interaction.core.ts` — remove Knowledge imports
- Delete: `lib/knowledge.core.ts`
- Modify: all test files that import from knowledge.core.ts

- [ ] **Step 1: Remove legacy Knowledge fallbacks from all core systems**

In each system modified in Tasks 3-7, remove the `if (ctx.knowledge) { ... }` fallback blocks. The Memory path is now the only path.

Remove `KNOWLEDGE` imports from intent, movement, social, search, interaction, solo-coroutine.

Remove `knowledge` from `ScorerContext`, `MovementInput`, and any other interfaces.

- [ ] **Step 2: Delete lib/knowledge.core.ts**

Move `generateNpcLifeStory` to `lib/lifestory.core.ts` first (it's a thin wrapper). Update imports in social.js and any test files.

Then delete `lib/knowledge.core.ts`.

- [ ] **Step 3: Migrate test files**

Update all test files that import from knowledge.core.ts:
- `test/knowledge.test.js` — rewrite to test Memory-based helpers. Or rename to `test/book-vision.test.js`.
- `test/pilgrimage-failure.test.js` — replace Knowledge usage with Memory
- `test/movement.test.js` — replace Knowledge usage with Memory
- `test/search.test.js` — replace Knowledge usage with Memory
- `test/interaction.test.js` — replace Knowledge usage with Memory
- `test/memory.test.js` — may reference Knowledge for mercy kiosk test
- `test/group-leadership.test.js` — check what it uses
- `test/slow/solo-coroutine.test.js` — replace Knowledge usage
- `test/slow/coroutine-perf.test.js` — replace Knowledge usage

Each test that created a Knowledge component should instead:
1. Create an Identity with lifeStory
2. Create a Memory with grantBookVision/grantVagueBookVision
3. Replace `getComponent(world, ent, KNOWLEDGE)` with `getComponent(world, ent, MEMORY)`

- [ ] **Step 4: Run full test suite**

Run: `npm test`

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`

- [ ] **Step 6: Build**

Run: `bash build.sh`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: delete knowledge.core.ts, all consumers use Memory"
```

---

## Verification

After all tasks:
1. `npm test` — all tests pass
2. `npx tsc --noEmit` — type check clean
3. `bash build.sh` — builds
4. `grep -r "KNOWLEDGE\|knowledge\.core" lib/ src/` — no references remain (except maybe docs)
5. `ls lib/knowledge.core.ts` — file deleted

## Parallelization

Tasks 3, 4, 5, 6, 7 are independent (different files). They can run in parallel after Task 1+2.
Task 8 depends on Tasks 1+2 but not on 3-7 (it has its own fallback-free path).
Task 9 depends on Task 8.
Task 10 depends on all previous tasks.

```
Tasks 1+2 (types + identity)
    ├── Task 3 (intent) ────────┐
    ├── Task 4 (movement) ──────┤
    ├── Task 5 (social decay) ──┤
    ├── Task 6 (search) ────────┤
    ├── Task 7 (interaction) ───┤
    └── Task 8 (social.js) ─────┤
                                ├── Task 9 (godmode) ──┐
                                └───────────────────────┤
                                                        └── Task 10 (cleanup)
```
