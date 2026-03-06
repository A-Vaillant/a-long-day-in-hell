/* Engine — state store, screen router, sidebar, save/load, event delegation,
   boundary registry, batch tick processing. */

import { PRNG } from "./prng.js";
import { seedFromString } from "../../lib/prng.core.js";
import { state } from "./state.js";
import { Lib } from "./library.js";
import { Book } from "./book.js";
import { LifeStory } from "./lifestory.js";
import { Surv } from "./survival.js";
import { Tick } from "./tick.js";
import { Events } from "./events.js";
import { Npc } from "./npc.js";
import { createBoundaryRegistry, processTime } from "../../lib/engine.core.js";

export { state };

const SAVE_KEY = "hell_save";

export function T(value, contextKey) {
    if (!Array.isArray(value)) return value;
    if (value.length === 0) return "";
    if (value.length === 1) return value[0];
    const rng = seedFromString("text:" + (contextKey || ""));
    return value[rng.nextInt(value.length)];
}

export const Engine = {
    _screens: {},
    _actions: {},
    _currentScreen: null,
    _batchMode: false,
    _pendingGoto: null,
    _screenBeforeBatch: null,
    _boundary: createBoundaryRegistry(),

    register(name, fn) {
        this._screens[name] = fn;
    },
    action(name, fn) {
        this._actions[name] = fn;
    },

    /** Register a boundary event handler (lightsOut, resetHour, dawn). */
    onBoundary(event, handler) {
        this._boundary.on(event, handler);
    },

    _inGoto: false,

    goto(name) {
        if (this._batchMode) {
            this._pendingGoto = name;
            return;
        }

        const screen = this._screens[name];
        if (!screen) {
            console.error("Unknown screen:", name);
            return;
        }

        // exit() on old screen
        const oldScreen = this._currentScreen ? this._screens[this._currentScreen] : null;
        if (oldScreen && oldScreen.exit) {
            try { oldScreen.exit(); } catch (e) { console.error("exit() error:", e); }
        }

        this._currentScreen = name;
        state.screen = name;
        if (screen.enter) screen.enter();
        if (state.dead && name !== "Death" && !this._inGoto) {
            if (!state.deathCause) Surv.kill("mortality");
            this._inGoto = true;
            try { return this.goto("Death"); }
            finally { this._inGoto = false; }
        }
        const el = document.getElementById("passage");
        try {
            el.innerHTML = screen.render();
            if (screen.afterRender) screen.afterRender();
            this.updateSidebar();
            if (screen.kind === "state" && name !== "Menu") this.save();
        } catch (err) {
            console.error("Screen render error:", err);
            el.innerHTML = '<p style="color:#9a2a2a">Render error: ' + err.message + '</p>';
        }
    },

    /**
     * Advance time by n ticks, firing boundary handlers.
     * Updates state.tick, state.day, state.lightsOn.
     * Returns the TickResult.
     */
    advanceTime(n) {
        this._batchMode = true;
        this._screenBeforeBatch = this._currentScreen;
        this._pendingGoto = null;

        let result;
        try {
            result = processTime(
                { tick: state.tick, day: state.day },
                n,
                this._boundary,
            );
        } finally {
            this._batchMode = false;
        }

        state.tick = result.finalTick;
        state.day = result.finalDay;
        state.lightsOn = result.finalTick < 160; // LIGHTS_ON_TICKS

        if (this._pendingGoto) {
            const target = this._pendingGoto;
            this._pendingGoto = null;
            // Run exit() on the screen that was active before the batch
            const oldScreen = this._screenBeforeBatch ? this._screens[this._screenBeforeBatch] : null;
            if (oldScreen && oldScreen.exit) {
                try { oldScreen.exit(); } catch (e) { console.error("exit() error:", e); }
            }
            this._screenBeforeBatch = null;
            this.goto(target);
        } else {
            this._screenBeforeBatch = null;
        }

        return result;
    },

    updateSidebar() {
        const cap = document.getElementById("story-caption");
        if (!cap) return;
        if (state.hunger === undefined) { cap.innerHTML = ""; return; }

        let html = '<div id="sidebar-stats">';
        if (!state.lightsOn) html += '<div class="sb-dark">dark</div>';
        html += '<div class="sb-divider"></div>';

        const stats = [
            { label: "hunger",     desc: Surv.describeRising(state.hunger) },
            { label: "thirst",     desc: Surv.describeRising(state.thirst) },
            { label: "exhaustion", desc: Surv.describeRising(state.exhaustion) },
            { label: "morale",     desc: Surv.describeMorale(state.morale) },
        ];
        for (let i = 0; i < stats.length; i++) {
            const st = stats[i];
            const cls = st.desc.level === "max" ? "sb-max" :
                        st.desc.level === "critical" ? "sb-critical" :
                        st.desc.level === "low" ? "sb-low" : "sb-ok";
            html += '<div class="sb-stat ' + cls + '">' +
                '<span class="sb-label">' + st.label + '</span>' +
                '<span class="sb-word">' + st.desc.word + '</span>' +
                '</div>';
        }

        if (Surv.showMortality()) {
            html += '<div class="sb-divider"></div>';
            html += '<div class="sb-condition sb-dying">dying (' + Math.floor(state.mortality) + ')</div>';
        }
        if (state.despairing) {
            html += '<div class="sb-condition sb-despairing">despairing</div>';
        }

        if (state.heldBook !== null) {
            html += '<div class="sb-divider"></div>';
            var bkKey = state.heldBook.side + ":" + state.heldBook.position + ":" + state.heldBook.floor + ":" + state.heldBook.bookIndex;
            var bkName = (state.bookNames && state.bookNames[bkKey]) || "a book";
            html += '<div class="sb-held">' + bkName.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>';
        }

        html += '<div class="sb-divider"></div>';
        html += '<div class="sb-menu"><a id="sidebar-menu">menu <kbd>esc</kbd></a></div>';
        html += '</div>';
        cap.innerHTML = html;

        const menuBtn = document.getElementById("sidebar-menu");
        if (menuBtn) {
            menuBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                var scr = state.screen;
                var cur = Engine._screens[scr];
                if (cur && cur.kind === "transition") {
                    state._menuReturn = "Corridor";
                } else {
                    state._menuReturn = scr;
                }
                Engine.goto("Menu");
            });
        }
    },

    save() {
        try {
            var cur = this._screens[state.screen];
            if (cur && cur.kind === "transition") return; // never save on a transition
            localStorage.setItem(SAVE_KEY, JSON.stringify(state));
        } catch (e) { /* ignore quota errors */ }
    },
    load() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore parse errors */ }
        return null;
    },
    clearSave() {
        localStorage.removeItem(SAVE_KEY);
    },

    init() {
        const params = new URLSearchParams(window.location.search);
        const saved = this.load();
        const isDebugGoto = params.has("vohu");
        const hasSeedParam = params.has("seed");

        if (saved && saved.seed != null && !hasSeedParam && !isDebugGoto) {
            Object.assign(state, saved);
            PRNG.seed(state.seed);
            // Migrate missing fields from older saves
            if (state.mortality === undefined) state.mortality = 100;
            if (state.despairing === undefined) state.despairing = false;
            if (state.deaths === undefined) state.deaths = 0;
            if (state.deathCause === undefined) state.deathCause = null;
            if (state.submissionsAttempted === undefined) state.submissionsAttempted = 0;
            if (state.won === undefined) state.won = false;
            if (!state.eventDeck) Events.init();
            if (!state.npcs) Npc.init();
            state._debugAllowed = false;
            state.debug = false;
        } else {
            const seed = params.get("seed") || String(Math.floor(Math.random() * 0xFFFFFFFF));
            PRNG.seed(seed);

            state.seed     = seed;
            state.side     = 0;
            state.position = 0;
            state.floor    = PRNG.fork("startFloor").nextInt(100000) + 50000;
            state.move     = "";
            state.heldBook    = null;
            state.shelfOffset = 0;
            state.openBook    = null;
            state.openPage    = 0;
            state.debug       = isDebugGoto;
            state._debugAllowed = isDebugGoto;
            state.deaths      = 0;
            state.deathCause  = null;

            const placement = params.get("placement") || "gaussian";
            const startLoc = { side: state.side, position: state.position, floor: state.floor };
            const story = LifeStory.generate(seed, { placement, startLoc });
            state.lifeStory  = story;
            state.targetBook = story.bookCoords;

            Surv.init();
            Tick.init();
            Events.init();
            Npc.init();
        }

        // Register boundary handlers (must happen after subsystem init, before first goto)
        Tick.registerBoundaryHandlers();

        if (state.debug) {
            const ob = params.get("openBook");
            if (ob) {
                const parts = ob.split(",").map(Number);
                state.openBook = { side: parts[0], position: parts[1], floor: parts[2], bookIndex: parts[3] };
                const sp = params.get("spread");
                state.openPage = sp ? Number(sp) : 0;
            }
        }

        let startScreen = "Life Story";
        if (isDebugGoto && state.debug) {
            startScreen = params.get("vohu");
        } else if (saved && saved.seed != null && !hasSeedParam && !isDebugGoto) {
            startScreen = state.screen || "Corridor";
        }

        document.getElementById("passage").addEventListener("click", function (ev) {
            const npcLink = ev.target.closest("[data-npc-id]");
            if (npcLink) {
                ev.preventDefault();
                const npcId = Number(npcLink.getAttribute("data-npc-id"));
                const npc = state.npcs.find(n => n.id === npcId);
                if (npc) {
                    const bubble = document.getElementById("npc-dialogue-" + npcId);
                    if (bubble) { bubble.remove(); return; }
                    const text = Npc.talk(npc);
                    const el = document.createElement("p");
                    el.className = "npc-dialogue";
                    el.id = "npc-dialogue-" + npcId;
                    el.innerHTML = '<em>"' + text.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '"</em>';
                    npcLink.parentNode.appendChild(el);
                }
                return;
            }

            const link = ev.target.closest("[data-goto]");
            if (!link) return;
            ev.preventDefault();
            const actionName = link.getAttribute("data-action");
            if (actionName && Engine._actions[actionName]) {
                Engine._actions[actionName]();
            }
            Engine.goto(link.getAttribute("data-goto"));
        });

        this.goto(startScreen);
    },
};
