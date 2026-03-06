# Project Summary: A Short Stay in Hell

Vanilla JS roguelike based on Steven L. Peck's novella. 7DRL jam project (March 4–10, 2026). Single-file build output (`dist/index.html`), no framework dependencies.

## 1. Architecture Overview

The project separates pure logic from DOM-touching code through a two-layer pattern:

**Pure logic layer** (`lib/*.core.{js,ts}`): Stateless functions operating on plain objects. No DOM, no globals. Modules: `prng.core.js`, `library.core.js`, `survival.core.js`, `tick.core.js`, `book.core.js`, `events.core.ts`, `npc.core.ts`, `lifestory.core.js`. TypeScript modules compile to JS before bundling.

**Wrapper layer** (`src/js/*.js`): Thin wrappers that import core functions and bind them to `window.state`. Each wrapper exposes a global object (`Lib`, `Surv`, `Tick`, `Events`, `Npc`, etc.) that reads/writes the shared mutable state object.

**Build pipeline**: `scripts/build-bundle.js` bundles core modules into an IIFE (`src/js/00_prng_core_bundle.js`), then `scripts/build-vanilla.js` merges `content/*.json` into `window.TEXT`, inlines CSS and JS, and produces `dist/index.html`. TypeScript is compiled by `tsc` before bundling.

**Content separation**: All prose, dialogue, NPC names, event text, and screen descriptions live in `content/*.json`. Code contains zero hardcoded strings. Text variants are arrays; the `T()` function selects deterministically via seeded RNG.

**Screen system**: `Engine.register(name, { enter(), render(), afterRender() })` — screens are plain objects. `Engine.goto()` sets `state.screen`, calls `enter()`, renders HTML into `#passage`, then calls `afterRender()` for DOM event binding. Navigation is via `data-goto` attributes on links and a global click handler on `#passage`.

**Input**: Single `keydown` listener in `keybindings.js`. A large if/else chain dispatches on `state.screen`. No abstraction layer, no input mapping table — screen-specific key handling is inlined.

## 2. State Model

`window.state` is a single shared mutable object (`src/js/state.js` exports `const state = {}`). All modules import and mutate it directly.

**Core fields**:
- `seed` (string), `side` (0|1), `position` (int), `floor` (int) — player location
- `screen` (string) — current screen name, doubles as input dispatch key
- `heldBook`, `openBook`, `openPage` — book interaction state
- `hunger`, `thirst`, `exhaustion` (0–100, rising = worse), `morale` (0–100, falling = worse), `mortality` (0–100, falling = dying)
- `despairing` (bool), `dead` (bool), `deathCause` (string|null)
- `tick` (0–239), `day` (int), `lightsOn` (bool)
- `lifeStory` (object), `targetBook` (coordinates)
- `eventDeck` (number[]), `lastEvent` (object|null)
- `npcs` (NPC[]) — array of 8 NPC objects
- `deaths`, `submissionsAttempted`, `won` — progress counters
- `debug`, `_debugAllowed` — debug mode flags
- Various `_` prefixed transient fields (`_menuReturn`, `_lastMove`, `_readBlocked`, `_grabFailed`, `_submissionWon`, `_dwellFired`, `falling`)

**Save/load**: `JSON.stringify(state)` to localStorage. Transient screens are remapped to safe screens before saving. Save migration handles missing fields from older saves.

**Risks**: The state object is entirely untyped. No schema, no validation, no TypeScript interface. Fields are added ad-hoc by various modules. Underscore-prefixed "transient" fields are a convention, not enforced. There is no mechanism to detect stale or invalid state after loading.

## 3. Core Systems

### Library Geometry (COMPLETE)
Two-sided infinite corridor with vertical floors. Position is unbounded integer; floors start at 0. Rest areas every 10 positions (kiosk, bedroom, stairs, submission slot). Bridge crossing only at floor 0 rest areas. 192 books per gallery position. Deterministic segment generation from coordinates.

### PRNG / Book Generation (COMPLETE)
Seeded PRNG with fork-based determinism. Books generated from `seed + coordinates`. Target book placed via Gaussian distribution (default) near starting position, or random placement for puzzle mode. Proximity signal system: books near the target contain life story fragments.

### Survival Stats (COMPLETE)
Hunger, thirst, exhaustion rise per tick. Morale falls under pressure. Mortality activates when thirst or hunger hits 100; drains toward death. Sleep resets exhaustion, requires exhaustion >= 50. Kiosk provides food/drink/alcohol. All stat operations are pure functions in `survival.core.js`.

### Tick / Time System (COMPLETE)
240 ticks per day. Lights out at tick 160 (10 PM). Reset hour at tick 230 (5 AM). Dawn at tick 240 wraps to next day. Boundary events (lightsOut, resetHour, dawn) fire during tick advancement. Sleep advances to dawn.

### Event Deck (COMPLETE)
20 atmospheric events in `content/events.json`. Fisher-Yates shuffled deck of indices. 20% draw chance per move. Auto-refills when exhausted. Events carry optional morale effects (-2 to +1). Three types: sound, atmospheric, sighting.

### NPC System (COMPLETE — but minimal)
8 NPCs spawned Gaussian-distributed around player start. Daily random walk (position +/- 5, occasional floor change). Disposition deterioration: calm -> anxious -> mad -> catatonic -> dead, probabilistic per day (chance = min(0.8, day/100)). Catatonic NPCs stop moving. Dialogue is disposition-keyed random selection from `content/npcs.json` (6 calm, 6 anxious, 6 mad, 4 catatonic, 3 dead lines). NPCs are displayed inline in corridor text. Click NPC name to toggle dialogue bubble.

### Death / Resurrection (COMPLETE)
Death triggers on mortality reaching 0. Resurrection at dawn: physical stats reset, morale preserved, position preserved. Death counter tracked.

### Chasm / Falling (COMPLETE)
Jump into chasm from any floor > 0. Falling system with speed, grab mechanics, altitude-based prose. Despairing players skip confirmation. Grab chance decreases with speed. Failed grabs damage mortality.

### Win Condition (COMPLETE)
Submit held book at submission slot. If book matches target coordinates, win screen displays. Stats summary shown (seed, days, deaths, submissions).

### Despair Mechanics (COMPLETE)
Morale 0 triggers despairing. Despairing blocks reading (probabilistic), skips chasm confirmation, corrupts text display. Deterministic corruption seeded from tick.

### Debug System (COMPLETE)
`?vohu=ScreenName` URL parameter enables debug mode. Backtick toggles debug panel. Debug panel shows all state fields. Direct screen navigation, book opening via URL params.

## 4. Code Quality Observations

**Strengths**:
- Clean separation of pure logic from side effects. Core modules are testable, stateless, and well-documented with JSDoc.
- Content/code separation is thorough. All prose externalized.
- Deterministic PRNG makes the entire game reproducible from a seed.
- Survival math is well-specified with explicit rate documentation.
- Save migration handles schema evolution.

**Concerns**:
- `state` is a typeless bag. No interface, no validation. Any module can write any field. The underscore convention for transient fields is not enforced.
- `screens.js` is a 930-line monolith containing all screen logic, HTML templating (string concatenation), and some game logic (movement, book interaction). No decomposition.
- `keybindings.js` is a 300-line if/else chain. Adding new screens or modifying input requires touching a single fragile function. The `TRANSIENT` screen list is duplicated in three places (keybindings, engine save, engine sidebar).
- HTML is built via string concatenation throughout. No templating, no escaping by default (though an `esc()` helper exists and is used inconsistently — some places use it, some don't).
- `afterRender()` adds event listeners on every render. No cleanup. Rapid re-renders could theoretically stack listeners, though `innerHTML` replacement mitigates this for most cases.
- Mixed use of `var` and `let`/`const` within the same files. Some ES5 patterns (`.indexOf() !== -1` instead of `.includes()`).
- The `Engine.goto()` flow has a subtle re-entrancy guard (`_inGoto`) for death redirect, which suggests the render lifecycle has edge cases.
- `setTimeout(() => Engine.goto(...), 0)` is used in several screens as a redirect mechanism. This is a workaround for the fact that `render()` must return HTML synchronously.

## 5. Test Coverage

406 tests across 18 test files, all passing. Test files in `test/`:

**Well-covered** (pure logic modules):
- `prng.test.js` — PRNG determinism, seeding, forking
- `library.test.js` — geometry, moves, rest areas, segments
- `survival-monotonic.test.js` — stat progression, mortality, resurrection
- `tick.test.js` — time advancement, boundary events, clock strings
- `events.test.js` — deck creation, draw probability, refill
- `npc.test.js` — spawn, movement, deterioration, dialogue
- `book.test.js` — page generation, target book, fragments
- `lifestory.test.js` — story generation, book placement
- `chasm.test.js`, `chasm-sim.test.js` — falling physics, grab mechanics
- `despairing.test.js` — despair conditions, corruption
- `keybindings.test.js` — keyboard dispatch per screen

**DOM tests** (using `dom-harness.js`):
- `dom-book.test.js`, `dom-chasm.test.js`, `dom-corridor.test.js`, `dom-menu.test.js` — screen rendering, interaction

**Simulator**:
- `simulator.test.js` — multi-day simulation runs

**Not tested**:
- `engine.js` — save/load, state migration, init flow, sidebar rendering
- `screens.js` — most screen render logic (only partially covered via DOM tests)
- Content JSON validity (no schema validation tests)
- Edge cases around state persistence (corrupted saves, missing fields beyond the migrated ones)
- Book naming, dwell/fragment highlighting, submission flow

## 6. Social System Pivot (docs/social-system.md)

A planned redesign that shifts the game from solitary book-search to social survival. Key elements:

**Companion system**: Player can invite one NPC to travel together (party size: 2). Acceptance based on disposition and relationship. Companions leave when disposition worsens, relationship exhausts, they die, or by random chance.

**Time acceleration**: Companion activities (walk, search, rest) consume 5–100 ticks but accomplish more and provide morale. Solo play is tick-by-tick grind; companion play covers days/weeks per action. Survival stats auto-managed during companion time skips.

**Morale rework**: Solo morale drain increases. Companion presence buffers drain. Companion loss causes proportional morale hit. Sleep alone barely restores morale. Recovery from despairing requires a companion.

**Knowledge/recipes**: NPCs teach crafting recipes (knife, telescope, bag, flask). Knowledge transfers probabilistically during shared activities. Recipes unlock kiosk orders.

**Combat**: Mad NPC groups (2+ co-located) become hostile. Simple fight/flee/die resolution. Knife required to fight. Killing costs morale, more for known NPCs. Spawn-camping is a designed failure mode.

**Dialogue expansion**: Template system with state interpolation. Relationship lines, knowledge lines, departure lines, exhaustion-driven quality degradation.

**Five implementation phases**: (1) join/leave, (2) time acceleration + morale rework, (3) knowledge transfer, (4) combat, (5) dialogue expansion.

**Endgame**: Finite NPCs, no replacements. Arc goes from social to solitary. Game ends when the player stops playing.

## 7. Structural Risks for the Pivot

**State complexity explosion.** The current state object is already untyped with ad-hoc fields. The social system adds per-NPC relationship tracking (`sharedTicks`, `activitiesDone`, `knowledgeShared`, `departed`, `departed_reason`), companion state, recipe inventory, and NPC-NPC co-location counters. Without a typed state schema, this will compound the existing maintenance problem.

**NPC data model inadequacy.** The current NPC interface (`npc.core.ts`) has 8 fields. The social system requires at minimum 8 additional fields per NPC. The `NPC` interface will need significant expansion, and all existing NPC functions (spawn, move, deteriorate, interact) will need modification.

**Screen system rigidity.** Companion activities (walk, search, rest) need new screens with different interaction patterns (time-skip display, dialogue during activities, interruption handling). The current screen system has no concept of multi-tick activities — everything is synchronous render-then-wait-for-input. Time-skip screens with progressive output will require a different render pattern.

**Keybinding fragility.** The social system adds 6+ new keybindings (T, I, W, S, R, G, L) that are context-dependent (only when NPC present, only when companion active). The current keybinding system is a flat if/else chain with no composability. Adding contextual bindings will further bloat it.

**Morale rework is breaking.** The current morale system is tuned: sleep restores +5/hour, events drain -1 to -2, stats drain -1 to -4. The pivot changes the fundamental morale economy (solo drain, companion buffer, loss penalty). All existing balance is invalidated. Survival tests will need rewriting.

**Time scale discontinuity.** Current gameplay operates at tick granularity (minutes). Companion activities skip 5–100 ticks (hours to days). The event deck, NPC movement, and deterioration systems are all designed around per-tick or per-day resolution. Bulk-advancing time through these systems without breaking invariants (event deck depletion, NPC death during skip, lights-out during walk) requires careful orchestration that doesn't exist yet.

**Save compatibility.** Any save from the current version will lack social system fields. The existing migration code handles individual missing fields; a systemic schema change (new NPC fields, companion state, recipes) will need a more robust migration strategy.

**Content volume.** The dialogue expansion (relationship lines, knowledge lines, departure lines, activity-specific lines, template system) is a major content authoring effort. The current NPC dialogue is 25 lines total. The social system implies hundreds of contextual lines, plus a template engine that doesn't exist.

**Scope vs. timeline.** This is a 7DRL jam project. The social system as designed is 5 phases of significant work. Even Phase 1 (companion join/leave with basic dialogue) touches engine, screens, keybindings, NPC core, state, and content — nearly every file in the project.

**Testing gap.** The wrapper layer and screen rendering are undertested. The social system's most complex behaviors (companion activity flow, time-skip survival management, departure triggers) will live in this undertested layer unless the architecture is restructured to push more logic into testable pure functions.
