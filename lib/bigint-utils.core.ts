/** BigInt utility functions.
 *
 * Replacements for Math.abs, Math.max, Math.min, Math.sign which
 * don't work on BigInt in JavaScript.
 *
 * @module bigint-utils.core
 */

export function bigAbs(x: bigint): bigint { return x < 0n ? -x : x; }
export function bigMax(...args: bigint[]): bigint { return args.reduce((a, b) => a > b ? a : b); }
export function bigMin(...args: bigint[]): bigint { return args.reduce((a, b) => a < b ? a : b); }
export function bigSign(x: bigint): bigint { return x > 0n ? 1n : x < 0n ? -1n : 0n; }

/** Round a bigint to the nearest multiple of n (round half up). */
export function bigRound(x: bigint, n: bigint): bigint {
    const r = ((x % n) + n) % n;
    return r * 2n >= n ? x - r + n : x - r;
}
