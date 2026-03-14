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

- `bookIndex`: which book on the shelf [0, `BOOKS_PER_GALLERY`)
- `floor`: which floor [0, `FLOORS`)
- `side`: which corridor, 0 (west) or 1 (east)
- `position`: which gallery along the corridor [0, `POSITIONS_PER_SIDE`)

These pack into a single integer, innermost field first. The encoding works like mixed-radix digits — the same way hours, minutes, and seconds pack into a total number of seconds:

```
address = bookIndex
        + BOOKS_PER_GALLERY × floor
        + BOOKS_PER_GALLERY × FLOORS × side
        + BOOKS_PER_GALLERY × FLOORS × 2 × position
```

The maximum value of this expression is `PLAYABLE_ADDRESS_MAX` ≈ 4 × 10^17. To unpack, `addressToCoords` divides and takes remainders in reverse order — extract `bookIndex` as `address % BOOKS_PER_GALLERY`, divide out `BOOKS_PER_GALLERY`, extract `floor` as the remainder mod `FLOORS`, and so on.

All the dimension constants live in `lib/scale.core.ts`. `PLAYABLE_ADDRESS_MAX` and `addressToCoords` in `lib/invertible.core.ts` derive from them automatically.

### Early exit and the playable boundary

`PLAYABLE_ADDRESS_MAX` (≈ 4 × 10^17) is the upper bound of the walkable library — how many books you can physically reach. `textToAddress` uses this as its early-exit threshold (`TEXT_ADDRESS_EARLY_EXIT`): once the running base-95 total exceeds it, the text is out of bounds and there's no point continuing. Most random texts cross this line within 9 characters. A book whose text-as-number falls within `PLAYABLE_ADDRESS_MAX` has a shelf location; one that exceeds it has no physical address in the playable library.

## Placing the book

`lib/lifestory.core.ts` runs on game start. The `playerBookAddress` is a packed address derived from the seed — a 4-tuple (bookIndex, floor, side, position) that anchors the player's book in the library for this run. The clamping and nudging steps constrain it to a subset of the full address range, though the position field dominates so completely that the effective range is ~[4 × 10^7, `PLAYABLE_ADDRESS_MAX`] — the floor and kiosk constraints are rounding errors. The sequence:

1. **Derive raw origin from the seed.** The PRNG produces a value mod `PLAYABLE_ADDRESS_MAX`. Unpacked, this gives a random shelf on a random floor on a random side at a random position.

2. **Clamp the floor.** The floor component is extracted and clamped to [`BOOK_FLOOR_MIN`, `BOOK_FLOOR_MAX`] (default [2,000, 95,000]), then packed back in. The book sits deep in the library, never near ground level.

3. **Nudge off rest areas.** Rest areas (every `GALLERIES_PER_SEGMENT`th gallery) have kiosks and stairs but no shelves. If the position lands on one, it shifts by 1.

4. **Randomize shelf slot.** `bookIndex` is rerolled mod `BOOKS_PER_GALLERY` so the book occupies a different shelf position each run.

The player's story text converts to a `rawAddress` via `textToAddress` — interpreting characters as base-95 digits. This raw address is enormous (hundreds of digits for even short text). The book placement formula is `bookAddress = rawAddress % PLAYABLE_ADDRESS_MAX`. For the player, `computeBookAddress` computes `(rawAddress - playerRawAddress + playerBookAddress)`, which cancels to `playerBookAddress`. The player's book always lands at the origin.

The quotient `rawAddress / PLAYABLE_ADDRESS_MAX` — the part discarded by the modulus — is a kind of universe index. Different players whose stories happen to share the same remainder mod `PLAYABLE_ADDRESS_MAX` would land on the same shelf in different universes. The game doesn't use this value, but it exists as a decomposition of the story into a shelf address and an unreachable remainder.

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
npcBookAddress = npcRawAddress - playerRawAddress + playerBookAddress
```

The `npcRawAddress` interprets the NPC's story text as a base-95 number. To see why the subtraction almost always produces a value outside `PLAYABLE_ADDRESS_MAX`, consider what a single character difference does. If two texts differ at character position *k* (counting from the left, 0-indexed), the minimum address difference is 95^(n-k-1), where *n* is the text length. For a 200-character story where the texts first diverge at character 10, the difference is at least 95^189 ≈ 10^374. `PLAYABLE_ADDRESS_MAX` is 4 × 10^17. The gap is 357 orders of magnitude.

For two completely independent story texts — different names, occupations, hometowns — the first characters already differ. The raw addresses diverge by roughly 95^199, a number with 395 digits. Subtracting one from the other and adding the small `playerBookAddress` doesn't bring the result anywhere near the walkable range.

An NPC's book exists in the library only if cosmic coincidence places their address within the 4 × 10^17 walkable window out of a space of size 95^66 ≈ 3.4 × 10^130. The odds are about 1 in 10^113. No NPC in any run of the game will ever be anything other than damned.

Godmode (`src/js/godmode-panel.js`) makes this visible. Clicking the `[?]` next to an NPC's book stat computes their `bookAddress` via `computeBookAddress` and checks it against `isAddressInBounds`. When the address falls outside the playable range — which it will — the panel renders a red **damned** label instead of a distance. The NPC has no book to find. Their search has no end.

NPCs search anyway. The ECS psychology system in `lib/psych.core.ts` models their decay over decades of fruitless searching: lucidity erodes, hope drains, dispositions shift from calm to anxious to catatonic. They don't know their search is impossible. Neither does the player, at first — the difference is that the player's book actually exists in the walkable library.

## Full-precision verification

### Why full precision matters (and why the runtime skips it)

The runtime `textToAddress` uses Horner's method: walk through the string left to right, accumulating `addr = addr × 95 + digit` at each character. It exits early when the running total exceeds `TEXT_ADDRESS_EARLY_EXIT` (set to `PLAYABLE_ADDRESS_MAX`). Most random texts blow past this threshold within 9 characters, so the check costs almost nothing.

For the player, the early exit doesn't matter. The `computeBookAddress` formula subtracts the player's raw address from itself: `rawAddress - rawAddress + playerBookAddress = playerBookAddress`. The cancellation holds regardless of whether `rawAddress` is the true value or a truncated one. Both sides of the subtraction are truncated identically.

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

`test/slow/full-precision.test.js` verifies that D&C and Horner's (with no early exit) agree on short texts, that the player's book address always equals `playerBookAddress`, and that all NPCs are damned.

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

## Unified content model (experimental)

The game uses two codepaths for book content. `generateBookPage` seeds a PRNG from shelf coordinates and emits random printable ASCII. `generateStoryPage` seeds a PRNG from the player's story text and emits life-arc prose. A hard-coded check in `src/js/book.js` picks between them: if the coordinates match `state.targetBook`, use the story generator; otherwise, noise.

A unified model would eliminate the branch. Every book — player's, NPCs', shelf filler — would derive its content from the same function, with the player's story emerging at one address and noise everywhere else. No special cases. `lib/invertible.core.ts` contains prototypes of several approaches.

### The linear bijection

The simplest unified model uses the base-95 bijection directly. A book at address N contains the 1,312,000-character string whose base-95 encoding equals N. `addressToText` implements the inverse. To anchor the player's story, the mapping offsets every address by the player's raw address:

```
bookContent(address) = addressToText(address - playerBookAddress + playerRawAddress)
```

At `address = playerBookAddress`, the offset cancels and the function returns the player's full book. `unifiedBookText` in `invertible.core.ts` implements this.

The model is correct. It is also useless. Nearby addresses produce nearly identical text — two addresses that differ by 1 share all but the final character. The walkable library spans ~4 × 10^17 addresses, which covers 95^9. Only the last 9 characters of a 1,312,000-character book can vary across the entire playable range.

Every reachable shelf holds the player's life story with a trivially different ending. The library is not noise. It is 4 × 10^17 copies of the same book.

### The scale mismatch

A mismatch between two number spaces causes the neighbor problem. Shelf addresses live in [0, 4 × 10^17] — 18 digits. The player's raw address (the full book interpreted as a base-95 number) has ~2.6 million digits. Adding an 18-digit perturbation to a 2.6M-digit number changes nothing visible in the high-order digits. Page 0 depends on the highest-order digits. Page 409 depends on the lowest. The perturbation only reaches the last page.

A Feistel permutation over the shelf-address space scrambles which 18-digit perturbation each shelf gets, but the perturbation is still 18 digits. After the linear offset adds `playerRawAddress`, the scrambled difference vanishes into the low-order tail. Feistel solves the wrong problem — it scrambles within the small space when the issue is projecting into the large one.

### The Feistel permutation

The permutation itself works and is implemented. `feistelKey(seed)` derives four round subkeys. `permute(address, key)` runs a 4-round balanced Feistel network on the 60-bit address, with cycle walking to stay within [0, PLAYABLE_ADDRESS_MAX]. `unpermute` reverses it.

```
split address into left (30 bits) and right (30 bits)
for each round i:
    left = left XOR hash(right, key, i)
    swap left and right
recombine into 60-bit address
```

Adjacent inputs scatter to distant outputs. The permutation is bijective, cheap (four hash calls), and deterministic. Tests verify roundtripping, bijectivity, and scatter distance. The Feistel is the right tool — it just needs to feed into the right formula.

### Carry-free digit-wise embedding (proposed)

The breakthrough: stop treating the book as one enormous number. Treat it as 1,312,000 independent digits.

Define an expansion function `expand(seed, i)` that returns a pseudorandom digit in [0, 94] for each character position i, seeded from a permuted shelf address. The book content at any address becomes:

```
digit(address, i) = ( expand(permute(address), i)
                     - expand(permute(origin),  i)
                     + playerDigit(i)
                   ) mod 95
```

At the player's origin, `permute(origin)` appears on both sides of the subtraction. The expand terms cancel, leaving `playerDigit(i)` — the player's book, character for character.

At any other address, `permute(address)` differs from `permute(origin)` (the Feistel guarantees this). The expansion function produces unrelated pseudorandom sequences for different seeds. The digit-by-digit subtraction yields a pseudorandom offset mod 95, which scrambles the player's text into noise.

The formula has no carries. Each character position is computed independently. No bigint arithmetic. No page-entanglement. Character i at address A depends only on the PRNG output at position i for two seeds, plus one character of the cached player text. Everything else is irrelevant.

### Why this works and the linear offset doesn't

The linear offset operates on the book-as-number, a single 2.6M-digit integer. Addition propagates carries. A small perturbation in the low-order digits cannot reach the high-order digits — the carry would have to ripple through 2.6 million positions, and for small perturbations it never does.

The digit-wise formula operates mod 95 at each position independently. There are no carries. A different seed at position 0 produces a different digit at position 0, regardless of what happens at position 1,311,999. The perturbation doesn't need to propagate — it acts locally at every character.

### Per-page cost

Rendering page K requires 3200 character computations. Each one:

1. Seek the expansion PRNG to position `K × 3200` (skip `K × 3200` outputs).
2. Emit 3200 pseudorandom digits from `expand(permute(address))`.
3. Subtract the corresponding 3200 cached digits from `expand(permute(origin))`.
4. Add the corresponding 3200 characters from the player's book.
5. Take each result mod 95, convert to ASCII.

Steps 2–5 cost 3200 integer operations — microseconds. Step 1 depends on the PRNG. A seekable PRNG (counter-mode, hash-based) makes this constant-time. A sequential PRNG requires skipping `K × 3200` outputs; for page 0 there's no skip, for page 409 it's 1,308,800 steps — still fast for a simple xorshift.

### Caching

Two things need caching, computed once at game start:

**The origin pad** — `expand(permute(origin), i)` for all 1,312,000 positions. One PRNG run, 1,312,000 outputs. ~5ms. Same for every book lookup during this run, so compute once and store as a `Uint8Array`.

**The player's book text** — all 410 pages materialized via `generateFullStoryBook`. Each character's digit value (charCode - 32) cached as a `Uint8Array`. Deterministic from the story seed and fields. ~50ms for generation.

Both caches depend on the game seed (which determines `playerBookAddress` and the story). They regenerate on new game or load. The Feistel key also derives from the seed. None of this is per-book or per-page — it's per-save, computed once.

The powers-of-95 cache (`_pow95Cache`) used by `extractPage` and `addressToText` depends only on the book format constants. Those values are universal — same for every save, every player. They could be precomputed and shipped as static data, though lazy computation on first access works fine.

### Current status

The Feistel permutation (`permute`, `unpermute`, `feistelKey`) is implemented and tested in `lib/invertible.core.ts`. The linear bijection (`addressToText`, `unifiedBookText`) and page extraction (`extractPage`) are implemented and tested. `generateFullStoryBook` in `lib/book.core.ts` materializes the full 410-page player book.

The carry-free digit-wise embedding is not yet implemented. It requires:

1. A seekable expansion function seeded from the permuted address.
2. The origin pad cache (one PRNG run at game start).
3. The player book digit cache (one `generateFullStoryBook` call at game start).
4. The per-page content function: 3200 modular subtractions and additions.

The existing Feistel and page-extraction code remains useful — `extractPage` verifies the bijection roundtrip, and the Feistel feeds directly into the digit-wise formula. Tests in `test/slow/feistel-page.test.js` cover permutation bijectivity, scatter, page extraction correctness, and the current `unifiedBookPage` (which uses the branching approach as an interim implementation).
