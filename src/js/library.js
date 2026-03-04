/* SugarCube wrapper for library.core — registers setup.Library. */

(function () {
    "use strict";

    const core = window._LibraryCore;

    setup.Library = {
        _cache: {},

        getSegment(side, position, floor) {
            const key = core.locationKey({ side, position, floor });
            if (!this._cache[key]) {
                this._cache[key] = core.generateSegment(
                    side, position, floor,
                    k => setup.PRNG.fork(k)
                );
            }
            return this._cache[key];
        },

        availableMoves(loc)     { return core.availableMoves(loc); },
        applyMove(loc, dir)     { return core.applyMove(loc, dir); },
        describeLocation(loc)   { return core.describeLocation(loc); },

        DIRS: core.DIRS,
        BOTTOM_FLOOR: core.BOTTOM_FLOOR,

        debugSegment(side, position, floor) {
            const s = this.getSegment(side, position, floor);
            const moves = core.availableMoves({ side, position, floor });
            return [
                `Segment [side:${side}, pos:${position}, floor:${floor}]`,
                `Light: ${s.lightLevel}`,
                `Bridge: ${s.hasBridge}`,
                `Available moves: ${moves.join(", ")}`,
            ].join("\n");
        }
    };
}());
