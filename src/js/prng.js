/* SugarCube wrapper for prng.core — registers setup.PRNG.
 *
 * Usage:
 *   setup.PRNG.seed("my-seed");
 *   setup.PRNG.next()        → float [0,1)
 *   setup.PRNG.nextInt(n)    → int [0,n)
 *   setup.PRNG.fork("key")   → child PRNG
 *   setup.PRNG.getSeed()     → string
 */

/* global setup */
/* NOTE: prng.core.js is concatenated before this file by tweego (alphabetical).
 * We re-expose its exports via a local alias injected at build time.
 * For SugarCube we can't use ES module import syntax, so core functions are
 * bundled as a plain IIFE that sets window._PRNGCore. See prng.core.sc.js.
 */

(function () {
    "use strict";

    setup.PRNG = {
        _rng:  null,
        _seed: null,

        seed(s) {
            this._seed = String(s);
            this._rng  = window._PRNGCore.seedFromString(this._seed);
        },

        next()       { this._assertSeeded(); return this._rng.next(); },
        nextInt(n)   { this._assertSeeded(); return this._rng.nextInt(n); },
        fork(key)    { this._assertSeeded(); return this._rng.fork(key); },
        getSeed()    { return this._seed; },

        _assertSeeded() {
            if (!this._rng) throw new Error("PRNG not seeded — call setup.PRNG.seed() first");
        }
    };
}());
