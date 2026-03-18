---
title: Chasm freefall system
description: Freefall mechanics, grab probability, terminal velocity, death-mid-fall resurrection
status: current
last-updated: 2026-03-04
---

# Chasm: Freefall System

## Context

The library has two parallel corridors separated by a massive central chasm. At floor 0, there is a floor — you can walk across it. Above floor 0, the gap is open air — and the library is enormous. If you start near the center vertically, the ground is hundreds of years of freefall away.

## Entering the Chasm

- `J` jumps off the railing into the chasm (from side 0)
- `K` jumps off the railing into the chasm (from side 1)
- Confirmation prompt before jumping? (TBD)

## Freefall State

Once you jump, you're in a new game mode: **Falling**.

- You accelerate until reaching terminal velocity
- Floors tick by as you fall (rate depends on current speed)
- The fall is *long* — potentially hundreds of in-game years from the starting area
- Time passes normally while falling (hunger, thirst, exhaustion, tick/day cycle)
- You die and resurrect repeatedly during the fall — **your body keeps falling while dead**
- Resurrection happens mid-air; you wake up still falling

## Actions While Falling

- **Wait** — do nothing, keep falling
- **Sleep** — attempt to sleep (normal sleep mechanics)
- **Grab railing** — attempt to catch yourself on a passing floor's railing
  - Difficulty scales with current speed (harder at higher velocity)
  - Failure: take damage (mortality hit), continue falling
  - Success: land on a floor (which side? random? same side you jumped from?)
- **Throw book** — release held book into the void
- **Suicide** — deliberate self-kill (see #53)

## Grab/Catch Mechanics (TBD)

- What determines success? PRNG + speed factor? Stats (exhaustion)?
- Damage on failure: mortality hit, possibly broken bones / exhaustion spike
- Does repeated failure slow you down (drag) or does speed stay constant at terminal velocity?
- At terminal velocity, is grabbing basically impossible? Near-impossible?

## Landing at Floor 0

- If you reach the bottom, damage depends on your current speed
- At terminal velocity from high up = death on impact (resurrect on the chasm floor next dawn)
- From low floors = survivable with injury

## Visuals

- What you see depends on speed — slow: individual floors visible; fast: blur
- Normal library light cycle applies — lights out at night, on at dawn
- Pitch black during lights-out unless you have a light source

## Book Behavior

- You can throw a held book while falling
- Nightly book-reset cleans up books mid-chasm (returned to shelf)
- A book you're holding follows normal possession rules (stays if touching at lights-out)

## Open Questions

- Can NPCs fall? Can you encounter falling NPCs?
- Light sources: what are they? Kiosk items? Found objects?
- How does grab difficulty curve with speed? Linear? Exponential?
- Does grabbing (failed or successful) reduce your speed?
