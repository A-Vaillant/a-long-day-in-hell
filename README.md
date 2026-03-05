# A Short Stay in Hell

A 7DRL (7-Day Roguelike) based on the novella *A Short Stay in Hell* by Steven L. Peck, itself inspired by Borges' *The Library of Babel*.

You are a condemned soul in a Hell that takes the form of an impossibly vast library. Every possible book exists here. Your only way out: find the one book that perfectly describes your life. The library is deterministically generated from a seed — infinite in practice, navigable in theory.

## Build & Run

```bash
bash build.sh          # tsc + bundle + build → dist/index.html
npm test               # node:test (~140 tests)
bash screenshots.sh    # shot-scraper → screenshots/*.png
```

Requires Node.js. TypeScript is the only dev dependency.

Open `dist/index.html` in a browser to play.

## The Library

Two parallel corridors (west and east) separated by a chasm. Each corridor is divided into segments containing 10 galleries of 1,920 books each. Rest areas appear at every segment boundary, equipped with a clock, kiosk, bedroom (7 beds), bathroom, submission slot, and stairs.

Books are 11 pages, 40 lines of 80 characters (35,200 characters total), drawn from ~95 printable ASCII characters. Every book is procedurally generated from the global seed + shelf coordinates. Most are gibberish. Your book — containing your life story — is hidden somewhere in the library.

## Core Systems

- **Navigation**: Move between galleries and segments. Climb stairs between floors. Cross the chasm at floor 0.
- **Survival**: Hunger, thirst, exhaustion, and morale. Kiosks provide food/drink at every rest area. Sleep in bedrooms. Morale degrades over time; reaching zero triggers the Despairing condition.
- **Death & Resurrection**: You die, you come back at dawn. Same location.
- **Events**: Stochastic event deck drawn on movement — environmental, existential, and mechanical encounters.
- **NPCs**: 8 characters spawn near the player, wander daily, and deteriorate over time (calm → anxious → mad → catatonic → dead). Ambient dialogue only.
- **Win Condition**: Find your book and submit it at a submission slot. Two placement modes:
  - **Gaussian** (default): Target book placed near the start. Books nearby contain fragments of your life story as proximity signals.
  - **Random** (`?placement=random`): Target book placed anywhere. Requires reverse-engineering the PRNG.

## Controls

| Key | Action |
|-----|--------|
| `h` / `l` / Left / Right | Move left / right (flip pages in book view) |
| `k` / `j` / Up / Down | Move up / down |
| `x` | Cross chasm (floor 0 only) |
| `z` | Sleep |
| `.` | Wait |
| `J` | Jump into chasm |
| `Esc` / `q` | Close book |
| `E` | Continue (life story) |

## Architecture

```
lib/                    # Pure logic modules (no DOM, no window)
  *.core.js             # JS core modules (prng, library, book, survival, tick, etc.)
  *.core.ts             # TS core modules (events, npc) — compiled by tsc
scripts/
  build-bundle.js       # Bundles lib/*.core.js → IIFE (window._XxxCore)
  build-vanilla.js      # Merges content + CSS + JS → dist/index.html
content/
  *.json                # All prose, event text, NPC dialogue, screen text
src/
  js/                   # Browser modules — wrappers + engine + screens + input
  css/style.css         # Styles
test/
  *.test.js             # node:test suites for core modules
```

Pure game logic lives in `lib/`. Browser wiring lives in `src/js/`. All prose and content lives in `content/*.json` — zero hardcoded strings in code.

## License

TBD
