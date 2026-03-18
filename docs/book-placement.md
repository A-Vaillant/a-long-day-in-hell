---
title: Book placement
description: Address space mechanics, base-95 encoding, player book placement, NPC damnation, full-precision algorithms
status: current
last-updated: 2026-03-14
---

# Book placement

How the game converts text to addresses, places the player's book, spawns the player, and determines that NPCs are damned.

## The address space

The library contains every possible 410-page book printable in 95 ASCII characters (codepoints 32–126), with 40 lines of 80 characters per page. Each book is 1,312,000 characters. The full space has 95^1,312,000 volumes — a number with roughly 2.6 million decimal digits. The game works in a playable subset.

### Text as base-95 number

Any string of characters drawn from a 95-symbol alphabet is a number in base 95. Space (codepoint 32) is digit 0; tilde (codepoint 126) is digit 94. The string `"!\"#"` encodes as `1 × 95² + 2 × 95 + 3 = 9,218`. A full book — 1,312,000 characters — encodes as a single integer in [0, 95^1,312,000). Storing one such number takes about a megabyte.

### Packing coordinates

A book's physical location has four fields:

- `bookIndex`: which book on the shelf, in [0, `BOOKS_PER_GALLERY`)
- `floor`: which floor, in [0, `FLOORS`)
- `side`: which corridor — 0 (west) or 1 (east)
- `position`: which gallery along the corridor, in [0, `POSITIONS_PER_SIDE`)

These pack into a single integer using mixed-radix encoding, innermost field first:

```
address = bookIndex
        + BOOKS_PER_GALLERY × floor
        + BOOKS_PER_GALLERY × FLOORS × side
        + BOOKS_PER_GALLERY × FLOORS × 2 × position
```

The maximum value is `PLAYABLE_ADDRESS_MAX` ≈ 4 × 10^17. To unpack, `addressToCoords` divides and takes remainders in reverse order. All dimension constants live in `lib/scale.core.ts`. `PLAYABLE_ADDRESS_MAX` and `addressToCoords` in `lib/invertible.core.ts` derive from them.

### Library dimensions

| Constant | Default | Meaning |
|---|---|---|
| `FLOORS` | 100,000 | Addressable floors (movement is unbounded) |
| `POSITIONS_PER_SIDE` | 10,000,000,000 | Gallery positions per corridor side |
| `BOOK_FLOOR_MIN` | 2,000 | Lowest floor a player's book can occupy |
| `BOOK_FLOOR_MAX` | 95,000 | Highest floor a player's book can occupy |
| `BOOKS_PER_GALLERY` | 200 | Books per shelf screen (25 columns × 8 shelves) |

`PLAYABLE_ADDRESS_MAX = POSITIONS_PER_SIDE × 2 × FLOORS × BOOKS_PER_GALLERY`. Changing any constant changes the walkable library's size, the early-exit threshold, and the damnation odds.

## Placing the player's book

`generatePlayerWorld` in `lib/lifestory.core.ts` runs at game start. The sequence:

1. **Derive raw address from seed.** The PRNG produces a value mod `PLAYABLE_ADDRESS_MAX`. Unpacked, this gives a random shelf on a random floor at a random position.

2. **Clamp floor.** The floor component is clamped to [`BOOK_FLOOR_MIN`, `BOOK_FLOOR_MAX`] (default [2,000, 95,000]), then packed back. The book sits deep in the library, never near ground level.

3. **Nudge off rest areas.** Rest areas (every `GALLERIES_PER_SEGMENT`th gallery) have kiosks and stairs but no shelves. If the position lands on one, it shifts by +1.

4. **Randomize shelf slot.** `bookIndex` is rerolled so the book occupies a different shelf position each run.

The result is `playerBookAddress` — a packed address guaranteed to be in bounds and on a shelving gallery. The player's life story text converts to `rawAddress` via `textToAddress`. `computeBookAddress` computes `rawAddress - playerRawAddress + playerBookAddress`, which for the player cancels exactly to `playerBookAddress`.

## Placing the player

The player spawns cosmologically far from the book horizontally, close vertically.

**Horizontal.** A base distance is drawn uniformly from [666,666, 666,666,666] segments, then scaled by 66^u where u ∈ [0, 1). Combined range: ~666,000 to ~44 billion segments. At one gallery per minute of walking, the lower end takes over 1,200 years of continuous movement.

**Vertical.** 20–30 floors above the book. Reachable within a day of stair-climbing.

**Snap to rest area.** The spawn position rounds to the nearest kiosk boundary (`GALLERIES_PER_SEGMENT` = 17), guaranteeing stairs, a bed, and a submission slot from the start.

**Same side.** The player always spawns on the same corridor side as the book.

The Life Story screen tells the player where their book is: direction, kiosk count, floor offset, and a walking time estimate. `mercyDistanceText` in `src/js/screens.js` formats this.

## NPC placement and damnation

NPCs spawn in Gaussian clouds around the player, not the book. `lib/npc.core.ts` uses a wave system: position spread starts at σ = 3 segments and grows by 8 per wave, floor spread starts at σ = 5 and grows by 5 (capped at 40). Six NPCs per wave, ten waves per side (120 total). Early NPCs cluster near the player; later ones scatter across floors and corridors.

Each NPC gets a unique life story seeded from their ID and the global seed. The book address:

```
npcBookAddress = npcRawAddress - playerRawAddress + playerBookAddress
```

`npcRawAddress` interprets the NPC's story text as a base-95 number. To see why the result almost always falls outside `PLAYABLE_ADDRESS_MAX`: if two texts differ at character position k (0-indexed from the left), the minimum address difference is 95^(n-k-1). For a 200-character story where texts first diverge at character 10, the difference is at least 95^189 ≈ 10^374. `PLAYABLE_ADDRESS_MAX` is 4 × 10^17 — a gap of 357 orders of magnitude.

For independently generated stories — different names, occupations, hometowns — the first characters already differ. The raw addresses diverge by roughly 95^199 ≈ 10^395. Subtracting one from the other and adding the small `playerBookAddress` changes nothing. The NPC is damned.

An NPC's book exists in the library only if cosmic coincidence places their address within the 4 × 10^17 walkable window. The odds are about 1 in 10^113. No NPC in any run of the game will find their book.

Godmode makes this visible. The NPC detail panel computes `bookAddress` via `computeBookAddress` and checks it against `isAddressInBounds`. When the address falls outside the playable range — which it always does — the panel shows a red **damned** label. The universe distance (in orders of magnitude) is displayed on hover.

## Base conversion: `textToAddress`

Converting a 1,312,000-character string to a base-95 integer is the computational bottleneck in the forward map. Two algorithms are available.

### Horner's method (runtime path)

Process one character at a time, left to right:

```
addr = 0
for each character c:
    addr = addr × 95 + digit(c)
```

Left to right matters — it processes the most significant digit first, so the accumulator grows monotonically. The moment `addr` exceeds `TEXT_ADDRESS_EARLY_EXIT` (set to `PLAYABLE_ADDRESS_MAX`), every subsequent character can only make it larger. The function bails immediately.

Most texts exceed the threshold within ~9 characters out of 1,312,000. The early exit makes Horner's nearly free at runtime. The full conversion (without early exit) is O(n²) — after 500,000 characters, the accumulator has a million digits, and multiplying that by 95 takes time proportional to its length. Summed across all 1,312,000 characters: ~8.6 × 10^11 operations. About 150 seconds on a modern CPU.

### Divide-and-conquer (verification path)

Split the string in half, convert each half separately, combine:

```
function convert(text):
    if len(text) == 1: return digit(text[0])
    mid = len(text) / 2
    left  = convert(text[0..mid])
    right = convert(text[mid..])
    return left × 95^len(right) + right
```

The combination step works because positional notation is additive. `"ABCDEF"` split into `"ABC"` (= 301,090) and `"DEF"` (= 328,553) recombines as `301,090 × 95³ + 328,553 = 258,087,441,803`.

D&C runs in O(n^1.585) — matching Karatsuba multiplication complexity. The recursion has ~20 levels. At each level, the multiplications involve two operands of roughly equal size, which triggers V8's Karatsuba path. Horner's method multiplies a huge number by 95 (big × small), which is always O(n) with no Karatsuba benefit.

Full 1,312,000-character conversion: ~300ms via D&C versus ~150 seconds via Horner's. A 500× speedup, irrelevant at runtime (early exit makes Horner's instant), but useful for verification tests.

`textToAddressFull` in `lib/invertible.core.ts` implements D&C. Powers of 95 are cached by exponent — a balanced binary split produces at most O(log n) distinct exponents.

### Why full precision doesn't matter at runtime

For the player, `computeBookAddress` subtracts the player's raw address from itself. The cancellation holds whether `rawAddress` is the true value or a truncated one — both sides truncate identically. The result is `playerBookAddress` regardless.

For NPCs, both `npcRawAddress` and `playerRawAddress` are enormous. Their difference is enormous. Whether computed exactly or approximately, it lands outside the walkable range by hundreds of orders of magnitude. The damnation verdict is the same.

`test/slow/full-precision.test.js` verifies that D&C and Horner's agree on short texts, that the player's book address equals `playerBookAddress`, and that all NPCs are damned under both methods.
