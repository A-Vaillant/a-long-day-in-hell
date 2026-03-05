/* LifeStory wrapper — life story generation and formatting. */

import {
    generateLifeStory, formatLifeStory, generateLifeBookPage,
} from "../../lib/lifestory.core.js";

export const LifeStory = {
    generate(seed, opts) { return generateLifeStory(seed, opts); },
    format(story)        { return formatLifeStory(story); },
    bookPage(story, pageIndex) { return generateLifeBookPage(story, pageIndex); },
};
