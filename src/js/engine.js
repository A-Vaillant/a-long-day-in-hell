/* Engine — state store, screen router, sidebar, save/load, event delegation. */

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

    register(name, fn) {
        this._screens[name] = fn;
    },
    action(name, fn) {
        this._actions[name] = fn;
    },

    _inGoto: false,

    goto(name) {
        const screen = this._screens[name];
        if (!screen) {
            console.error("Unknown screen:", name);
            return;
        }
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
            if (name !== "Menu") this.save();
        } catch (err) {
            console.error("Screen render error:", err);
            el.innerHTML = '<p style="color:#9a2a2a">Render error: ' + err.message + '</p>';
        }
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
            html += '<div class="sb-held">book #' + (state.heldBook.bookIndex + 1) + '</div>';
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
                var KIOSK_SUBS = ["Kiosk Get Drink", "Kiosk Get Food", "Kiosk Get Alcohol"];
                var TRANSIENT = ["Wait", "Sleep", "Submission Attempt", "Chasm", "Falling"].concat(KIOSK_SUBS);
                if (KIOSK_SUBS.indexOf(scr) !== -1) state._menuReturn = "Kiosk";
                else if (TRANSIENT.indexOf(scr) !== -1) state._menuReturn = "Corridor";
                else state._menuReturn = scr;
                Engine.goto("Menu");
            });
        }
    },

    save() {
        try {
            var KIOSK_SUBS = ["Kiosk Get Drink", "Kiosk Get Food", "Kiosk Get Alcohol"];
            var TRANSIENT = ["Wait", "Sleep", "Submission Attempt", "Chasm", "Falling"].concat(KIOSK_SUBS);
            var savedScreen = state.screen;
            if (KIOSK_SUBS.indexOf(state.screen) !== -1) state.screen = "Kiosk";
            else if (TRANSIENT.indexOf(state.screen) !== -1) state.screen = "Corridor";
            localStorage.setItem(SAVE_KEY, JSON.stringify(state));
            state.screen = savedScreen;
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
