# A Short Stay in Hell

A 7DRL (7-Day Roguelike) built in Twine/SugarCube 2. Based on the novella *A Short Stay in Hell* by Steven L. Peck, itself inspired by Borges' *The Library of Babel*.

## Concept

You are a condemned soul in a Hell that takes the form of an impossibly vast library. Every possible 410-page book exists here. Your only way out: find the one book that perfectly describes your life. The library is deterministically generated from a seed — infinite in practice, navigable in theory.

## Core Systems

### The Library (Seeded Deterministic Generation)
- Hexagonal galleries, each containing shelves of books
- Navigation: move between galleries, select shelves, pull books
- Every book is procedurally generated from the seed + location coordinates
- Most books are gibberish. Occasionally: a coherent word, a sentence, a fragment of meaning

### Books & Reading
- 410 pages, 40 lines of 80 characters, 95 printable ASCII characters
- Reading a book reveals its contents (generated deterministically, streamed page-by-page — never generate the full 1.3M chars at once)
- Coherent fragments are vanishingly rare but possible — and trackable

### Your Book & Proximity Signals
- At game start, the player's life story is generated (or seeded) and placed at a specific location in the library
- **Your book exists.** Its coordinates are derived deterministically from the game seed.
- As the player navigates, proximity signals fire based on distance to the book's location:
  - Far: nothing
  - Closer: books on this shelf contain your name, a familiar word, a date
  - Near: fragments of coherent autobiography appear in adjacent books
  - Adjacent: unmistakable. A page that describes a memory perfectly.
- This creates a "warmer/colder" mechanic without ever making the search tractable

### Survival
- **Morale**: Degrades over time. Finding coherent text restores it. Hitting zero applies the **Despairing** condition (effects TBD — deferred for v0.1).
- **Hunger/Thirst**: Separate tracks. Vending machines are common (as in the book — every few galleries). They produce anything you want. Not a scarcity problem, more a "did you remember to eat" problem.
- **Exhaustion**: Sleep requirement. Separate from morale. You need to rest periodically.
- **Death & Resurrection**: You die, you come back. You respawn where you died. If you were falling, you're still falling. Time of day matters — resurrection is not instant, it follows the library's clock.

### The Tick System
- Time passes. Events happen stochastically.
- Events drawn from a deck (encounter table). Shuffled, drawn, reshuffled when empty.
- Event categories: environmental (lights flicker, distant sounds), discovery (coherent text fragment), mechanical (vending machine found/lost), existential (time dilation moments, déjà vu)
- Future: NPCs as decks ("a person is a kind of deck")

### Win Condition
- Find your book. The one that describes your life with no errors.
- This is theoretically possible. Practically: you are searching 95^1,312,000 books.
- The game should make you *feel* this.

## Tech Stack

- **Twine / SugarCube 2**: Story format and macro system
- **Tweego**: CLI compiler (Twee → HTML)
- **JavaScript/TypeScript**: Game logic, PRNG, generation systems
- **Assets**: Kyrise 16x16 RPG icons, ThaleahFat pixel font

## Build

```bash
tweego/tweego -f sugarcube-2 -o dist/index.html src/
```

## Project Structure (Planned)

```
src/
  story/          # Twee passage files
    start.twee    # Entry point
    library.twee  # Gallery navigation passages
    book.twee     # Book reading interface
    events.twee   # Event passages
    status.twee   # Player status/inventory
  js/
    prng.js       # Seeded PRNG (xoshiro256** or similar)
    library.js    # Deterministic gallery/book generation
    tick.js       # Tick system and event deck
    player.js     # Player state management
    book.js       # Book content generation (streaming, page-at-a-time)
    lifebook.js   # Player life story generation and placement
  css/
    style.css     # Styling, horror aesthetic
```

## Development Timeline (4 days)

1. **Day 1**: Scaffolding. PRNG, basic gallery generation, movement between galleries, tweego pipeline working.
2. **Day 2**: Book generation and reading. Morale system. Vending machines. Basic survival loop.
3. **Day 3**: Event deck. Horror atmosphere (CSS, writing). Coherent text fragment detection/celebration.
4. **Day 4**: Polish, playtesting, edge cases. Win condition (even if unreachable). Ship it.

## License

TBD
