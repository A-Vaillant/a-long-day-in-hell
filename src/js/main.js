/* Entry point — imports all modules, exposes window globals, boots engine. */

import { state } from "./state.js";
import { PRNG } from "./prng.js";
import { Lib } from "./library.js";
import { Book } from "./book.js";
import { LifeStory } from "./lifestory.js";
import { Despair } from "./despairing.js";
import { Surv } from "./survival.js";
import { Tick } from "./tick.js";
import { Events } from "./events.js";
import { Npc } from "./npc.js";
import { Engine, T } from "./engine.js";
import { Chasm } from "./chasm.js";
import { Debug } from "./debug.js";
import { doMove } from "./screens.js";
import "./keybindings.js";

// Expose globals for debug console, shot-scraper, and saved game restore
window.state    = state;
window.PRNG     = PRNG;
window.Lib      = Lib;
window.Book     = Book;
window.LifeStory = LifeStory;
window.Despair  = Despair;
window.Surv     = Surv;
window.Tick     = Tick;
window.Events   = Events;
window.Npc      = Npc;
window.Engine   = Engine;
window.T        = T;
window.Chasm    = Chasm;
window.Debug    = Debug;
window.doMove   = doMove;

// Boot when DOM is ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { Engine.init(); });
} else {
    Engine.init();
}
