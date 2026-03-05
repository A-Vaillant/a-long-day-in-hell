# The Library of Stories

## Core Concept

Every book in the library is a collection of degraded stories. Not random characters — degraded *prose*. The library is the space of all possible edits to a finite corpus of short stories. The combinatorial explosion of word substitutions generates a functionally infinite library from a small source.

## Structure

### The Corpus

~50 short prose pieces, each fitting one page (~200–300 words). Sourced from multiple LLMs to get tonal variety. Each piece is a fragment of a life — a memory, a moment, a confession. Not plot-driven. Impressionistic. The kind of thing that could be a page from someone's life story.

Tone range:
- Mundane domestic (a meal cooked, a morning routine, a child's question)
- Sensory/embodied (weather, texture, a body in motion)
- Loss and absence (someone gone, a place that doesn't exist anymore)
- Absurd/comic (a stupid argument, a bureaucratic humiliation, a pet)
- Existential (doubt, prayer, the feeling of not knowing what you believe)
- Violent/disturbing (a few — war, accident, cruelty witnessed)

No genre fiction. No fantasy/sci-fi. These read like pages torn from memoirs that could belong to anyone.

### The Page

A page is one story at some edit distance from its original. Format: flowing prose, line-wrapped, ~20–30 lines. No rigid 40×80 grid — readability matters because the player is meant to *read*.

### The Book

11 pages per book. Each page is independently generated:
- Story ID selected from corpus via PRNG(coordinates, page_index)
- Edit distance selected via PRNG
- Specific word replacements selected via PRNG from dictionary

Pages within a book are unrelated — different stories at different degradation levels. This matches the source material (books are not thematically coherent).

### The Dictionary

A general English word list. Maybe 10,000–20,000 words. Curated slightly — no slurs, no brand names, weighted toward the vocabulary of the corpus and the novella (corridor, silence, railing, hunger, shelf, dust, memory, threshold). Replacement words come from this list.

## Degradation Function

Given a source story and a PRNG seeded from coordinates:

1. Tokenize story into words (preserving punctuation attachment)
2. For each word position, PRNG decides: keep or replace
3. Replacement probability = f(edit_distance_level)
4. Replacement word drawn from dictionary via PRNG
5. Capitalization and punctuation preserved from original positions

### Edit Distance Levels

- **Level 0**: Original text, untouched. Only exists for the player's target book page.
- **Level 1–3**: A few words replaced. The story is clearly readable, a few jarring substitutions. "I remember my daughter's *harvest* in the kitchen" — you notice the wrong word.
- **Level 4–6**: Many words replaced. Sentence structure intact but meaning fractures. You can feel the ghost of a story underneath.
- **Level 7–9**: Most words replaced. Occasional original phrases survive like islands. "I remember" followed by dictionary soup.
- **Level 10+**: Pure dictionary sequence. Sentence structure from punctuation placement, but no meaning. This is the baseline — what most books look like.

### Distribution

Most books in the library should be high edit distance (7+). Low edit distance books are rare. The PRNG distribution should be exponential or similar — the vast majority of what you open is word soup, with occasional pockets of near-coherence.

This is not tied to spatial proximity. A nearly-intact story could appear anywhere. The distribution is uniform in rarity, not clustered around the target.

## The Player's Story

Generated from the life story seed, same as now. Name, occupation, hometown, cause of death, last memory — woven into a prose paragraph that reads like one of the corpus pieces. This is page N of the target book. The other 10 pages are other stories at various degradation levels.

The player sees their story on the Life Story screen at game start. They'd recognize it if they found it in a book — same words, same structure. But they'd have to remember it, or compare carefully.

## Morale and Reading

Morale determines how you interact with books:

- **High morale (80+)**: Open to cover, then page 1. You read like someone who still cares.
- **Moderate (40–80)**: Open to a random page. You're skimming.
- **Low (15–40)**: Random page. Shorter attention span (faster dwell timer? fewer pages before closing?).
- **Despairing (<15)**: 70% chance reading is blocked entirely (existing mechanic). When you do read, random page, text may render partially — words dropping out, gaps.

## Fragment Highlighting

The dwell timer (existing, 2s) triggers fragment detection. After lingering on a page:

- Scan visible text for sequences of original (un-degraded) words
- Highlight surviving fragments in-place (subtle color shift, not flashy)
- The experience: you stare at word soup, and slowly a phrase emerges — "my daughter's birthday" — highlighted against the noise
- This is the Biscuit moment. The player finds meaning because they waited.

No mechanical reward needed. The highlight IS the reward. Optionally a small morale bump for finding a fragment, but the primary value is aesthetic/emotional.

## Display Changes

### Shelf Grid (Corridor)

Keep the 192-spine grid. Clicking a spine opens the book inline or in a simplified view — one page at a time. No separate "Shelf Open Book" screen with heavy navigation. Quick open, quick close.

### Book View

- One page of flowing prose, readable font size
- Page indicator (page N of 11)
- h/l to flip pages (if player chooses to dig deeper)
- Escape/q to close
- Fragment highlights appear after dwell timer
- Morale determines starting page

### Spine Appearance

All spines look identical (calfskin, gilded edges per the novella). The grid is uniform. No visual hints about content.

## Generation Pipeline

### Build Time
1. Corpus stories in `content/stories.json` — array of { id, text, wordCount }
2. Dictionary in `content/dictionary.json` — array of words

### Runtime (per page view)
1. Seed PRNG from `globalSeed + ":" + side + ":" + position + ":" + floor + ":" + bookIndex + ":" + pageIndex`
2. Select story: `rng.nextInt(corpus.length)`
3. Select edit distance level: weighted random (exponential distribution favoring high levels)
4. Tokenize source story
5. For each token: `rng.next() < replaceProbability(level)` → keep or replace
6. Replacement: `dictionary[rng.nextInt(dictionary.length)]`
7. Reconstruct text with original punctuation/capitalization patterns

### Target Book
- One page uses player's generated life story at edit distance 0
- Other 10 pages: normal generation (random stories, random degradation)
- Target book coordinates determined by life story seed (existing system)

## Impact on Existing Systems

### Replaces
- `generateBookPage()` in `lib/book.core.js` — new word-based generator
- Character-based sensibility scoring — replaced by edit-distance-aware fragment detection
- The 40×80 character grid display

### Keeps
- Book coordinates system (side, position, floor, bookIndex)
- Target book placement (lifestory.core.js)
- Dwell timer mechanic (repurposed for fragment highlighting)
- Morale effects from reading
- Take/hold/submit book flow

### Breaks
- Invertible PRNG puzzle path — coordinate encoding was character-based. Needs rethinking or cutting. Possibly: the target book's coordinates are encoded in the life story text itself as a steganographic hint, rather than in the book's character sequence.
- `CHARS_PER_LINE`, `CHARS_PER_PAGE`, `CHARS_PER_BOOK` constants — no longer meaningful
- `scoreSensibility()` bigram analysis — replaced by fragment detection on word boundaries

## Open Questions

- Exact corpus size? 50 is a target. Could be 30, could be 100.
- Story sourcing: which LLMs, what prompts, how much human editing?
- Dictionary size and curation level?
- Do we keep the invertible PRNG path or cut it? (It's a "read the source code" easter egg — cool but niche, and the word-based system makes it harder.)
- Should the player's life story be stylistically consistent with the corpus, or deliberately different (so it stands out)?
- How does "submit" verification work? Exact text match of the player's story page? Or coordinates match (current system)?
