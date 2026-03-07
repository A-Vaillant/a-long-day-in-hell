/* Library wrapper — segment generation and movement. */

import {
    DIRS, BOTTOM_FLOOR, BOOKS_PER_GALLERY, GALLERIES_PER_SEGMENT,
    isRestArea, locationKey, generateSegment, availableMoves, applyMove,
    describeLocation,
} from "../../lib/library.core.ts";
import { PRNG } from "./prng.js";

const _cache = {};

export const Lib = {
    getSegment(side, position, floor) {
        const key = locationKey({ side, position, floor });
        if (!_cache[key]) {
            _cache[key] = generateSegment(side, position, floor, k => PRNG.fork(k));
        }
        return _cache[key];
    },

    availableMoves(loc)   { return availableMoves(loc); },
    applyMove(loc, dir)   { return applyMove(loc, dir); },
    describeLocation(loc) { return describeLocation(loc); },

    DIRS,
    BOTTOM_FLOOR,
    BOOKS_PER_GALLERY,
    GALLERIES_PER_SEGMENT,
    isRestArea,

    debugSegment(side, position, floor) {
        const s = this.getSegment(side, position, floor);
        const moves = availableMoves({ side, position, floor });
        return "Segment [side:" + side + ", pos:" + position + ", floor:" + floor + "]\n" +
            "Light: " + s.lightLevel + "\n" +
            "Bridge: " + s.hasBridge + "\n" +
            "Available moves: " + moves.join(", ");
    },
};
