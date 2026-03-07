# Death & Resurrection — *A Long Day in Hell*

## Source Canon

> *"…that strange hour before dawn when sleep can't be helped and all things are repaired and made right and new in Hell."*

Key rules from the text:
- Death is never permanent. You always come back.
- Resurrection happens at dawn (6:00am), not immediately.
- You respawn at the exact location where you died.
- Your body is fully restored — all damage repaired.
- Held books persist through death (possession = physical contact at lights-out; death counts).

---

## Causes of Death

### 1. Mortality Depletion (starvation/dehydration)
- `state.mortality` drains toward 0 when Parched (thirst ≥ 100) or Starving (hunger ≥ 100).
- Mortality reaching 0 sets `state.dead = true`.
- Already implemented in `lib/survival.core.js → applyMortality()`.
- This happens during normal tick processing — no special trigger needed.

### 2. External kill via `Surv.kill(cause)` (NPC violence, events, etc.)

### 3. Chasm jump is NOT a death — it's a separate traversal mechanic (own feature)

---

## Death Screen

When `state.dead` becomes true, transition to the `"Death"` screen.

### Entry (`enter`)
- Calls `Tick.onForcedSleep()` to advance time to dawn, triggering resurrection.

### Render
- Show cause of death (looks up `TEXT.screens["death_" + cause]`).
- Show day count and total deaths.
- Continue link to Corridor.

### Behavior While Dead
- **All input blocked** except debug toggle (`` ` ``).
- Time auto-advances to dawn via `onForcedSleep()`.

---

## `Surv.kill(cause)`

General-purpose kill API. Any game system can call it:

```js
Surv.kill("murder");    // NPC kills you
Surv.kill("event");     // environmental death
Surv.kill("mortality"); // starvation/dehydration (auto-detected)
```

Sets `state.dead = true`, increments `state.deaths`, records `state.deathCause`.

---

## Death Detection

Centralized in `Engine.goto()`. After any screen's `enter()` runs, if `state.dead` is true, Engine redirects to the Death screen automatically. No per-screen death checks needed. Re-entrance guard (`_inGoto`) prevents infinite loops.

If `state.dead` was set by `applyMortality` (no cause recorded yet), `Surv.kill("mortality")` is called to fill in the counter and cause.

---

## Resurrection

Handled in `Tick.advance()` — when dawn fires and `state.dead` is true, calls `Surv.onResurrection()`.

Resets: hunger, thirst, exhaustion, morale, mortality, despairing, dead, deathCause.
Preserves: location, heldBook, seed, lifeStory, targetBook, day, npcs, deaths counter.

---

## Death Counter

`state.deaths` (integer, starts at 0). Displayed on death screen, win screen, and debug panel.

---

## text.json Keys

```json
{
  "screens": {
    "death_mortality": "DEATH_MORTALITY_PLACEHOLDER",
    "resurrection": "RESURRECTION_PLACEHOLDER"
  }
}
```

New causes just need a `"death_<cause>"` key added.

---

## Open Questions

- Should the death screen show a black/blank screen for a beat before showing text?
- Should death count affect anything mechanically, or is it purely narrative?
- NPC reactions to player death/resurrection — out of scope for now.
