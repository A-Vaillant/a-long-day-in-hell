/* PRNG wrapper — seeded xoshiro128** with fork support. */

import { seedFromString } from "../../lib/prng.core.ts";

let _rng = null;
let _seed = null;

function assertSeeded() {
    if (!_rng) throw new Error("PRNG not seeded — call PRNG.seed() first");
}

export const PRNG = {
    seed(s) {
        _seed = String(s);
        _rng = seedFromString(_seed);
    },
    next()      { assertSeeded(); return _rng.next(); },
    nextInt(n)  { assertSeeded(); return _rng.nextInt(n); },
    fork(key)   { assertSeeded(); return _rng.fork(key); },
    getSeed()   { return _seed; },
};
