# Library of Stories: Implementation Plan

## Overview

Replace character-noise book generation with word-based degraded stories. Every book page is a story from a corpus, with some words replaced by dictionary words. The combinatorial explosion of possible edits generates the library.

## Phase 1: Core Generator (`lib/book.core.js` rewrite)

### New exports

```js
export const PAGES_PER_BOOK = 11;
// Remove: LINES_PER_PAGE, CHARS_PER_LINE, CHARS_PER_PAGE, CHARS_PER_BOOK, CHARSET

export function generateBookPage(side, position, floor, bookIndex, pageIndex, globalSeed, stories, dictionary)
// Returns: { text: string, storyId: number, editDistance: number }
// - text: the degraded story (flowing prose string)
// - storyId: which corpus story was used
// - editDistance: how many words were replaced (for internal use / dwell scoring)
```

### Algorithm

```
1. rng = seedFromString(globalSeed + ":book:" + coords + ":p" + pageIndex)
2. storyId = rng.nextInt(stories.length)
3. story = stories[storyId]
4. words = tokenize(story.text)  // preserves punctuation attachment
5. editLevel = pickEditLevel(rng)  // exponential distribution, most books high
6. for each word position:
     if rng.next() < replaceProbability(editLevel):
       replacement = dictionary[rng.nextInt(dictionary.length)]
       apply original punctuation/capitalization to replacement
     else:
       keep original word
7. return { text: detokenize(words), storyId, editDistance: replacedCount }
```

### Edit level distribution

```
editLevel = floor(exponentialSample(rng) * 3)  // clamped to 0..10
```

Most pages land at level 7–10 (word soup). Level 0–3 are rare (~2% of pages). This is NOT spatially correlated — a nearly-intact story can appear anywhere.

### Tokenization

Split on whitespace, but attach punctuation to the word it's adjacent to:
- "kitchen," → { word: "kitchen", trailing: "," }
- "(the" → { leading: "(", word: "the" }

When replacing, swap the word but keep the punctuation. Capitalization: if original word was capitalized, capitalize replacement.

### Dependencies

- `stories` and `dictionary` passed in (no hardcoded content in core module)
- Core module stays pure: no `window`, no globals

### What to remove from book.core.js

- `LINES_PER_PAGE`, `CHARS_PER_LINE`, `CHARS_PER_PAGE`, `CHARS_PER_BOOK`, `CHARSET`
- `generateBookPage` old implementation (replaced)
- `findCoherentFragment` (replaced by fragment detection on word boundaries)
- `scoreSensibility` and `BIGRAM_WEIGHTS` (replaced by editDistance-based scoring)
- `SENSIBILITY_THRESHOLD` (replaced)

### What to keep

- `PAGES_PER_BOOK = 11`
- `bookMeta()`
- `DWELL_MS = 2000`
- `dwellMoraleDelta()` — reworked to use editDistance instead of sensibility score

### New: fragment detection

```js
export function findOriginalFragments(degradedWords, originalWords)
// Returns array of { start, end, text } for runs of 3+ consecutive original words
// Used by dwell timer to highlight surviving phrases
```

Compare degraded output to source story word-by-word. Runs of 3+ unchanged consecutive words are "fragments." These get highlighted after the dwell timer fires.

---

## Phase 2: Wrapper update (`src/js/book.js`)

### Changes

- `Book.getPage()` passes `TEXT.stories` and `TEXT.dictionary` to core
- Returns `{ text, storyId, editDistance }` instead of a raw string
- `Book.findFragments(storyId, degradedText)` — calls core's fragment detection using the original story
- Remove `findCoherentFragment`, `scoreSensibility` from wrapper exports
- `startDwell()` uses `editDistance` for morale scoring instead of bigram sensibility

---

## Phase 3: Morale-gated page opening (`src/js/screens.js`)

### Current flow
1. Click spine → `state.openPage = 0` (cover) → goto "Shelf Open Book"
2. Player navigates pages manually

### New flow
1. Click spine → compute starting page from morale:
   - Morale 80+: `openPage = 0` (cover, then page 1)
   - Morale 40–80: `openPage = rng.nextInt(PAGES_PER_BOOK) + 1` (random page)
   - Morale 15–40: same random page
   - Despairing: 70% blocked (existing), else random page
2. Page navigation still available (h/l) but the *default landing* shifts

### Implementation

In the spine click handler (screens.js ~line 225–236):
```js
var startPage;
if (state.morale >= 80) {
    startPage = 0;  // cover
} else {
    var pageRng = PRNG.fork("pageopen:" + state.tick);
    startPage = pageRng.nextInt(Book.PAGES_PER_BOOK) + 1;  // random content page
}
state.openPage = startPage;
```

---

## Phase 4: Fragment highlighting (`src/js/screens.js` afterRender)

### Current behavior
- afterRender sets `el.textContent = pageText` (monospace block)
- Finds coherent fragment, shows as notice below

### New behavior
- afterRender sets flowing prose text in `el`
- Starts dwell timer
- On dwell fire: call `Book.findFragments(storyId, degradedText)`
- For each fragment: wrap matching text spans in `<mark class="fragment">`
- Fragments fade in via CSS transition (opacity 0 → 1)
- No separate notice — the highlights ARE the notice

### CSS
```css
.fragment {
    color: var(--text-main);
    background: transparent;
    transition: background 1.5s ease;
}
.fragment.revealed {
    background: rgba(180, 160, 100, 0.15);
}
```

---

## Phase 5: Book view reformat (`src/js/screens.js` + `src/css/style.css`)

### Current
- `#book-single` displays monospace 40×80 grid
- Cover shows "Book N"
- Back cover is blank

### New
- `#book-single` displays flowing prose, serif or readable mono, line-wrapped
- Remove cover/back-cover concept — open directly to a page of text
- Page indicator simplified: "page N" in dim text
- Page nav (h/l, arrows) still works for flipping through all 11 pages
- Book text styled for readability:
  ```css
  #book-single {
      font-family: var(--font-serif, Georgia, serif);
      font-size: 1em;
      line-height: 1.6;
      max-width: 580px;
      white-space: normal;
      word-wrap: break-word;
  }
  ```

---

## Phase 6: Target book (`lib/lifestory.core.js`)

### Current
- `generateBookPage(story, pageIndex)` produces 40×80 padded character pages
- Page 0: title page, Page 1: prose, Pages 2+: whitespace

### New
- `generateBookPage(story, pageIndex)` returns the player's life story prose on ONE designated page (e.g., page 0)
- Other pages generated normally (random degraded stories)
- The designated page index is deterministic from seed (so it's different per run)
- The prose style should match corpus voice — memoir fragment, ~200 words

### Changes to formatLifeStory
- Keep for Life Story screen display
- Also generate a "book version" — the exact text that appears on the target page
- This text must be recognizable by the player if they find it

---

## Phase 7: Content pipeline (`scripts/build-bundle.js`, `scripts/build-vanilla.js`)

### New content files
- `content/stories.json` — array of { id, title, text } (already written, 15 stories)
- `content/dictionary.json` — array of strings (already written, 3438 words)

### Build changes
- Both files merged into `window.TEXT` at build time (same as events.json, npcs.json)
- `TEXT.stories` and `TEXT.dictionary` available at runtime
- Core module receives them as parameters (no window access)

---

## Phase 8: Invertible PRNG decision

### Problem
The invertible module (`lib/invertible.core.js`) encodes book coordinates into character sequences. With word-based pages, this mechanism breaks.

### Options
1. **Cut it.** Remove `lib/invertible.core.js` and its tests. The `?placement=random` mode becomes unsolvable-by-design (which fits the art piece direction — the win condition is theoretical, not practical).
2. **Rework it.** Encode coordinates steganographically in word choices — e.g., specific dictionary indices in a specific page encode the target coordinates. Significantly more work.
3. **Hybrid.** Keep one page of each book as raw character data (the "colophon") that encodes coordinates. The rest are word-based stories. Weird but functional.

### Recommendation
Cut it. The puzzle path was designed for a "read the source code" player. The game is moving toward art piece, not puzzle box. The invertible module is cool engineering but doesn't serve the new direction.

---

## Phase 9: Update tests (`test/book.test.js`)

### Remove
- Character generation tests (CHARSET, line counts, char counts)
- Bigram sensibility tests
- Coherent fragment tests (character-based)

### Add
- `generateBookPage` returns { text, storyId, editDistance }
- Determinism: same coords + seed → same output
- Edit distance distribution: most pages are high edit distance
- Tokenization round-trips: tokenize → detokenize preserves punctuation
- Fragment detection: finds runs of original words
- Target book page: edit distance 0, matches life story text
- All stories in corpus are reachable (given enough coordinates)

### Keep
- `bookMeta` tests
- `dwellMoraleDelta` tests (reworked for editDistance input)

---

## Execution Order

1. **Phase 1** — Core generator. This is the foundation. ~150 lines of new code.
2. **Phase 9** — Tests for the new core. Validate before wiring up.
3. **Phase 7** — Content pipeline. Get stories/dictionary into the build.
4. **Phase 2** — Wrapper update. Wire core to game state.
5. **Phase 6** — Target book. Player's story as a page.
6. **Phase 5** — Book view reformat. Display changes.
7. **Phase 3** — Morale-gated opening. Quick screen change.
8. **Phase 4** — Fragment highlighting. Dwell timer + CSS.
9. **Phase 8** — Cut invertible module.

### Estimated file changes
- `lib/book.core.js` — rewrite (~150 lines)
- `src/js/book.js` — moderate edit (~30 lines changed)
- `src/js/screens.js` — moderate edit (book view, spine click, ~50 lines)
- `src/css/style.css` — book view styles (~20 lines)
- `lib/lifestory.core.js` — small edit (target page generation)
- `scripts/build-bundle.js` — add stories/dictionary to bundle exports
- `scripts/build-vanilla.js` — add stories/dictionary to TEXT merge
- `test/book.test.js` — rewrite (~150 lines)
- `lib/invertible.core.js` — delete
- `test/invertible.test.js` — delete
- `content/stories.json` — already written
- `content/dictionary.json` — already written
