import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    SAVE_VERSION, parseSaveVersion, checkSaveCompatibility,
    needsMigration, savedMinor, featureFlags,
} from "../lib/save-version.core.ts";

describe("parseSaveVersion", () => {
    it("null/undefined → {release:0, major:0, minor:0}", () => {
        assert.deepStrictEqual(parseSaveVersion(null), { release: 0, major: 0, minor: 0 });
        assert.deepStrictEqual(parseSaveVersion(undefined), { release: 0, major: 0, minor: 0 });
    });

    it("bare number (pre-release format) → {release:0, major:n, minor:0}", () => {
        assert.deepStrictEqual(parseSaveVersion(1), { release: 0, major: 1, minor: 0 });
        assert.deepStrictEqual(parseSaveVersion(2), { release: 0, major: 2, minor: 0 });
    });

    it("old {major, minor} object gets release:0", () => {
        assert.deepStrictEqual(parseSaveVersion({ major: 3, minor: 0 }), { release: 0, major: 3, minor: 0 });
    });

    it("full {release, major, minor} round-trips", () => {
        const v = { release: 1, major: 5, minor: 2 };
        assert.deepStrictEqual(parseSaveVersion(v), v);
    });

    it("garbage input → {release:0, major:0, minor:0}", () => {
        assert.deepStrictEqual(parseSaveVersion("hello"), { release: 0, major: 0, minor: 0 });
        assert.deepStrictEqual(parseSaveVersion(true), { release: 0, major: 0, minor: 0 });
    });
});

describe("checkSaveCompatibility", () => {
    it("current version is compatible", () => {
        assert.strictEqual(checkSaveCompatibility(SAVE_VERSION), null);
    });

    it("same release+major, older minor is compatible", () => {
        assert.strictEqual(
            checkSaveCompatibility({ release: SAVE_VERSION.release, major: SAVE_VERSION.major, minor: 0 }),
            null
        );
    });

    it("different release rejects", () => {
        const older = { release: SAVE_VERSION.release - 1, major: SAVE_VERSION.major, minor: 0 };
        assert.ok(checkSaveCompatibility(older) !== null, "older release should be rejected");
        const newer = { release: SAVE_VERSION.release + 1, major: SAVE_VERSION.major, minor: 0 };
        assert.ok(checkSaveCompatibility(newer) !== null, "newer release should be rejected");
    });

    it("older major (same release) rejects", () => {
        const v = { release: SAVE_VERSION.release, major: SAVE_VERSION.major - 1, minor: 0 };
        assert.ok(checkSaveCompatibility(v) !== null);
    });

    it("newer major (same release) rejects", () => {
        const v = { release: SAVE_VERSION.release, major: SAVE_VERSION.major + 1, minor: 0 };
        assert.ok(checkSaveCompatibility(v) !== null);
    });

    it("null (pre-versioning) rejects", () => {
        assert.ok(checkSaveCompatibility(null) !== null);
    });

    it("bare number from old format rejects if major differs", () => {
        assert.ok(checkSaveCompatibility(1) !== null);
    });
});

describe("needsMigration", () => {
    it("same major, older minor needs migration", () => {
        if (SAVE_VERSION.minor > 0) {
            const v = { release: SAVE_VERSION.release, major: SAVE_VERSION.major, minor: SAVE_VERSION.minor - 1 };
            assert.strictEqual(needsMigration(v), true);
        }
    });

    it("same major+minor does not need migration", () => {
        assert.strictEqual(needsMigration(SAVE_VERSION), false);
    });

    it("different major does not need migration (rejected outright)", () => {
        assert.strictEqual(needsMigration({ release: SAVE_VERSION.release, major: SAVE_VERSION.major - 1, minor: 0 }), false);
    });
});

describe("savedMinor", () => {
    it("extracts minor from object", () => {
        assert.strictEqual(savedMinor({ major: 3, minor: 7 }), 7);
    });

    it("returns 0 for null", () => {
        assert.strictEqual(savedMinor(null), 0);
    });

    it("returns 0 for bare number", () => {
        assert.strictEqual(savedMinor(2), 0);
    });
});

describe("SAVE_VERSION shape", () => {
    it("has release, major, and minor fields", () => {
        assert.strictEqual(typeof SAVE_VERSION.release, "number");
        assert.strictEqual(typeof SAVE_VERSION.major, "number");
        assert.strictEqual(typeof SAVE_VERSION.minor, "number");
    });

    it("minor is at least 1 (post-release-field)", () => {
        assert.ok(SAVE_VERSION.minor >= 1);
    });
});

describe("featureFlags", () => {
    it("current version enables digitWiseBooks", () => {
        assert.strictEqual(featureFlags(SAVE_VERSION).digitWiseBooks, true);
    });

    it("pre-3.2 saves disable digitWiseBooks", () => {
        assert.strictEqual(featureFlags({ release: 0, major: 3, minor: 1 }).digitWiseBooks, false);
        assert.strictEqual(featureFlags({ release: 0, major: 3, minor: 0 }).digitWiseBooks, false);
        assert.strictEqual(featureFlags({ release: 0, major: 2, minor: 0 }).digitWiseBooks, false);
        assert.strictEqual(featureFlags(null).digitWiseBooks, false);
    });

    it("3.2+ saves enable digitWiseBooks", () => {
        assert.strictEqual(featureFlags({ release: 0, major: 3, minor: 2 }).digitWiseBooks, true);
        assert.strictEqual(featureFlags({ release: 0, major: 3, minor: 3 }).digitWiseBooks, true);
    });
});
