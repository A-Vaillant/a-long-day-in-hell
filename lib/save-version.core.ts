/** Save format versioning.
 *
 * Bump SAVE_VERSION when state shape changes in a way that makes old
 * saves incompatible (geometry constants, address space, coordinate
 * system, etc.).
 *
 * Saves with version < SAVE_VERSION are rejected on load with a user
 * message. Saves with no version are pre-versioning (version 0).
 *
 * Additive field migrations (new optional fields with defaults) do NOT
 * require a version bump — handle those in the migration block.
 *
 * @module save-version.core
 */

/**
 * Current save format version. Increment on breaking changes.
 *
 * History:
 *   0 — pre-versioning (no _saveVersion field)
 *   1 — BigInt coords, save slots, godmoded flag
 *   2 — scale overhaul: BOOKS_PER_GALLERY 192→12800,
 *       GALLERIES_PER_SEGMENT 10→5, TICKS_PER_HOUR 10→60,
 *       address space recalculated. All coordinates invalidated.
 */
export const SAVE_VERSION: number = 2;

/**
 * Minimum save version that can be migrated forward.
 * Saves below this are irrecoverably incompatible.
 */
export const MIN_COMPATIBLE_VERSION: number = 2;

/**
 * Check whether a loaded save is compatible.
 *
 * @param savedVersion - the _saveVersion from the save (undefined = 0)
 * @returns null if compatible, or an error message string if not
 */
export function checkSaveCompatibility(savedVersion: number | undefined): string | null {
    const v = savedVersion ?? 0;
    if (v >= MIN_COMPATIBLE_VERSION && v <= SAVE_VERSION) return null;
    if (v > SAVE_VERSION) {
        return "This save was created with a newer version of the game. " +
               "It cannot be loaded in this version.";
    }
    return "This save is from an older version of the game and is no longer compatible. " +
           "You'll need to start a new game.";
}
