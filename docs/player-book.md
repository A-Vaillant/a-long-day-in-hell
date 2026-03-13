# The player book

How the game seeds a player's book into the library, places the player relative to it, and makes no guarantees that NPCs will ever find theirs.

## The address space

The library contains every possible 410-page book printable in 95 ASCII characters (codepoints 32-126), with 40 lines of 80 characters per page. That yields 1,312,000 characters per book and 95^1,312,000 distinct volumes.

### Text as number

Any string of characters drawn from a 95-symbol alphabet is a number in base 95. The character `' '` (space, codepoint 32) is digit 0; `'~'` (tilde, codepoint 126) is digit 94. A three-character string like `"!\"#"` encodes as:

```
1 × 95² + 2 × 95 + 3 = 9,218
```

A full book — 1,312,000 characters — encodes as a single integer in the range [0, 95^1,312,000). That upper bound has roughly 2.6 million decimal digits. Storing one such number takes about a megabyte. You can point at any book, but you can't search through 10^2,593,927 of them.

### Packing coordinates into an address

The game defines a *playable* subset of that space. A book's physical location is four fields:

- `bookIndex`: which book on the shelf [0, 199]
- `floor`: which floor [0, 99,999]
- `side`: which corridor, 0 (west) or 1 (east)
- `position`: which gallery along the corridor [0, 9,999,999,999]

These pack into a single integer, innermost field first. The encoding works like mixed-radix digits — the same way hours, minutes, and seconds pack into a total number of seconds:

```
address = bookIndex
        + 200 × floor
        + 200 × 100,000 × side
        + 200 × 100,000 × 2 × position
```

The maximum value of this expression is `PLAYABLE_ADDRESS_MAX` ≈ 4 × 10^17. To unpack, `addressToCoords` divides and takes remainders in reverse order — extract `bookIndex` as `address % 200`, divide out 200, extract `floor` as the remainder mod 100,000, and so on.

All the dimension constants (`BOOKS_PER_GALLERY`, `FLOORS`, `POSITIONS_PER_SIDE`) live in `lib/scale.core.ts`. `PLAYABLE_ADDRESS_MAX` and `addressToCoords` in `lib/invertible.core.ts` derive from them automatically.

### Early exit and the playable boundary

`PLAYABLE_ADDRESS_MAX` (≈ 4 × 10^17) is the upper bound of the walkable library — how many books you can physically reach. `textToAddress` uses this as its early-exit threshold (`TEXT_ADDRESS_EARLY_EXIT`): once the running base-95 total exceeds it, the text is out of bounds and there's no point continuing. Most random texts cross this line within 9 characters. A book whose text-as-number falls within `PLAYABLE_ADDRESS_MAX` has a shelf location; one that exceeds it has no physical address in the playable library.

## Placing the book

`lib/lifestory.core.ts` runs on game start. The sequence:

1. **Derive `randomOrigin` from the seed.** Two 32-bit PRNG outputs combine into a 64-bit value, taken mod `PLAYABLE_ADDRESS_MAX`. This origin anchors the entire coordinate system for this run.

2. **Clamp the floor.** The raw origin might place the book on floor 7 or floor 99,998 — both bad for gameplay. The floor component is extracted, clamped to [`BOOK_FLOOR_MIN`, `BOOK_FLOOR_MAX`] (default [2,000, 95,000]), and packed back in. The book sits deep in the library, never near ground level. These bounds live in `scale.core.ts`.

3. **Nudge off rest areas.** Rest areas (every 17th gallery) have kiosks and stairs but no shelves. If the position lands on one, it shifts to position + 1.

4. **Randomize shelf slot.** `bookIndex` is rerolled from [0, 199] so the book occupies a different shelf position each run.

The player's own life story text converts to a `rawAddress` via `textToAddress` — interpreting characters as base-95 digits. For the player, `bookAddress = rawAddress - rawAddress + randomOrigin = randomOrigin`. The player's book always lands at the origin, always in bounds.

## Placing the player

The player spawns cosmologically far from the book on the horizontal axis but close on the vertical. The spawn algorithm in `generateLifeStory`:

**Horizontal distance:** A base value is drawn uniformly from [666,666, 666,666,666] segments, then scaled by 66^u where u ranges over [0, 1). The combined range spans roughly 666,000 to 44 billion segments. At one gallery per minute of walking, the lower end takes over 1,200 years of continuous movement. The upper end takes hundreds of thousands.

**Vertical distance:** 20-30 floors above the book. This gap is small enough that a player who knows the correct floor can reach it within a day of stair-climbing.

**Snap to rest area.** The spawn position rounds to the nearest multiple of `GALLERIES_PER_SEGMENT` (17), guaranteeing access to stairs, a bed, and a submission slot from the start.

**Same side.** The player always spawns on the same side of the chasm as the book.

The horizontal distance makes brute-force search impossible. The vertical gap is tractable. As a mercy, the game tells the player exactly where their book is on the Life Story screen at spawn: direction, kiosk count, floor offset, and a human-readable time estimate. The `mercyDistanceText` function in `src/js/screens.js` formats this — "Your book is located between the 39,215,687th and 39,215,688th kiosks to your left, 25 floors below. Walking from here would take 1,246 years."

`lib/invertible.core.ts` also encodes book coordinates into the book's own text via paired LCG chains, making it theoretically possible to reverse-engineer a book's location from its content. This path exists but is secondary — the player already knows where to go.

## NPC placement and doom

NPCs spawn in Gaussian clouds around the player, not the book. `lib/npc.core.ts` uses a wave system: position spread starts at σ = 3 segments and grows by 8 per wave, floor spread starts at σ = 5 and grows by 5 (capped at 40). Six NPCs per wave, ten waves per side. The result clusters early NPCs near the player and scatters later ones across floors and corridors.

Each NPC gets a unique life story seeded from their ID and the global seed. Their book address is computed as:

```
npcBookAddress = npcRawAddress - playerRawAddress + randomOrigin
```

The `npcRawAddress` interprets the NPC's story text as a base-95 number. To see why the subtraction almost always produces a value outside `PLAYABLE_ADDRESS_MAX`, consider what a single character difference does. If two texts differ at character position *k* (counting from the left, 0-indexed), the minimum address difference is 95^(n-k-1), where *n* is the text length. For a 200-character story where the texts first diverge at character 10, the difference is at least 95^189 ≈ 10^374. `PLAYABLE_ADDRESS_MAX` is 4 × 10^17. The gap is 357 orders of magnitude.

For two completely independent story texts — different names, occupations, hometowns — the first characters already differ. The raw addresses diverge by roughly 95^199, a number with 395 digits. Subtracting one from the other and adding the small `randomOrigin` doesn't bring the result anywhere near the walkable range.

An NPC's book exists in the library only if cosmic coincidence places their address within the 4 × 10^17 walkable window out of a space of size 95^66 ≈ 3.4 × 10^130. The odds are about 1 in 10^113. No NPC in any run of the game will ever be anything other than damned.

Godmode (`src/js/godmode-panel.js`) makes this visible. Clicking the `[?]` next to an NPC's book stat computes their `bookAddress` via `computeBookAddress` and checks it against `isAddressInBounds`. When the address falls outside the playable range — which it will — the panel renders a red **damned** label instead of a distance. The NPC has no book to find. Their search has no end.

NPCs search anyway. The ECS psychology system in `lib/psych.core.ts` models their decay over decades of fruitless searching: lucidity erodes, hope drains, dispositions shift from calm to anxious to catatonic. They don't know their search is impossible. Neither does the player, at first — the difference is that the player's book actually exists in the walkable library.

## Full-precision verification

### Why full precision matters (and why the runtime skips it)

The runtime `textToAddress` uses Horner's method: walk through the string left to right, accumulating `addr = addr × 95 + digit` at each character. It exits early when the running total exceeds `TEXT_ADDRESS_EARLY_EXIT` (set to `PLAYABLE_ADDRESS_MAX`). Most random texts blow past this threshold within 9 characters, so the check costs almost nothing.

For the player, the early exit doesn't matter. The `computeBookAddress` formula subtracts the player's raw address from itself: `rawAddress - rawAddress + randomOrigin = randomOrigin`. The cancellation holds regardless of whether `rawAddress` is the true value or a truncated one. Both sides of the subtraction are truncated identically.

For NPCs, the early exit also doesn't change the damnation verdict. Both `npcRawAddress` and `playerRawAddress` are enormous — far larger than `PLAYABLE_ADDRESS_MAX` — so their difference is enormous too. Whether you compute the exact difference or an approximate one, it's still outside the walkable range by hundreds of orders of magnitude.

But a full-precision computation is useful as a verification tool: it confirms that the approximation gives the same answer as the exact math, and it opens the door to future mechanics that might care about the true address.

### Horner's method and why it's slow at scale

Horner's method converts a string of digits to an integer by processing one digit at a time:

```
addr = 0
for each character c in the string:
    addr = addr × 95 + digit(c)
```

For the string `"ABC"` (digits 33, 34, 35):

```
step 0: addr = 0 × 95 + 33 = 33
step 1: addr = 33 × 95 + 34 = 3,169
step 2: addr = 3,169 × 95 + 35 = 301,090
```

This is equivalent to `33 × 95² + 34 × 95 + 35`. The method is optimal for small numbers — each step is a single multiply-and-add.

The problem appears at scale. After processing 500,000 characters, `addr` is a number with roughly a million digits. Multiplying that million-digit number by 95 takes time proportional to its length — about a million elementary operations. The next multiplication is slightly larger, the one after that slightly larger still. Summed across all 1,312,000 characters, the total work is proportional to 1 + 2 + 3 + ... + n, which is n²/2. For n = 1,312,000 that's about 8.6 × 10^11 operations. On a modern CPU it takes roughly 150 seconds.

### Divide-and-conquer base conversion

The D&C approach splits the string in half and converts each half separately:

```
function convert(text):
    if len(text) == 1: return digit(text[0])
    mid = len(text) / 2
    left  = convert(text[0..mid])
    right = convert(text[mid..])
    return left × 95^len(right) + right
```

The combination step `left × 95^len(right) + right` works because positional notation is additive. If the string `"ABCDEF"` splits into `"ABC"` and `"DEF"`:

```
"ABC" = 33 × 95² + 34 × 95 + 35 = 301,090
"DEF" = 36 × 95² + 37 × 95 + 38 = 328,553
combined = 301,090 × 95³ + 328,553
         = 301,090 × 857,375 + 328,553
         = 258,087,441,803
```

This equals `33×95⁵ + 34×95⁴ + 35×95³ + 36×95² + 37×95 + 38`. The split is invisible in the result.

### Why D&C is faster

At the bottom of the recursion, you're multiplying small numbers — single digits by single digits. At the next level up, pairs of ~2-digit numbers. Then pairs of ~4-digit numbers. The key multiplication at each level combines two numbers of roughly equal size.

V8's BigInt implementation uses Karatsuba multiplication for large numbers. Karatsuba's cost for multiplying two n-digit numbers is O(n^1.585) — substantially better than the O(n²) schoolbook algorithm. But Karatsuba only helps when both operands are large. Horner's method multiplies a huge number by 95 — that's a big×small multiplication, which is always O(n) regardless of algorithm. No Karatsuba benefit.

The D&C recursion has log₂(1,312,000) ≈ 20 levels. At level *k* (counting from the bottom), there are n/2^k subproblems, each combining two numbers with about 2^k × 2 digits. The multiplication at each subproblem costs O((2^k)^1.585). The total work at level *k* is:

```
(n / 2^k) × O((2^k)^1.585) = O(n × 2^(0.585k))
```

Summed across all 20 levels, this is dominated by the top level, giving O(n^1.585) total — matching Karatsuba's complexity for a single multiplication of two n-digit numbers. In practice, the full 1,312,000-character conversion runs in about 300ms. Horner's takes 150 seconds. That's a 500× speedup.

### Power caching

The combination step needs `95^len(right)` at each level. For a balanced split on a string of length n, the exponents are n/2, n/4, n/8, ..., 1. Computing these from scratch via `95n ** BigInt(k)` is wasteful if the same exponent appears in multiple branches. The implementation caches computed powers in a Map keyed by exponent value. Since a balanced binary split produces at most O(log n) distinct exponents, the cache stays small.

### The implementation

`textToAddressFull` in `lib/invertible.core.ts`:

1. Converts the string to an `Int32Array` of digit values (charCode - 32)
2. Calls `_convertRange(codes, 0, length)` recursively
3. Base cases: length 0 → 0, length 1 → the digit, length 2 → `d0 × 95 + d1`
4. Recursive case: split at midpoint, convert both halves, combine with cached power

`test/slow/full-precision.test.js` verifies that D&C and Horner's (with no early exit) agree on short texts, that the player's book address always equals `randomOrigin`, and that all NPCs are damned.

## Tuning the library

All library dimension constants live in `lib/scale.core.ts`:

| Constant | Default | Controls |
|----------|---------|----------|
| `FLOORS` | 100,000 | Addressable floors for book placement (movement is unbounded) |
| `POSITIONS_PER_SIDE` | 10,000,000,000 | Gallery positions per side in the addressable range |
| `BOOK_FLOOR_MIN` | 2,000 | Lowest floor a player's book can occupy |
| `BOOK_FLOOR_MAX` | 95,000 | Highest floor a player's book can occupy |
| `BOOKS_PER_GALLERY` | 200 | Books per screen (25 columns × 8 shelves) |

`PLAYABLE_ADDRESS_MAX` derives from `POSITIONS_PER_SIDE × 2 (sides) × FLOORS × BOOKS_PER_GALLERY`. Changing any of these changes the walkable library's size, the early-exit threshold (`TEXT_ADDRESS_EARLY_EXIT` tracks `PLAYABLE_ADDRESS_MAX`), and the damnation odds.
