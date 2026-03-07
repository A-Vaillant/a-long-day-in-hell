# Tick System Spec — *A Long Day in Hell*

## Source Canon

The library has lights. They are binary: on or off. From the text:

> *"Suddenly, no more than a few minutes after I had arrived, the lights went out, and in the dark I wept until I slept."*

> *"At six a.m. — the lights came on as quickly as they had gone out the night before."*

> *"At about 9:50 p.m., I went into the bedroom…"*

Lights on: 6:00am–10:00pm (16 hours). Lights off: 10:00pm–6:00am (8 hours).

Resurrection is dawn-gated, not sleep-gated:

> *"…that strange hour before dawn when sleep can't be helped and all things are repaired and made right and new in Hell."*

No one can stay awake through it. The game enforces this.

---

## Time Model

**Turn-based.** One tick = one player action (move, wait, eat, drink, read page, etc.).

### Constants

| Constant | Value | Notes |
|---|---|---|
| `TICKS_PER_HOUR` | 10 | Tunable |
| `HOURS_PER_DAY` | 24 | — |
| `TICKS_PER_DAY` | 240 | `TICKS_PER_HOUR × HOURS_PER_DAY` |
| `DAY_START_HOUR` | 6 | 6:00am |
| `LIGHTS_OFF_HOUR` | 22 | 10:00pm |
| `LIGHTS_ON_HOUR` | 6 | 6:00am (= dawn) |
| `LIGHTS_ON_TICKS` | 160 | Ticks from dawn to lights-out |

Tick 0 of each day = 6:00am. Tick 160 = 10:00pm. Tick 240 = 6:00am next day (wraps to 0).

### SugarCube State Variables

| Variable | Type | Initial | Description |
|---|---|---|---|
| `$tick` | integer | 0 | Ticks elapsed since 6am this day (0–239) |
| `$day` | integer | 1 | Current day number (shown on wall clock) |
| `$lightsOn` | boolean | true | Derived: `$tick < 160` |
| `$dead` | boolean | false | Set true on death; cleared at dawn |

`$lightsOn` is recomputed after every tick advance; it is never set directly.

---

## Tick Advancement

Every player action calls `advanceTick(n)` where n is the cost of that action:

| Action | Tick Cost |
|---|---|
| Move (walk one segment) | 1 |
| Wait | 1 |
| Eat | 1 |
| Drink | 1 |
| Read one page | 1 |
| Sleep (per hour slept) | 10 |

`advanceTick(n)` increments `$tick` by n, then checks for boundary crossings in order. If a single action crosses multiple boundaries (unlikely but possible with large n), each boundary fires once in sequence.

### Boundary Events

**Lights-out (tick crosses 160):**
- Set `$lightsOn = false`
- Display narrative message: *"The lights go out."*
- Kiosk becomes unavailable
- Player is forced to the bedroom passage (see Forced Sleep below)

**Dawn (tick crosses 240 → wraps to 0):**
- Increment `$day`
- Set `$lightsOn = true`
- If `$dead`: resurrect (see Resurrection below)
- Display clock message: *"Year 0000000, Day N — 6:00 AM"*
- Kiosk becomes available

---

## Forced Sleep

At lights-out, the player cannot continue exploring. The game transitions to a sleep passage automatically:

> *"The lights go out. You find a bed."*

Time then skips to dawn: tick advances from 160 to 240, triggering the dawn event. The skip calls `applyMove`-equivalent for each hour of darkness (8 calls of `applySleep`), representing time passing. This is **Option A** — no dark stumbling.

Rationale: the jam scope does not support a meaningful dark-exploration mechanic, and the text implies unconsciousness before dawn is involuntary anyway.

---

## Sleep (Manual, Before Lights-Out)

The player can sleep voluntarily at any bedroom during the lights-on period. Sleep advances time in increments of `TICKS_PER_HOUR` until one of:
- Exhaustion reaches 100 (fully rested), or
- Lights-out tick (160) is reached, at which case forced sleep takes over

Each sleep-hour calls `applySleep(stats)` (existing function) and advances tick by `TICKS_PER_HOUR`.

The player **cannot** set an alarm or choose how long to sleep — they wake when rested or at lights-out, whichever comes first.

---

## Resurrection

Death sets `$dead = true` and renders the player unable to act (passage blocks all actions). At dawn, the dawn event checks `$dead` and if true:

- Restore all survival stats to starting values (`hunger: 80, thirst: 80, exhaustion: 90, morale: 100`)
- Clear `$despairing`
- Clear `$dead`
- Display: *"You wake. Another day begins."*
- Player resumes from their current location (no relocation)

`$heldBook` is **not** cleared on death — the text establishes possession survives if you're touching the book at lights-out, and resurrection counts.

---

## Book Reset at Dawn

Per canon: books not held by the player return to their shelf positions at dawn. In practice this is a no-op in code — books are procedurally generated from coordinates, so they are always "on their shelf." Only `$heldBook` represents a taken book. It persists through dawn.

---

## Survival Stat Retuning

At 10 ticks/hour and -2 thirst/tick, the player would go from 80→0 thirst in 40 ticks (~4 hours). That is too punishing for a jam game. Proposed retuning:

| Stat | Current rate (per tick) | Proposed rate (per tick) | Depletes in |
|---|---|---|---|
| Thirst | -2 | -0.11 | ~3 days (720 ticks from 80→0) |
| Hunger | -0.5 | -0.05 | ~6.7 days |
| Exhaustion | -1 | -0.25 | ~1.3 days (intentionally aggressive — enforces sleep rhythm) |

Thirst rate targets 3-day survival without drinking (80 ÷ 720 ticks ≈ 0.111, rounded to 0.11). Exhaustion stays punishing because the daily sleep cycle is a core mechanic, not an obstacle to route around.

### Mortality

A **Mortality** bar (0–100) activates when either Hunger or Thirst reaches 0. Drain rate depends on active conditions:

| Active conditions | Drain rate | Time to death from full |
|---|---|---|
| Parched only | -0.83/tick | ~0.5 days (120 ticks) |
| Starving only | -0.42/tick | ~1 day (240 ticks) |
| Both | -1.67/tick | ~0.25 days (60 ticks) |

Both-active drain is not the sum of the two — it's a separate, faster rate. This represents compounding physiological failure.

Mortality hitting 0 sets `$dead = true`.

When the player eats enough to clear Starving AND drinks enough to clear Parched, Mortality resets to 100 and the bar disappears. Clearing only one condition does not reset — drain continues at the single-condition rate.

| Condition | Trigger | UI |
|---|---|---|
| Parched | thirst = 0 | "PARCHED" status + mortality bar |
| Starving | hunger = 0 | "STARVING" status + mortality bar |
| Low thirst | thirst ≤ 20 | warning colour on thirst meter |
| Low hunger | hunger ≤ 20 | warning colour on hunger meter |

Morale penalties for zeroed stats remain but are now secondary — the mortality bar is the primary death pressure. The `despairing` condition (morale = 0) is independent and can coexist with mortality.

These are starting values — expect tuning after playtest.

---

## UI

### Wall Clock (Rest Areas)

Every rest area shows the clock. Display format mirrors the text:

```
Year 0000000, Day 7
10:40 PM
```

Implemented as a macro in the rest area passage template, reading `$day` and `tickToTimeString($tick)`.

### Sidebar

Add a compact time display to `StoryCaption`:

```
Day 7  10:40 PM  ●  (lights-on indicator dot, goes dark at lights-out)
```

### Lights-Out Indicator

When `$lightsOn === false`, the corridor passage description changes tone. Suggested: italicize or dim the passage text, add a line like *"The library is dark."* No separate night passage needed.

---

## Pure Logic Module: `lib/tick.core.js`

```
defaultTickState()          → { tick: 0, day: 1 }
advanceTick(state, n)       → { state, events: ['lightsOut'|'dawn'] }
isLightsOn(tick)            → boolean
tickToTimeString(tick)      → "6:00 AM" | "10:40 PM" etc.
tickToHour(tick)            → float hour in [6, 30) (30 = 6am next day)
hoursUntilDawn(tick)        → number of hours remaining until tick 240
```

No SugarCube dependencies. Exported as ES module for unit tests.

---

## SugarCube Wrapper: `src/js/tick.js`

```
setup.Tick.init()                  → initialises $tick, $day, $lightsOn, $dead
setup.Tick.advance(n)              → calls advanceTick, fires events, updates SC vars
setup.Tick.getTimeString()         → formatted string for UI
setup.Tick.getDayDisplay()         → "Day N" string
setup.Tick.hoursUntilDawn()        → number, for sleep mechanic
```

---

## Integration Points

All of these call `setup.Tick.advance(n)` and then `setup.Survival.onMove()` (or appropriate variant):

- `src/story/corridor.twee` — move left/right/up/down/cross
- `src/story/corridor.twee` — wait action
- `src/story/shelves.twee` — read page
- `src/story/restareas.twee` — eat, drink, sleep
- `src/story/ui.twee` — StoryCaption reads `$tick`, `$day`, `$lightsOn`

Lights-out transition: when `advanceTick` returns `events` containing `"lightsOut"`, the passage redirects to a sleep interstitial before returning to corridor.

---

## Open Questions

- `despairing` (morale = 0) is non-lethal. It imposes mechanical penalties (TBD) but does not kill.
