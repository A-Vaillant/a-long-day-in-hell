/* Engine — state store, screen router, sidebar, save/load, event delegation,
   boundary registry, batch tick processing. */

import { PRNG } from "./prng.js";
import { seedFromString } from "../../lib/prng.core.ts";
import { state } from "./state.js";
import { Lib } from "./library.js";
import { Book } from "./book.js";
import { LifeStory } from "./lifestory.js";
import { Surv } from "./survival.js";
import { Tick } from "./tick.js";
import { Events } from "./events.js";
import { Npc } from "./npc.js";
import { Social } from "./social.js";
import { LIGHTS_ON_TICKS } from "../../lib/tick.core.ts";
import { createBoundaryRegistry, processTime } from "../../lib/engine.core.ts";
import { Godmode } from "./godmode.js";
import { saveLog, loadLog, clearLog, count as logCount } from "./event-log.js";
import * as Slots from "./save-slots.js";
import { SAVE_VERSION, checkSaveCompatibility, needsMigration, savedMinor, parseSaveVersion, featureFlags } from "../../lib/save-version.core.ts";
import { feistelKey, buildOriginPad, buildPlayerDigits, coordsToAddress } from "../../lib/invertible.core.ts";

export { state };

const SAVE_KEY = "hell_save"; // legacy — kept for jsonReplacer/Reviver reuse only

// Transient state fields — recomputed on load, never persisted.
const TRANSIENT_KEYS = new Set([
    "_featureFlags", "_feistelKey", "_originPad", "_playerDigits",
]);

function jsonReplacer(key, value) {
    if (TRANSIENT_KEYS.has(key)) return undefined;
    if (typeof value === 'bigint') return { __bigint: value.toString() };
    if (value instanceof Set) return { __set: Array.from(value) };
    if (value instanceof Map) return { __map: Array.from(value.entries()) };
    return value;
}
function jsonReviver(key, value) {
    if (value && typeof value === 'object') {
        if ('__bigint' in value) return BigInt(value.__bigint);
        if ('__set' in value) return new Set(value.__set);
        if ('__map' in value) return new Map(value.__map);
    }
    return value;
}

export function T(value, contextKey) {
    if (!Array.isArray(value)) return value;
    if (value.length === 0) return "";
    if (value.length === 1) return value[0];
    const rng = seedFromString("text:" + (contextKey || ""));
    return value[rng.nextInt(value.length)];
}

/**
 * Combinatorial text generation — mad-libs style.
 * Picks a template, then fills {slot} placeholders from pools.
 * Deterministic: same contextKey always produces the same result.
 *
 * @param {object} def - { templates: string[], pools: { [slot]: string[] } }
 * @param {string} contextKey - seed for deterministic selection
 * @returns {string}
 */
export function Madlib(def, contextKey) {
    if (!def || !def.templates || !def.templates.length) return "";
    const rng = seedFromString("madlib:" + (contextKey || ""));
    const template = def.templates[rng.nextInt(def.templates.length)];
    return template.replace(/\{(\w+)\}/g, function (_match, slot) {
        const pool = def.pools && def.pools[slot];
        if (!pool || !pool.length) return "{" + slot + "}";
        return pool[rng.nextInt(pool.length)];
    });
}

let _preSaveHooks = [];

export const Engine = {
    _screens: {},
    _actions: {},
    _currentScreen: null,
    _batchMode: false,
    _pendingGoto: null,
    _screenBeforeBatch: null,
    _boundary: createBoundaryRegistry(),
    _sidebarActions: [], // { label, key, screen } — rendered in sb-actions, handled by keybindings

    register(name, fn) {
        this._screens[name] = fn;
    },

    /**
     * Register a sidebar action button. Rendered automatically in the sidebar
     * and dispatched by keybindings. Call from the screen's own module.
     * @param {{ label: string, key: string, screen: string }} entry
     */
    registerSidebarAction(entry) {
        this._sidebarActions.push(entry);
    },
    action(name, fn) {
        this._actions[name] = fn;
    },

    /** Register a callback to run before every save (e.g. ECS export). */
    onBeforeSave(fn) {
        _preSaveHooks.push(fn);
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

        state._lastScreen = this._currentScreen || null;
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
        state.lightsOn = result.finalTick < LIGHTS_ON_TICKS;

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
        html += '<div class="sb-day">DAY ' + String(state.day).padStart(7, '0') + '</div>';
        // Time-of-day indicator
        var timeStr = Tick.getTimeString();
        if (state.tick >= 1380) {
            html += '<div class="sb-sleeping-hour">the sleeping hour</div>';
        } else if (!state.lightsOn) {
            html += '<div class="sb-dark">dark</div>';
        } else if (state.tick >= 900) {
            html += '<div class="sb-time sb-dusk">' + timeStr + '</div>';
        } else {
            html += '<div class="sb-time">' + timeStr + '</div>';
        }
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

        var group = Social.getGroupMembers();
        if (group.length > 0) {
            html += '<div class="sb-divider"></div>';
            html += '<div class="sb-label">Companions</div>';
            for (var gi = 0; gi < group.length; gi++) {
                var m = group[gi];
                html += '<div class="sb-companion sb-disp-' + m.disposition + '">' +
                    m.name.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '</div>';
            }
            var home = Social.getGroupHome();
            if (home) {
                var parts = [];
                if (home.side !== state.side) parts.push('across the chasm');
                var df = home.floor - state.floor;
                if (df > 0n) parts.push(df + (df === 1n ? ' floor up' : ' floors up'));
                else if (df < 0n) parts.push((-df) + (df === -1n ? ' floor down' : ' floors down'));
                var dp = home.position - state.position;
                var absDp = dp < 0n ? -dp : dp;
                if (absDp > 20n) parts.push(dp > 0n ? 'far right' : 'far left');
                else if (absDp > 5n) parts.push(dp > 0n ? 'right' : 'left');
                else if (dp !== 0n) parts.push(dp > 0n ? 'just right' : 'just left');
                var desc = parts.length > 0 ? parts.join(', ') : 'here';
                html += '<div class="sb-home">' + desc + '</div>';
            }
        }

        html += '<div class="sb-divider"></div>';
        html += '<div class="sb-menu">';
        for (var ai = 0; ai < this._sidebarActions.length; ai++) {
            var sa = this._sidebarActions[ai];
            html += '<a data-goto="' + sa.screen + '">' + sa.label + ' <kbd>' + sa.key + '</kbd></a>';
        }
        html += '<a id="sidebar-menu" data-goto="Menu">menu <kbd>esc</kbd></a>';
        html += '</div>';
        html += '</div>';
        cap.innerHTML = html;

        function openMenu(ev) {
            ev.preventDefault();
            var scr = state.screen;
            var cur = Engine._screens[scr];
            if (cur && cur.kind === "transition") {
                state._menuReturn = "Corridor";
            } else {
                state._menuReturn = scr;
            }
            Engine.goto("Menu");
        }

        const menuBtn = document.getElementById("sidebar-menu");
        if (menuBtn) {
            menuBtn.addEventListener("click", openMenu);
        }

        // Mobile menu button (rendered outside sidebar for mobile layout)
        const mobileMenu = document.getElementById("mobile-menu-btn");
        if (mobileMenu) {
            mobileMenu.addEventListener("click", openMenu);
        }
    },

    save() {
        try {
            var cur = this._screens[state.screen];
            if (cur && cur.kind === "transition") return; // never save on a transition
            if (state._possessedNpcId != null) return; // don't save during possession
            state._saveVersion = SAVE_VERSION;
            state._savedLogCount = logCount();
            state._savedAt = Date.now();

            for (const hook of _preSaveHooks) hook();

            const index = Slots.loadIndex();
            let slotId = state._slotId || index.activeSlot;
            const stateJson = JSON.stringify(state, jsonReplacer);
            saveLog(slotId);

            const meta = {
                seed: state.seed,
                name: (state.lifeStory && state.lifeStory.name) || "?",
                day: state.day || 0,
                savedAt: state._savedAt,
                godmoded: !!state.godmoded,
                deaths: state.deaths || 0,
            };

            if (!slotId) {
                slotId = Slots.createSlot(index, meta);
                state._slotId = slotId;
            }
            const logJson = localStorage.getItem(Slots.logKey(slotId));
            Slots.saveToSlot(index, slotId, stateJson, logJson, meta);
        } catch (e) {
            if (e instanceof DOMException && e.name === "QuotaExceededError") return;
            console.error("Save failed:", e);
        }
    },
    /** Load state for a specific slot (or the active slot). */
    load(slotId) {
        try {
            const index = Slots.loadIndex();
            const id = slotId || index.activeSlot;
            if (!id) return null;
            const raw = Slots.loadSlotRaw(id);
            if (raw) {
                const parsed = JSON.parse(raw, jsonReviver);
                parsed._slotId = id;
                return parsed;
            }
        } catch (e) { /* ignore parse errors */ }
        return null;
    },
    /** Delete the active slot's save data. */
    clearSave() {
        const index = Slots.loadIndex();
        const id = state._slotId || index.activeSlot;
        if (id) Slots.deleteSlot(index, id);
        clearLog(id);
    },
    /** Get the save slot index for UI rendering. */
    getSlotIndex() {
        return Slots.loadIndex();
    },
    /** Switch to a different save slot and reload. */
    loadSlot(slotId) {
        const index = Slots.loadIndex();
        index.activeSlot = slotId;
        Slots.saveIndex(index);
        window.location.reload();
    },
    /** Delete a specific slot by id. */
    deleteSlot(slotId) {
        const index = Slots.loadIndex();
        Slots.deleteSlot(index, slotId);
    },
    /** Start a new game without deleting the current slot. */
    newGame() {
        const index = Slots.loadIndex();
        index.activeSlot = null;
        Slots.saveIndex(index);
        window.location.href = window.location.pathname;
    },

    init() {
        const params = new URLSearchParams(window.location.search);
        if (params.has("reset")) {
            this.clearSave();
            window.location.href = window.location.pathname;
            return;
        }
        const saved = this.load();
        const isDebugGoto = params.has("vohu");
        const hasSeedParam = params.has("seed");

        // Check save compatibility; discard incompatible saves
        let useSave = saved && saved.seed != null && !hasSeedParam && !isDebugGoto;
        if (useSave) {
            const compat = checkSaveCompatibility(saved._saveVersion);
            if (compat) {
                const sv = parseSaveVersion(saved._saveVersion);
                console.warn("Incompatible save (v" + sv.major + "." + sv.minor + "):", compat);
                const index = Slots.loadIndex();
                const badId = saved._slotId || index.activeSlot;
                if (badId) Slots.deleteSlot(index, badId);
                useSave = false;
            }
        }

        if (useSave) {
            Object.assign(state, saved);
            PRNG.seed(state.seed);
            loadLog(state._slotId);
            // Migrate missing fields from older saves (within compatible versions)
            if (state.mortality === undefined) state.mortality = 100;
            if (state.despairing === undefined) state.despairing = false;
            if (state.deaths === undefined) state.deaths = 0;
            if (state.deathCause === undefined) state.deathCause = null;
            if (state.submissionsAttempted === undefined) state.submissionsAttempted = 0;
            if (state.won === undefined) state.won = false;
            if (state._spawnSide === undefined) state._spawnSide = state.side;
            if (state._spawnPosition === undefined) state._spawnPosition = state.position;
            if (state._spawnFloor === undefined) state._spawnFloor = state.floor;
            if (!state.eventDeck) Events.init();
            if (!state.npcs) Npc.init();
            Social.init();
            // Minor version migrations (same major, older minor)
            if (needsMigration(saved._saveVersion)) {
                const minor = savedMinor(saved._saveVersion);
                if (minor < 1) {
                    // 3.0 → 3.1: add release field
                    if (!state._saveVersion || state._saveVersion.release == null) {
                        state._saveVersion = { release: 0, major: state._saveVersion?.major ?? 3, minor: 1 };
                    }
                }
                state._saveVersion = SAVE_VERSION;
            }
            state._debugAllowed = false;
            state.debug = false;
        } else {
            const seed = params.get("seed") || String(Math.floor(Math.random() * 0xFFFFFFFF));
            PRNG.seed(seed);

            state.seed     = seed;
            state.side     = 0;
            state.position = 0n;
            state.floor    = BigInt(PRNG.fork("startFloor").nextInt(100000) + 50000);
            state.move     = "";
            state.heldBook    = null;
            state.shelfOffset = 0;
            state.openBook    = null;
            state.openPage    = 0;
            state.debug       = isDebugGoto;
            state._debugAllowed = isDebugGoto;
            state.deaths      = 0;
            state.deathCause  = null;

            const { playerBookAddress, story } = LifeStory.generatePlayerWorld(seed);
            state.playerBookAddress = playerBookAddress;
            state.lifeStory  = story;
            state.targetBook = story.bookCoords;
            state.playerRawAddress = story.rawBookAddress;
            // Player wakes up cosmically far from their book
            state.side     = story.playerStart.side;
            state.position = story.playerStart.position;
            state.floor    = story.playerStart.floor;
            state._spawnSide     = state.side;
            state._spawnPosition = state.position;
            state._spawnFloor    = state.floor;

            Surv.init();
            Tick.init();
            Events.init();
            Npc.init();
            Social.init();
        }

        // Feature flags — derived from save version, never stored
        state._featureFlags = featureFlags(state._saveVersion);

        // Digit-wise book caches (computed once per save, not persisted)
        if (state._featureFlags.digitWiseBooks) {
            const key = feistelKey(state.seed);
            state._feistelKey = key;
            state._originPad = buildOriginPad(state.playerBookAddress, key);
            state._playerDigits = buildPlayerDigits(
                state.lifeStory.storyText,
                {
                    name: state.lifeStory.name,
                    occupation: state.lifeStory.occupation,
                    hometown: state.lifeStory.hometown,
                    causeOfDeath: state.lifeStory.causeOfDeath,
                },
            );
        }

        // Register boundary handlers (must happen after subsystem init, before first goto)
        Tick.registerBoundaryHandlers();

        // Godmode: observation mode — skip normal game UI entirely
        if (params.get("godmode") === "1") {
            state.godmoded = true;
            this.save();
            Godmode.start();
            return;
        }

        if (state.debug) {
            const ob = params.get("openBook");
            if (ob) {
                const parts = ob.split(",").map(Number);
                state.openBook = { side: parts[0], position: BigInt(parts[1]), floor: BigInt(parts[2]), bookIndex: parts[3] };
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

        // Sidebar data-goto delegation (sb-actions, sb-menu links)
        document.getElementById("story-caption").addEventListener("click", function (ev) {
            const link = ev.target.closest("[data-goto]");
            if (!link) return;
            ev.preventDefault();
            const actionName = link.getAttribute("data-action");
            if (actionName && Engine._actions[actionName]) Engine._actions[actionName]();
            Engine.goto(link.getAttribute("data-goto"));
        });

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
