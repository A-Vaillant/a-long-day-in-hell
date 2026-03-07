# Game Systems Reference

All systems for *A Long Day in Hell*. Each section covers: what it does, where it lives, what state it touches, and what's missing.

---

## PRNG

**Modules:** `lib/prng.core.js` → `src/js/prng.js` (wrapper: `window.PRNG`)

Deterministic RNG. MurmurHash3 seeding, xoshiro128** generator. Every random decision forks from the global seed with a context key, so the same seed always produces the same world.

**State:** `state.seed` (string, set at init from URL param or random)

**Status:** Complete.

---

## Library Geometry

**Modules:** `lib/library.core.js` → `src/js/library.js` (wrapper: `window.Lib`)

Two parallel corridors (west=0, east=1) separated by a chasm. Each corridor is an infinite sequence of positions, each position is one gallery of 192 books (24 wide × 8 tall). Every 10th position is a rest area (kiosk, bedroom, stairs, submission slot). Bridge crossing only at floor 0 rest areas.

**Constants:** `BOOKS_PER_GALLERY=192`, `GALLERIES_PER_SEGMENT=10`, `SEGMENT_BOOK_COUNT=1920`, `BOTTOM_FLOOR=0`

**Key functions:** `generateSegment()` (5% dim light chance), `availableMoves()`, `applyMove()`, `isRestArea()`, `describeLocation()`

**State:** `state.side`, `state.position`, `state.floor`

**Status:** Complete.

---

## Book Generation

**Modules:** `lib/book.core.js` → `src/js/book.js` (wrapper: `window.Book`)

Each book: 11 pages × 40 lines × 80 chars = 35,200 characters from 95 printable ASCII. Generated deterministically from coordinates + global seed. Most books are random noise.

**Sensibility system:** `scoreSensibility()` uses bigram frequency analysis (0.0–1.0). Books near the target contain coherent fragments (`findCoherentFragment()`). Dwell timer (2s) on pages triggers morale changes based on sensibility — reading nonsense hurts, finding meaning helps.

**Key functions:** `generateBookPage()`, `bookMeta()`, `scoreSensibility()`, `dwellMoraleDelta()`

**State:** `state.openBook`, `state.openPage`, `state.heldBook`, `state.nonsensePagesRead`

**Status:** Complete.

---

## Life Story

**Modules:** `lib/lifestory.core.js` → `src/js/lifestory.js` (wrapper: `window.LifeStory`)

Generates player identity (name, occupation, hometown, cause of death) and target book coordinates from seed. Two placement modes:

- **Gaussian** (default): target near start, σ=50 segments, σ=15 floors. Brute-force searchable.
- **Random** (`?placement=random`): anywhere in the library. Requires reverse-engineering the PRNG.

Target book page 0 is a title page, page 1 is life story prose, pages 2+ are whitespace-padded.

**State:** `state.lifeStory`, `state.targetBook`

**Status:** Complete.

---

## Survival

**Modules:** `lib/survival.core.js` → `src/js/survival.js` (wrapper: `window.Surv`)

Four stats (0–100, up=worse for hunger/thirst/exhaustion, down=worse for morale) plus mortality and despairing flags.

**Per-move depletion:** thirst +0.11, hunger +0.05, exhaustion +0.25, ambient morale drain -0.15 (via Despair module)

**Mortality:** activates when thirst or hunger maxed. Parched: -0.83/tick (~12h to death). Starving: -0.42/tick (~1 day). Both: -1.67/tick (~6h). Resets to 100 when neither condition active.

**Recovery:** Sleep (exhaustion→0, morale +5/hour, hunger/thirst tick up slowly). Eat (hunger -40). Drink (thirst -40). Alcohol (thirst -20, morale +20, can clear despairing).

**Key functions:** `applyMoveTick()`, `applySleep()`, `applyEat()`, `applyDrink()`, `applyAlcohol()`, `applyResurrection()`, `getWarnings()`, `showMortality()`

**State:** `state.hunger`, `state.thirst`, `state.exhaustion`, `state.morale`, `state.mortality`, `state.despairing`, `state.dead`

**Status:** Complete.

---

## Tick / Time

**Modules:** `lib/tick.core.js` → `src/js/tick.js` (wrapper: `window.Tick`)

240 ticks per day (10 ticks/hour, 24 hours). Three boundary events:

| Tick | Time | Event |
|------|------|-------|
| 160 | 10:00 PM | **Lights out** — kiosk closes, reading blocked, corridor goes dark |
| 230 | 5:00 AM | **Reset hour** — forced sleep, open book cleared, library resets books to shelves |
| 0 (wrap) | 6:00 AM | **Dawn** — lights on, resurrection, NPC daily update, nonsense decay |

**Key functions:** `advanceTick()` → returns boundary events list. `tickToTimeString()`, `isLightsOn()`, `isResetHour()`

**Tick.onMove()** orchestrates: advance tick → check boundaries → Surv.onMove() → Events.draw()

**State:** `state.tick`, `state.day`, `state.lightsOn`

**Status:** Complete.

---

## Events (Atmospheric Deck)

**Modules:** `lib/events.core.ts` → `src/js/events.js` (wrapper: `window.Events`)
**Content:** `content/events.json` (20 cards)

Shuffled deck of indices, 20% draw chance per move, Fisher-Yates shuffle, auto-refill. Three card types: `sound`, `atmospheric`, `sighting`. Drawn event applies morale delta and displays text on corridor screen.

**Key functions:** `createDeck()`, `drawEvent()`, `Events.draw()` (wrapper, mutates state)

**State:** `state.eventDeck`, `state.lastEvent`

**Status:** Mechanics complete. Content is 95% placeholder. System is context-blind — see [events-rework.md](events-rework.md) for redesign plan.

---

## NPCs

**Modules:** `lib/npc.core.ts` → `src/js/npc.js` (wrapper: `window.Npc`)
**Content:** `content/npcs.json` (names, dialogue by disposition)

8 NPCs spawned Gaussian around player start. Daily random walk (±5 positions, ±1 floor 30%). Disposition deterioration: calm → anxious → mad → catatonic → dead (probability increases with day count, caps at 0.8).

Displayed on corridor screen when at player location. Click for dialogue (Dark Souls style ambient muttering, not interactive conversation).

**Key functions:** `spawnNPCs()`, `moveNPCs()`, `getNPCsAt()`, `deteriorate()`, `interactText()`

**State:** `state.npcs` (array of NPC objects with id, name, side, position, floor, disposition, daysMet, lastSeenDay, alive)

**Status:** Mechanics complete. Dialogue content is placeholder. No integration with event system. `daysMet`/`lastSeenDay` tracking defined but not fully wired (issue #42).

---

## Despairing

**Modules:** `lib/despairing.core.js` → `src/js/despairing.js` (wrapper: `window.Despair`)

Triggered when morale hits 0. Exit threshold: morale ≥ 15 (hysteresis). Effects:

1. **Ambient drain** — morale -0.15 per move tick (the monotony of hell; always active, not just while despairing)
2. **Sticky recovery** — sleep morale gain × 0.3
3. **Stat corruption** — sidebar shows wrong values (±25 range, 40% chance of word swap)
4. **Reading block** — 70% chance book interaction refused
5. **Chasm seduction** — jump confirmation skipped (auto-confirm)

Alcohol clears despairing (configurable).

**State:** `state.despairing`, `state.morale`

**Status:** Complete.

---

## Invertible PRNG (Puzzle Path)

**Modules:** `lib/invertible.core.js`

The "hard mode" win path. Target book pages are generated via an invertible LCG seeded from packed coordinates XOR'd with a seed-derived key. A player who reads the source code can:

1. Extract 10+ consecutive chars from target book page 0
2. Recover LCG state by enumerating ~45M candidates
3. Decode state back to coordinates (side, position, floor, bookIndex)
4. Walk directly to their book

This is the `?placement=random` endgame — the library is too large to brute-force search.

**Key functions:** `encodeCoords()`, `decodeCoords()`, `generateTargetPage()`, `recoverCoords()`, `lcgPrev()`

**Status:** Complete.

---

## Engine

**Module:** `src/js/engine.js` (wrapper: `window.Engine`, `window.state`)

State management, screen routing, save/load (localStorage), sidebar rendering.

**Screen lifecycle:** `Engine.goto(name)` → `enter()` → death check redirect → `render()` → DOM insert → `afterRender()` → sidebar update → auto-save

**Action dispatch:** `data-goto` attributes for screen transitions, `data-action` for named actions, `data-npc-id` for NPC dialogue clicks.

**Text sampling:** `T(value, contextKey)` — if value is array, deterministically picks one via PRNG fork.

**Init sequence:** check save → parse URL params → generate life story → init Surv/Tick/Events/Npc → route to start screen.

**Status:** Complete.

---

## Screens

**Module:** `src/js/screens.js` (17 registered screens)

| Screen | Purpose | Notes |
|--------|---------|-------|
| Corridor | Main exploration | Lights on/off variants, shelf grid, NPCs, events |
| Shelf Open Book | Read a book | Page navigation, take/swap/put-back, dwell timer |
| Life Story | Opening | Formatted story + hint, press E to continue |
| Kiosk | Rest area vendor | Links to drink/food/alcohol sub-screens |
| Kiosk Get Drink/Food/Alcohol | Consume | Each advances 1 tick + applies stat effect |
| Bedroom | Rest area | Link to sleep |
| Submission Slot | Submit held book | Shows attempt count |
| Submission Attempt | Win check | Silent fail, routes to Win or corridor |
| Win | Victory | Shows seed, stats, coordinates, new game link |
| Death | Death screen | Cause text, resurrection info, forced sleep to dawn |
| Menu | Pause (Escape) | Continue/save/new game |
| Wait | Pass time | 1 tick, minimal |
| Sleep | Sleep until morning | Calls Tick.onSleep() |
| Chasm | Placeholder | Not implemented (see docs/chasm.md) |

**Status:** Core screens complete. Wait/Sleep/Chasm are stubs.

---

## Keybindings

**Module:** `src/js/keybindings.js`

Screen-based dispatch via `addEventListener("keydown")`. Movement: `h/l/k/j` + arrow keys. Bridge: `x`. Wait: `.`. Sleep: `z`. Jump: `J`. Book pages: `h/l`. Close book: `Escape/q`. Life Story continue: `E`. Debug toggle: `` ` ``.

**Status:** Complete.

---

## Debug

**Module:** `src/js/debug.js` (wrapper: `window.Debug`)

Console API for testing and screenshots. Teleport, set stats, jump to time boundaries, trigger conditions. Toggle with backtick key.

**Status:** Complete.

---

## Simulator

**Module:** `lib/simulator.core.js`

Headless game loop with pluggable AI strategies. No DOM. Used for testing game paths. Strategy receives full game state snapshot, returns action. Supports callbacks for tick/day/death/event hooks.

**Action types:** move, wait, sleep, eat, drink, alcohol, read, take, submit.

**Status:** Complete.

---

## Cross-System Flow

```
Keypress → keybindings.js → doMove(dir)
  → Lib.applyMove() → update position
  → Tick.onMove()
    → advanceTick(1) → boundary events (lightsOut/resetHour/dawn)
    → Surv.onMove() → stat depletion + Despair.ambientDrain()
    → Events.draw() → maybe show event text + morale delta
  → Engine.goto("Corridor") → render + sidebar + save
```

**Dawn cascade:** day++ → resurrect dead → Npc.onDawn() (move + deteriorate) → nonsense decay

**Death cascade:** mortality ≤ 0 → state.dead → any Engine.goto() redirects to Death → forced sleep → dawn → resurrection

**Win cascade:** submit held book → coords match targetBook → Engine.goto("Win")
