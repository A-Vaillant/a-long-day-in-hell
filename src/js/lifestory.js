/* SugarCube wrapper for LifeStoryCore — registers setup.LifeStory. */
(function () {
    "use strict";
    const core = window._LifeStoryCore;
    setup.LifeStory = {
        generate(seed) { return core.generateLifeStory(seed); },
        format(story)  { return core.formatLifeStory(story); },
    };
}());
