# Book maps

How the library maps between shelf coordinates and book content — and the four properties any such map must satisfy.

## The four properties

A book map is a function from shelf address to book content (or the reverse). The game needs this map to satisfy four constraints:

**Tractable.** The player's book must land within the playable address space. The map cannot place it at coordinates the player can never reach.

**Pseudorandom.** Books neighboring the player's book must be indistinguishable from books anywhere else in the library. No proximity signal. No gradual transition. A shelf one position away looks like a shelf a billion positions away.

**Invertible.** Given an NPC's life story text, the forward map must produce a shelf address — or determine that no shelf exists. Given a shelf address, the content map must produce a book. Both maps are total: defined for every input, not just the player's.

Note: these are two separate maps. The content map does not need to be the algebraic inverse of the forward map. It only needs to agree with it at the player's address.

**Single-branch.** One formula for all books. The player's book emerges from the same computation as every other book. No `if (address === playerAddress)` check. The player's identity is baked into the constants, not tested at runtime.

Every implementation attempt can be scored against these four. The history of the book content system is a sequence of approaches that satisfy more of them.

## The forward map: text → address

Every soul has a life story. The forward map converts that story text into a shelf address — the location where the soul's book sits in the library.

The game anchors the coordinate system to the player:

```
bookAddress = rawAddress(soul) - rawAddress(player) + playerBookAddress
```

`rawAddress` interprets a story's text as a base-95 number. `playerBookAddress` is a seed-derived constant in the playable range. For the player, the subtraction cancels: `bookAddress = playerBookAddress`. For NPCs, the subtraction of two independently generated large numbers almost always produces a result outside the playable range. The NPC is damned — their book does not exist here.

The forward map satisfies Tractable (the player's address is in bounds by construction) and Invertible in the forward direction (any story text produces an address). It does not depend on or constrain the content map.

## The inverse map: address → content

The inverse map is the content function — given a shelf address, what text does the book contain? This is where the four approaches diverge.

### Approach 1: independent PRNG

Seed a PRNG from the shelf coordinates. Generate 1,312,000 random ASCII characters.

| Property | Status |
|---|---|
| Tractable | N/A — content generation is decoupled from placement |
| Pseudorandom | ✓ Every book is noise |
| Invertible | ✗ The content map ignores the forward map entirely — no connection between address and content |
| Single-branch | ✗ The player's book requires a separate codepath |

The original implementation. `generateBookPage` hashes the coordinates into a seed and emits random characters. The player's book uses a completely different function (`generateStoryPage`) gated behind an `isTargetBook` check. Two codepaths, no connection between address and content.

### Approach 2: linear bijection

Treat the book's content as its address. A book at address N contains the 1,312,000-character string whose base-95 encoding equals N. Offset every address by the player's raw address so the player's story appears at `playerBookAddress`:

```
content(address) = addressToText(address - playerBookAddress + playerRawAddress)
```

At the player's address, the offset cancels and the function returns the player's full story. One formula, no branch.

| Property | Status |
|---|---|
| Tractable | ✓ |
| Pseudorandom | ✗ Adjacent addresses produce nearly identical text |
| Invertible | ✓ The content map is the true algebraic inverse of the forward map |
| Single-branch | ✓ |

The model satisfies three of four properties. The content map genuinely inverts `textToAddress`: `addressToText(textToAddress(story)) = story` for every story. That exactness is what kills it. The playable address range spans ~4 × 10^17 addresses, which covers 95^9 — nine characters out of 1,312,000. Only the final nine characters vary across the entire walkable library. Every reachable shelf holds the player's life story with a trivially different ending.

The cause is a scale mismatch. Shelf addresses are ~18 digits. The raw address (a full book as a base-95 number) has ~2.6 million digits. An 18-digit perturbation cannot reach the high-order digits of a 2.6-million-digit number. Addition propagates carries upward, but a small perturbation's carry never ripples far enough.

### Approach 3: Feistel + linear bijection

Scramble the address before applying the linear offset. A Feistel permutation maps adjacent shelf addresses to distant ones, so neighbors no longer share content.

```
content(address) = addressToText(permute(address) - permute(playerBookAddress) + playerRawAddress)
```

| Property | Status |
|---|---|
| Tractable | ✓ |
| Pseudorandom | ✗ Same scale mismatch — scrambled perturbation is still 18 digits |
| Invertible | ✓ Still a true inverse (permuted, but bijective) |
| Single-branch | ✓ |

The Feistel permutation itself works. `permute` is bijective, cheap (four hash rounds), and scatters adjacent inputs across the address space. But the scattered output is still an 18-digit number being added to a 2.6-million-digit number. The perturbation still can't reach the high-order digits. Feistel solves the wrong problem — it scrambles within the small space when the failure is the projection from small space into large space.

### Approach 4: carry-free digit-wise embedding

Stop treating the book as one number. Treat it as 1,312,000 independent digits.

Define `expand(seed, i)` — a pseudorandom function that returns a digit in [0, 94] for each character position `i`, seeded from a permuted shelf address. The content at any address:

```
digit(address, i) = (expand(permute(address), i) - expand(permute(origin), i) + playerDigit(i)) mod 95
```

At the player's address, `permute(address) = permute(origin)`. The expand terms cancel position by position, leaving `playerDigit(i)` — the player's book, character for character. At any other address, `permute(address) ≠ permute(origin)`, so `expand` produces an unrelated pseudorandom sequence. The subtraction yields a random offset mod 95 at every position. The result is noise.

| Property | Status |
|---|---|
| Tractable | ✓ |
| Pseudorandom | ✓ Each character position is independently scrambled |
| Invertible | ✓ Both maps are total — but the content map is not the inverse of the forward map |
| Single-branch | ✓ No branch in the formula — cancellation is algebraic |

The content map agrees with the forward map at exactly one address: the player's. Everywhere else it produces noise. If you took an arbitrary story, computed its base-95 address, and fed that address into the digit-wise content function, you would not get the story back. The only story that survives the round-trip is the player's, because that is the one point where the formula was calibrated to cancel.

The linear bijection failed because it insisted on being a true inverse. A true inverse inherits all the structure of the forward map — including carries. The digit-wise approach gave up on inversion, settled for agreement at one point, and that freedom let it choose a better algebraic structure.

The formula has no carries. Each character position depends only on the PRNG output at that position for two seeds (the address and the origin), plus one character of the player's text. No digit knows about its neighbors. A perturbation in the address changes every character independently because there is no carry chain to block propagation.

The previous approaches operated on the book-as-number — a single morphism from the address space S into the integers Z. Digits were entangled by positional notation. The digit-wise embedding decomposes this into 1,312,000 independent morphisms S → Z/95Z. Each one acts locally.

The single-branch property deserves a closer look. The formula doesn't check for the player — but the player is everywhere. The constants ω (origin pad) and π (player digits) are both derived from the player's data. Every book in the library is computed relative to the player. The noise on every shelf is the player's text, transformed. The library is not a neutral container that happens to hold one special book. The library is built from that book. Everything else is what the machine emits when pointed at the wrong address.

## The Feistel permutation

The permutation is shared between approaches 3 and 4. It destroys local similarity along the shelf axis — two books one shelf apart must look completely different, because the player can walk between them.

`permute` runs a 4-round balanced Feistel network on the ~60-bit address. Each round XORs one half with a keyed hash of the other half, then swaps. Cycle walking keeps the output within [0, PLAYABLE_ADDRESS_MAX]. `unpermute` reverses it.

Adjacent inputs scatter to distant outputs. The permutation is bijective and deterministic. In approach 4, it feeds the scattered address into `expand` as a PRNG seed.

## Per-page rendering

The digit-wise formula computes one page at a time. Rendering page K requires 3,200 character computations (40 lines × 80 characters):

1. `permute(address)` — one Feistel evaluation.
2. `expand(permuted, K × 3200, 3200)` — counter-mode hashing, 800 hash calls (4 digits each).
3. Subtract the corresponding 3,200 cached origin-pad digits.
4. Add the corresponding 3,200 cached player-book digits.
5. Reduce each result mod 95, convert to ASCII.

Counter-mode hashing makes the cost independent of page index — page 409 costs the same as page 0. Measured at ~0.19ms per page.

Three values are computed once at game start and held in transient state (not serialized, recomputed on load in ~25ms):

- `_feistelKey` (16 bytes) — four round subkeys from the game seed.
- `_originPad` (1.3MB) — `expand(permute(playerBookAddress))` across all 1,312,000 positions.
- `_playerDigits` (1.3MB) — the player's full book as digit values.

## The phantom-kiosk gap

The address space packs coordinates densely: every integer from 0 to `PLAYABLE_ADDRESS_MAX` maps to a (bookIndex, floor, side, position) tuple. But the game's physical model has rest areas — every 17th gallery position is a kiosk with no shelves.

The address space does not skip these positions. Roughly 1/17 of all valid addresses map to kiosk galleries that have no physical books. The player's book is nudged off rest areas during placement. An NPC book that miraculously landed in bounds would not be nudged — its coordinates could point to a kiosk, making the book present in the math but absent from the world.

This gap is harmless in practice (the probability of an in-bounds NPC book is ~10^-1953). Closing it would require decoupling the address space from the position space — having addresses index only shelving galleries, with a separate expansion function mapping address-positions to physical positions. That change would shift every address in the space and require a save version bump.

## The universe index

The playable address space covers ~4 × 10^17 books. The full library — every possible 410-page book — has 95^1,312,000 volumes. The digit-wise formula works in an infinitesimal cross-section of that space.

Any book's text, interpreted as a base-95 number, decomposes into a shelf address and a quotient:

```
rawAddress = u × PLAYABLE_ADDRESS_MAX + a
```

`a` is the shelf location. `u` is the universe index — the part the current system discards. Extending `expand` to accept `u` as an additional seed input would cover the full space. The content function would become:

```
content(a, u, i) = expand(permute(a), u, i) - ω(u₀, i) + π(i)   mod 95
```

At the player's shelf in the player's universe (`a = origin`, `u = u₀`), cancellation holds. The player's book sits at one address in one universe.

The universe axis does not need a Feistel permutation. The permutation exists to destroy local similarity along an axis the player can walk. Nobody walks between universes. Adjacent universes would produce books that differ in a few characters — gradual drift. Local similarity is a defect when observable, and texture when it is not.

The library would then be complete in the Borges sense: every book that can be written exists at some coordinate. The implementation is one hash input away from covering 95^1,312,000 volumes. The game does not need it — the player interacts only with the walkable slice.
