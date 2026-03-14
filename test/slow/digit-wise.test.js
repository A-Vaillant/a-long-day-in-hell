import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    feistelKey, permute,
    PLAYABLE_ADDRESS_MAX,
} from "../../lib/invertible.core.ts";
import { generateFullStoryBook } from "../../lib/book.core.ts";
import { generatePlayerWorld } from "../../lib/lifestory.core.ts";
import { CHARS_PER_BOOK, CHARS_PER_PAGE, CHARSET_SIZE, PAGES_PER_BOOK } from "../../lib/scale.core.ts";

// These imports will exist once the implementation lands.
// expand: (seed: bigint, offset: number, count: number) => Uint8Array
//   - Returns `count` pseudorandom values in [0, 94], seeded from `seed`,
//     starting at character position `offset`.
// buildOriginPad: (playerBookAddress: bigint, key: Uint32Array) => Uint8Array
//   - Expands permute(playerBookAddress) over all 1,312,000 positions.
// buildPlayerDigits: (storyText: string, fields: StoryFields) => Uint8Array
//   - Materializes the player's full book as digit values (charCode - 32).
// digitWiseBookPage: (address, originPad, playerDigits, key, pageIndex) => string
//   - The unified content function. No branch.
//
// Adjust import names if the implementation uses different names.

// Placeholder: these will be uncommented / adjusted when the implementation exists.
// For now the test file documents every expectation.

import {
    expand,
    buildOriginPad,
    buildPlayerDigits,
    digitWiseBookPage,
} from "../../lib/invertible.core.ts";

const SEED = "digit-wise-test";

// --- Helpers ---

function makeTestContext(seed = SEED) {
    const { playerBookAddress, story } = generatePlayerWorld(seed);
    const fields = {
        name: story.name,
        occupation: story.occupation,
        hometown: story.hometown,
        causeOfDeath: story.causeOfDeath,
    };
    const fullBook = generateFullStoryBook(story.storyText, fields);
    const key = feistelKey(seed);
    const originPad = buildOriginPad(playerBookAddress, key);
    const playerDigits = buildPlayerDigits(story.storyText, fields);
    return { playerBookAddress, story, fields, fullBook, key, originPad, playerDigits };
}

function getExpectedPage(fullBook, pageIndex) {
    return fullBook.slice(pageIndex * CHARS_PER_PAGE, (pageIndex + 1) * CHARS_PER_PAGE);
}

// --- expand() ---

describe("expand", () => {
    it("returns values in [0, 94]", () => {
        const digits = expand(42n, 0, 10000);
        for (let i = 0; i < digits.length; i++) {
            assert.ok(digits[i] >= 0 && digits[i] < CHARSET_SIZE,
                `digit at position ${i} = ${digits[i]}, expected [0, ${CHARSET_SIZE - 1}]`);
        }
    });

    it("is deterministic: same seed + same offset + same count → same output", () => {
        const a = expand(123n, 500, 200);
        const b = expand(123n, 500, 200);
        assert.deepStrictEqual(a, b);
    });

    it("different seeds produce different output", () => {
        const a = expand(100n, 0, 1000);
        const b = expand(200n, 0, 1000);
        let same = 0;
        for (let i = 0; i < 1000; i++) {
            if (a[i] === b[i]) same++;
        }
        // ~1/95 chance per position ≈ ~10.5 expected matches
        assert.ok(same < 50, `${same}/1000 matches between different seeds — expected < 50`);
    });

    it("different offsets from the same seed produce different output", () => {
        const a = expand(42n, 0, 1000);
        const b = expand(42n, 1000, 1000);
        let same = 0;
        for (let i = 0; i < 1000; i++) {
            if (a[i] === b[i]) same++;
        }
        assert.ok(same < 50, `${same}/1000 matches between offset 0 and 1000`);
    });

    it("contiguous calls match: expand(seed, 0, 2000) === concat(expand(seed, 0, 1000), expand(seed, 1000, 1000))", () => {
        const full = expand(42n, 0, 2000);
        const first = expand(42n, 0, 1000);
        const second = expand(42n, 1000, 1000);
        for (let i = 0; i < 1000; i++) {
            assert.strictEqual(full[i], first[i], `mismatch at position ${i}`);
        }
        for (let i = 0; i < 1000; i++) {
            assert.strictEqual(full[1000 + i], second[i], `mismatch at position ${1000 + i}`);
        }
    });

    it("output is roughly uniform over [0, 94]", () => {
        const digits = expand(77n, 0, 95000);
        const counts = new Array(CHARSET_SIZE).fill(0);
        for (let i = 0; i < digits.length; i++) {
            counts[digits[i]]++;
        }
        // Expected: 1000 per bucket. Allow 600–1400.
        for (let d = 0; d < CHARSET_SIZE; d++) {
            assert.ok(counts[d] > 600 && counts[d] < 1400,
                `digit ${d} appeared ${counts[d]} times, expected ~1000`);
        }
    });

    it("handles offset 0 and large offsets", () => {
        // Should not throw for page 409's offset
        const lastPageOffset = 409 * CHARS_PER_PAGE;
        const digits = expand(1n, lastPageOffset, CHARS_PER_PAGE);
        assert.strictEqual(digits.length, CHARS_PER_PAGE);
    });

    it("adjacent permuted seeds produce unrelated sequences", () => {
        const key = feistelKey(SEED);
        const seedA = permute(100n, key);
        const seedB = permute(101n, key);
        const a = expand(seedA, 0, 1000);
        const b = expand(seedB, 0, 1000);
        let same = 0;
        for (let i = 0; i < 1000; i++) {
            if (a[i] === b[i]) same++;
        }
        assert.ok(same < 50, `${same}/1000 matches — Feistel-permuted adjacent seeds should diverge`);
    });
});

// --- buildOriginPad ---

describe("buildOriginPad", () => {
    it("has length CHARS_PER_BOOK", () => {
        const { originPad } = makeTestContext();
        assert.strictEqual(originPad.length, CHARS_PER_BOOK);
    });

    it("all values in [0, 94]", () => {
        const { originPad } = makeTestContext();
        for (let i = 0; i < originPad.length; i++) {
            assert.ok(originPad[i] >= 0 && originPad[i] < CHARSET_SIZE,
                `origin pad digit ${i} = ${originPad[i]}`);
        }
    });

    it("matches expand(permute(playerBookAddress), 0, CHARS_PER_BOOK)", () => {
        const { playerBookAddress, key, originPad } = makeTestContext();
        const permuted = permute(playerBookAddress, key);
        const expected = expand(permuted, 0, CHARS_PER_BOOK);
        assert.deepStrictEqual(originPad, expected);
    });

    it("different seeds produce different pads", () => {
        const a = makeTestContext("pad-seed-a");
        const b = makeTestContext("pad-seed-b");
        let same = 0;
        const check = 10000;
        for (let i = 0; i < check; i++) {
            if (a.originPad[i] === b.originPad[i]) same++;
        }
        assert.ok(same < check * 0.05,
            `${same}/${check} matches between different seeds`);
    });

    it("is deterministic across calls", () => {
        const ctx1 = makeTestContext("pad-determinism");
        const ctx2 = makeTestContext("pad-determinism");
        assert.deepStrictEqual(ctx1.originPad, ctx2.originPad);
    });
});

// --- buildPlayerDigits ---

describe("buildPlayerDigits", () => {
    it("has length CHARS_PER_BOOK", () => {
        const { playerDigits } = makeTestContext();
        assert.strictEqual(playerDigits.length, CHARS_PER_BOOK);
    });

    it("all values in [0, 94]", () => {
        const { playerDigits } = makeTestContext();
        for (let i = 0; i < playerDigits.length; i++) {
            assert.ok(playerDigits[i] >= 0 && playerDigits[i] < CHARSET_SIZE,
                `player digit ${i} = ${playerDigits[i]}`);
        }
    });

    it("matches charCode - 32 of generateFullStoryBook output", () => {
        const { fullBook, playerDigits } = makeTestContext();
        for (let i = 0; i < fullBook.length; i++) {
            const expected = fullBook.charCodeAt(i) - 32;
            assert.strictEqual(playerDigits[i], expected,
                `position ${i}: digit ${playerDigits[i]} !== charCode ${fullBook.charCodeAt(i)} - 32 = ${expected}`);
        }
    });

    it("is deterministic across calls", () => {
        const a = makeTestContext("digits-det");
        const b = makeTestContext("digits-det");
        assert.deepStrictEqual(a.playerDigits, b.playerDigits);
    });
});

// --- digitWiseBookPage: core formula ---

describe("digitWiseBookPage", () => {
    // THE CRITICAL TEST: player's book reproduces exactly
    it("produces the player's book at playerBookAddress, every page", { timeout: 120000 }, () => {
        const ctx = makeTestContext("player-exact");
        // Check every 50th page + first and last
        const pages = [0, 1, 50, 100, 150, 200, 250, 300, 350, 400, 409];
        for (const k of pages) {
            const result = digitWiseBookPage(
                ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, k
            );
            const expected = getExpectedPage(ctx.fullBook, k);
            assert.strictEqual(result.length, CHARS_PER_PAGE,
                `page ${k}: wrong length ${result.length}`);
            assert.strictEqual(result, expected,
                `page ${k}: content mismatch`);
        }
    });

    // Verify the cancellation mechanism character by character
    it("cancellation: expand terms cancel at origin, leaving playerDigit(i)", () => {
        const ctx = makeTestContext("cancellation");
        const permutedOrigin = permute(ctx.playerBookAddress, ctx.key);
        const expandAtOrigin = expand(permutedOrigin, 0, CHARS_PER_PAGE);

        // The origin pad's first page should equal expandAtOrigin
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            assert.strictEqual(ctx.originPad[i], expandAtOrigin[i],
                `origin pad mismatch at position ${i}`);
        }

        // Formula: (expand(permute(addr)) - expand(permute(origin)) + playerDigit) mod 95
        // At addr = origin: expand terms are identical, so result = playerDigit mod 95
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            const result = ((expandAtOrigin[i] - ctx.originPad[i] + ctx.playerDigits[i]) % CHARSET_SIZE + CHARSET_SIZE) % CHARSET_SIZE;
            assert.strictEqual(result, ctx.playerDigits[i],
                `cancellation failed at position ${i}`);
        }
    });

    // No branch — the function should NOT special-case playerBookAddress
    it("uses the same codepath for player and non-player addresses", () => {
        // This is a structural expectation. We verify by checking that the
        // player's book content emerges from the formula, not from a branch.
        // If the implementation has `if (address === playerBookAddress)`, this
        // test still passes — but the design doc says no branch. This test
        // verifies correctness; code review verifies no branch.
        const ctx = makeTestContext("no-branch");
        const page = digitWiseBookPage(
            ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        assert.strictEqual(page, getExpectedPage(ctx.fullBook, 0));
    });
});

// --- digitWiseBookPage: noise properties ---

describe("digitWiseBookPage noise properties", () => {
    it("neighbor (address ± 1) produces different content on every page", () => {
        const ctx = makeTestContext("neighbor-noise");
        for (const k of [0, 205, 409]) {
            const player = digitWiseBookPage(
                ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, k
            );
            const neighbor = digitWiseBookPage(
                ctx.playerBookAddress + 1n, ctx.originPad, ctx.playerDigits, ctx.key, k
            );
            assert.notStrictEqual(neighbor, player,
                `page ${k}: neighbor should differ from player`);
        }
    });

    it("neighbor has noise-level character match rate (~1/95 ≈ 1%)", () => {
        const ctx = makeTestContext("neighbor-match-rate");
        const player = digitWiseBookPage(
            ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        const neighbor = digitWiseBookPage(
            ctx.playerBookAddress + 1n, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        let matching = 0;
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            if (neighbor[i] === player[i]) matching++;
        }
        const rate = matching / CHARS_PER_PAGE;
        // 1/95 ≈ 1.05%. Allow up to 5%.
        assert.ok(rate < 0.05,
            `${(rate * 100).toFixed(1)}% match rate — expected noise (<5%)`);
    });

    it("far address (playerBookAddress + 1,000,000) is noise", () => {
        const ctx = makeTestContext("far-noise");
        const player = digitWiseBookPage(
            ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        const far = digitWiseBookPage(
            ctx.playerBookAddress + 1000000n, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        let matching = 0;
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            if (far[i] === player[i]) matching++;
        }
        const rate = matching / CHARS_PER_PAGE;
        assert.ok(rate < 0.05,
            `${(rate * 100).toFixed(1)}% match — expected noise`);
    });

    it("address 0 produces valid printable ASCII noise", () => {
        const ctx = makeTestContext("addr-zero");
        const page = digitWiseBookPage(
            0n, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        assert.strictEqual(page.length, CHARS_PER_PAGE);
        for (let i = 0; i < page.length; i++) {
            const c = page.charCodeAt(i);
            assert.ok(c >= 32 && c <= 126,
                `char at ${i} = ${c}, outside printable ASCII`);
        }
    });

    it("PLAYABLE_ADDRESS_MAX produces valid printable ASCII noise", () => {
        const ctx = makeTestContext("addr-max");
        const page = digitWiseBookPage(
            PLAYABLE_ADDRESS_MAX, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        assert.strictEqual(page.length, CHARS_PER_PAGE);
        for (let i = 0; i < page.length; i++) {
            const c = page.charCodeAt(i);
            assert.ok(c >= 32 && c <= 126,
                `char at ${i} = ${c}, outside printable ASCII`);
        }
    });
});

// --- Character distribution ---

describe("digitWiseBookPage character distribution", () => {
    it("noise books have roughly uniform character distribution", () => {
        const ctx = makeTestContext("char-dist");
        // Accumulate characters from several noise books
        const counts = new Array(CHARSET_SIZE).fill(0);
        let total = 0;
        for (let offset = 1n; offset <= 10n; offset++) {
            const page = digitWiseBookPage(
                ctx.playerBookAddress + offset, ctx.originPad, ctx.playerDigits, ctx.key, 0
            );
            for (let i = 0; i < page.length; i++) {
                counts[page.charCodeAt(i) - 32]++;
                total++;
            }
        }
        // 10 pages × 3200 chars = 32000 total. Expected per bucket: ~337.
        const expected = total / CHARSET_SIZE;
        let maxDeviation = 0;
        for (let d = 0; d < CHARSET_SIZE; d++) {
            const deviation = Math.abs(counts[d] - expected) / expected;
            if (deviation > maxDeviation) maxDeviation = deviation;
        }
        // Allow 50% deviation from expected (generous for 32k samples)
        assert.ok(maxDeviation < 0.5,
            `max deviation ${(maxDeviation * 100).toFixed(1)}% — distribution not uniform enough`);
    });

    it("all 95 printable ASCII characters appear in noise output", () => {
        const ctx = makeTestContext("all-chars");
        const seen = new Set();
        // Sample enough noise pages to see all 95 characters
        for (let offset = 1n; offset <= 20n; offset++) {
            const page = digitWiseBookPage(
                ctx.playerBookAddress + offset, ctx.originPad, ctx.playerDigits, ctx.key, 0
            );
            for (let i = 0; i < page.length; i++) {
                seen.add(page.charCodeAt(i));
            }
            if (seen.size === CHARSET_SIZE) break;
        }
        assert.strictEqual(seen.size, CHARSET_SIZE,
            `only ${seen.size}/95 characters appeared in noise`);
    });
});

// --- Cross-page properties ---

describe("digitWiseBookPage cross-page behavior", () => {
    it("different pages of the same noise book differ", () => {
        const ctx = makeTestContext("cross-page-diff");
        const addr = ctx.playerBookAddress + 7n;
        const p0 = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 0);
        const p1 = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 1);
        assert.notStrictEqual(p0, p1, "different pages should differ");
    });

    it("different pages of the same noise book have low mutual match rate", () => {
        const ctx = makeTestContext("cross-page-noise");
        const addr = ctx.playerBookAddress + 42n;
        const p0 = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 0);
        const p100 = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 100);
        let matching = 0;
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            if (p0[i] === p100[i]) matching++;
        }
        const rate = matching / CHARS_PER_PAGE;
        assert.ok(rate < 0.05,
            `${(rate * 100).toFixed(1)}% cross-page match — expected noise`);
    });

    it("page 0 and page 409 of the player's book are correct and different", () => {
        const ctx = makeTestContext("player-page-range");
        const p0 = digitWiseBookPage(
            ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        const p409 = digitWiseBookPage(
            ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, 409
        );
        assert.strictEqual(p0, getExpectedPage(ctx.fullBook, 0));
        assert.strictEqual(p409, getExpectedPage(ctx.fullBook, 409));
        assert.notStrictEqual(p0, p409, "first and last pages should differ");
    });

    it("concatenating all pages at playerBookAddress reproduces full book", { timeout: 120000 }, () => {
        const ctx = makeTestContext("full-concat");
        let assembled = "";
        for (let k = 0; k < PAGES_PER_BOOK; k++) {
            assembled += digitWiseBookPage(
                ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, k
            );
        }
        assert.strictEqual(assembled.length, CHARS_PER_BOOK);
        assert.strictEqual(assembled, ctx.fullBook,
            "reassembled pages must exactly match generateFullStoryBook output");
    });
});

// --- Determinism ---

describe("digitWiseBookPage determinism", () => {
    it("same address + same page is deterministic", () => {
        const ctx = makeTestContext("determinism");
        const addr = ctx.playerBookAddress + 99n;
        const a = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 5);
        const b = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 5);
        assert.strictEqual(a, b);
    });

    it("deterministic across fresh context rebuilds", () => {
        const ctx1 = makeTestContext("det-rebuild");
        const ctx2 = makeTestContext("det-rebuild");
        const addr = ctx1.playerBookAddress + 13n;
        const a = digitWiseBookPage(addr, ctx1.originPad, ctx1.playerDigits, ctx1.key, 3);
        const b = digitWiseBookPage(addr, ctx2.originPad, ctx2.playerDigits, ctx2.key, 3);
        assert.strictEqual(a, b);
    });
});

// --- Different seeds ---

describe("digitWiseBookPage seed independence", () => {
    it("different game seeds produce different player books", () => {
        const ctxA = makeTestContext("seed-indep-a");
        const ctxB = makeTestContext("seed-indep-b");
        const pageA = digitWiseBookPage(
            ctxA.playerBookAddress, ctxA.originPad, ctxA.playerDigits, ctxA.key, 0
        );
        const pageB = digitWiseBookPage(
            ctxB.playerBookAddress, ctxB.originPad, ctxB.playerDigits, ctxB.key, 0
        );
        assert.notStrictEqual(pageA, pageB, "different seeds should produce different books");
    });

    it("different game seeds produce different noise at the same address", () => {
        const ctxA = makeTestContext("seed-noise-a");
        const ctxB = makeTestContext("seed-noise-b");
        // Use address 1000 (not playerBookAddress) for both
        const pageA = digitWiseBookPage(1000n, ctxA.originPad, ctxA.playerDigits, ctxA.key, 0);
        const pageB = digitWiseBookPage(1000n, ctxB.originPad, ctxB.playerDigits, ctxB.key, 0);
        assert.notStrictEqual(pageA, pageB);
    });
});

// --- Output format ---

describe("digitWiseBookPage output format", () => {
    it("returns exactly CHARS_PER_PAGE characters", () => {
        const ctx = makeTestContext("format");
        for (const addr of [ctx.playerBookAddress, ctx.playerBookAddress + 1n, 0n]) {
            for (const k of [0, 205, 409]) {
                const page = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, k);
                assert.strictEqual(page.length, CHARS_PER_PAGE,
                    `addr=${addr}, page=${k}: length ${page.length} !== ${CHARS_PER_PAGE}`);
            }
        }
    });

    it("contains only printable ASCII [32, 126] for player and noise books", () => {
        const ctx = makeTestContext("printable");
        const addrs = [
            ctx.playerBookAddress,
            ctx.playerBookAddress + 1n,
            ctx.playerBookAddress + 999999n,
            0n,
            PLAYABLE_ADDRESS_MAX,
        ];
        for (const addr of addrs) {
            const page = digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 0);
            for (let i = 0; i < page.length; i++) {
                const c = page.charCodeAt(i);
                assert.ok(c >= 32 && c <= 126,
                    `addr=${addr}, position ${i}: char ${c} outside printable range`);
            }
        }
    });

    it("no newlines in output (flat character stream)", () => {
        const ctx = makeTestContext("no-newlines");
        const page = digitWiseBookPage(
            ctx.playerBookAddress, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        assert.ok(!page.includes("\n"), "page should not contain newlines");
    });
});

// --- Performance ---

describe("digitWiseBookPage performance", () => {
    it("renders a single page in under 10ms", () => {
        const ctx = makeTestContext("perf");
        const addr = ctx.playerBookAddress + 42n;

        // Warm up
        digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 0);

        const t0 = performance.now();
        const iterations = 100;
        for (let i = 0; i < iterations; i++) {
            digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, i % PAGES_PER_BOOK);
        }
        const elapsed = (performance.now() - t0) / iterations;
        console.log(`  digitWiseBookPage avg: ${elapsed.toFixed(2)}ms`);
        assert.ok(elapsed < 10, `${elapsed.toFixed(2)}ms per page — expected <10ms`);
    });

    it("page 0 and page 409 have similar render time (seekable)", () => {
        const ctx = makeTestContext("perf-seek");
        const addr = ctx.playerBookAddress + 42n;

        // Warm up
        digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 0);
        digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 409);

        const iterations = 50;

        const t0 = performance.now();
        for (let i = 0; i < iterations; i++) {
            digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 0);
        }
        const time0 = (performance.now() - t0) / iterations;

        const t1 = performance.now();
        for (let i = 0; i < iterations; i++) {
            digitWiseBookPage(addr, ctx.originPad, ctx.playerDigits, ctx.key, 409);
        }
        const time409 = (performance.now() - t1) / iterations;

        console.log(`  page 0: ${time0.toFixed(2)}ms, page 409: ${time409.toFixed(2)}ms`);
        // Page 409 should not be dramatically slower than page 0.
        // If using sequential PRNG with skip, allow up to 10x. If seekable, should be ~equal.
        assert.ok(time409 < time0 * 10,
            `page 409 (${time409.toFixed(2)}ms) more than 10x slower than page 0 (${time0.toFixed(2)}ms)`);
    });

    it("buildOriginPad completes in under 50ms", () => {
        const { playerBookAddress } = generatePlayerWorld("perf-origin-pad");
        const key = feistelKey("perf-origin-pad");

        const t0 = performance.now();
        buildOriginPad(playerBookAddress, key);
        const elapsed = performance.now() - t0;
        console.log(`  buildOriginPad: ${elapsed.toFixed(1)}ms`);
        assert.ok(elapsed < 50, `${elapsed.toFixed(1)}ms — expected <50ms`);
    });

    it("buildPlayerDigits completes in under 200ms", { timeout: 30000 }, () => {
        const { story } = generatePlayerWorld("perf-player-digits");
        const fields = {
            name: story.name, occupation: story.occupation,
            hometown: story.hometown, causeOfDeath: story.causeOfDeath,
        };

        const t0 = performance.now();
        buildPlayerDigits(story.storyText, fields);
        const elapsed = performance.now() - t0;
        console.log(`  buildPlayerDigits: ${elapsed.toFixed(1)}ms`);
        assert.ok(elapsed < 200, `${elapsed.toFixed(1)}ms — expected <200ms`);
    });
});

// --- Edge cases ---

describe("digitWiseBookPage edge cases", () => {
    it("page index 0 is valid", () => {
        const ctx = makeTestContext("edge-page0");
        const page = digitWiseBookPage(
            ctx.playerBookAddress + 1n, ctx.originPad, ctx.playerDigits, ctx.key, 0
        );
        assert.strictEqual(page.length, CHARS_PER_PAGE);
    });

    it("page index 409 (last page) is valid", () => {
        const ctx = makeTestContext("edge-page409");
        const page = digitWiseBookPage(
            ctx.playerBookAddress + 1n, ctx.originPad, ctx.playerDigits, ctx.key, 409
        );
        assert.strictEqual(page.length, CHARS_PER_PAGE);
    });

    it("two addresses that permute to adjacent values still produce unrelated content", () => {
        const ctx = makeTestContext("permute-adjacent");
        // Find two addresses whose permuted values are adjacent
        // (We can't easily guarantee this, so instead verify that the formula
        // works correctly even when permuted values happen to be close)
        const addr1 = ctx.playerBookAddress + 100n;
        const addr2 = ctx.playerBookAddress + 200n;
        const p1 = digitWiseBookPage(addr1, ctx.originPad, ctx.playerDigits, ctx.key, 0);
        const p2 = digitWiseBookPage(addr2, ctx.originPad, ctx.playerDigits, ctx.key, 0);
        assert.notStrictEqual(p1, p2);
    });

    it("works when playerBookAddress is 0", { timeout: 60000 }, () => {
        // Construct a scenario where playerBookAddress = 0 (edge case for permutation)
        // We can't easily force generatePlayerWorld to produce 0, so we test
        // the function directly with a synthetic origin pad
        const key = feistelKey("edge-zero-origin");
        const originPad = expand(permute(0n, key), 0, CHARS_PER_BOOK);
        // Use arbitrary player digits
        const playerDigits = new Uint8Array(CHARS_PER_BOOK);
        for (let i = 0; i < CHARS_PER_BOOK; i++) {
            playerDigits[i] = i % CHARSET_SIZE;
        }

        const page = digitWiseBookPage(0n, originPad, playerDigits, key, 0);
        assert.strictEqual(page.length, CHARS_PER_PAGE);
        // At address 0 with this originPad, the expand terms cancel → playerDigits
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            const expected = String.fromCharCode(32 + playerDigits[i]);
            assert.strictEqual(page[i], expected,
                `position ${i}: expected '${expected}', got '${page[i]}'`);
        }
    });

    it("works when playerBookAddress is PLAYABLE_ADDRESS_MAX", { timeout: 60000 }, () => {
        const key = feistelKey("edge-max-origin");
        const originPad = expand(permute(PLAYABLE_ADDRESS_MAX, key), 0, CHARS_PER_BOOK);
        const playerDigits = new Uint8Array(CHARS_PER_BOOK);
        for (let i = 0; i < CHARS_PER_BOOK; i++) {
            playerDigits[i] = (i * 7) % CHARSET_SIZE;
        }

        const page = digitWiseBookPage(PLAYABLE_ADDRESS_MAX, originPad, playerDigits, key, 0);
        assert.strictEqual(page.length, CHARS_PER_PAGE);
        // Cancellation should work at the boundary too
        for (let i = 0; i < CHARS_PER_PAGE; i++) {
            const expected = String.fromCharCode(32 + playerDigits[i]);
            assert.strictEqual(page[i], expected,
                `position ${i}: cancellation failed at PLAYABLE_ADDRESS_MAX`);
        }
    });
});
