# Engine Rewrite Specification

## Problem

The engine is a SugarCube passage-transition system. `Engine.goto()` renders a screen and waits for input. There is no concept of "advance N ticks and process the results." The social system needs batch tick processing for companion activities (walk together for 50 ticks, search together for 10 ticks).

Secondary issues: untyped global state, no screen lifecycle cleanup, duplicated constants, mixed ES5/ES6.

## Scope

Rewrite `engine.js` and `state.js` to TypeScript. Extract pure engine logic into `lib/engine.core.ts`. Keep the DOM-touching engine wrapper as `src/js/engine.ts`. Port all wrappers and screens to TypeScript incrementally.

## State Interface

```typescript
interface HeldBook {
    side: number;
    position: number;
    floor: number;
    bookIndex: number;
}

interface GameState {
    // Identity
    seed: string;
    screen: string;

    // Position
    side: number;       // 0=west, 1=east
    position: number;   // segment index
    floor: number;      // 0=bottom, up

    // Navigation
    move: string;
    shelfOffset: number;

    // Books
    heldBook: HeldBook | null;
    openBook: HeldBook | null;
    openPage: number;
    bookNames: Record<string, string>;
    dwellHistory: Record<string, boolean>;

    // Survival
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;

    // Condition
    despairing: boolean;
    dead: boolean;
    deaths: number;
    deathCause: string | null;
    won: boolean;

    // Time
    tick: number;
    day: number;
    lightsOn: boolean;

    // Story
    lifeStory: LifeStory;
    targetBook: HeldBook;

    // Systems
    eventDeck: number[];         // shuffled indices into event card list
    lastEvent: EventCard | null;
    npcs: NPC[];
    submissionsAttempted: number;

    // Debug
    debug: boolean;
    _debugAllowed: boolean;

    // Transient (prefixed with _)
    _menuReturn?: string;
    _submissionWon?: boolean;
    _readBlocked?: boolean;
    _dwellFired?: { bookIndex: number; pageIndex: number } | null;
}
```

## Screen Interface

```typescript
interface Screen {
    kind: "state" | "transition";
    enter?(): void;
    render(): string;
    afterRender?(): void;
    exit?(): void;
}
```

### Screen Lifecycle

```
try { exit() on old screen } finally {
  → enter() on new screen
  → death redirect check
  → render()
  → afterRender()
  → updateSidebar()
  → save()
}
```

The `exit()` hook runs before `enter()` on the next screen, wrapped in try/finally so a throwing `exit()` doesn't prevent the transition. This is where screens remove event listeners, clear timers, etc.

`render()` is the only required method on `Screen`. TypeScript enforces this at compile time — registering a screen without `render()` is a type error.

### Screen Taxonomy: States and Transitions

The screen graph is a category. Two kinds of nodes:

- **States** — objects with identity. The player can remain here indefinitely. Saveable. Examples: Corridor, Kiosk, Bedroom, Shelf, Menu, Death, Win.
- **Transitions** — morphisms. They compose with the current state and produce a new state. They do work in `enter()`, show a result in `render()`, and resolve via `goto()` to a state. Never saved. Examples: Wait, Sleep, Submission Attempt, Chasm, Falling, Kiosk Get Food.

```typescript
interface Screen {
    kind: "state" | "transition";
    enter?(): void;
    render(): string;
    afterRender?(): void;
    exit?(): void;
}
```

A transition knows its own codomain — it `goto()`s a state when it resolves. The engine doesn't track parent relationships. `save()` only fires when `state.screen` is a state-kind screen. If the engine is on a transition during save (shouldn't happen, but defensively), it skips the save.

This replaces the hardcoded TRANSIENT list and the parent field. The duplicated list in `save()` and `updateSidebar()` is gone.

## Batch Tick Processing

### The Core Method

```typescript
// In lib/engine.core.ts — pure logic, no DOM

interface TickResult {
    tickEvents: string[];   // boundary events from advanceTick
    days: number;           // how many days passed
    finalTick: number;
    finalDay: number;
}

const MAX_ADVANCE_TICKS = 2400; // 10 days, safety cap

function processTime(
    state: { tick: number; day: number },
    n: number,
    registry: Record<string, BoundaryHandler[]>
): TickResult {
    const clamped = Math.min(Math.max(1, n), MAX_ADVANCE_TICKS);
    const result = advanceTick(state, clamped);

    // Fire handlers for each boundary event in order.
    // Each handler is try/caught independently — a failing handler
    // does not prevent subsequent handlers or events from running.
    for (const event of result.events) {
        const handlers = registry[event] || [];
        for (const handler of handlers) {
            try { handler(); }
            catch (err) { console.error("Boundary handler error (" + event + "):", err); }
        }
    }

    return {
        tickEvents: result.events,
        days: result.state.day - state.day,
        finalTick: result.state.tick,
        finalDay: result.state.day,
    };
}
```

### Boundary Events

`advanceTick` emits these events in chronological order as tick boundaries are crossed:

| Event | Tick | Meaning |
|-------|------|---------|
| `lightsOut` | 160 (10:00 PM) | Lights off. Kiosk closes. Books unreadable. |
| `resetHour` | 230 (5:00 AM) | Forced sleep. Library shelf reset. |
| `dawn` | 240 (6:00 AM) | New day. Lights on. Resurrection. NPC movement + deterioration. |

Multiple events can fire per `advanceTime()` call. Multi-day skips emit repeated sequences.

### Boundary Event Registry

Handlers are registered, not hardcoded. Subsystems hook in at init time. This allows the social system to add companion-specific dawn processing without modifying engine code.

```typescript
type BoundaryHandler = () => void;

const boundaryRegistry: Record<string, BoundaryHandler[]> = {};

function onBoundary(event: string, handler: BoundaryHandler): void {
    if (!boundaryRegistry[event]) boundaryRegistry[event] = [];
    boundaryRegistry[event].push(handler);
}

// Core handlers registered at init
onBoundary("lightsOut", () => {
    state.lightsOn = false;
});
onBoundary("resetHour", () => {
    // forced sleep, book reset
});
onBoundary("dawn", () => {
    state.lightsOn = true;
    // resurrection, NPC movement + deterioration, survival
});

// Social system registers its own handlers later
onBoundary("dawn", () => {
    // companion relationship tick, departure checks
});
```

### Usage: Solo Action

```typescript
// Single tick, same as current behavior
Engine.advanceTime(1);
```

### Usage: Companion Activity

```typescript
// Walk together — 50 ticks, process all boundaries
Engine.advanceTime(50);
// On completion: survival auto-managed (reset to comfortable)
// Morale sustained by companion presence
// NPC deterioration processed for each dawn crossed
// Relationship sharedTicks += 50
```

### Usage: Sleep

```typescript
// Sleep until dawn — variable ticks
const n = ticksUntilDawn(state.tick);
Engine.advanceTime(n);
```

## Engine API (Public)

```typescript
interface EngineAPI {
    register(name: string, screen: Screen): void;
    action(name: string, fn: () => void): void;
    goto(name: string): void;
    advanceTime(n: number): TickResult;
    save(): void;
    load(): Partial<GameState> | null;
    clearSave(): void;
    init(): void;
    updateSidebar(): void;
}
```

## Migration Path

1. Create `lib/engine.core.ts` with `GameState`, `Screen`, `TickResult` interfaces and `processTime()` function.
2. Create `src/js/state.ts` replacing `state.js` — typed `GameState` with `as` cast (runtime stays `{}`; type is documentation and compile-time check).
3. Rewrite `src/js/engine.ts` — import core, implement `advanceTime()`, add `exit()` lifecycle, centralize transient screens.
4. Port screens to use `exit()` where needed.
5. Port remaining wrappers to TS.
6. Tests pass at each step.

## What This Enables

- **Companion activities**: `advanceTime(50)` for a walk, `advanceTime(10)` for a search. Boundary events fire correctly. Survival auto-managed on completion.
- **Screen cleanup**: `exit()` prevents listener leaks.
- **Typed state**: compile-time catches for misspelled fields, missing initializations, wrong types.
- **Save robustness**: transient screen metadata replaces hardcoded lists.
- **Future social system**: companion state, relationship tracking, knowledge flags all get typed fields on GameState.

## What This Doesn't Change

- Screen rendering (still string concatenation, still `innerHTML`)
- Keybinding dispatch (still screen-based switch)
- Content system (still `content/*.json` → `window.TEXT`)
- PRNG, library geometry, book generation
- Test infrastructure

## Threading Model

The game is single-threaded. All state mutations are synchronous and sequential. There are no async operations, web workers, or concurrent state access. `advanceTime()` runs to completion before any rendering occurs. This eliminates entire categories of state corruption concerns — there are no race conditions, no partial updates visible to other threads, no need for transactional state or clone-and-swap.

## Save Migration

The current engine already migrates old saves by checking for undefined fields in `init()`. The rewrite preserves this pattern. New fields added by the social system get default values during migration. Fields prefixed with `_` are transient — they may be serialized but are overwritten on load. This is acceptable; filtering them from serialization is a polish task, not a correctness requirement.

## Risks

- `Object.assign(state, saved)` for save loading works with typed state only if the cast is permissive. Runtime stays untyped — TS is compile-time only.
- Screens reference `state` directly everywhere. Typing `state` means every screen file needs to import the typed version. This is the largest mechanical change.
- `advanceTime()` boundary handlers modify state. If a handler triggers a screen transition (e.g., death during time skip), the batch processing must handle re-entrant `goto()` calls. Solution: queue screen transitions, execute after batch completes.

## Re-entrant goto During Batch Processing

If the player dies during a 50-tick walk (e.g., dawn triggers resurrection check but they're already dead from hunger mid-skip), the engine must not render mid-batch. Solution:

```typescript
let _batchMode = false;
let _pendingGoto: string | null = null;
let _screenBeforeBatch: string | null = null;

function advanceTime(n: number): TickResult {
    _batchMode = true;
    _screenBeforeBatch = state.screen;
    let result: TickResult;
    try {
        result = processTime(...);
    } finally {
        _batchMode = false;
    }

    if (_pendingGoto) {
        const target = _pendingGoto;
        _pendingGoto = null;
        // Run exit() on the screen that was active before the batch started.
        // This is the screen whose listeners/timers need cleanup.
        const oldScreen = Engine._screens[_screenBeforeBatch!];
        if (oldScreen?.exit) {
            try { oldScreen.exit(); } catch (e) { console.error("exit() error:", e); }
        }
        _screenBeforeBatch = null;
        Engine.goto(target);  // enter/render/afterRender on the new screen
    } else {
        _screenBeforeBatch = null;
    }
    return result;
}

function goto(name: string) {
    if (_batchMode) {
        _pendingGoto = name;  // defer until batch completes
        return;
    }
    // ... normal goto (runs exit on current, enter/render on new)
}
```

This ensures batch processing completes atomically. The final state is rendered once. The screen that was active when the batch started gets its `exit()` called exactly once, before the final deferred screen's `enter()`.

If multiple `goto()` calls fire during a batch (e.g., death then resurrection in the same dawn), the last one wins. This is intentional — intermediate screen transitions during a time skip are not rendered. The player sees the final outcome. State mutations from intermediate handlers still apply (e.g., `deathCause` is set even if Death screen doesn't render because resurrection followed).
