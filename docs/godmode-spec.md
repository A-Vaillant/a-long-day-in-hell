# Godmode: Library Observation Mode

## Overview

`&godmode=1` URL parameter activates an entirely separate view of the game: a top-down simulation viewer. Instead of first-person exploration, you observe the library as a vertical cross-section of the chasm, watching NPCs live their lives. You can follow any person from their interior perspective — seeing their psychology, relationships, and inner monologue — or fix the camera on a region and watch the population move through it.

The same ECS social physics simulation drives both modes. Godmode is the external view of the same world.

## Entry Point

- URL param: `?godmode=1` (combinable with `?seed=X`)
- Parsed via `URLSearchParams`, coerced to boolean with `=== "1"` — any other value ignored
- Seed param validated same as regular game (string, defaults to random if missing/empty)
- Bypasses Life Story screen, goes straight to godmode view
- No player entity in the simulation — all entities are NPCs
- Time controls: tick manually, or auto-advance at adjustable speed

## Map Visualization

### Layout
- Vertical cross-section of the chasm
- Two columns: west corridor (left) and east corridor (right)
- Floors stacked vertically: floor 0 at bottom, increasing upward
- Chasm gap between the columns (visual only, represents the void)
- Bridge visible at floor 0 connecting the two sides

### Viewport
- Shows a window of N floors x M segments (tunable, ~20 floors x 30 segments default)
- Each cell = one segment on one side at one floor
- Rest areas visually distinct (every 10th segment)
- Camera clamped: floor >= 0 (no negative floors), position >= 0, viewport edges clamped to valid geometry
- Pan beyond populated area allowed (the library is vast) but clamped to non-negative coordinates

### NPC Representation
- Each NPC is a colored dot in their cell
- Color = disposition: calm (white/neutral), anxious (amber), mad (red), catatonic (grey), dead (dark)
- Multiple NPCs in same cell: dots stack/cluster
- Selected NPC has a highlight ring
- Groups shown with a subtle connecting line or shared glow

## Camera Modes

### Follow Mode
- Click an NPC dot → camera follows them
- Viewport centers on selected NPC, scrolls as they move
- Interior panel opens (see below)

### Fixed Mode
- Click empty space or press a key to detach
- Scroll/pan with arrow keys or drag
- Can still click NPCs to see their interior without following

## Interior Panel

When an NPC is selected, a side panel shows:

### Identity
- Name, disposition (with color)
- Days alive, total deaths

### Psychology
- Lucidity: bar + number (0-100)
- Hope: bar + number (0-100)
- Current disposition derived from these

### Personality
- Trait values (openness, agreeableness, resilience, sociability, curiosity)

### Relationships
- List of known NPCs with familiarity/affinity values
- Group members highlighted
- Bond strength visualized (bar or number)

### Inner Monologue
- Generated text reflecting current psychological state
- Changes as psychology shifts
- Uses disposition + personality + context to produce ambient internal narration
- Examples:
  - Calm, high hope: "The kiosk had coffee today. Small things."
  - Anxious, low hope: "I can't remember what day it is. Does it matter?"
  - Mad: "THE SHELVES ARE WRONG. THEY MOVED THEM."
  - Catatonic: "..."

## Time Controls

- **Pause/Play** toggle (spacebar)
- **Step** one tick (period key, like the game's wait)
- **Speed** control: 1x, 2x, 5x, 10x tick rate
- Auto-advance uses `requestAnimationFrame` + delta accumulator, NOT `setInterval` — prevents task queuing on thread hitch, ticks are consumed one-per-frame at most even at high speed
- Accumulator capped at 1 tick worth of delta on tab-refocus — prevents time-dilation burst when browser resumes after background
- Dawn/dusk cycle visible (background dims during lights-out)
- Day counter displayed

## Simulation Behavior

Same systems as the regular game:
- NPC daily random walk
- Psychology decay (lucidity, hope drain over time)
- Relationship formation when co-located
- Group formation from mutual bonds
- Disposition transitions (calm → anxious → mad → catatonic → dead)
- Death and resurrection at dawn
- Lights out at night (map dims, kiosks off)

### Differences from regular game
- No player entity — all NPCs are autonomous
- More NPCs possible (16-32 instead of 16) since there's no player to spawn around
- Simulation can run faster (no waiting for player input)
- All NPCs have full AI movement, not just random walk

## NPC AI (for godmode, extended)

NPCs need more interesting behavior than random walk:
- **Calm**: seek out other NPCs, form groups, visit kiosks, browse books
- **Anxious**: pace (move back and forth in small range), avoid others or cling to group
- **Mad**: erratic movement, large jumps, approach others aggressively
- **Catatonic**: stop moving entirely
- **Group behavior**: grouped NPCs move together, matching the group leader's movement

## Visual Style

- Dark background matching the game's palette
- Minimal — dots, lines, muted colors
- The chasm is a dark void between the two columns
- Rest areas have a subtle glow (kiosk light)
- Night mode: everything dims except NPC dots
- Interior panel uses the same typography as the game

## Implementation Plan

### Files
- `src/js/godmode.js` — entry point, time controls, orchestration (< 150 lines)
- `src/js/godmode-map.js` — canvas map renderer, viewport, camera, dot drawing
- `src/js/godmode-interior.js` — interior panel, monologue generation
- `src/js/godmode-ai.js` — extended NPC AI behaviors for autonomous simulation
- `src/js/godmode-input.js` — keyboard/mouse event handling for godmode
- `src/css/godmode.css` — all godmode-specific styles

### Integration
- `src/js/main.js` checks for `godmode` URL param
- If set, skip normal game init, boot godmode instead
- Godmode creates its own NPC population (no player entity)
- Reuses: ECS world, social physics systems, PRNG, tick system
- Does NOT reuse: screens.js, keybindings.js (godmode has its own)
- ECS systems are player-agnostic (iterate by component, not by tag) — no player entity is safe
- Social.init() can be called without creating a player entity (or just don't call syncPlayerPosition)

### Rendering
- Canvas for the map (performance with many dots + scrolling)
- HTML/DOM for the interior panel (text-heavy, benefits from CSS)
- Split layout: map takes ~65% width, interior panel ~35%
- All UI updates are derived from ECS state read after tick completes — single-threaded JS, no concurrency risk
- Render loop: `onTick()` completes all systems synchronously → `requestAnimationFrame` → read ECS state → draw canvas + update DOM panel
- No background threads, no async tick execution — tick is synchronous, render reads after it finishes

### State Management
- `godmode.js` owns the tick loop and delegates to renderer/panel
- Canvas and DOM panel both read directly from ECS components after tick — safe because JS is single-threaded and tick is synchronous
- No deep cloning needed — reads happen in the same event loop turn after tick completes
- Architectural constraint: tick loop MUST remain synchronous. No promises, no async, no setTimeout in tick path. rAF loop *schedules* ticks, but each tick itself is synchronous run-to-completion. Render reads ECS state only after tick returns — no mid-tick UI updates possible in single-threaded JS.
- Godmode AI writes only to ECS Position components (same as existing random walk) — no new side-effect channels
- Entity death/resurrection: entities are NOT deleted from ECS. Identity.alive is set false, psychology resets at dawn. totalDeaths counter on Identity component persists across deaths.
- Dawn handler is part of the tick (synchronous) — alive flag flip + psychology reset happen atomically within the same tick. UI reads after the entire tick completes, so no half-updated state visible.
- Social physics systems are O(N) per entity for psychology/decay, O(N*G) for relationships where G = number of bonds per entity (bounded, typically < 10). 32 entities is trivially fast.

## Scope for 7DRL

Minimum viable godmode:
1. Map renders with NPC dots, colored by disposition
2. Click to select, panel shows name + psychology + disposition
3. Follow/fixed camera
4. Time controls (play/pause/step/speed)
5. Inner monologue (even if simple template-based)

Stretch:
- Relationship visualization on map (lines between bonded NPCs)
- Group movement AI (leader-follower)
- Richer monologue generation (LLM-assisted or deeper templates)
- Night cycle visual (dim/brighten)

## Monologue Schema

Inner monologue is template-based with structured data:

```js
// Template selection keys
{
  disposition: "calm" | "anxious" | "mad" | "catatonic",
  hope: 0-100,
  lucidity: 0-100,
  groupSize: number,       // 0 = alone
  daysSinceDeath: number,  // Infinity if never died
  totalDeaths: number,
}
```

Templates stored in `content/godmode.json` as arrays keyed by disposition + context bucket. No string interpolation beyond simple `{name}` / `{count}` substitutions — no eval, no dynamic construction.
