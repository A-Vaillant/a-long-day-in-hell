/** Seeded PRNG: xoshiro128**
 * Pure ES module — no SugarCube dependency. Importable by tests and the SC wrapper.
 *
 * @module prng.core
 */

/** MurmurHash3 finalizer — hashes a string to a uint32. */
export function hash(str) {
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
export function makeXoshiro128ss(a, b, c, d) {
    let s0 = a, s1 = b, s2 = c, s3 = d;
    return {
        next() {
            const t = s1 << 9;
            let r = s1 * 5;
            r = ((r << 7) | (r >>> 25)) * 9;
            s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
            s2 ^= t;
            s3 = (s3 << 11) | (s3 >>> 21);
            return (r >>> 0) / 0x100000000;
        },
        nextInt(n) {
            return Math.floor(this.next() * n);
        },
        fork(key) {
            const s = hash(key + String(this.nextInt(0xffffffff)));
            return makeXoshiro128ss(
                hash("a" + s), hash("b" + s),
                hash("c" + s), hash("d" + s)
            );
        }
    };
}

/** Seed a PRNG from a string. */
export function seedFromString(str) {
    return makeXoshiro128ss(
        hash(str + "a"), hash(str + "b"),
        hash(str + "c"), hash(str + "d")
    );
}
