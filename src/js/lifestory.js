/* LifeStory wrapper — registers window.LifeStory. */
(function () {
    "use strict";
    var core = window._LifeStoryCore;
    window.LifeStory = {
        generate: function (seed, opts) { return core.generateLifeStory(seed, opts); },
        format: function (story)  { return core.formatLifeStory(story); },
        bookPage: function (story, pageIndex) { return core.generateBookPage(story, pageIndex); },
    };
}());
