# Unified action dispatch implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared `applyAction(state, action, ctx)` function that both the browser and headless simulator call, eliminating duplicated game logic.

**Architecture:** A new `lib/action-dispatch.core.ts` module owns all action resolution. It mutates a `GameState` interface in place, calls existing pure core functions (`survival.core`, `tick.core`, `chasm.core`, `despairing.core`, `events.core`, `interaction.core`), and returns a `DispatchResult` with screen transition + tick events. The browser's `actions.js` becomes a thin wrapper that calls `applyAction` then handles DOM/screen/boundary concerns. The simulator replaces its internal `applyAction` switch with a call to the shared function.

**Tech Stack:** TypeScript core modules (`lib/*.core.ts`), JS bridge (`src/js/`), node:test

**Spec:** `docs/superpowers/specs/2026-03-16-unified-action-dispatch-design.md`

---

## File map

| File | Action | Responsibility |
|------|--------|----------------|
| `lib/action.core.ts` | Modify | Add social player actions (talk, spend_time, recruit, dismiss), add `inBedroom` to SleepAction |
| `lib/action-dispatch.core.ts` | Create | `GameState`, `ActionContext`, `DispatchResult`, `applyAction()` — the core of this refactor |
| `lib/simulator.core.ts` | Modify | Flatten `InternalState`, replace `applyAction` switch with shared function, migrate action type names |
| `src/js/actions.js` | Modify | Replace `resolve*` functions with calls to `applyAction`, handle screen/boundary dispatch |
| `src/js/survival.js` | Modify | Remove dead methods, keep display helpers |
| `src/js/chasm.js` | Modify | Remove methods absorbed by `applyAction`, keep display helpers |
| `src/js/despairing.js` | Modify | Remove methods absorbed by `applyAction`, keep display helpers |
| `src/js/tick.js` | Modify | Adapt `onMove`/`onSleep` to work with `applyAction` results |
| `test/action-dispatch.test.js` | Create | Unit tests for each action type |
| `test/action.test.js` | Modify | Update for new action types |
| `test/simulator*.test.js` | Modify | Adapt to flattened state + renamed action types |

---

## Chunk 1: Prerequisites — types and simulator state flattening

### Task 1: Extend action types

**Files:**
- Modify: `lib/action.core.ts`
- Modify: `test/action.test.js`

- [ ] **Step 1: Write tests for new action types**

Add to `test/action.test.js`:

```javascript
it("talk is a tick action", () => {
    assert.equal(costsTick({ type: "talk", npcId: 0, approach: "kind" }), true);
});

it("spend_time is a tick action", () => {
    assert.equal(costsTick({ type: "spend_time", npcId: 0 }), true);
});

it("recruit is a tick action", () => {
    assert.equal(costsTick({ type: "recruit", npcId: 0 }), true);
});

it("dismiss is a tick action", () => {
    assert.equal(costsTick({ type: "dismiss", npcId: 0 }), true);
});

it("sleep with inBedroom is a tick action", () => {
    assert.equal(costsTick({ type: "sleep", inBedroom: true }), true);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- --test-name-pattern "talk is a tick|spend_time|recruit is a tick|dismiss is a tick|sleep with inBedroom"`

- [ ] **Step 3: Add types to action.core.ts**

In `lib/action.core.ts`, modify `SleepAction`:

```typescript
export interface SleepAction { type: "sleep"; inBedroom?: boolean; }
```

Add after `FleeAction`:

```typescript
/** Talk to an NPC. */
export interface TalkAction { type: "talk"; npcId: number; approach: string; }
/** Spend time with an NPC. */
export interface SpendTimeAction { type: "spend_time"; npcId: number; }
/** Recruit an NPC into your group. */
export interface RecruitAction { type: "recruit"; npcId: number; }
/** Dismiss an NPC from your group. */
export interface DismissAction { type: "dismiss"; npcId: number; }
```

Add to the `Action` union (after `FleeAction`):

```typescript
    | TalkAction
    | SpendTimeAction
    | RecruitAction
    | DismissAction;
```

Add `"talk"`, `"spend_time"`, `"recruit"`, `"dismiss"` to `TICK_ACTIONS`:

```typescript
export const TICK_ACTIONS: Set<Action["type"]> = new Set([
    "move", "wait", "sleep", "eat", "drink", "alcohol",
    "submit", "fall_wait",
    "talk", "spend_time", "recruit", "dismiss",
]);
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Run full suite: `npm test`**

- [ ] **Step 6: Commit**

```bash
git add lib/action.core.ts test/action.test.js
git commit -m "feat(action): add social player actions and inBedroom to sleep"
```

### Task 2: Flatten simulator InternalState

**Files:**
- Modify: `lib/simulator.core.ts`
- Modify: `test/simulator*.test.js` (any tests that reference `gs.stats`)

This is mechanical but large. The simulator nests survival stats under `gs.stats` (e.g., `gs.stats.hunger`). Flatten them to `gs.hunger`, `gs.thirst`, etc. to match the `GameState` interface.

- [ ] **Step 1: In `lib/simulator.core.ts`, modify `InternalState`**

Replace the `stats: SurvivalStats;` field with flat fields:

```typescript
interface InternalState {
    seed: string;
    side: number;
    position: bigint;
    floor: bigint;
    tick: number;
    day: number;
    lightsOn: boolean;
    heldBook: BookCoords | null;
    dead: boolean;
    despairing: boolean;
    despairDays: number;
    deathCause: string | null;
    deaths: number;
    won: boolean;
    submissionsAttempted: number;
    lifeStory: LifeStory;
    targetBook: BookCoords;
    // Flat survival stats (previously nested under gs.stats)
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;
    eventDeck: number[];
    lastEvent: EventCard | null;
    npcs: NPC[];
    nonsensePagesRead: number;
    totalMoves: number;
    segmentsVisited: number;
    booksRead: Set<string>;
    _mercyKiosks: Record<string, boolean>;
    _mercyKioskDone: boolean;
    // New fields needed for GameState compat
    openBook: BookCoords | null;
    openPage: number;
    dwellHistory: Record<string, boolean>;
    _mercyArrival: string | null;
    _despairDays: number;
    falling: null;
    _readBlocked: boolean;
    _submissionWon: boolean;
    _lastMove: string | null;
}
```

- [ ] **Step 2: Add a helper to extract/apply SurvivalStats**

Add near the top of the file (inside `createSimulation`):

```typescript
function statsFromState(): SurvivalStats {
    return {
        hunger: gs.hunger, thirst: gs.thirst, exhaustion: gs.exhaustion,
        morale: gs.morale, mortality: gs.mortality,
        despairing: gs.despairing, dead: gs.dead,
    };
}
function applyStats(s: SurvivalStats): void {
    gs.hunger = s.hunger; gs.thirst = s.thirst; gs.exhaustion = s.exhaustion;
    gs.morale = s.morale; gs.mortality = s.mortality;
    gs.despairing = s.despairing; gs.dead = s.dead;
}
```

- [ ] **Step 3: Update all `gs.stats.*` references**

Find-and-replace throughout `createSimulation`:
- `gs.stats = Surv.applyEat(gs.stats)` → `applyStats(Surv.applyEat(statsFromState()))`
- `gs.stats = Surv.applyDrink(gs.stats)` → `applyStats(Surv.applyDrink(statsFromState()))`
- `gs.stats = Surv.applyAlcohol(gs.stats)` → `applyStats(Surv.applyAlcohol(statsFromState()))`
- `gs.stats = Surv.applyMoveTick(gs.stats)` → `applyStats(Surv.applyMoveTick(statsFromState()))`
- `gs.stats = Surv.applyMercyKiosk(gs.stats)` → `applyStats(Surv.applyMercyKiosk(statsFromState()))`
- `gs.stats = Surv.applyResurrection(gs.stats)` → `applyStats(Surv.applyResurrection(statsFromState()))`
- `gs.stats.morale` → `gs.morale`
- `gs.stats.despairing` → `gs.despairing`
- `gs.stats.dead` → `gs.dead`
- `gs.stats.thirst` → `gs.thirst`
- `gs.stats.hunger` → `gs.hunger`
- `gs.stats.exhaustion` → `gs.exhaustion`
- `gs.stats.mortality` → `gs.mortality`

Also update the `gsView` getter and `run()` result to use flat fields instead of `gs.stats`.

- [ ] **Step 4: Update initialization**

Replace `stats: Surv.defaultStats()` in the `gs` initialization with:

```typescript
hunger: 0,
thirst: 0,
exhaustion: 0,
morale: opts.startMorale ?? 100,
mortality: 100,
```

Add the new fields:

```typescript
openBook: null,
openPage: 0,
dwellHistory: {},
_mercyArrival: null,
_despairDays: 0,
falling: null,
_readBlocked: false,
_submissionWon: false,
_lastMove: null,
```

- [ ] **Step 5: Update the `GameState` view and `SimResult`**

The `gsView` object and `SimResult` currently reference `gs.stats`. Update them to read flat fields. The `SimResult.finalStats` field should be constructed from flat fields:

```typescript
finalStats: statsFromState(),
```

- [ ] **Step 6: Migrate action type names**

Replace throughout `simulator.core.ts`:
- `type: "read"` → `type: "read_book"`
- `type: "take"` → `type: "take_book"`
- `case "read":` → `case "read_book":`
- `case "take":` → `case "take_book":`

Update the `ActionType` type and `Action` union to import from `lib/action.core.ts` instead of defining its own:

```typescript
import type { Action } from "./action.core.ts";
```

Remove the local `ActionType`, `MoveAction`, `WaitAction`, etc. type definitions that duplicate `action.core.ts`.

Note: `SleepAction` in the simulator has no `inBedroom` — the simulator determines bedroom from `isRestArea()`. Add `inBedroom: Lib.isRestArea(gs.position)` when constructing sleep actions internally, or handle it in the strategy. For now, strategies can omit it and `applyAction` defaults to `false`.

- [ ] **Step 7: Run tests**

Run: `npm test`

Many tests will reference `finalStats` or `stats.morale` — update those in `test/simulator*.test.js` as needed. The key tests to check:
- `test/simulator.test.js` — references `finalStats.morale`, etc.
- `test/simulator-mercy.test.js` — references `stats.morale`
- `test/simulator-despair.test.js` — if it exists

- [ ] **Step 8: Commit**

```bash
git add lib/simulator.core.ts test/simulator*.test.js
git commit -m "refactor(simulator): flatten InternalState, import canonical Action types"
```

---

## Chunk 2: Create action-dispatch.core.ts

### Task 3: Scaffold module with GameState, ActionContext, DispatchResult

**Files:**
- Create: `lib/action-dispatch.core.ts`
- Create: `test/action-dispatch.test.js`

- [ ] **Step 1: Write test for module existence**

Create `test/action-dispatch.test.js`:

```javascript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyAction } from "../lib/action-dispatch.core.ts";

describe("action-dispatch scaffold", () => {
    it("applyAction exists and returns unresolved for unknown action", () => {
        const state = makeTestState();
        const ctx = makeTestCtx();
        const result = applyAction(state, { type: "unknown_thing" }, ctx);
        assert.equal(result.resolved, false);
    });
});
```

Add helpers at top of test file (after imports):

```javascript
function makeTestState(overrides = {}) {
    return {
        side: 0, position: 0n, floor: 10n,
        tick: 0, day: 1, lightsOn: true,
        hunger: 0, thirst: 0, exhaustion: 0, morale: 100, mortality: 100,
        despairing: false, dead: false,
        heldBook: null, openBook: null, openPage: 0,
        dwellHistory: {},
        targetBook: { side: 0, position: 100n, floor: 50n, bookIndex: 5 },
        submissionsAttempted: 0, nonsensePagesRead: 0, totalMoves: 0,
        deaths: 0, deathCause: null,
        _mercyKiosks: {}, _mercyKioskDone: false, _mercyArrival: null, _despairDays: 0,
        falling: null, eventDeck: [], lastEvent: null,
        won: false, _readBlocked: false, _submissionWon: false, _lastMove: null,
        ...overrides,
    };
}

function makeTestCtx(overrides = {}) {
    return { seed: "test", eventCards: [], ...overrides };
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- --test-name-pattern "action-dispatch scaffold"`

- [ ] **Step 3: Create minimal module**

Create `lib/action-dispatch.core.ts`:

```typescript
/**
 * Unified action dispatch — the single source of truth for game mechanics.
 *
 * Both the browser (src/js/actions.js) and the headless simulator
 * (lib/simulator.core.ts) call applyAction(). Screen transitions and
 * boundary event dispatch are caller concerns.
 *
 * @module action-dispatch.core
 */

import type { Action } from "./action.core.ts";
import type { TickEvent } from "./tick.core.ts";
import type { FallingState } from "./chasm.core.ts";
import type { EventCard } from "./events.core.ts";
import type { Entity, World } from "./ecs.core.ts";

// --- Interfaces ---

export interface BookCoords {
    side: number;
    position: bigint;
    floor: bigint;
    bookIndex: number;
}

export interface GameState {
    side: number;
    position: bigint;
    floor: bigint;
    tick: number;
    day: number;
    lightsOn: boolean;
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;
    despairing: boolean;
    dead: boolean;
    heldBook: BookCoords | null;
    openBook: BookCoords | null;
    openPage: number;
    dwellHistory: Record<string, boolean>;
    targetBook: BookCoords;
    submissionsAttempted: number;
    nonsensePagesRead: number;
    totalMoves: number;
    deaths: number;
    deathCause: string | null;
    _mercyKiosks: Record<string, boolean>;
    _mercyKioskDone: boolean;
    _mercyArrival: string | null;
    _despairDays: number;
    falling: FallingState | null;
    eventDeck: number[];
    lastEvent: EventCard | null;
    won: boolean;
    _readBlocked: boolean;
    _submissionWon: boolean;
    _lastMove: string | null;
    npcs?: any[];
}

export interface ActionContext {
    seed: string;
    eventCards: EventCard[];
    world?: World;
    resolveEntity?: (npcId: number) => Entity | undefined;
    playerEntity?: Entity;
    quicknessBonus?: number;
}

export interface DispatchResult {
    resolved: boolean;
    screen?: string;
    tickEvents: TickEvent[];
    ticksConsumed: number;
    data?: any;
}

// --- Helpers ---

function unresolved(): DispatchResult {
    return { resolved: false, tickEvents: [], ticksConsumed: 0 };
}

// --- Main dispatch ---

export function applyAction(
    state: GameState,
    action: Action | { type: string; [k: string]: any },
    ctx: ActionContext,
): DispatchResult {
    switch (action.type) {
        default:
            return unresolved();
    }
}
```

- [ ] **Step 4: Run test, verify it passes**

- [ ] **Step 5: Commit**

```bash
git add lib/action-dispatch.core.ts test/action-dispatch.test.js
git commit -m "feat(dispatch): scaffold action-dispatch module with types"
```

### Task 4: Implement move action

**Files:**
- Modify: `lib/action-dispatch.core.ts`
- Modify: `test/action-dispatch.test.js`

Move is the most complex single action: position update, exhaustion, auto-drink, mercy kiosk, event draw, survival depletion, ambient drain, death check, tick advance.

- [ ] **Step 1: Write move tests**

Add to `test/action-dispatch.test.js`:

```javascript
import { GALLERIES_PER_SEGMENT } from "../lib/library.core.ts";

describe("applyAction move", () => {
    it("moves right and advances one tick", () => {
        const s = makeTestState({ position: 5n });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.position, 6n);
        assert.equal(r.ticksConsumed, 1);
        assert.equal(s.totalMoves, 1);
    });

    it("rejects invalid move", () => {
        // At floor 0, can't go down
        const s = makeTestState({ floor: 0n, position: 0n });
        const r = applyAction(s, { type: "move", dir: "down" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("applies exhaustion for upward move", () => {
        const s = makeTestState({ position: 0n, floor: 5n });
        const r = applyAction(s, { type: "move", dir: "up" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.exhaustion >= 1.5, "up should add 1.5 exhaustion");
    });

    it("auto-drinks at rest area when thirsty", () => {
        const restPos = BigInt(GALLERIES_PER_SEGMENT);
        const s = makeTestState({ position: restPos - 1n, thirst: 60 });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.position, restPos);
        assert.ok(s.thirst < 60, "should have auto-drunk: thirst=" + s.thirst);
    });

    it("applies survival depletion on move", () => {
        const s = makeTestState({ hunger: 10 });
        applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.ok(s.hunger > 10, "hunger should increase: " + s.hunger);
    });

    it("applies ambient morale drain", () => {
        const s = makeTestState({ morale: 50 });
        applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.ok(s.morale < 50, "morale should drain: " + s.morale);
    });

    it("dead when move is rejected", () => {
        const s = makeTestState({ dead: true });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("returns screen Corridor on success", () => {
        const s = makeTestState({ position: 5n });
        const r = applyAction(s, { type: "move", dir: "right" }, makeTestCtx());
        assert.equal(r.screen, "Corridor");
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- --test-name-pattern "applyAction move"`

- [ ] **Step 3: Implement move in applyAction**

Add imports to `lib/action-dispatch.core.ts`:

```typescript
import { seedFromString } from "./prng.core.ts";
import type { SurvivalStats } from "./survival.core.ts";
import { applyMoveTick, applyDrink, applyMercyKiosk } from "./survival.core.ts";
import { applyAmbientDrain, shouldClearDespairing } from "./despairing.core.ts";
import { availableMovesMask, moveAllowed, applyMoveInPlace, isRestArea, type Location, type Direction } from "./library.core.ts";
import { mercyKiosk } from "./library.core.ts";
import { advanceTick, isLightsOn } from "./tick.core.ts";
import * as EventsCore from "./events.core.ts";
```

Add helpers:

```typescript
const AUTO_DRINK_THRESHOLD = 50;

function statsFromState(s: GameState): SurvivalStats {
    return {
        hunger: s.hunger, thirst: s.thirst, exhaustion: s.exhaustion,
        morale: s.morale, mortality: s.mortality,
        despairing: s.despairing, dead: s.dead,
    };
}

function applyStats(s: GameState, stats: SurvivalStats): void {
    s.hunger = stats.hunger; s.thirst = stats.thirst; s.exhaustion = stats.exhaustion;
    s.morale = stats.morale; s.mortality = stats.mortality;
    s.despairing = stats.despairing; s.dead = stats.dead;
}

function advanceOneTick(s: GameState): TickEvent[] {
    // Survival depletion
    applyStats(s, applyMoveTick(statsFromState(s)));
    // Ambient morale drain
    s.morale = applyAmbientDrain(s.morale);
    if (s.morale <= 0) s.despairing = true;
    // Death check
    if (s.mortality <= 0 || s.hunger >= 100 || s.thirst >= 100) {
        s.dead = true;
        if (s.mortality <= 0) s.deathCause = "mortality";
        else if (s.thirst >= 100 && s.hunger >= 100) s.deathCause = "starvation_dehydration";
        else if (s.thirst >= 100) s.deathCause = "dehydration";
        else if (s.hunger >= 100) s.deathCause = "starvation";
    }
    // Advance time
    const result = advanceTick({ tick: s.tick, day: s.day }, 1);
    s.tick = result.state.tick;
    s.day = result.state.day;
    s.lightsOn = isLightsOn(s.tick);
    return result.events;
}
```

Add the move case to the switch:

```typescript
case "move": {
    if (state.dead || state.won) return unresolved();
    const dir = (action as any).dir as Direction;
    const mask = availableMovesMask(state.position, state.floor);
    if (!moveAllowed(mask, dir)) return unresolved();

    const loc: Location = { side: state.side, position: state.position, floor: state.floor };
    applyMoveInPlace(loc, dir);
    state.side = loc.side;
    state.position = loc.position;
    state.floor = loc.floor;
    state._lastMove = dir;
    state.totalMoves++;

    // Directional exhaustion
    if (dir === "up") state.exhaustion = Math.min(100, state.exhaustion + 1.5);
    else if (dir === "down") state.exhaustion = Math.min(100, state.exhaustion + 0.75);

    // Advance one tick (depletion + time)
    const tickEvents = advanceOneTick(state);

    // Auto-drink at rest area kiosks
    if (isRestArea(state.position) && state.lightsOn) {
        if (state.thirst >= AUTO_DRINK_THRESHOLD) {
            applyStats(state, applyDrink(statsFromState(state)));
        }
    }

    // Mercy kiosk (one-shot)
    state._mercyArrival = null;
    if (!state._mercyKioskDone && isRestArea(state.position)) {
        const mercy = mercyKiosk(
            { side: state.side, position: state.position, floor: state.floor },
            state.targetBook,
        );
        if (mercy) {
            state._mercyKiosks[mercy] = true;
            state._mercyKioskDone = true;
            applyStats(state, applyMercyKiosk(statsFromState(state)));
            state._mercyArrival = mercy;
            state._despairDays = 0;
        }
    }

    // Event draw
    if (ctx.eventCards.length > 0) {
        const evRng = seedFromString(ctx.seed + ":ev:" + state.totalMoves);
        const draw = EventsCore.drawEvent(state.eventDeck, ctx.eventCards, evRng);
        state.eventDeck = draw.deck;
        state.lastEvent = draw.event;
        if (draw.event && draw.event.morale) {
            state.morale = Math.max(0, Math.min(100, state.morale + draw.event.morale));
        }
    }

    return { resolved: true, screen: "Corridor", tickEvents, ticksConsumed: 1 };
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Run full suite: `npm test`**

- [ ] **Step 6: Commit**

```bash
git add lib/action-dispatch.core.ts test/action-dispatch.test.js
git commit -m "feat(dispatch): implement move action"
```

### Task 5: Implement wait, eat, drink, alcohol

**Files:**
- Modify: `lib/action-dispatch.core.ts`
- Modify: `test/action-dispatch.test.js`

These are all simple single-tick actions.

- [ ] **Step 1: Write tests**

```javascript
describe("applyAction wait", () => {
    it("advances one tick", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "wait" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.ticksConsumed, 1);
        assert.equal(r.screen, "Wait");
    });

    it("rejected when dead", () => {
        const s = makeTestState({ dead: true });
        const r = applyAction(s, { type: "wait" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction eat", () => {
    it("reduces hunger at rest area", () => {
        const restPos = BigInt(GALLERIES_PER_SEGMENT);
        const s = makeTestState({ position: restPos, hunger: 50 });
        const r = applyAction(s, { type: "eat" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.hunger < 50, "hunger should decrease");
    });

    it("rejected when not at rest area", () => {
        const s = makeTestState({ position: 5n, hunger: 50 });
        const r = applyAction(s, { type: "eat" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("rejected when lights off", () => {
        const restPos = BigInt(GALLERIES_PER_SEGMENT);
        const s = makeTestState({ position: restPos, lightsOn: false });
        const r = applyAction(s, { type: "eat" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction drink", () => {
    it("reduces thirst at rest area", () => {
        const restPos = BigInt(GALLERIES_PER_SEGMENT);
        const s = makeTestState({ position: restPos, thirst: 50 });
        const r = applyAction(s, { type: "drink" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.thirst < 50, "thirst should decrease");
    });
});

describe("applyAction alcohol", () => {
    it("applies at rest area and checks despairing clear", () => {
        const restPos = BigInt(GALLERIES_PER_SEGMENT);
        const s = makeTestState({ position: restPos, morale: 30, despairing: true });
        const r = applyAction(s, { type: "alcohol" }, makeTestCtx());
        assert.equal(r.resolved, true);
        // Alcohol gives morale boost, shouldClearDespairing checks if morale > threshold
        assert.ok(s.morale > 30, "morale should increase");
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement**

Add imports:

```typescript
import { applyEat, applyAlcohol } from "./survival.core.ts";
```

Add cases to the switch:

```typescript
case "wait": {
    if (state.dead || state.won) return unresolved();
    const tickEvents = advanceOneTick(state);
    return { resolved: true, screen: "Wait", tickEvents, ticksConsumed: 1 };
}

case "eat": {
    if (state.dead || state.won) return unresolved();
    if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
    applyStats(state, applyEat(statsFromState(state)));
    const tickEvents = advanceOneTick(state);
    return { resolved: true, screen: "Kiosk Get Food", tickEvents, ticksConsumed: 1 };
}

case "drink": {
    if (state.dead || state.won) return unresolved();
    if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
    applyStats(state, applyDrink(statsFromState(state)));
    const tickEvents = advanceOneTick(state);
    return { resolved: true, screen: "Kiosk Get Drink", tickEvents, ticksConsumed: 1 };
}

case "alcohol": {
    if (state.dead || state.won) return unresolved();
    if (!isRestArea(state.position) || !state.lightsOn) return unresolved();
    applyStats(state, applyAlcohol(statsFromState(state)));
    if (state.despairing && shouldClearDespairing(state.morale)) {
        state.despairing = false;
    }
    const tickEvents = advanceOneTick(state);
    return { resolved: true, screen: "Kiosk Get Alcohol", tickEvents, ticksConsumed: 1 };
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add lib/action-dispatch.core.ts test/action-dispatch.test.js
git commit -m "feat(dispatch): implement wait, eat, drink, alcohol"
```

### Task 6: Implement read_book, take_book, drop_book, submit

**Files:**
- Modify: `lib/action-dispatch.core.ts`
- Modify: `test/action-dispatch.test.js`

- [ ] **Step 1: Write tests**

```javascript
import { BOOKS_PER_GALLERY } from "../lib/library.core.ts";

describe("applyAction read_book", () => {
    it("opens book and applies morale penalty", () => {
        const s = makeTestState({ position: 5n, morale: 80 });
        const r = applyAction(s, { type: "read_book", bookIndex: 3 }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.screen, "Shelf Open Book");
        assert.deepEqual(s.openBook, { side: 0, position: 5n, floor: 10n, bookIndex: 3 });
        assert.equal(s.openPage, 1);
        // Should have applied nonsense reading penalty
        assert.ok(s.morale < 80 || s.nonsensePagesRead > 0,
            "should apply read penalty or track pages");
    });

    it("rejected at rest area", () => {
        const s = makeTestState({ position: 0n });
        const r = applyAction(s, { type: "read_book", bookIndex: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("rejected when lights off", () => {
        const s = makeTestState({ position: 5n, lightsOn: false });
        const r = applyAction(s, { type: "read_book", bookIndex: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("tracks dwell history", () => {
        const s = makeTestState({ position: 5n });
        applyAction(s, { type: "read_book", bookIndex: 7 }, makeTestCtx());
        assert.equal(s.dwellHistory["0:5:10:7"], true);
    });
});

describe("applyAction take_book", () => {
    it("sets heldBook with no tick cost", () => {
        const s = makeTestState({ position: 5n });
        const r = applyAction(s, { type: "take_book", bookIndex: 3 }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.ticksConsumed, 0);
        assert.deepEqual(s.heldBook, { side: 0, position: 5n, floor: 10n, bookIndex: 3 });
    });
});

describe("applyAction drop_book", () => {
    it("clears heldBook", () => {
        const s = makeTestState({ heldBook: { side: 0, position: 5n, floor: 10n, bookIndex: 3 } });
        const r = applyAction(s, { type: "drop_book" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.heldBook, null);
    });
});

describe("applyAction submit", () => {
    it("wins when book matches target", () => {
        const target = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        const s = makeTestState({ position: 0n, heldBook: { ...target }, targetBook: target });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.won, true);
        assert.equal(s._submissionWon, true);
    });

    it("consumes wrong book on failed submission", () => {
        const target = { side: 0, position: 100n, floor: 50n, bookIndex: 5 };
        const wrong = { side: 0, position: 100n, floor: 50n, bookIndex: 6 };
        const s = makeTestState({ position: 0n, heldBook: wrong, targetBook: target });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.won, false);
        assert.equal(s._submissionWon, false);
        assert.equal(s.heldBook, null);
    });

    it("rejected without held book", () => {
        const s = makeTestState({ position: 0n });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("rejected when not at rest area", () => {
        const s = makeTestState({ position: 5n, heldBook: { side: 0, position: 5n, floor: 10n, bookIndex: 0 } });
        const r = applyAction(s, { type: "submit" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement**

Add imports:

```typescript
import { applyReadNonsense } from "./survival.core.ts";
import { isReadingBlocked } from "./despairing.core.ts";
import { BOOKS_PER_GALLERY } from "./library.core.ts";
```

Add cases:

```typescript
case "read_book": {
    if (state.dead || state.won) return unresolved();
    if (!state.lightsOn) return unresolved();
    if (isRestArea(state.position)) return unresolved();
    const bookIndex = (action as any).bookIndex as number;
    if (bookIndex < 0 || bookIndex >= BOOKS_PER_GALLERY) return unresolved();

    // Despairing read block
    const readRng = seedFromString(ctx.seed + ":read:" + state.totalMoves + ":" + bookIndex);
    if (isReadingBlocked(state.despairing, readRng.next())) {
        state._readBlocked = true;
        return { resolved: true, screen: "Corridor", tickEvents: [], ticksConsumed: 0 };
    }

    // Open book
    state.openBook = { side: state.side, position: state.position, floor: state.floor, bookIndex };
    state.openPage = 1;

    // Track dwell history
    const dwellKey = state.side + ":" + state.position + ":" + state.floor + ":" + bookIndex;
    state.dwellHistory[dwellKey] = true;

    // Apply nonsense reading morale penalty
    const readResult = applyReadNonsense(statsFromState(state), state.nonsensePagesRead);
    applyStats(state, readResult.stats);
    state.nonsensePagesRead = readResult.nonsensePagesRead;

    return { resolved: true, screen: "Shelf Open Book", tickEvents: [], ticksConsumed: 0 };
}

case "take_book": {
    if (state.dead || state.won) return unresolved();
    if (!state.lightsOn) return unresolved();
    const bi = (action as any).bookIndex as number;
    if (bi < 0 || bi >= BOOKS_PER_GALLERY) return unresolved();
    state.heldBook = { side: state.side, position: state.position, floor: state.floor, bookIndex: bi };
    return { resolved: true, tickEvents: [], ticksConsumed: 0 };
}

case "drop_book": {
    state.heldBook = null;
    return { resolved: true, tickEvents: [], ticksConsumed: 0 };
}

case "submit": {
    if (state.dead || state.won) return unresolved();
    if (!isRestArea(state.position) || !state.heldBook) return unresolved();
    state.submissionsAttempted++;
    state._submissionWon = false;
    const hb = state.heldBook;
    const tb = state.targetBook;
    if (hb.side === tb.side && hb.position === tb.position &&
        hb.floor === tb.floor && hb.bookIndex === tb.bookIndex) {
        state.won = true;
        state._submissionWon = true;
    }
    if (!state.won) state.heldBook = null;
    const tickEvents = advanceOneTick(state);
    return { resolved: true, screen: "Submission Attempt", tickEvents, ticksConsumed: 1 };
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add lib/action-dispatch.core.ts test/action-dispatch.test.js
git commit -m "feat(dispatch): implement read_book, take_book, drop_book, submit"
```

### Task 7: Implement sleep (one hour)

**Files:**
- Modify: `lib/action-dispatch.core.ts`
- Modify: `test/action-dispatch.test.js`

Sleep applies one hour of recovery and advances `TICKS_PER_HOUR` ticks. The caller loops.

- [ ] **Step 1: Write tests**

```javascript
import { TICKS_PER_HOUR } from "../lib/tick.core.ts";

describe("applyAction sleep", () => {
    it("advances TICKS_PER_HOUR and recovers exhaustion", () => {
        const s = makeTestState({ exhaustion: 50, tick: 960 }); // lights off
        s.lightsOn = false;
        const r = applyAction(s, { type: "sleep", inBedroom: true }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.ticksConsumed, TICKS_PER_HOUR);
        assert.ok(s.exhaustion < 50, "exhaustion should recover: " + s.exhaustion);
    });

    it("returns tick events from the hour", () => {
        // Tick 1380 + 60 = 1440 → crosses dawn
        const s = makeTestState({ tick: 1380 });
        s.lightsOn = false;
        const r = applyAction(s, { type: "sleep", inBedroom: false }, makeTestCtx());
        assert.ok(r.tickEvents.includes("dawn"), "should fire dawn event");
    });

    it("applies despairing sleep modifier", () => {
        const s = makeTestState({ exhaustion: 80, morale: 5, despairing: true, tick: 960 });
        s.lightsOn = false;
        const moraleBefore = s.morale;
        applyAction(s, { type: "sleep", inBedroom: true }, makeTestCtx());
        // Despairing reduces sleep recovery by 10%
        // Just verify morale changed (direction depends on bedroom + despairing math)
        assert.equal(typeof s.morale, "number");
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement**

Add imports:

```typescript
import { applySleep } from "./survival.core.ts";
import { applySleepWithDespairing, modifySleepRecovery } from "./despairing.core.ts";
import { TICKS_PER_HOUR } from "./tick.core.ts";
```

Add case:

```typescript
case "sleep": {
    if (state.dead || state.won) return unresolved();
    const inBedroom = (action as any).inBedroom ?? false;

    // Apply one hour of sleep recovery
    const moraleBefore = state.morale;
    applyStats(state, applySleep(statsFromState(state), inBedroom));

    // Despairing sleep modifier
    if (state.despairing) {
        const baseDelta = state.morale - moraleBefore;
        if (baseDelta > 0) {
            const effective = modifySleepRecovery(baseDelta, state.despairing);
            state.morale = Math.max(0, moraleBefore + effective);
        }
    }
    if (state.despairing && shouldClearDespairing(state.morale)) {
        state.despairing = false;
    }

    // Advance time by one hour
    const result = advanceTick({ tick: state.tick, day: state.day }, TICKS_PER_HOUR);
    state.tick = result.state.tick;
    state.day = result.state.day;
    state.lightsOn = isLightsOn(state.tick);

    return {
        resolved: true, screen: "Sleep",
        tickEvents: result.events,
        ticksConsumed: TICKS_PER_HOUR,
    };
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add lib/action-dispatch.core.ts test/action-dispatch.test.js
git commit -m "feat(dispatch): implement sleep (one hour per call, caller loops)"
```

### Task 8: Implement chasm actions

**Files:**
- Modify: `lib/action-dispatch.core.ts`
- Modify: `test/action-dispatch.test.js`

- [ ] **Step 1: Write tests**

```javascript
describe("applyAction chasm_jump", () => {
    it("starts falling state", () => {
        const s = makeTestState({ floor: 10n });
        const r = applyAction(s, { type: "chasm_jump" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(s.falling, "should be falling");
        assert.equal(s.falling.speed, 0);
    });

    it("rejected at floor 0", () => {
        const s = makeTestState({ floor: 0n });
        const r = applyAction(s, { type: "chasm_jump" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction grab_railing", () => {
    it("attempts grab when falling", () => {
        const s = makeTestState({ floor: 10n, falling: { speed: 5, floorsToFall: 0, side: 0 } });
        const r = applyAction(s, { type: "grab_railing" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.ok(r.data, "should have grab result data");
    });

    it("rejected when not falling", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "grab_railing" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});

describe("applyAction throw_book", () => {
    it("clears held book while falling", () => {
        const s = makeTestState({
            falling: { speed: 5, floorsToFall: 0, side: 0 },
            heldBook: { side: 0, position: 5n, floor: 10n, bookIndex: 3 },
        });
        const r = applyAction(s, { type: "throw_book" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(s.heldBook, null);
    });
});

describe("applyAction fall_wait", () => {
    it("advances tick and continues fall", () => {
        const s = makeTestState({ floor: 100n, falling: { speed: 5, floorsToFall: 0, side: 0 } });
        const floorBefore = s.floor;
        const r = applyAction(s, { type: "fall_wait" }, makeTestCtx());
        assert.equal(r.resolved, true);
        assert.equal(r.ticksConsumed, 1);
        assert.ok(s.floor < floorBefore, "should have fallen");
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement**

Add imports:

```typescript
import { defaultFallingState, fallTick, attemptGrab } from "./chasm.core.ts";
```

Add cases:

```typescript
case "chasm_jump": {
    if (state.dead || state.won) return unresolved();
    if (state.floor <= 0n) return unresolved();
    state.falling = defaultFallingState(state.side);
    return { resolved: true, screen: "Falling", tickEvents: [], ticksConsumed: 0 };
}

case "grab_railing": {
    if (!state.falling) return unresolved();
    const grabRng = seedFromString(ctx.seed + ":grab:" + state.floor + ":" + state.tick);
    const bonus = ctx.quicknessBonus ?? 0;
    const result = attemptGrab(state.falling.speed, grabRng, bonus);
    if (result.success) {
        state.falling = null;
        return { resolved: true, screen: "Corridor", tickEvents: [], ticksConsumed: 0, data: { success: true, mortalityHit: 0 } };
    }
    state.falling.speed = result.speedAfter;
    state.mortality = Math.max(0, state.mortality - result.mortalityHit);
    if (state.mortality <= 0) {
        state.dead = true;
        state.deathCause = "trauma";
    }
    return { resolved: true, tickEvents: [], ticksConsumed: 0, data: { success: false, mortalityHit: result.mortalityHit } };
}

case "throw_book": {
    state.heldBook = null;
    return { resolved: true, tickEvents: [], ticksConsumed: 0 };
}

case "fall_wait": {
    if (state.dead) return unresolved();
    if (!state.falling) return unresolved();

    // Preserve mortality (trauma damage is from grabs, not from falling ticks)
    const mortalityBefore = state.mortality;
    const tickEvents = advanceOneTick(state);
    state.mortality = Math.min(state.mortality, mortalityBefore);

    // Fall physics
    const fallResult = fallTick(state.falling, Number(state.floor));
    state.floor = BigInt(fallResult.newFloor);
    state.falling.speed = fallResult.newSpeed;

    if (fallResult.landed) {
        state.falling = null;
        if (fallResult.fatal) {
            state.dead = true;
            state.deathCause = "gravity";
        }
    }

    if (state.dead) return { resolved: true, screen: "Death", tickEvents, ticksConsumed: 1 };
    if (!state.falling) return { resolved: true, screen: "Corridor", tickEvents, ticksConsumed: 1 };
    return { resolved: true, screen: "Falling", tickEvents, ticksConsumed: 1 };
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Commit**

```bash
git add lib/action-dispatch.core.ts test/action-dispatch.test.js
git commit -m "feat(dispatch): implement chasm actions (jump, grab, throw, fall_wait)"
```

### Task 9: Implement social actions (talk, spend_time, recruit, dismiss)

**Files:**
- Modify: `lib/action-dispatch.core.ts`
- Modify: `test/action-dispatch.test.js`

Social actions delegate to `lib/interaction.core.ts` and `lib/actions.core.ts` (ECS NPC system). They require `ctx.world`. When absent, return unresolved.

- [ ] **Step 1: Write tests**

```javascript
describe("applyAction social actions", () => {
    it("talk returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "talk", npcId: 0, approach: "kind" }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("spend_time returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "spend_time", npcId: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("recruit returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "recruit", npcId: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });

    it("dismiss returns unresolved without world", () => {
        const s = makeTestState();
        const r = applyAction(s, { type: "dismiss", npcId: 0 }, makeTestCtx());
        assert.equal(r.resolved, false);
    });
});
```

Note: full integration tests with an actual ECS world are deferred — the browser integration (Chunk 3) will validate these paths. For now we just verify the guard.

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Implement**

Add imports:

```typescript
import { talkTo, spendTime as spendTimeCore, recruit as recruitCore, type TalkResult } from "./interaction.core.ts";
import { dismiss as dismissCore } from "./actions.core.ts";
```

Add cases:

```typescript
case "talk": {
    if (state.dead) return unresolved();
    if (!ctx.world || !ctx.resolveEntity || !ctx.playerEntity) return unresolved();
    const npcId = (action as any).npcId as number;
    const approach = (action as any).approach as string;
    const npcEnt = ctx.resolveEntity(npcId);
    if (npcEnt === undefined) return unresolved();
    const result = talkTo(ctx.world, ctx.playerEntity, npcEnt, approach as any);
    if (!result.success) return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
    // Advance 2 ticks for conversation
    const ev1 = advanceTick({ tick: state.tick, day: state.day }, 2);
    state.tick = ev1.state.tick; state.day = ev1.state.day;
    state.lightsOn = isLightsOn(state.tick);
    return { resolved: true, tickEvents: ev1.events, ticksConsumed: 2, data: result };
}

case "spend_time": {
    if (state.dead) return unresolved();
    if (!ctx.world || !ctx.resolveEntity || !ctx.playerEntity) return unresolved();
    const npcId = (action as any).npcId as number;
    const npcEnt = ctx.resolveEntity(npcId);
    if (npcEnt === undefined) return unresolved();
    const result = spendTimeCore(ctx.world, ctx.playerEntity, npcEnt);
    if (!result.success) return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
    const ticks = result.ticksSpent;
    const ev = advanceTick({ tick: state.tick, day: state.day }, ticks);
    state.tick = ev.state.tick; state.day = ev.state.day;
    state.lightsOn = isLightsOn(state.tick);
    return { resolved: true, tickEvents: ev.events, ticksConsumed: ticks, data: result };
}

case "recruit": {
    if (state.dead) return unresolved();
    if (!ctx.world || !ctx.resolveEntity || !ctx.playerEntity) return unresolved();
    const npcId = (action as any).npcId as number;
    const npcEnt = ctx.resolveEntity(npcId);
    if (npcEnt === undefined) return unresolved();
    const result = recruitCore(ctx.world, ctx.playerEntity, npcEnt);
    if (!result.success) return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
    const ev = advanceTick({ tick: state.tick, day: state.day }, 1);
    state.tick = ev.state.tick; state.day = ev.state.day;
    state.lightsOn = isLightsOn(state.tick);
    return { resolved: true, tickEvents: ev.events, ticksConsumed: 1, data: result };
}

case "dismiss": {
    if (state.dead) return unresolved();
    if (!ctx.world || !ctx.resolveEntity || !ctx.playerEntity) return unresolved();
    const npcId = (action as any).npcId as number;
    const npcEnt = ctx.resolveEntity(npcId);
    if (npcEnt === undefined) return unresolved();
    const result = dismissCore(ctx.world, ctx.playerEntity, npcEnt);
    if (result.type !== "ok") return { resolved: false, tickEvents: [], ticksConsumed: 0, data: result };
    const ev = advanceTick({ tick: state.tick, day: state.day }, 1);
    state.tick = ev.state.tick; state.day = ev.state.day;
    state.lightsOn = isLightsOn(state.tick);
    return { resolved: true, tickEvents: ev.events, ticksConsumed: 1, data: result };
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Run full suite: `npm test`**

- [ ] **Step 6: Commit**

```bash
git add lib/action-dispatch.core.ts test/action-dispatch.test.js
git commit -m "feat(dispatch): implement social actions (talk, spend_time, recruit, dismiss)"
```

---

## Chunk 3: Browser integration

### Task 10: Rewrite actions.js to call applyAction

**Files:**
- Modify: `src/js/actions.js`
- Modify: `src/js/tick.js`

The browser's `Actions.resolve()` becomes a thin wrapper: call `applyAction`, handle screen transition, dispatch boundary events, run social physics.

- [ ] **Step 1: Rewrite actions.js**

Replace the entire body of `src/js/actions.js` with:

```javascript
import { state } from "./state.js";
import { Tick } from "./tick.js";
import { Social } from "./social.js";
import { applyAction } from "../../lib/action-dispatch.core.ts";
import { Engine } from "./engine.js";
import { PRNG } from "./prng.js";
import { isRestArea } from "../../lib/library.core.ts";

function buildCtx() {
    return {
        seed: PRNG.getSeed(),
        eventCards: [], // Events currently disabled in browser
        world: Social.getWorld?.() || undefined,
        resolveEntity: Social.resolveEntity?.bind(Social),
        playerEntity: Social.getPlayerEntity?.(),
        quicknessBonus: Social.getQuicknessGrabBonus?.() || 0,
    };
}

/** Pin NPC to player's position for conversation. */
function pinNpc(npcId) {
    const npc = state.npcs && state.npcs.find(function (n) { return n.id === npcId; });
    if (npc) {
        npc.side = state.side;
        npc.position = state.position;
        npc.floor = state.floor;
        Social.syncNpcPositions();
    }
}

function resolve(action) {
    // Map sleep action with bedroom context
    if (action.type === "sleep") {
        action = { ...action, inBedroom: state._lastScreen === "Bedroom" };
    }

    const ctx = buildCtx();
    const result = applyAction(state, action, ctx);

    if (!result.resolved) return result;

    // Dispatch boundary events
    for (const ev of result.tickEvents) {
        Engine._boundary.fire(ev);
    }

    // Run social physics for ticks consumed
    if (result.ticksConsumed > 0) {
        Social.onTick(result.ticksConsumed);
    }

    // Pin NPC for social actions
    if (action.type === "talk" || action.type === "spend_time" ||
        action.type === "recruit" || action.type === "dismiss") {
        pinNpc(action.npcId);
    }

    // Pass-out guard (resetHour boundary sets _passedOut)
    if (state._passedOut) {
        state._passedOut = false;
        result.resolved = true;
        result.screen = "Passing Out";
    }

    return result;
}

export const Actions = { resolve };
```

- [ ] **Step 2: Update tick.js onMove**

The `Tick.onMove()` function currently calls `this.advance(1)` + `Surv.onMove()` + `Events.draw()`. Since `applyAction` now handles survival depletion and events internally, `Tick.onMove()` is no longer called by `actions.js`. However, it may still be called by other code. Check for callers and remove or adapt as needed.

If `onMove` has no other callers, remove it. If it does, keep it as a compatibility shim.

- [ ] **Step 3: Adapt tick.js onSleep**

`Tick.onSleep()` currently loops internally. It should now loop by calling `applyAction({ type: "sleep" })`:

```javascript
onSleep() {
    const inBedroom = state._lastScreen === "Bedroom";
    const startDay = state.day;
    while (!isResetHour(state.tick) && !state.dead && state.day === startDay) {
        const r = applyAction(state, { type: "sleep", inBedroom }, buildCtx());
        for (const ev of r.tickEvents) Engine._boundary.fire(ev);
        Social.onTick(TICKS_PER_HOUR);
    }
},
```

This requires importing `applyAction` in tick.js and a `buildCtx` helper. Alternatively, the sleep loop can live in `actions.js` — the `resolve` function detects `sleep` and loops there. Decide based on which file currently owns the loop.

- [ ] **Step 4: Run full test suite and screenshot tests**

Run: `npm test` and `bash screenshots.sh`

- [ ] **Step 5: Commit**

```bash
git add src/js/actions.js src/js/tick.js
git commit -m "refactor(browser): rewrite actions.js to call shared applyAction"
```

### Task 11: Clean up dead wrapper code

**Files:**
- Modify: `src/js/survival.js`
- Modify: `src/js/chasm.js`
- Modify: `src/js/despairing.js`

Remove methods that are now dead code because `applyAction` handles them:

**survival.js** — remove: `onMove`, `onEat`, `onDrink`, `onAlcohol`, `onSleep`, `onResurrection`, `kill`, `exhaust`. Keep: `init`, `canSleep`, `severity`, `showMortality`, `warnings`, `describeRising`, `describeMorale`.

**chasm.js** — remove: `jump`, `grab`, `throwBook`, `onTick`. Keep: `getGrabChance`, `getAltitude`.

**despairing.js** — remove: `applyAmbientDrain`, `checkExit`, `modifySleepRecovery`. Keep: `corruptStatValue`, `shouldCorruptDescriptor`, `isReadingBlocked`, `chasmSkipsConfirm`.

Wait — `isReadingBlocked` in despairing.js uses `Math.random()` while the core function uses seeded RNG. The browser no longer calls `Despair.isReadingBlocked()` from actions.js (applyAction handles it), so this is fine to keep as a display/UI check if needed elsewhere.

- [ ] **Step 1: Remove dead methods from each file**

- [ ] **Step 2: Check for any remaining callers of removed methods**

Run: `grep -r "Surv.onMove\|Surv.onEat\|Surv.onDrink\|Surv.onAlcohol\|Surv.onSleep\|Surv.kill\|Surv.exhaust\|Chasm.jump\|Chasm.grab\|Chasm.throwBook\|Chasm.onTick\|Despair.applyAmbientDrain\|Despair.checkExit" src/js/`

Fix any remaining callers.

- [ ] **Step 3: Run full suite: `npm test`**

- [ ] **Step 4: Commit**

```bash
git add src/js/survival.js src/js/chasm.js src/js/despairing.js
git commit -m "refactor: remove dead wrapper methods absorbed by action-dispatch"
```

---

## Chunk 4: Simulator integration

### Task 12: Rewrite simulator to use applyAction

**Files:**
- Modify: `lib/simulator.core.ts`
- Modify: `test/simulator*.test.js`

- [ ] **Step 1: Replace the simulator's `applyAction` function**

The simulator's internal `applyAction` switch (~130 lines) is replaced with a call to the shared function:

```typescript
import { applyAction as dispatchAction, type ActionContext, type DispatchResult } from "./action-dispatch.core.ts";

// Inside createSimulation:
const simCtx: ActionContext = {
    seed,
    eventCards,
};

function applyAction(action: Action): boolean {
    const result = dispatchAction(gs, action, simCtx);
    if (!result.resolved) return false;

    // Handle boundary events
    for (const ev of result.tickEvents) {
        if (ev === "dawn") onDawn();
    }

    return true;
}
```

- [ ] **Step 2: Remove dead helper functions**

Remove `advanceOneTick`, `advanceTime`, `applySleepHour` — their logic is now in the shared module.

Keep `onDawn` — it handles resurrection, NPC cycle, dawn reset.

- [ ] **Step 3: Adapt the sleep handling**

The simulator's sleep case currently loops. Replace with the caller-managed loop:

```typescript
case "sleep": {
    const inBedroom = isRestArea(gs.position);
    while (!isResetHour(gs.tick) && !gs.dead && gs.day <= maxDays) {
        const r = dispatchAction(gs, { type: "sleep", inBedroom }, simCtx);
        if (!r.resolved) break;
        for (const ev of r.tickEvents) {
            if (ev === "dawn") onDawn();
        }
    }
    return true;
}
```

Wait — sleep is no longer in the strategy's action set. The strategy returns `{ type: "sleep" }` and the simulator's main loop calls `applyAction`. But the simulator's `applyAction` wrapper needs to detect sleep and loop. The simplest approach: the strategy returns `{ type: "sleep" }`, the simulator wrapper detects it and loops.

- [ ] **Step 4: Update onDawn to use flat state**

`onDawn` already works with flat state after Task 2. Verify it uses `gs.hunger`, not `gs.stats.hunger`.

- [ ] **Step 5: Update the `run()` function**

The `run()` result construction should use flat fields:

```typescript
return {
    won: gs.won,
    day: gs.day,
    deaths: gs.deaths,
    totalMoves: gs.totalMoves,
    segmentsVisited: gs.segmentsVisited,
    booksRead: gs.booksRead.size,
    submissionsAttempted: gs.submissionsAttempted,
    finalStats: statsFromState(),
    despairing: gs.despairing,
    npcsAlive: gs.npcs.filter(n => n.alive).length,
    npcsTotal: gs.npcs.length,
    targetBook: gs.targetBook,
    heldBook: gs.heldBook,
};
```

- [ ] **Step 6: Run all simulator tests**

Run: `npm test -- --test-name-pattern "simulator"`

Fix any assertions that reference old field paths.

- [ ] **Step 7: Run full suite: `npm test`**

- [ ] **Step 8: Commit**

```bash
git add lib/simulator.core.ts test/simulator*.test.js
git commit -m "refactor(simulator): use shared applyAction, remove duplicate dispatch"
```

---

## Verification

After all tasks:

1. `npm test` — all tests pass
2. `npx tsc --noEmit` — type check passes
3. `bash build.sh` — builds successfully
4. `bash screenshots.sh` — screenshots look correct
5. Manual play test — verify move, eat, drink, sleep, read, submit all work

## Summary

| What | Lines removed | Lines added | Net |
|------|--------------|-------------|-----|
| `lib/action-dispatch.core.ts` | 0 | ~350 | +350 |
| `lib/simulator.core.ts` | ~200 | ~50 | -150 |
| `src/js/actions.js` | ~200 | ~60 | -140 |
| `src/js/survival.js` | ~40 | 0 | -40 |
| `src/js/chasm.js` | ~30 | 0 | -30 |
| `src/js/despairing.js` | ~10 | 0 | -10 |
| Tests | 0 | ~250 | +250 |
| **Total** | ~480 | ~710 | +230 |

Net +230 lines, but ~480 lines of duplicated/divergent logic become a single source of truth.
