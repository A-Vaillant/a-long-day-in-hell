# A Short Stay in Hell

A 7DRL (7-Day Roguelike) based on the novella *A Short Stay in Hell* by Steven L. Peck, itself inspired by Borges' *The Library of Babel*.

You are a condemned soul in a Hell that takes the form of an impossibly vast library. Every possible book exists here — 95^1,312,000 of them. Your only way out: find the one book that perfectly describes your life. The library is deterministically generated from a seed — infinite in practice, navigable in theory.

## Build & Run

```bash
bash build.sh          # esbuild bundles .ts directly → dist/index.html
npm test               # node:test (800+ tests)
bash screenshots.sh    # shot-scraper → screenshots/*.png
bash snap.sh name.png  # quick single screenshot
```

Requires Node.js 25+ (native type stripping). No tsc build step — `tsconfig.json` is `noEmit: true`, type-check only.

Open `dist/index.html` in a browser to play. Single self-contained HTML file, no server needed.

## The Library

Two parallel corridors (west and east) separated by a chasm. Each corridor is divided into segments containing 10 galleries of 1,920 books each (24×8 shelves). Rest areas at every segment boundary: clock, kiosk, 7-bed bedroom, bathroom, submission slot, and stairs.

Books are 410 pages, 40 lines of 80 characters (1,312,000 characters), drawn from ~95 printable ASCII characters. Every book is procedurally generated from the global seed + shelf coordinates. Most are gibberish — books near yours contain degraded fragments of your life story as proximity signals.

## Core Systems

- **Navigation**: Move between galleries and segments. Climb stairs between floors. Cross the chasm at floor 0 only.
- **Survival**: Hunger, thirst, exhaustion. Kiosks provide food/drink at every rest area. Sleep in bedrooms. Death from deprivation is possible.
- **Death & Resurrection**: You die, you come back at dawn. Same location. Resurrection is automatic — there is no escape through death.
- **Psychology**: Lucidity and hope degrade over cosmic timescales. Low lucidity → madness. Low hope → catatonia. Personality traits bias the direction you break.
- **Belief**: Prior faith erodes into crisis. NPCs adopt stances — Seeker (purposeful search), Holdout (clinging to old faith), Direite (meaning through violence), Nihilist (precursor to catatonia).
- **Events**: Stochastic event deck drawn on movement — environmental, existential, and mechanical encounters with morale effects.
- **NPCs**: 16 characters in 3 waves. ECS social physics: psychology decay, habituation to trauma, personality-driven compatibility, relationship bonds, group formation, social pressure. NPCs wander, deteriorate, form bonds, go mad, die, and come back.
- **Chasm**: Jumping is not suicide — you tumble endlessly, dying and resurrecting mid-freefall, until you catch a railing. The worst thing to witness.
- **Win Condition**: Find your book and submit it at a submission slot. Two placement modes:
  - **Gaussian** (default): Target book near the start (σ=50 segments, σ=15 floors). Brute-force solvable.
  - **Random** (`?placement=random`): Target book placed anywhere. Requires reverse-engineering the PRNG from source.

## Controls

| Key | Action |
|-----|--------|
| `h` `l` / ← → | Move left / right (flip pages in book view) |
| `k` `j` / ↑ ↓ | Move up / down |
| `x` | Cross chasm (floor 0 only) |
| `z` | Sleep |
| `.` | Wait |
| `r` | Read held book |
| `t` | Take book from shelf |
| `p` | Put book back |
| `n` | Name a book |
| `J` | Jump into chasm |
| `Esc` / `q` | Close book |
| `E` | Continue (life story) |

## Debug & Godmode

- `?vohu=ScreenName` — jump to any screen (implies debug mode)
- `?godmode=1` — observation mode: vertical chasm cross-section canvas, NPC dots colored by disposition, click-to-follow, zoom/drag/pan, side panel with full ECS component inspection, event log, possession, tooltips on all stats

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
  *.test.js             # node:test suites (800+ tests)
```

Pure game logic lives in `lib/`. Browser wiring lives in `src/js/`. All prose and content lives in `content/*.json` — zero hardcoded strings in code.

## License

TBD
