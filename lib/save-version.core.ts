/** Save format versioning (major.minor).
 *
 * Major: breaking changes (geometry, address space, coordinate system).
 *   Different major = incompatible, save rejected.
 *
 * Minor: additive changes (new fields with defaults, retuned rates).
 *   Same major, older minor = run migrations forward. Newer minor = fine
 *   (new code just ignores fields it doesn't know about).
 *
 * Saves with no _saveVersion are pre-versioning (0.0).
 *
 * @module save-version.core
 */

export interface SaveVersion {
    major: number;
    minor: number;
}

/**
 * Current save format version.
 *
 * History:
 *   0.0 — pre-versioning (no _saveVersion field)
 *   1.0 — BigInt coords, save slots, godmoded flag
 *   2.0 — scale overhaul: BOOKS_PER_GALLERY 192→12800,
 *         GALLERIES_PER_SEGMENT 10→5, TICKS_PER_HOUR 10→60,
 *         address space recalculated. All coordinates invalidated.
 */
export const SAVE_VERSION: SaveVersion = { major: 2, minor: 0 };

/**
 * Parse a saved version. Pre-versioning saves have no field (→ 0.0).
 * Accepts the old single-number format (→ { major: n, minor: 0 }).
 */
export function parseSaveVersion(raw: unknown): SaveVersion {
    if (raw == null) return { major: 0, minor: 0 };
    if (typeof raw === "number") return { major: raw, minor: 0 };
    if (typeof raw === "object" && "major" in (raw as object)) {
        const obj = raw as Record<string, unknown>;
        return {
            major: typeof obj.major === "number" ? obj.major : 0,
            minor: typeof obj.minor === "number" ? obj.minor : 0,
        };
    }
    return { major: 0, minor: 0 };
}

/**
 * Check whether a loaded save is compatible.
 *
 * @param raw - the _saveVersion from the save (undefined, number, or {major,minor})
 * @returns null if compatible, or an error message string if not
 */
export function checkSaveCompatibility(raw: unknown): string | null {
    const v = parseSaveVersion(raw);
    if (v.major === SAVE_VERSION.major) return null;
    if (v.major > SAVE_VERSION.major) {
        return "This save was created with a newer version of the game. " +
               "It cannot be loaded in this version.";
    }
    return "This save is from an older version of the game and is no longer compatible. " +
           "You'll need to start a new game.";
}

/**
 * Whether a loaded save needs minor migrations applied.
 * True when same major but older minor.
 */
export function needsMigration(raw: unknown): boolean {
    const v = parseSaveVersion(raw);
    return v.major === SAVE_VERSION.major && v.minor < SAVE_VERSION.minor;
}

/**
 * Get the minor version of a loaded save (for migration switch/case).
 */
export function savedMinor(raw: unknown): number {
    return parseSaveVersion(raw).minor;
}
