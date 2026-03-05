/* Engine — state store, screen router, sidebar, save/load, event delegation.
 * Replaces SugarCube runtime.
 */

(function () {
    "use strict";

    var SAVE_KEY = "hell_save";

    window.state = {};

    /** Resolve a TEXT field: if array, sample one via game PRNG; if string, return as-is.
     *  contextKey should vary by situation (e.g. field path + tick) for deterministic variety. */
    window.T = function (value, contextKey) {
        if (!Array.isArray(value)) return value;
        if (value.length === 0) return "";
        if (value.length === 1) return value[0];
        var rng = PRNG.fork("text:" + (contextKey || ""));
        return value[rng.nextInt(value.length)];
    };

    window.Engine = {
        _screens: {},   // populated by screens.js
        _actions: {},   // named action callbacks (avoids new Function)

        register: function (name, fn) {
            this._screens[name] = fn;
        },

        /** Register a named action callable from data-action attributes. */
        action: function (name, fn) {
            this._actions[name] = fn;
        },

        _inGoto: false,

        goto: function (name) {
            var screen = this._screens[name];
            if (!screen) {
                console.error("Unknown screen:", name);
                return;
            }
            state.screen = name;
            if (screen.enter) screen.enter();
            // Centralized death check: if any enter() caused death, redirect
            if (state.dead && name !== "Death" && !this._inGoto) {
                if (!state.deathCause) Surv.kill("mortality");
                this._inGoto = true;
                try { return this.goto("Death"); }
                finally { this._inGoto = false; }
            }
            var el = document.getElementById("passage");
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

        updateSidebar: function () {
            var cap = document.getElementById("story-caption");
            if (!cap) return;
            if (state.hunger === undefined) { cap.innerHTML = ""; return; }

            var html = '<div id="sidebar-stats">';

            // Time
            html += '<div class="sb-time">' + Tick.getDayDisplay() + '</div>';
            html += '<div class="sb-clock">' + Tick.getTimeString();
            if (!state.lightsOn) html += '  <span class="sb-dark">dark</span>';
            html += '</div>';

            html += '<div class="sb-divider"></div>';

            // Stats as descriptive words (corrupted when despairing)
            var dh = Despair.corruptStatValue(state.hunger);
            var dt = Despair.corruptStatValue(state.thirst);
            var de = Despair.corruptStatValue(state.exhaustion);
            var dm = Despair.corruptStatValue(state.morale);
            var stats = [
                { label: "hunger",     desc: Surv.describeRising(dh) },
                { label: "thirst",     desc: Surv.describeRising(dt) },
                { label: "exhaustion", desc: Surv.describeRising(de) },
                { label: "morale",     desc: Surv.describeMorale(dm) }
            ];
            for (var i = 0; i < stats.length; i++) {
                var st = stats[i];
                var cls = st.desc.level === "max" ? "sb-max" :
                          st.desc.level === "critical" ? "sb-critical" :
                          st.desc.level === "low" ? "sb-low" : "sb-ok";
                html += '<div class="sb-stat ' + cls + '">' +
                    '<span class="sb-label">' + st.label + '</span>' +
                    '<span class="sb-word">' + st.desc.word + '</span>' +
                    '</div>';
            }

            // Conditions
            if (Surv.showMortality()) {
                html += '<div class="sb-divider"></div>';
                html += '<div class="sb-condition sb-dying">dying (' + Math.floor(state.mortality) + ')</div>';
            }
            if (state.despairing) {
                html += '<div class="sb-condition sb-despairing">despairing</div>';
            }

            // Held book
            if (state.heldBook !== null) {
                html += '<div class="sb-divider"></div>';
                html += '<div class="sb-held">book #' + (state.heldBook.bookIndex + 1) + '</div>';
            }

            html += '</div>';
            cap.innerHTML = html;
        },

        save: function () {
            try {
                localStorage.setItem(SAVE_KEY, JSON.stringify(state));
            } catch (e) { /* ignore quota errors */ }
        },

        load: function () {
            try {
                var raw = localStorage.getItem(SAVE_KEY);
                if (raw) return JSON.parse(raw);
            } catch (e) { /* ignore parse errors */ }
            return null;
        },

        clearSave: function () {
            localStorage.removeItem(SAVE_KEY);
        },

        init: function () {
            var params = new URLSearchParams(window.location.search);
            var saved = this.load();
            var isDebugGoto = params.has("goto");
            var hasSeedParam = params.has("seed");

            // Restore from save if no URL overrides
            if (saved && saved.seed != null && !hasSeedParam && !isDebugGoto) {
                window.state = saved;
                PRNG.seed(state.seed);
            } else {
                // Fresh game
                var seed = params.get("seed") || String(Math.floor(Math.random() * 0xFFFFFFFF));
                PRNG.seed(seed);

                state.seed     = seed;
                state.side     = 0;
                state.position = 0;
                state.floor    = 10;
                state.move     = "";
                state.heldBook    = null;
                state.shelfOffset = 0;
                state.openBook    = null;
                state.openPage    = 0;
                state.debug       = true;
                state.deaths      = 0;
                state.deathCause  = null;

                var placement = params.get("placement") || "gaussian";
                var startLoc = { side: state.side, position: state.position, floor: state.floor };
                var story = LifeStory.generate(seed, { placement: placement, startLoc: startLoc });
                state.lifeStory  = story;
                state.targetBook = story.bookCoords;

                Surv.init();
                Tick.init();
                if (typeof Events !== "undefined") Events.init();
                if (typeof Npc !== "undefined") Npc.init();
            }

            // Debug URL params
            if (state.debug) {
                var ob = params.get("openBook");
                if (ob) {
                    var parts = ob.split(",").map(Number);
                    state.openBook = { side: parts[0], position: parts[1], floor: parts[2], bookIndex: parts[3] };
                    var sp = params.get("spread");
                    state.openPage = sp ? Number(sp) : 0;
                }
            }

            // Determine start screen
            var startScreen = "Life Story";
            if (isDebugGoto && state.debug) {
                startScreen = params.get("goto");
            } else if (saved && saved.seed != null && !hasSeedParam && !isDebugGoto) {
                startScreen = state.screen || "Corridor";
            }

            // Event delegation for [data-goto] links and NPC interaction
            document.getElementById("passage").addEventListener("click", function (ev) {
                // NPC click
                var npcLink = ev.target.closest("[data-npc-id]");
                if (npcLink && typeof Npc !== "undefined") {
                    ev.preventDefault();
                    var npcId = Number(npcLink.getAttribute("data-npc-id"));
                    var npc = state.npcs.find(function (n) { return n.id === npcId; });
                    if (npc) {
                        var bubble = document.getElementById("npc-dialogue-" + npcId);
                        if (bubble) { bubble.remove(); return; }
                        var text = Npc.talk(npc);
                        var el = document.createElement("p");
                        el.className = "npc-dialogue";
                        el.id = "npc-dialogue-" + npcId;
                        el.innerHTML = '<em>"' + text.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '"</em>';
                        npcLink.parentNode.appendChild(el);
                    }
                    return;
                }

                var link = ev.target.closest("[data-goto]");
                if (!link) return;
                ev.preventDefault();
                var actionName = link.getAttribute("data-action");
                if (actionName && Engine._actions[actionName]) {
                    Engine._actions[actionName]();
                }
                Engine.goto(link.getAttribute("data-goto"));
            });

            this.goto(startScreen);
        }
    };

    // Boot when DOM is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () { Engine.init(); });
    } else {
        Engine.init();
    }
}());
