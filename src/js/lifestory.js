/* LifeStory wrapper — life story generation and formatting. */

import {
    generateLifeStory, formatLifeStory,
} from "../../lib/lifestory.core.ts";

export const LifeStory = {
    generate(seed, opts) { return generateLifeStory(seed, opts); },
    format(story)        { return formatLifeStory(story); },
};
