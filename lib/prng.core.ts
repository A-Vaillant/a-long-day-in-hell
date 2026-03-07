/** Seeded PRNG: xoshiro128**
 * Pure ES module — no SugarCube dependency. Importable by tests and the SC wrapper.
 *
 * @module prng.core
 */

/** A xoshiro128** PRNG instance. */
export interface Xoshiro128ss {
    /** Return a float in [0, 1). */
    next(): number;
    /** Return an integer in [0, n). */
    nextInt(n: number): number;
    /** Fork a new independent PRNG seeded by `key` and current state. */
    fork(key: string): Xoshiro128ss;
}

/** MurmurHash3 finalizer — hashes a string to a uint32. */
export function hash(str: string): number {
    let h = 0xdeadbeef;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9);
    }
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}

/** Create a xoshiro128** PRNG from four uint32 state values. */
export function makeXoshiro128ss(a: number, b: number, c: number, d: number): Xoshiro128ss {
    let s0 = a, s1 = b, s2 = c, s3 = d;
    return {
        next(): number {
            const t = s1 << 9;
            let r = s1 * 5;
            r = ((r << 7) | (r >>> 25)) * 9;
            s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
            s2 ^= t;
            s3 = (s3 << 11) | (s3 >>> 21);
            return (r >>> 0) / 0x100000000;
        },
        nextInt(n: number): number {
            return Math.floor(this.next() * n);
        },
        fork(key: string): Xoshiro128ss {
            const s = hash(key + String(this.nextInt(0xffffffff)));
            return makeXoshiro128ss(
                hash("a" + s), hash("b" + s),
                hash("c" + s), hash("d" + s)
            );
        }
    };
}

/** Seed a PRNG from a string. */
export function seedFromString(str: string): Xoshiro128ss {
    return makeXoshiro128ss(
        hash(str + "a"), hash(str + "b"),
        hash(str + "c"), hash(str + "d")
    );
}
