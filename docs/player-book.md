# The player book

How the game seeds a player's book into the library, places the player relative to it, and makes no guarantees that NPCs will ever find theirs.

## The address space

The library contains every possible 410-page book printable in 95 ASCII characters (codepoints 32-126), with 40 lines of 80 characters per page. That yields 1,312,000 characters per book and 95^1,312,000 distinct volumes.

Indexing a specific book takes a number with roughly 2.6 million digits — about a megabyte. You can point at any book, but you can't search the space. The game defines a *playable* subset: a coordinate system of `side` (0 or 1), `position` (gallery index, ±5 billion), `floor` (0-99,999 for book placement, unbounded for movement), and `bookIndex` (0-199 within a gallery). These four fields encode into a single address below `PLAYABLE_ADDRESS_MAX` ≈ 4 × 10^17. The full 95^1,312,000 space exists in principle — books outside the playable window simply can't be walked to.

`lib/invertible.core.ts` defines the mapping. An address decomposes innermost-first: bookIndex occupies the low `BOOKS_PER_GALLERY` values (200), then floor (`FLOORS` values, default 100,000), then side (2), then position (`MAX_BOOK_POSITION`, default 10 billion). All three dimension constants live in `lib/scale.core.ts` and propagate to `PLAYABLE_ADDRESS_MAX` and `addressToCoords` automatically. The `addressToCoords` function reverses this packing.

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

The `npcRawAddress` interprets the NPC's story text as a base-95 number. For any two distinct texts, the difference between their raw addresses is astronomically large — a single character change in a 1.3-million-character string shifts the address by at least 95^(position of that character). The subtraction almost always produces a value outside `PLAYABLE_ADDRESS_MAX`.

An NPC's book exists in the library only if cosmic coincidence places their address within the 4 × 10^17 walkable window. The odds are roughly 4 × 10^17 / 95^66, or about 1 in 10^113. It doesn't happen.

Godmode (`src/js/godmode-panel.js`) makes this visible. Clicking the `[?]` next to an NPC's book stat computes their `bookAddress` via `computeBookAddress` and checks it against `isAddressInBounds`. When the address falls outside the playable range — which it will — the panel renders a red **damned** label instead of a distance. The NPC has no book to find. Their search has no end.

NPCs search anyway. The ECS psychology system in `lib/psych.core.ts` models their decay over decades of fruitless searching: lucidity erodes, hope drains, dispositions shift from calm to anxious to catatonic. They don't know their search is impossible. Neither does the player, at first — the difference is that the player's book actually exists in the walkable library.

## Full-precision verification

The runtime `textToAddress` uses Horner's method with an early-exit at `LIBRARY_MAX` (95^66). Most texts blow past that limit within 66 characters, making the check nearly free. For the player, the subtraction `rawAddress - rawAddress` cancels out regardless of precision, so the early exit doesn't affect correctness.

`textToAddressFull` in `lib/invertible.core.ts` computes the true address without any early exit. It uses divide-and-conquer base conversion: split the string in half, convert each half recursively, combine as `left * 95^(right_length) + right`. V8's BigInt multiplication is fast for balanced operands (Karatsuba), making this O(n log²n) instead of O(n²). A full 1,312,000-character book produces a ~2.6 million digit number in about 300ms.

The naive Horner's approach takes ~150 seconds for the same input. The difference is that Horner's multiplies a huge accumulator by 95 at each step — an operation that grows linearly in the accumulator's size, yielding quadratic total work. The D&C approach keeps operands balanced at every level.

`test/slow/full-precision.test.js` verifies three things: that D&C and Horner's agree on short texts, that the player's book address always equals `randomOrigin`, and that all NPCs are damned.

## Tuning the library

All library dimension constants live in `lib/scale.core.ts`:

| Constant | Default | Controls |
|----------|---------|----------|
| `FLOORS` | 100,000 | Addressable floors for book placement (movement is unbounded) |
| `MAX_BOOK_POSITION` | 10,000,000,000 | Gallery index range (±5B from origin) |
| `BOOK_FLOOR_MIN` | 2,000 | Lowest floor a player's book can occupy |
| `BOOK_FLOOR_MAX` | 95,000 | Highest floor a player's book can occupy |
| `BOOKS_PER_GALLERY` | 200 | Books per screen (25 columns × 8 shelves) |

`PLAYABLE_ADDRESS_MAX` derives from `MAX_BOOK_POSITION × 2 × FLOORS × BOOKS_PER_GALLERY`. Changing any of these changes the walkable library's size and the damnation odds. `LIBRARY_MAX` (95^66) is independent — it governs how many characters of text are interpreted before the early-exit fires, not the walkable geometry.
