# Unified action dispatch

## Problem

The simulator (`lib/simulator.core.ts`) and browser (`src/js/actions.js`) each implement their own action dispatch. They call the same pure core functions but wire them differently, leading to:

- **Drift bugs**: read-book morale penalty only exists in the simulator. Movement exhaustion modifiers only exist in the browser. Submission tick cost is applied in one, deferred in the other.
- **Maintenance tax**: every new mechanic must be implemented twice, tested twice, kept in sync.
- **False video output**: the simulator drives the playthrough video generator. Behavioral divergence from the real game means the video shows incorrect gameplay.

## Design

### Core idea

A single `applyAction(state, action, ctx)` function in `lib/action-dispatch.core.ts` that mutates a `GameState` object in place. Both the simulator and the browser call this function. The browser wraps it with screen-transition logic and boundary event dispatch. The simulator wraps it with its strategy loop.

### GameState interface

A mutable interface satisfied by both `window.state` (browser) and `InternalState` (simulator). Uses flat fields matching the browser's `window.state` layout. The simulator's `InternalState` must be flattened to match (currently nests survival stats under `gs.stats`).

Survival core functions (`applyEat`, `applySleep`, etc.) take and return `SurvivalStats` objects. Inside `applyAction`, these are extracted from flat `GameState` fields, passed to the core function, then spread back — the same pattern the browser's `Surv` wrapper already uses. This is honest adapter work, not zero-cost, but it's mechanical and contained in one place.

```typescript
interface GameState {
    // Position
    side: number;
    position: bigint;
    floor: bigint;

    // Time
    tick: number;
    day: number;
    lightsOn: boolean;

    // Survival (flat, matching window.state layout)
    hunger: number;
    thirst: number;
    exhaustion: number;
    morale: number;
    mortality: number;
    despairing: boolean;
    dead: boolean;

    // Book state
    heldBook: BookCoords | null;
    openBook: BookCoords | null;
    openPage: number;
    dwellHistory: Record<string, boolean>;

    // Target
    targetBook: BookCoords;

    // Counters
    submissionsAttempted: number;
    nonsensePagesRead: number;
    totalMoves: number;
    deaths: number;
    deathCause: string | null;

    // Mercy kiosk
    _mercyKiosks: Record<string, boolean>;
    _mercyKioskDone: boolean;
    _mercyArrival: string | null;
    _despairDays: number;

    // Chasm
    falling: FallingState | null;

    // Events
    eventDeck: number[];
    lastEvent: EventCard | null;

    // Flags
    won: boolean;
    _readBlocked: boolean;
    _submissionWon: boolean;
    _lastMove: string | null;

    // NPCs (optional — simulator may not have full NPC state)
    npcs?: NPC[];
}
```

### ActionContext

Actions that need external resources (RNG, ECS world, game seed) receive them through a context object:

```typescript
interface ActionContext {
    /** Game seed (for event draw RNG, grab RNG, etc). */
    seed: string;
    /** ECS world, if available. Required for social actions. */
    world?: World;
    /** Entity lookup for social actions. */
    resolveEntity?: (npcId: number) => Entity | undefined;
    /** Player entity for social actions. */
    playerEntity?: Entity;
    /** Event cards for event deck draws. Empty array disables events. */
    eventCards: EventCard[];
    /** Quickness grab bonus (from ECS Stats component). 0 when ECS unavailable. */
    quicknessBonus?: number;
}
```

**RNG strategy**: no persistent RNG on the context. Each mechanic that needs randomness derives its own from `seedFromString(ctx.seed + ":" + purpose + ":" + state fields)`. This matches the simulator's approach and guarantees determinism regardless of call order. Specific seeds:
- Event draw: `ctx.seed + ":ev:" + state.totalMoves`
- Grab attempt: `ctx.seed + ":grab:" + state.floor + ":" + state.tick`
- Reading block: `ctx.seed + ":read:" + state.totalMoves + ":" + bookIndex`

Social actions check for `ctx.world` and return `{ resolved: false }` if absent.

### Action types

Extend the existing `Action` union in `lib/action.core.ts` rather than defining a second one. Add missing player action types alongside the existing NPC action types:

```typescript
// Added to existing Action union in lib/action.core.ts:
| { type: "move"; dir: Direction }
| { type: "wait" }
| { type: "sleep"; inBedroom: boolean }
| { type: "eat" }
| { type: "drink" }
| { type: "alcohol" }
| { type: "read_book"; bookIndex: number }
| { type: "take_book"; bookIndex: number }
| { type: "drop_book" }
| { type: "submit" }
| { type: "chasm_jump" }
| { type: "grab_railing" }
| { type: "throw_book" }
| { type: "fall_wait" }
| { type: "talk"; npcId: number; approach: Approach }
| { type: "spend_time"; npcId: number }
| { type: "recruit"; npcId: number }
| { type: "dismiss"; npcId: number }
```

Note: the simulator currently uses `"read"` and `"take"` for its strategy actions. These must be migrated to `"read_book"` and `"take_book"` to match the canonical types. All built-in strategies in `simulator.core.ts` will need updating.

Sleep carries `inBedroom` on the action itself (replaces the browser's `_lastScreen === "Bedroom"` check). The browser sets this based on screen context. The simulator sets it based on `isRestArea()`.

### Return value

```typescript
interface DispatchResult {
    /** Whether the action was accepted and executed. */
    resolved: boolean;
    /** Screen to transition to (browser reads this; simulator ignores it). */
    screen?: string;
    /** Tick events that fired during this action (dawn, lightsOut, resetHour). */
    tickEvents: string[];
    /** Ticks consumed by this action. */
    ticksConsumed: number;
    /** Action-specific data (grab result, talk result, etc). */
    data?: any;
}
```

Named `DispatchResult` to avoid collision with the existing `ActionResult` type in `lib/actions.core.ts` (the ECS NPC action system).

### Time advancement

Single-tick actions (move, wait, eat, drink, alcohol, read, submit, fall_wait) advance time by 1 tick internally using `advanceTick()` from `lib/tick.core.ts`. The function detects boundary crossings (dawn, lightsOut, resetHour) and returns them in `tickEvents`.

`applyAction` does NOT fire boundary handlers or run social physics. It only advances the tick counter, updates `lightsOn`, and reports what boundaries were crossed. The caller is responsible for side effects.

### Sleep: caller-managed loop

Sleep is the exception to "applyAction handles everything." A sleep action applies **one hour** of sleep and returns `ticksConsumed: TICKS_PER_HOUR`. The caller loops:

```
// Browser (simplified):
while (!isResetHour(state.tick) && !state.dead) {
    const r = applyAction(state, { type: "sleep", inBedroom }, ctx);
    for (const ev of r.tickEvents) Engine._boundary.fire(ev);
    Social.onTick(TICKS_PER_HOUR);
}

// Simulator (simplified):
while (!isResetHour(gs.tick) && !gs.dead) {
    const r = applyAction(gs, { type: "sleep", inBedroom }, ctx);
    for (const ev of r.tickEvents) handleSimEvent(ev);
}
```

This preserves the browser's per-hour interleaving of social physics and boundary events. The core function handles the survival recovery math for one hour; the caller handles the loop, boundary dispatch, and social physics.

### Boundary events and forced sleep

`applyAction` returns boundary events but does not act on them. The browser's existing `resetHour` handler (which triggers forced sleep via `Tick.onForcedSleep()`) continues to work unchanged — when the browser sees `resetHour` in `tickEvents`, it fires the boundary handler, which enters the forced-sleep loop calling `applyAction({ type: "sleep" })` iteratively until dawn. No re-entrancy problem because `applyAction` itself never fires handlers.

### What moves into `applyAction`

| Mechanic | Source functions | Notes |
|----------|-----------------|-------|
| Movement validation | `availableMovesMask()`, `moveAllowed()` | |
| Position update | `applyMoveInPlace()` | |
| Exhaustion (up/down) | Direct mutation | Currently browser-only, becomes universal |
| Auto-drink | `applyDrink()` at rest areas | |
| Mercy kiosk | `mercyKiosk()`, `applyMercyKiosk()` | Also resets `_despairDays` |
| Event draw | `drawEvent()` | RNG from `seed + ":ev:" + totalMoves` |
| Survival depletion | `applyMoveTick()` | Extract stats, call, spread back |
| Ambient morale drain | `applyAmbientDrain()` | |
| Despairing check | `shouldClearDespairing()` | After alcohol, sleep |
| Death check | Mortality/starvation/dehydration diagnosis | |
| Sleep (one hour) | `applySleep()`, `applySleepWithDespairing()` | Caller loops |
| Eat/drink/alcohol | `applyEat()`, `applyDrink()`, `applyAlcohol()` | |
| Read book | `isReadingBlocked()`, `applyReadNonsense()` | Fixes browser bug |
| Take/drop book | Direct state mutation | |
| Submit | Coordinate comparison, win check | |
| Chasm jump | `defaultFallingState()` | |
| Grab railing | `attemptGrab()`, mortality damage | Uses `ctx.quicknessBonus` |
| Fall wait | `fallTick()`, death on landing | |
| Throw book | Clear `heldBook` | |
| Talk/spend time/recruit/dismiss | `talkTo()`, `spendTime()`, etc. via `ctx.world` | Returns `{ resolved: false }` without world |

### What stays in the browser

- Screen transitions (`Engine.goto(result.screen)`)
- Boundary handler dispatch (`Engine._boundary.fire()` for dawn, lightsOut, resetHour)
- Forced sleep loop (resetHour handler calls sleep action iteratively)
- ECS social physics ticking (`Social.onTick()`) — per-action and per-sleep-hour
- NPC position sync after social actions (`Social.syncNpcPositions()`)
- Pass-out flag (`_passedOut`) — set by resetHour handler, read by post-dispatch guard
- DOM rendering effects

### What stays in the simulator

- Strategy loop (decide → applyAction → handle events → repeat)
- Dawn callbacks (resurrection, NPC cycle, dawn reset) — triggered by `tickEvents`
- Sleep loop (same pattern as browser, without social physics)
- Tick/day caps, safety limits

### Migration path

1. Flatten simulator's `InternalState` — replace `gs.stats.hunger` with `gs.hunger` etc. Update all internal references. This is mechanical but touches many lines.
2. Extend `lib/action.core.ts` with player action types. Migrate simulator strategy types from `"read"`/`"take"` to `"read_book"`/`"take_book"`.
3. Create `lib/action-dispatch.core.ts` with `GameState`, `ActionContext`, `DispatchResult`, and `applyAction`. Port mechanics one action type at a time, with tests for each.
4. Rewrite `src/js/actions.js` to call `applyAction`, handle screen transitions and boundary events.
5. Rewrite `simulator.core.ts` to call `applyAction` instead of its own switch. Flatten sleep into a caller-managed loop.
6. Delete dead code from browser wrappers (`Surv.onMove`, `Surv.onEat`, `Surv.onDrink`, `Surv.onAlcohol`, `Surv.onSleep`, `Despair.applyAmbientDrain`, `Despair.checkExit`, `Chasm.jump`, `Chasm.grab`, `Chasm.throwBook`).
7. `Surv` and `Despair` wrappers shrink to display-only helpers (severity labels, warnings, descriptors).

### What does NOT change

- `lib/survival.core.ts` — pure functions, called from new location
- `lib/tick.core.ts` — unchanged
- `lib/chasm.core.ts` — unchanged
- `lib/events.core.ts` — unchanged
- `lib/despairing.core.ts` — unchanged
- `lib/interaction.core.ts` — unchanged
- `src/js/screens.js` — unchanged (calls `Actions.resolve()` which still returns compatible shape)
- `src/js/keybindings.js` — unchanged
- ECS social physics — unchanged (runs on `Tick.advance`, not action dispatch)

### Testing

- Existing simulator tests (`test/simulator*.test.js`) validate that the refactored simulator produces identical results. Any behavioral change (e.g., read-book now applies morale penalty) is a deliberate fix, documented in test updates.
- New unit tests for `action-dispatch.core.ts` test each action type in isolation with a minimal `GameState`.
- The browser is validated by existing screenshot tests and manual play.
- Specific regression tests:
  - Read-book morale penalty now applies in both paths
  - Movement exhaustion (up/down) now applies in both paths
  - Mercy kiosk clears despairDays in both paths
