/* LifeStory wrapper — life story generation and formatting. */

import {
    generateLifeStory, generatePlayerWorld, formatLifeStory, distanceToBook,
} from "../../lib/lifestory.core.ts";

export const LifeStory = {
    generate(seed, opts) { return generateLifeStory(seed, opts); },
    generatePlayerWorld(seed, opts) { return generatePlayerWorld(seed, opts); },
    format(story)        { return formatLifeStory(story); },
    distanceToBook(loc, book) { return distanceToBook(loc, book); },
};
