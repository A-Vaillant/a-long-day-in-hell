# Epoch Simulation: Scaling Time in the Library

The library is eternal. The walk to your book takes thousands of years. Per-tick simulation doesn't scale — we need multiple fidelity tiers that compose correctly.

## The Problem

At 16 ticks/day, simulating one year = 5,840 ticks. A century = 584,000. The player's journey is 666k–44B segments at 1 segment/tick. Even at the minimum distance, that's ~114 years of walking, ~665,000 ticks. With 16+ NPCs each running intent/movement/psychology/relationships/needs per tick, this is computationally infeasible and narratively pointless — nobody wants to watch 665,000 identical corridor moves.

But the *outcomes* matter. Who went mad? Who found their book? Who formed a group that lasted decades? The player needs to arrive at their book having *lived* through the journey, not having skipped it.

## Three Tiers

### Tier 1: Batch Ticks (1x–100x speed)

**Status: Partially implemented, disabled (`BATCH_MODE = false` in godmode.js)**

Each system has an `n > 1` path that computes `state_after = f(state_before, n)` analytically where possible:

- **Needs** (`needs.core.ts`): `hunger += rate * n`, with periodic relief (rest areas are ubiquitous)
- **Movement** (`movement.core.ts`): `position += direction * n`, with batch pathfinding for pilgrimage/explore
- **Psychology** (`psych.core.ts`): decay curves applied over n ticks
- **Memory** (`memory.core.ts`): analytical decay for n ticks

**What works:** Independent systems compose fine in batch. Needs, movement, and psychology don't interact at the per-tick level in ways that change outcomes.

**What breaks:** Systems that interact causally:
- "NPC gets hungry → seeks kiosk → eats → morale bump" is a causal chain
- "Two NPCs meet at same position → relationship forms → group forms → movement changes" requires co-location detection
- Intent transitions (explore → socialize → pilgrimage) depend on accumulated state thresholds

**Fix:** Accept that batch ticks are *approximate* for interacting systems. Over 100 ticks, the statistical outcome of eat/drink cycles is deterministic (everyone near a rest area eats). Encounters can be sampled at batch boundaries rather than per-tick.

**Action items:**
1. Fix the bugs that caused `BATCH_MODE` to be disabled
2. Run batch ticks alongside per-tick for the same seeds, validate outcome distributions match
3. Re-enable for godmode speeds > ~50x

### Tier 1.5: Entity Coroutines (10x–1,000x)

**Status: Design phase.**

The fundamental problem with Tier 1 is that it treats systems as independent across all NPCs. But systems are independent *within* a single NPC — a solo Pilgrim's eat/sleep/walk cycle is self-contained. What's expensive is NPC-NPC interaction.

Invert the decomposition: instead of running each *system* across all NPCs, run each *entity* through all its systems independently.

#### Entity = NPC or Group

A social group is an entity for simulation purposes. It has:
- A position and movement strategy (leader-driven)
- Collective needs (group stops when any member needs rest)
- Internal state (cohesion, tension, relationships between members)
- Internal systems (social pressure, dismiss checks, psychology decay)

This collapses the simulation. Instead of 16 NPCs × 12 systems with cross-NPC queries, you have ~6-8 entities running self-contained coroutines, with interaction only at spatial intersections.

#### Architecture

```
for each tick (or batch of ticks):
  1. advance each entity independently (coroutine)
     - solo NPC: needs → intent → movement → psychology (internally coherent)
     - group: collective needs → leader intent → group movement → per-member psychology
     - fast: no cross-entity queries, embarrassingly parallel
  2. spatial intersection check (hash on side:floor:segment)
     - only fires when two entities occupy the same segment
     - rare at cosmological distances
  3. run interaction systems for intersecting entities only
     - relationship accumulation, group formation/absorption, witness events
     - full fidelity — it's rare enough to afford it
```

#### Entity Lifecycle

```
solo NPC + solo NPC → intersection → relationship builds → group forms
  → group entity absorbs both NPCs as members
  → group runs as single coroutine
  → internal tension accumulates
  → group dissolves → emits solo NPCs back
```

Formation and dissolution are intersection events. Everything between is internal to the group coroutine.

#### Why This Matters

- **Restrained NPCs**: A captured NPC's strategy changes — "can't move → can't reach rest area → needs accumulate → death." Internal to the coroutine, no batch approximation.
- **Causal chains work**: "hungry → seek kiosk → eat → morale bump" runs inside the coroutine in correct causal order.
- **Groups are first-class**: Soren's Direites move as a unit, not 4 NPCs in lockstep. The simulation reflects this.
- **Scales to Tier 3**: Groups are already aggregates. Population-level is "how many groups of what type in this region."
- **Validates against Tier 1**: Run both models on same seed, compare NPC end-states.

#### Batch Acceleration

Within each coroutine, many ticks are trivial (walk, accumulate needs, decay psychology). The coroutine can fast-forward through uneventful stretches:

```
while (no threshold crossed in next K ticks):
    position += heading * K
    needs += rates * K
    psychology = decay(psychology, K)
```

The coroutine knows its own thresholds — it can compute exactly when the next internal event fires (eat threshold, sleep threshold, psychology transition) and jump to it. This is per-entity DES without the global event queue.

### Tier 2: Discrete Event Simulation (100x–10,000x)

**Status: Not implemented. This is the key new system.**

Instead of advancing every tick and checking "did anything happen?", we invert the question: "when does the next interesting thing happen?" and jump directly to it.

This is the **Gillespie algorithm** / **next-event simulation** — standard in operations research, epidemiology, chemical kinetics. The formal model:

#### Event Model

Each NPC has a set of possible **events** with **rates** (expected occurrences per unit time). Events are drawn from exponential distributions: `time_to_next = -ln(random()) / rate`.

Core events per NPC:

| Event | Rate basis | Effect |
|---|---|---|
| `eat` | hunger accumulation rate / eat threshold | Reset hunger, spend time at kiosk |
| `sleep` | exhaustion rate / sleep threshold | Reset exhaustion, advance to dawn |
| `encounter` | f(local NPC density, movement speed) | Relationship update, possible group formation |
| `group_join` | f(familiarity, affinity, co-location time) | Join/form group |
| `group_dissolve` | f(group tension, member count, time) | Group breaks apart |
| `intent_change` | f(current behavior duration, psychology) | Switch behavior (explore→search→pilgrimage) |
| `psych_threshold` | f(lucidity/hope decay curves) | Cross into anxious/despairing/mad |
| `find_words` | f(books examined per unit time, proximity to target) | Morale event — found legible text |
| `death` | f(needs neglect, chasm proximity, combat) | Die, queue resurrection at dawn |
| `book_found` | f(search rate, remaining search space) | Win condition — astronomically rare for NPCs |

#### The Loop

```
1. For each NPC, compute rate of each possible event given current state
2. Draw next_time = -ln(rand()) / total_rate for each NPC
3. Pick the globally earliest event
4. Advance clock to that time
5. Apply analytical updates for elapsed time (Tier 1 batch math)
6. Execute the event, update state
7. Recompute affected rates
8. Repeat
```

Over a simulated year with 16 NPCs, this might produce 1,000–5,000 events total instead of 93,000+ ticks. Each event is meaningful and narratable.

#### Rate Derivation

Rates come from inverting the per-tick probabilities already in the codebase:

- Tick-level: "20% chance of event draw per move" → rate = 0.2 events/tick × ticks/day = ~3.2 events/day
- Psychology: "lucidity decays by 0.01/tick when alone" → time to threshold = (current - threshold) / 0.01 ticks
- Encounter: "two NPCs within 3 segments" → rate depends on movement model and NPC density in the region

The crucial property: **DES outcomes should statistically match batch-tick outcomes** when run over the same time period with the same initial conditions. This is how you validate the rates.

#### Composability with Real-Time

When the player returns to real-time (possession, pilgrimage first-person), the DES state must be convertible back to a valid per-tick state. This means:
- All ECS components remain canonical (positions, psychology, relationships, needs)
- DES doesn't introduce state that per-tick can't handle
- Transition is: freeze DES → snapshot state → resume per-tick from snapshot

### Tier 3: Population-Level / Mean-Field (10,000x+, decades–centuries)

**Status: Future. Depends on Tier 2 being solid.**

When simulating centuries, even DES becomes expensive if the NPC population grows. The insight: most NPCs are doing statistically similar things. Instead of tracking individuals, model *population distributions*.

#### Markov Chain Model

NPC states form a finite state machine:

```
searching ←→ exploring ←→ socializing
    ↓              ↓            ↓
  pilgrimage    group_travel   idle
    ↓              ↓            ↓
  anxious ←→ despairing → mad → catatonic
                                    ↓
                                  dead (→ resurrect → searching)
```

Transition rates between states (from Tier 2 event rates) form a **transition rate matrix Q**. The probability of being in each state after time t is:

```
P(t) = P(0) × exp(Q × t)
```

Matrix exponentiation gives exact population distributions at any future time. For 16 NPCs this is trivial to compute.

#### Active Window / Deferred Window

The library has ~infinite capacity. With population-level simulation, we can model *many more* NPCs:

- **Active window** (~50 segments around player): Full ECS, per-tick simulation, rendered NPCs
- **Nearby window** (~1000 segments): DES simulation, occasional encounter events
- **Deferred window** (rest of library): Population sketches — statistical distributions of NPC types, densities, group sizes. When the player's active window reaches a deferred region, instantiate NPCs from the distribution.

This means during a 10,000-year walk, the player encounters a *populated* library — not the same 16 NPCs endlessly, but a flowing population where people come and go, groups form and dissolve in the distance, and the social landscape evolves.

NPCs that leave the active window don't vanish — they transition to deferred status with a statistical summary. If the player encounters them again (same segment), they're re-instantiated with state consistent with their summary.

#### Population Generation

For the deferred window, we don't need individual histories — we need *plausible snapshots*:

- NPC density: f(distance from origin, time since creation)
- Psychology distribution: sample from the steady-state Markov chain
- Group probability: f(local density, time)
- Name/story: generated on instantiation (same as current NPC spawning)

The player's 10,000-year walk becomes: long stretches of empty corridor, punctuated by encounters with individuals and groups at statistically appropriate rates. Some are searching. Some are mad. Some have been walking for longer than you have. The library feels *inhabited*.

## Build Path

```
Phase 1: Fix and re-enable batch ticks
  - Debug BATCH_MODE failures in godmode
  - Validate batch vs per-tick outcome parity (test/batch-tick.test.js — 17 tests)
  - Re-enable for godmode slider > 50x
  → Unblocks: faster godmode observation

Phase 1.5: Entity coroutine model
  - Per-NPC coroutine: internally coherent system chain (needs → intent → movement → psychology)
  - Groups as first-class simulation entities (absorb members, single coroutine)
  - Spatial intersection check for cross-entity interaction (rare at cosmic distances)
  - Per-entity fast-forward: compute next internal threshold, jump to it
  - Validate against per-tick model on same seeds
  → Unblocks: correct batch behavior for interacting systems, restrained/captured NPCs

Phase 2: DES event model
  - Define event types and rate functions
  - Implement the event loop (Gillespie)
  - Validate DES vs batch-tick parity over 1-year runs
  - Wire into godmode as speed tier (auto-switch above 1000x)
  → Unblocks: pilgrimage autotravel (#152), time-patience (#153)

Phase 3: Player autotravel via DES
  - PC entity generates events like NPCs (eat, sleep, encounter)
  - First-person narration of DES events ("Three weeks pass. You eat, sleep, walk.")
  - Break on meaningful events (encounter, find words, psychology threshold)
  → Unblocks: playable journey to book

Phase 4: Population-level model
  - Markov chain from Tier 2 rates
  - Active/nearby/deferred windows
  - NPC instantiation from population distributions
  - Encounter generation for deferred regions
  → Unblocks: populated library at cosmic scale
```

## References

- **Gillespie, D.T. (1977)** "Exact stochastic simulation of coupled chemical reactions." *J. Phys. Chem.* — the foundational DES algorithm
- **Dwarf Fortress world generation** — abstract vs detailed simulation tiers, Tarn Adams' talks on "legends mode"
- **Paradox Interactive** (CK3, EU4) — variable-rate event systems with monthly/yearly ticks, event probability tables
- **Idle game "offline progress"** — analytical formulas for production over elapsed time, with caps
- **Continuous-time Markov chains** — standard textbook material for population-level steady-state computation (any stochastic processes textbook)

## Relevant Issues

- #155 Epoch simulation (parent)
- #153 Time-patience scaling
- #152 Pilgrimage autotravel
- #151 PC as ECS entity in godmode
