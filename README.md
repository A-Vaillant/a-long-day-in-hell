# A Long Day in Hell

A 7DRL (7-Day Roguelike) based on the novella *A Short Stay in Hell* by Steven L. Peck, itself inspired by Borges' *The Library of Babel*.

You are a condemned soul in a Hell that takes the form of an impossibly vast library. Every possible book exists here — 95^1,312,000 of them. Your only way out: find the one book that perfectly describes your life. The library is deterministically generated from a seed — infinite in practice, navigable in theory.

![Life Story — your introduction to Hell](doc/01_life_story.png)

## Play

Open `dist/index.html` in a browser. Single self-contained HTML file, no server needed.

Or build from source:

```bash
bash build.sh          # esbuild bundles .ts directly → dist/index.html
npm test               # node:test (1200+ tests)
```

Requires Node.js 25+ (native type stripping). No tsc build step — `tsconfig.json` is `noEmit: true`, type-check only.

## The Library

Two parallel corridors (west and east) separated by a chasm. Each corridor is divided into segments containing 10 galleries of 1,920 books each (24×8 shelves). Rest areas at every segment boundary: clock, kiosk, 7-bed bedroom, bathroom, submission slot, and stairs.

![A gallery — rows of identical calfskin spines](doc/03_corridor_gallery.png)

Books are 410 pages, 40 lines of 80 characters (1,312,000 characters), drawn from ~95 printable ASCII characters. Every book is procedurally generated from the global seed + shelf coordinates. Most are noise — books near yours contain degraded fragments of your life story as proximity signals.

![Reading a book](doc/05_book_page.png)

## Survival

Hunger, thirst, exhaustion, morale. Kiosks provide food and drink at every rest area. Sleep in bedrooms. Death from deprivation is possible — but temporary. You die, you come back at dawn. Same location. There is no escape through death.

![Survival pressure — stats deteriorating](doc/12_corridor_stressed.png)

## NPCs

120 characters spawned in waves across both corridors. ECS-driven social physics: psychology decay over cosmic timescales, personality-driven compatibility, relationship bonds, group formation and dissolution, habituation to trauma. NPCs wander, deteriorate, form bonds, go mad, die, and come back.

You can talk to them, spend time together, invite them to travel with you. Companions follow your lead, share a home rest area, and slow each other's psychological decay. But incompatible personalities erode — groups self-dissolve when familiarity breeds contempt.

![NPCs — calm, anxious, mad, dead](doc/11_corridor_npcs_mixed.png)

## Core Systems

- **Navigation**: Move between galleries and segments. Climb stairs between floors. Cross the chasm at floor 0 only.
- **Psychology**: Lucidity and hope degrade over cosmic timescales. Low lucidity → madness. Low hope → catatonia. Personality traits bias the direction you break.
- **Events**: Stochastic event deck drawn on movement — environmental, existential, and mechanical encounters with morale effects.
- **Groups**: Recruit companions. Leaders determine movement direction. Group members follow closely (80–98% bias). Shared home rest areas align through co-sleeping.
- **Chasm**: Jumping is not suicide — you tumble endlessly, dying and resurrecting mid-freefall, until you catch a railing. The worst thing to witness.
- **Win Condition**: Find your book and submit it at a submission slot. Two placement modes:
  - **Gaussian** (default): Target book near the start (σ=50 segments, σ=15 floors). Brute-force solvable.
  - **Random** (`?placement=random`): Target book placed anywhere. Requires reverse-engineering the PRNG from source.

## Controls

| Key | Action |
|-----|--------|
| `h` `l` / ← → | Move left / right (flip pages in book view) |
| `k` `j` / ↑ ↓ | Move up / down stairs |
| `x` | Cross chasm (floor 0 only) |
| `b` | Enter bedroom |
| `z` | Sleep |
| `.` | Wait |
| `t` | Talk to NPC / take book from shelf |
| `r` | Read held book |
| `p` | Put book back |
| `n` | Name a book |
| `i` | Invite NPC to travel together |
| `d` | Dismiss companion |
| `J` | Jump into chasm |
| `K` | Kiosk |
| `s` | Submission slot |
| `Esc` / `q` | Back / close |

## Godmode

`?godmode=1` — observation mode. Vertical corridor map (position × floor), NPC dots colored by disposition, click-to-follow, zoom/drag/pan. Toggle between west and east corridors with Tab. Side panel with full ECS component inspection, event log with filters, group view, trend graphs. Possess any NPC. Step time forward at any speed.

![Godmode — observation view](doc/20_godmode_both.png)

## Architecture

```
lib/                    # Pure logic (21 TS modules, no DOM)
  *.core.ts             # prng, library, book, survival, tick, events, npc,
                        # ecs, social, personality, psych, belief, movement,
                        # needs, chasm, despairing, lifestory, invertible...
scripts/
  build-bundle.js       # esbuild bundles lib/*.core.ts → IIFE
  build-vanilla.js      # Merges content + CSS + JS → dist/index.html
content/
  *.json                # All prose, events, NPCs, screens, life stories, stats
src/
  js/                   # Browser wrappers + engine + screens + input + godmode
  css/                  # style.css + godmode.css (inlined at build)
test/
  *.test.js             # node:test suites (1200+ tests)
```

Pure game logic lives in `lib/`. Browser wiring lives in `src/js/`. All prose and content lives in `content/*.json` — zero hardcoded strings in code.

## License

TBD
