/* LifeStory wrapper — life story generation and formatting. */

import {
    generateLifeStory, formatLifeStory, generateBookPage,
} from "../../lib/lifestory.core.js";

export const LifeStory = {
    generate(seed, opts) { return generateLifeStory(seed, opts); },
    format(story)        { return formatLifeStory(story); },
    bookPage(story, pageIndex) { return generateBookPage(story, pageIndex); },
};
