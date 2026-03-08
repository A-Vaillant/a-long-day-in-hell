/* Screens — all passage templates as JS render functions. */

import { state } from "./state.js";
import { Engine, T, Madlib } from "./engine.js";
import { PRNG } from "./prng.js";
import { seedFromString } from "../../lib/prng.core.ts";
import { Lib } from "./library.js";
import { Book } from "./book.js";
import { LifeStory } from "./lifestory.js";
import { Surv } from "./survival.js";
import { Tick } from "./tick.js";
import { Npc } from "./npc.js";
import { Despair } from "./despairing.js";
import { Chasm } from "./chasm.js";
import { Social } from "./social.js";
import { Actions } from "./actions.js";

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ---------- helpers ---------- */

export function doMove(dir) {
    const result = Actions.resolve({ type: "move", dir });
    return result.resolved;
}

Engine.action("move-left",  function () { doMove("left"); });
Engine.action("move-right", function () { doMove("right"); });
Engine.action("move-up",    function () { doMove("up"); });
Engine.action("move-down",  function () { doMove("down"); });
Engine.action("move-cross", function () { doMove("cross"); });
Engine.action("page-prev",  function () { state.openPage -= 1; });
Engine.action("page-next",  function () { state.openPage += 1; });
Engine.action("drop-book",  function () { Actions.resolve({ type: "drop_book" }); });

function debugPanelHTML() {
    if (!state.debug) return "";
    return '<details id="debug-panel" open>' +
        '<summary>DEBUG</summary>' +
        '<pre>' +
        "Seed:     " + esc(state.seed) + "\n" +
        "Side:     " + (state.side === 0 ? "west" : "east") + "\n" +
        "Position: " + state.position + "\n" +
        "Floor:    " + state.floor + "\n" +
        "Screen:   " + esc(state.screen) + "\n" +
        "Tick:     " + state.tick + " / 240  (" + Tick.getTimeString() + ")\n" +
        "Day:      " + state.day + "\n" +
        "Lights:   " + (state.lightsOn ? "on" : "OFF") + "\n" +
        Lib.debugSegment(state.side, state.position, state.floor) + "\n" +
        "Hunger:    " + state.hunger.toFixed(2) + "\n" +
        "Thirst:    " + state.thirst.toFixed(2) + "\n" +
        "Exhaustion:" + state.exhaustion.toFixed(2) + "\n" +
        "Morale:    " + state.morale.toFixed(2) + "\n" +
        "Mortality: " + state.mortality.toFixed(2) + "\n" +
        "Despairing:" + state.despairing + "\n" +
        "Dead:       " + state.dead + "\n" +
        "Deaths:    " + (state.deaths || 0) + "\n" +
        '</pre></details>';
}

function locKey(loc) {
    return loc.side + ":" + loc.position + ":" + loc.floor;
}

/* ---------- Corridor ---------- */

function renderCorridorDark(loc, moves) {
    const seg = Lib.getSegment(loc.side, loc.position, loc.floor);
    let html = '<div id="corridor-view" class="mode-explore dark">';
    html += '<p class="location-header">' + (state.side === 0 ? 'The Corridor' : 'The Other Corridor') + '</p>';

    if (seg.restArea) {
        html += '<p>' + esc(T(TEXT.screens.darkness_rest_area, "darkness_rest_area:" + locKey(loc))) + '</p>';
    } else {
        html += '<p>' + esc(T(TEXT.screens.darkness_corridor, "darkness_corridor:" + locKey(loc))) + '</p>';
    }

    const warnings = Surv.warnings();
    if (warnings.length > 0) {
        html += '<p class="warnings">';
        for (let w = 0; w < warnings.length; w++) html += esc(warnings[w]) + " ";
        html += '</p>';
    }

    html += '<div id="moves"><strong>Move:</strong> ';
    const moveLinks = [
        { dir: "left",  label: "\u2190", key: "h" },
        { dir: "right", label: "\u2192", key: "l" },
        { dir: "up",    label: "\u2191", key: "k" },
        { dir: "down",  label: "\u2193", key: "j" },
        { dir: "cross", label: "\u21cc", key: "x" },
    ];
    for (let m = 0; m < moveLinks.length; m++) {
        if (moves.indexOf(moveLinks[m].dir) !== -1) {
            html += '<a data-goto="Corridor" data-action="move-' + moveLinks[m].dir + '"><kbd>' + moveLinks[m].key + '</kbd> ' + moveLinks[m].label + '</a> ';
        }
    }
    html += '</div>';

    html += '<div id="actions">';
    html += '<a data-goto="Wait"><kbd>.</kbd> wait</a>';
    if (Surv.canSleep()) html += ' <a data-goto="Sleep"><kbd>z</kbd> sleep</a>';
    if (state.floor > 0n) {
        html += ' <a data-goto="Chasm"><kbd>J</kbd> ' + (state.despairing ? 'jump' : 'chasm') + '</a>';
    }
    if (seg.restArea) {
        html += ' <a data-goto="Bedroom"><kbd>b</kbd> bedroom</a>';
    }
    html += '</div>';

    html += debugPanelHTML();
    html += '</div>';
    return html;
}

Engine.register("Corridor", {
    kind: "state",
    enter() {},
    render() {
        const loc = { side: state.side, position: state.position, floor: state.floor };
        const moves = Lib.availableMoves(loc);

        if (!state.lightsOn) return renderCorridorDark(loc, moves);

        const seg = Lib.getSegment(state.side, state.position, state.floor);
        const warnings = Surv.warnings();

        let html = '<div id="corridor-view" class="mode-explore">';
        html += '<p class="location-header">' + (state.side === 0 ? 'The Corridor' : 'The Other Corridor') + '</p>';

        if (state._lastMove === "up") {
            html += '<p class="stair-notice">You ascend.</p>';
            state._lastMove = null;
        } else if (state._lastMove === "down") {
            html += '<p class="stair-notice">You descend.</p>';
            state._lastMove = null;
        }
        if (seg.lightLevel === "dim") {
            html += '<p class="dim-notice">' + esc(Madlib(TEXT.madlibs.corridor_dim, "corridor_dim:" + locKey(loc))) + '</p>';
        }
        if (warnings.length > 0) {
            html += '<p class="warnings">';
            for (let w = 0; w < warnings.length; w++) html += esc(warnings[w]) + " ";
            html += '</p>';
        }

        if (state._readBlocked) {
            html += '<p class="despair-notice">' + esc(T(TEXT.screens.despair_read_blocked, "despair_read:" + state.tick)) + '</p>';
            state._readBlocked = false;
        }

        html += '<p>' + esc(Madlib(TEXT.madlibs.corridor, "corridor:" + locKey(loc))) + '</p>';

        if (state.lastEvent) {
            html += '<p class="event-text">' + esc(T(state.lastEvent.text, "event:" + state.lastEvent.id + ":" + state.tick)) + '</p>';
        }

        const npcsHere = Npc.here();
        if (npcsHere.length > 0) {
            html += '<div class="npc-list">';
            for (let ni = 0; ni < npcsHere.length; ni++) {
                const n = npcsHere[ni];
                const dispClass = n.alive ? "npc-" + n.disposition : "npc-dead";
                html += '<p class="npc-entry ' + dispClass + '">';
                if (!n.alive) {
                    html += '<span class="npc-name">' + esc(n.name) + '</span> ' + esc(T(TEXT.screens.dead_npc_at_location, "dead_npc:" + n.id));
                } else {
                    html += '<a class="npc-name npc-talk-link" data-npc-id="' + n.id + '">' + esc(n.name) + '</a>';
                    if (Social.isInPlayerGroup(n.id)) {
                        html += ' <span class="npc-companion-tag">(companion)</span> ';
                    } else {
                        html += ' ';
                    }
                    html += '<span class="npc-dialogue">' + esc(Npc.talk(n)) + '</span>';
                }
                html += '</p>';
            }
            html += '</div>';
        }

        // Ambient muttering from nearby NPCs (within hearing range, not here)
        const mutterers = Social.getNearbyMutterers();
        if (mutterers.length > 0) {
            // Show at most 2 mutterings to avoid clutter
            const shown = mutterers.slice(0, 2);
            for (let mi = 0; mi < shown.length; mi++) {
                const m = shown[mi];
                const pool = TEXT.npc_dialogue["muttering_" + m.disposition];
                if (pool && pool.length > 0) {
                    const rng = seedFromString("mutter:" + m.id + ":" + state.tick);
                    const line = pool[rng.nextInt(pool.length)];
                    const dirLabel = m.direction === "left" ? "\u2190" : m.direction === "right" ? "\u2192" : "";
                    const dirSpan = dirLabel ? '<span class="muttering-dir">' + dirLabel + '</span> ' : '';
                    html += '<p class="muttering muttering-' + m.disposition + '">' + dirSpan + esc(line) + '</p>';
                }
            }
        }

        if (seg.restArea) {
            html += '<p class="feature">' + esc(Madlib(TEXT.madlibs.corridor_rest, "corridor_rest:" + locKey(loc)));
            html += (state.floor > 0n) ? ' Stairs lead up and down.' : ' Stairs lead up.';
            html += '</p>';
        } else {
            html += '<div id="corridor-grid"></div>';
            html += '<p class="shelf-hint">Click a spine to read.</p>';
        }

        if (seg.hasBridge) {
            html += '<p class="feature">' + esc(T(TEXT.screens.corridor_bridge, "corridor_bridge:" + locKey(loc))) + '</p>';
        }

        html += '<div id="moves"><strong>Move:</strong> ';
        const moveLinks = [
            { dir: "left",  label: "\u2190", key: "h" },
            { dir: "right", label: "\u2192", key: "l" },
            { dir: "up",    label: "\u2191", key: "k" },
            { dir: "down",  label: "\u2193", key: "j" },
            { dir: "cross", label: "\u21cc", key: "x" },
        ];
        for (let m = 0; m < moveLinks.length; m++) {
            if (moves.indexOf(moveLinks[m].dir) !== -1) {
                html += '<a data-goto="Corridor" data-action="move-' + moveLinks[m].dir + '"><kbd>' + moveLinks[m].key + '</kbd> ' + moveLinks[m].label + '</a> ';
            }
        }
        html += '</div>';

        html += '<div id="actions">';
        html += '<a data-goto="Wait"><kbd>.</kbd> wait</a>';
        if (Surv.canSleep()) html += ' <a data-goto="Sleep"><kbd>z</kbd> sleep</a>';
        if (state.heldBook !== null && state.lightsOn) {
            var heldLabel = getBookName(state.heldBook);
            html += ' <a data-goto="Read Held Book"><kbd>r</kbd> read' + (heldLabel ? ' \u2018' + esc(heldLabel) + '\u2019' : '') + '</a>';
        }
        if (state.floor > 0) {
            html += ' <a data-goto="Chasm"><kbd>J</kbd> ' + (state.despairing ? 'jump' : 'chasm') + '</a>';
        }
        if (npcsHere.length > 0) {
            html += ' <a id="corridor-talk"><kbd>t</kbd> talk</a>';
        }
        if (seg.restArea) {
            html += '<a data-goto="Kiosk"><kbd>K</kbd> kiosk</a> <a data-goto="Bedroom"><kbd>b</kbd> bedroom</a> <a data-goto="Submission Slot"><kbd>s</kbd> submit</a> <a data-goto="Sign"><kbd>R</kbd> sign</a>';
        }
        html += '</div>';

        html += debugPanelHTML();
        html += '</div>';
        return html;
    },

    afterRender() {
        if (!state.lightsOn) return;

        // NPC talk click handlers
        function openTalk(npcId) {
            const npcsHere = Npc.here();
            const target = npcsHere.find(function (n) { return n.id === npcId; });
            if (target && target.alive) {
                state._talkTarget = target;
                Engine.goto("Talk");
            }
        }

        const talkLinks = document.querySelectorAll(".npc-talk-link");
        for (let i = 0; i < talkLinks.length; i++) {
            talkLinks[i].addEventListener("click", function (ev) {
                ev.preventDefault();
                const npcId = parseInt(this.getAttribute("data-npc-id"), 10);
                openTalk(npcId);
            });
        }

        const talkBtn = document.getElementById("corridor-talk");
        if (talkBtn) {
            talkBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                const npcsHere = Npc.here();
                const alive = npcsHere.filter(function (n) { return n.alive; });
                if (alive.length === 1) {
                    openTalk(alive[0].id);
                } else if (alive.length > 1) {
                    state._talkTarget = null;
                    state._talkNpcList = alive;
                    Engine.goto("Talk Pick");
                }
            });
        }

        // Shelf grid (only in non-rest-area segments)
        const seg = Lib.getSegment(state.side, state.position, state.floor);
        if (!seg.restArea) {
            const COUNT = 192;
            const grid = document.createElement("div");
            const playerKnow = Social.getPlayerKnowledge();
            const segSearched = playerKnow && playerKnow.searchedSegments.has(
                state.side + ":" + state.position + ":" + state.floor);
            grid.className = "shelf-grid" + (segSearched ? " shelf-searched" : "");

            for (let bi = 0; bi < COUNT; bi++) {
                const isHeld = state.heldBook !== null && state.heldBook.side === state.side &&
                    state.heldBook.position === state.position && state.heldBook.floor === state.floor &&
                    state.heldBook.bookIndex === bi;
                const hasVision = playerKnow && playerKnow.bookVision;
                const isTarget = hasVision &&
                    state.targetBook.side === state.side &&
                    state.targetBook.position === state.position && state.targetBook.floor === state.floor &&
                    state.targetBook.bookIndex === bi;
                const rng = seedFromString("spine:" + PRNG.getSeed() + ":" + state.side + ":" + state.position + ":" + state.floor + ":" + bi);
                const h = Math.floor(rng.next() * 30);
                const s = 15 + Math.floor(rng.next() * 20);
                const l = 12 + Math.floor(rng.next() * 14);
                const spine = document.createElement("div");
                if (isHeld) {
                    spine.className = "book-spine book-gap";
                    grid.appendChild(spine);
                    continue;
                }
                spine.className = "book-spine" + (isTarget ? " target-nearby" : "");
                spine.style.background = "hsl(" + h + "," + s + "%," + l + "%)";
                spine.addEventListener("click", (function (idx) {
                    return function () {
                        const result = Actions.resolve({ type: "read_book", bookIndex: idx });
                        if (result.resolved && result.screen) Engine.goto(result.screen);
                    };
                })(bi));
                grid.appendChild(spine);
            }

            const container = document.getElementById("corridor-grid");
            if (container) container.appendChild(grid);
        }
    },
});

/* ---------- Book naming ---------- */

function bookKey(bk) {
    return bk.side + ":" + bk.position + ":" + bk.floor + ":" + bk.bookIndex;
}

function getBookName(bk) {
    if (!state.bookNames) return null;
    return state.bookNames[bookKey(bk)] || null;
}

function setBookName(bk, name) {
    if (!state.bookNames) state.bookNames = {};
    if (name) {
        state.bookNames[bookKey(bk)] = name;
    } else {
        delete state.bookNames[bookKey(bk)];
    }
}

function bookLabel(bk) {
    return getBookName(bk) || "a book";
}

/* ---------- Shelf Open Book ---------- */

/** Fit 80×40 monospace grid into the book page's content area.
 *  Measures ch-width at a reference size, then derives font-size and line-height. */
function fitBookText(el) {
    const probe = document.createElement("span");
    probe.style.cssText = "font-family:var(--font-mono);font-size:20px;position:absolute;visibility:hidden;white-space:pre";
    probe.textContent = "M";
    document.body.appendChild(probe);
    const chAt20 = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);

    const style = getComputedStyle(el);
    const padH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padV = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availW = el.clientWidth - padH;
    const availH = el.clientHeight - padV;

    const fs = (availW / (80 * chAt20)) * 20;
    const lh = availH / (40 * fs);
    el.style.fontSize = fs + "px";
    el.style.lineHeight = lh;
}

Engine.register("Shelf Open Book", {
    kind: "state",
    render() {
        if (state.openBook === null || !state.lightsOn) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
        const bk = state.openBook;
        const pg = state.openPage;
        const maxPage = Book.PAGES_PER_BOOK + 1;
        const isHeld = state.heldBook !== null && state.heldBook.side === bk.side &&
            state.heldBook.position === bk.position && state.heldBook.floor === bk.floor &&
            state.heldBook.bookIndex === bk.bookIndex;

        let html = '<div id="book-view" class="mode-book">';

        const bkLabel = esc(bookLabel(bk));
        if (pg === 0) {
            html += '<p class="location-header">' + bkLabel + ' — Cover</p>';
        } else if (pg === maxPage) {
            html += '<p class="location-header">' + bkLabel + ' — Back Cover</p>';
        } else {
            html += '<p class="location-header">' + bkLabel + ' — Page ' + pg + ' / ' + Book.PAGES_PER_BOOK + '</p>';
        }

        const pkOpen = Social.getPlayerKnowledge();
        if (pkOpen && pkOpen.bookVision &&
            bk.side === state.targetBook.side && bk.position === state.targetBook.position &&
            bk.floor === state.targetBook.floor && bk.bookIndex === state.targetBook.bookIndex) {
            html += '<p class="target-book-hint">Something about this book makes you stop.</p>';
        }

        html += '<div class="book-single" id="book-single"></div>';
        html += '<div id="book-notices"></div>';

        html += '<div id="book-controls">';
        html += '<div id="page-nav">';
        if (pg > 0) html += '<a data-goto="Shelf Open Book" data-action="page-prev"><kbd>h</kbd> prev</a> ';
        if (pg < maxPage) html += '<a data-goto="Shelf Open Book" data-action="page-next">next <kbd>l</kbd></a>';
        html += '</div>';

        Engine.action("take-book", function () {
            Actions.resolve({ type: "take_book", bookIndex: bk.bookIndex });
        });

        html += '<div id="book-actions">';
        if (isHeld) {
            html += '<a data-goto="Corridor" data-action="drop-book"><kbd>p</kbd> put back</a> ';
        } else if (state.heldBook !== null) {
            html += '<a data-goto="Corridor" data-action="take-book"><kbd>t</kbd> swap</a> ';
        } else {
            html += '<a data-goto="Corridor" data-action="take-book"><kbd>t</kbd> take</a> ';
        }
        html += '<a id="name-book-link"><kbd>n</kbd> name</a> ';
        html += '<a data-goto="Corridor"><kbd>q</kbd> close</a>';
        html += '</div>';
        html += '<div id="book-name-input" style="display:none; margin-top:0.4rem;">';
        html += '<input id="book-name-field" type="text" maxlength="40" placeholder="name this book" style="font-family:var(--font-mono);font-size:0.8em;background:#2a2218;color:var(--text);border:1px solid var(--text-dim);padding:0.2em 0.4em;width:16em;">';
        html += ' <a id="book-name-save"><kbd>⏎</kbd></a>';
        html += '</div>';
        html += '</div>';

        html += '</div>';
        return html;
    },

    afterRender() {
        const pg = state.openPage;
        const bk = state.openBook;
        if (!bk) return;
        const el = document.getElementById("book-single");
        if (!el) return;

        if (pg === 0) {
            el.className = "book-single book-page-cover";
        } else if (pg === Book.PAGES_PER_BOOK + 1) {
            el.className = "book-single book-page-cover book-page-back";
        } else {
            el.className = "book-single book-page-symbols";
            el.textContent = Book.getPage(bk.side, bk.position, bk.floor, bk.bookIndex, pg - 1);
            // Size font so 80 monospace chars fit the content width exactly
            fitBookText(el);
        }

        // Book naming UI
        const nameLink = document.getElementById("name-book-link");
        const nameBox = document.getElementById("book-name-input");
        const nameField = document.getElementById("book-name-field");
        const nameSave = document.getElementById("book-name-save");
        if (nameLink && nameBox && nameField) {
            const existing = getBookName(bk);
            if (existing) nameField.value = existing;
            function showNameInput() {
                nameBox.style.display = "";
                nameField.focus();
            }
            function saveName() {
                const val = nameField.value.trim();
                setBookName(bk, val || null);
                Engine.goto("Shelf Open Book");
            }
            nameLink.addEventListener("click", function (ev) {
                ev.preventDefault();
                showNameInput();
            });
            if (nameSave) {
                nameSave.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    saveName();
                });
            }
            nameField.addEventListener("keydown", function (ev) {
                if (ev.key === "Enter") { ev.preventDefault(); saveName(); }
                if (ev.key === "Escape") { ev.preventDefault(); nameBox.style.display = "none"; }
                ev.stopPropagation();  // don't let book keybindings fire
            });
        }
    },
});

/* ---------- Read Held Book (redirect) ---------- */

Engine.register("Read Held Book", {
    kind: "transition",
    enter() {
        if (state.heldBook && state.lightsOn) {
            state.openBook = {
                side: state.heldBook.side,
                position: state.heldBook.position,
                floor: state.heldBook.floor,
                bookIndex: state.heldBook.bookIndex,
            };
            state.openPage = 1;
        }
    },
    render() {
        if (state.openBook) {
            setTimeout(function () { Engine.goto("Shelf Open Book"); }, 0);
        } else {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
        }
        return "";
    },
});

function renderSignBody(body) {
    var parts = Array.isArray(body) ? body : [body];
    return parts.map(function (p) {
        return '<p>' + esc(p).replace(/(\d+)\^([\d,]+)/g, '$1<sup>$2</sup>') + '</p>';
    }).join("");
}

/* ---------- Life Story ---------- */

Engine.register("Life Story", {
    kind: "state",
    render() {
        return '<div id="lifestory-view">' +
            '<p>' + esc(LifeStory.format(state.lifeStory)) + '</p>' +
            '<hr>' +
            '<p class="key-hint"><a data-goto="Sign Intro">Read the sign <kbd>E</kbd></a></p>' +
            '</div>';
    },
});

Engine.register("Sign Intro", {
    kind: "state",
    render() {
        var rules = TEXT.screens.sign_rules || [];
        var html = '<div id="sign-view">';
        html += '<p class="sign-intro-note"><em>A large sign is posted on the wall beside the shelves. You read it.</em></p>';
        html += '<div class="sign-text">';
        html += renderSignBody(TEXT.screens.sign_body);
        html += '<ol class="sign-rules">';
        for (var i = 0; i < rules.length; i++) {
            html += '<li>' + esc(rules[i]) + '</li>';
        }
        html += '</ol>';
        if (TEXT.screens.sign_closing) {
            html += '<p class="sign-closing">' + esc(TEXT.screens.sign_closing) + '</p>';
        }
        html += '</div>';
        html += '<hr>';
        html += '<p class="key-hint"><a data-goto="Corridor">Continue <kbd>E</kbd></a></p>';
        html += '</div>';
        return html;
    },
});

/* ---------- Kiosk ---------- */

Engine.register("Kiosk", {
    kind: "state",
    render() {
        if (!state.lightsOn) {
            return '<div id="kiosk-view">' +
                '<p class="location-header">Kiosk</p>' +
                '<p>' + esc(T(TEXT.screens.kiosk_dark, "kiosk_dark:" + state.tick)) + '</p>' +
                '<a data-goto="Corridor"><kbd>q</kbd> Leave</a>' +
                '</div>';
        }
        return '<div id="kiosk-view">' +
            '<p class="location-header">Kiosk</p>' +
            '<p class="kiosk-clock">' + esc(Tick.getClockDisplay()) + '</p>' +
            '<p>' + esc(T(TEXT.screens.kiosk_intro, "kiosk_intro:" + state.tick)) + '</p>' +
            '<a data-goto="Kiosk Get Drink"><kbd>1</kbd> Ask for water</a><br>' +
            '<a data-goto="Kiosk Get Food"><kbd>2</kbd> Ask for food</a><br>' +
            '<a data-goto="Kiosk Get Alcohol"><kbd>3</kbd> Ask for a drink</a><br>' +
            '<a data-goto="Corridor"><kbd>q</kbd> Leave</a>' +
            '</div>';
    },
});

Engine.register("Kiosk Get Drink", {
    kind: "transition",
    enter() { Actions.resolve({ type: "drink" }); },
    render() {
        return '<p>' + esc(Madlib(TEXT.madlibs.kiosk_drink, "kiosk_drink:" + state.tick)) + '</p>' +
            '<a data-goto="Kiosk"><kbd>⏎</kbd> Continue</a>';
    },
});

Engine.register("Kiosk Get Food", {
    kind: "transition",
    enter() { Actions.resolve({ type: "eat" }); },
    render() {
        return '<p>' + esc(Madlib(TEXT.madlibs.kiosk_food, "kiosk_food:" + state.tick)) + '</p>' +
            '<a data-goto="Kiosk"><kbd>⏎</kbd> Continue</a>';
    },
});

Engine.register("Kiosk Get Alcohol", {
    kind: "transition",
    enter() { Actions.resolve({ type: "alcohol" }); },
    render() {
        return '<p>' + esc(Madlib(TEXT.madlibs.kiosk_alcohol, "kiosk_alcohol:" + state.tick)) + '</p>' +
            '<a data-goto="Kiosk"><kbd>⏎</kbd> Continue</a>';
    },
});

/* ---------- Sign ---------- */

Engine.register("Sign", {
    kind: "state",
    render() {
        var rules = TEXT.screens.sign_rules || [];
        var html = '<div id="sign-view">';
        html += '<p class="location-header">The Sign</p>';
        html += '<div class="sign-text">';
        html += renderSignBody(TEXT.screens.sign_body);
        html += '<ol class="sign-rules">';
        for (var i = 0; i < rules.length; i++) {
            html += '<li>' + esc(rules[i]) + '</li>';
        }
        html += '</ol>';
        if (TEXT.screens.sign_closing) {
            html += '<p class="sign-closing">' + esc(TEXT.screens.sign_closing) + '</p>';
        }
        html += '</div>';
        html += '<p class="key-hint"><a data-goto="Corridor"><kbd>q</kbd> Back</a></p>';
        html += '</div>';
        return html;
    },
});

/* ---------- Bedroom ---------- */

Engine.register("Bedroom", {
    kind: "state",
    render() {
        return '<div id="bedroom-view">' +
            '<p class="location-header">Bedroom</p>' +
            '<p>' + esc(T(TEXT.screens.bedroom_intro, "bedroom_intro:" + state.tick)) + '</p>' +
            (Surv.canSleep() ? '<a data-goto="Sleep"><kbd>z</kbd> Sleep</a><br>' : '<p><em>You aren\'t tired enough to sleep.</em></p>') +
            '<a data-goto="Corridor"><kbd>q</kbd> Leave</a>' +
            '</div>';
    },
});

/* ---------- Submission Slot ---------- */

Engine.register("Submission Slot", {
    kind: "state",
    render() {
        const attempts = state.submissionsAttempted || 0;
        let html = '<div id="submission-view">' +
            '<p class="location-header">Submission Slot</p>' +
            '<p>' + esc(T(TEXT.screens.submission_intro, "submission_intro:" + state.tick)) + '</p>' +
            '<p>You have submitted ' + attempts + ' book' + (attempts !== 1 ? 's' : '') + ' so far.</p>';

        if (state.heldBook !== null) {
            html += '<a data-goto="Submission Attempt"><kbd>s</kbd> Submit held book</a><br>';
        } else {
            html += '<p><em>You are not holding a book.</em></p>';
        }

        html += '<a data-goto="Corridor"><kbd>q</kbd> Leave</a></div>';
        return html;
    },
});

Engine.register("Submission Attempt", {
    kind: "transition",
    enter() {
        Actions.resolve({ type: "submit" });
    },
    render() {
        if (state._submissionWon) {
            setTimeout(function () { Engine.goto("Win"); }, 0);
            return "";
        }
        return '<p>' + esc(T(TEXT.screens.submission_fail, "submission_fail:" + state.tick)) + '</p>' +
            '<a data-goto="Corridor"><kbd>⏎</kbd> Continue</a>';
    },
});

/* ---------- Win ---------- */

Engine.register("Win", {
    kind: "state",
    enter() {
        state.won = true;
        Engine.save();
    },
    render() {
        const tb = state.targetBook;
        const sideLabel = tb.side === 0 ? "west" : "east";
        return '<div id="win-view">' +
            '<p class="location-header">Release</p>' +
            '<p>' + esc(T(TEXT.screens.win_release, "win_release")) + '</p>' +
            '<p>' + esc(T(TEXT.screens.win_through, "win_through")) + '</p>' +
            '<p>' + esc(T(TEXT.screens.win_light, "win_light")) + '</p>' +
            '<p class="win-message">You are free.</p>' +
            '<hr>' +
            '<p><em>Seed: ' + esc(state.seed) + '<br>' +
            'Your name was ' + esc(state.lifeStory.name) + '.<br>' +
            'Placement: ' + esc(state.lifeStory.placement || "random") + '<br>' +
            'Book location: ' + sideLabel + ' side, segment ' + tb.position + ', floor ' + tb.floor + ', book #' + (tb.bookIndex + 1) + '<br>' +
            'Days survived: ' + state.day + '<br>' +
            'Submissions: ' + (state.submissionsAttempted || 0) + '<br>' +
            'Deaths: ' + (state.deaths || 0) + '</em></p>' +
            '<p><a id="new-game-link">New game</a></p>' +
            '</div>';
    },
    afterRender() {
        const link = document.getElementById("new-game-link");
        if (link) {
            link.addEventListener("click", function (ev) {
                ev.preventDefault();
                Engine.clearSave();
                window.location.reload();
            });
        }
    },
});

/* ---------- Menu ---------- */

Engine.register("Menu", {
    kind: "state",
    enter() {
        if (!state._menuReturn) state._menuReturn = "Corridor";
        if (state._menuSaved === undefined) state._menuSaved = false;
        if (state._menuConfirmNew === undefined) state._menuConfirmNew = false;
    },
    render() {
        let html = '<div id="menu-view">';
        html += '<p class="location-header">Menu</p>';

        // Save slot summary
        let saveLabel = "No save";
        if (state._savedAt) {
            const d = new Date(state._savedAt);
            const dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
                " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            const evCount = state._savedLogCount != null ? state._savedLogCount + " events" : "";
            saveLabel = "Day " + state.day + " · " + Tick.getTimeString() + " · " + dateStr;
            if (evCount) saveLabel += " · " + evCount;
        }
        html += '<p class="menu-save-slot">' + esc(saveLabel) + '</p>';

        if (state._menuSaved) {
            html += '<p class="menu-confirm">Saved.</p>';
        }

        if (state._menuConfirmNew) {
            html += '<p class="menu-warning">Start a new game? Current progress will be lost.</p>';
            html += '<p><a id="menu-confirm-new">Yes, start over</a> | <a data-goto="Menu" data-action="menu-cancel-new">No, go back</a></p>';
        } else {
            html += '<p><a data-goto="' + esc(state._menuReturn) + '"><kbd>Esc</kbd> Resume</a></p>';
            html += '<p><a id="menu-save">Save game</a></p>';
            html += '<p><a id="menu-new-game">New game</a></p>';
        }

        html += '</div>';
        return html;
    },
    afterRender() {
        Engine.action("menu-cancel-new", function () {
            state._menuConfirmNew = false;
            state._menuSaved = false;
        });
        const saveLink = document.getElementById("menu-save");
        if (saveLink) {
            saveLink.addEventListener("click", function (ev) {
                ev.preventDefault();
                Engine.save();
                state._menuSaved = true;
                Engine.goto("Menu");
            });
        }
        const newLink = document.getElementById("menu-new-game");
        if (newLink) {
            newLink.addEventListener("click", function (ev) {
                ev.preventDefault();
                state._menuConfirmNew = true;
                Engine.goto("Menu");
            });
        }
        const confirmLink = document.getElementById("menu-confirm-new");
        if (confirmLink) {
            confirmLink.addEventListener("click", function (ev) {
                ev.preventDefault();
                Engine.clearSave();
                window.location.reload();
            });
        }
    },
});

/* ---------- Talk Pick (multiple NPCs) ---------- */

Engine.register("Talk Pick", {
    kind: "state",
    render() {
        const npcs = state._talkNpcList;
        if (!npcs || npcs.length === 0) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
        let html = '<div id="talk-pick-view">';
        html += '<p class="location-header">Who do you approach?</p>';
        for (let i = 0; i < npcs.length; i++) {
            const n = npcs[i];
            const dispClass = "npc-" + n.disposition;
            html += '<p><a class="talk-pick-npc" data-npc-idx="' + i + '"><kbd>' + (i + 1) + '</kbd> <span class="npc-name ' + dispClass + '">' + esc(n.name) + '</span></a></p>';
        }
        html += '<p><a data-goto="Corridor"><kbd>q</kbd> Back</a></p>';
        html += '</div>';
        return html;
    },
    afterRender() {
        const npcs = state._talkNpcList;
        if (!npcs) return;
        const links = document.querySelectorAll(".talk-pick-npc");
        for (let i = 0; i < links.length; i++) {
            links[i].addEventListener("click", function (ev) {
                ev.preventDefault();
                const idx = parseInt(this.getAttribute("data-npc-idx"), 10);
                if (npcs[idx]) {
                    state._talkTarget = npcs[idx];
                    state._talkNpcList = null;
                    Engine.goto("Talk");
                }
            });
        }
    },
});

/* ---------- Talk ---------- */

Engine.register("Talk", {
    kind: "state",
    render() {
        const npc = state._talkTarget;
        if (!npc) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
        const dispClass = npc.alive ? "npc-" + npc.disposition : "npc-dead";
        const bond = Social.getBond(npc.id);
        const bondHint = bond ? ' <span class="bond-hint">(familiar: ' + Math.round(bond.familiarity) + ')</span>' : '';

        let html = '<div id="talk-view">';
        html += '<p class="location-header">Talking to <span class="npc-name ' + dispClass + '">' + esc(npc.name) + '</span>' + bondHint + '</p>';
        html += '<p class="npc-dialogue">' + esc(Npc.talk(npc)) + '</p>';

        html += '<div id="talk-actions">';
        html += '<p>How do you approach them?</p>';
        html += '<a id="talk-kind"><kbd>1</kbd> Be kind</a><br>';
        html += '<a id="talk-neutral"><kbd>2</kbd> Make conversation</a><br>';
        html += '<a id="talk-dismiss"><kbd>3</kbd> Be dismissive</a><br>';
        html += '<hr>';
        if (bond && bond.familiarity >= 5) {
            html += '<a id="talk-spend"><kbd>w</kbd> Spend time together</a><br>';
        }
        if (Social.isInPlayerGroup(npc.id)) {
            html += '<p class="talk-group-status">Traveling with you.</p>';
            html += '<a id="talk-group-dismiss"><kbd>d</kbd> Ask to leave your group</a><br>';
        } else if (bond && bond.familiarity >= 10) {
            html += '<a id="talk-recruit"><kbd>i</kbd> Invite to travel together</a><br>';
        }
        html += '<a data-goto="Corridor"><kbd>q</kbd> Leave</a>';
        html += '</div>';
        html += '</div>';
        return html;
    },
    afterRender() {
        const npc = state._talkTarget;
        if (!npc) return;

        function doTalk(approach) {
            const result = Actions.resolve({ type: "talk", npcId: npc.id, approach: approach });
            if (result.resolved) {
                state._talkResult = result.data;
                state._talkResult._npcName = npc.name;
                state._talkResult._approach = approach;
                Engine.goto("Talk Result");
            }
        }

        var kindBtn = document.getElementById("talk-kind");
        var neutralBtn = document.getElementById("talk-neutral");
        var dismissBtn = document.getElementById("talk-dismiss");
        var spendBtn = document.getElementById("talk-spend");
        var recruitBtn = document.getElementById("talk-recruit");

        if (kindBtn) kindBtn.addEventListener("click", function (ev) { ev.preventDefault(); doTalk("kind"); });
        if (neutralBtn) neutralBtn.addEventListener("click", function (ev) { ev.preventDefault(); doTalk("neutral"); });
        if (dismissBtn) dismissBtn.addEventListener("click", function (ev) { ev.preventDefault(); doTalk("dismissive"); });

        if (spendBtn) {
            spendBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                var result = Actions.resolve({ type: "spend_time", npcId: npc.id });
                if (result.resolved) {
                    state._spendTimeResult = result.data;
                    state._spendTimeResult._npcName = npc.name;
                    Engine.goto("Spend Time Result");
                }
            });
        }

        if (recruitBtn) {
            recruitBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                var result = Actions.resolve({ type: "recruit", npcId: npc.id });
                state._recruitResult = result.data || result;
                state._recruitResult._npcName = npc.name;
                Engine.goto("Recruit Result");
            });
        }

        var dismissGroupBtn = document.getElementById("talk-group-dismiss");
        if (dismissGroupBtn) {
            dismissGroupBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                var result = Actions.resolve({ type: "dismiss", npcId: npc.id });
                state._dismissResult = result.data || result;
                state._dismissResult._npcName = npc.name;
                Engine.goto("Dismiss Result");
            });
        }
    },
});

Engine.register("Talk Result", {
    kind: "transition",
    render() {
        const r = state._talkResult;
        if (!r) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
        const dialogue = TEXT.npc_dialogue;
        const approachKey = "talk_" + (r._approach || "neutral") + "_player";
        const playerLines = dialogue[approachKey] || dialogue.talk_neutral_player || [];
        const playerLine = playerLines.length > 0 ? playerLines[Math.floor(Math.random() * playerLines.length)] : "";
        const responseKey = "talk_" + r.disposition;
        const responseLines = dialogue[responseKey] || dialogue.talk_calm || [];
        const responseLine = responseLines.length > 0 ? responseLines[Math.floor(Math.random() * responseLines.length)] : "";

        let html = '<div id="talk-result-view">';
        if (playerLine) html += '<p class="player-action">' + esc(playerLine) + '</p>';
        if (responseLine) html += '<p class="npc-response">' + esc(responseLine) + '</p>';
        if (r.segmentsLearned > 0) {
            html += '<p class="talk-knowledge">You compare notes on the shelves. ' + r.segmentsLearned + ' new section' + (r.segmentsLearned !== 1 ? 's' : '') + ' to avoid.</p>';
        }
        html += '<p class="key-hint"><a data-goto="Talk"><kbd>\u23ce</kbd> Continue</a></p>';
        html += '</div>';
        state._talkResult = null;
        return html;
    },
});

Engine.register("Spend Time Result", {
    kind: "transition",
    render() {
        const r = state._spendTimeResult;
        if (!r) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
        const dialogue = TEXT.npc_dialogue;
        const lines = dialogue.spend_time || [];
        const line = lines.length > 0 ? lines[Math.floor(Math.random() * lines.length)] : "You spend some time together.";

        let html = '<div id="spend-time-result-view">';
        html += '<p>' + esc(line) + '</p>';
        html += '<p class="key-hint"><a data-goto="Talk"><kbd>\u23ce</kbd> Continue</a></p>';
        html += '</div>';
        state._spendTimeResult = null;
        return html;
    },
});

Engine.register("Recruit Result", {
    kind: "transition",
    render() {
        const r = state._recruitResult;
        if (!r) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
        const name = r._npcName || "them";
        const dialogue = TEXT.npc_dialogue;
        var poolKey;
        if (r.joined) {
            poolKey = "recruit_accept";
        } else if (r.reason === "unfamiliar") {
            poolKey = "recruit_refuse_unfamiliar";
        } else if (r.reason === "low_affinity") {
            poolKey = "recruit_refuse_affinity";
        } else {
            poolKey = "recruit_refuse_disposition";
        }
        const lines = dialogue[poolKey] || [];
        const line = lines.length > 0 ? lines[Math.floor(Math.random() * lines.length)] : (r.joined ? "They agree." : "They refuse.");

        let html = '<div id="recruit-result-view">';
        html += '<p>' + esc(line) + '</p>';
        if (r.joined) {
            html += '<p class="recruit-success"><strong>' + esc(name) + '</strong> has joined you.</p>';
        }
        html += '<p class="key-hint"><a data-goto="Corridor"><kbd>\u23ce</kbd> Continue</a></p>';
        html += '</div>';
        state._recruitResult = null;
        return html;
    },
});

Engine.register("Dismiss Result", {
    kind: "transition",
    render() {
        const r = state._dismissResult;
        if (!r) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
        const name = r._npcName || "them";
        let html = '<div id="dismiss-result-view">';
        if (r.success) {
            html += '<p>You tell <strong>' + esc(name) + '</strong> it\'s time to part ways.</p>';
            html += '<p>They leave without a word.</p>';
        } else {
            html += '<p>You can\'t do that right now.</p>';
        }
        html += '<p class="key-hint"><a data-goto="Corridor"><kbd>\u23ce</kbd> Continue</a></p>';
        html += '</div>';
        state._dismissResult = null;
        return html;
    },
});

/* ---------- Stubs ---------- */

Engine.register("Wait", {
    kind: "transition",
    enter() { Actions.resolve({ type: "wait" }); },
    render() {
        setTimeout(function () { Engine.goto("Corridor"); }, 0);
        return "";
    },
});

Engine.register("Sleep", {
    kind: "transition",
    enter() { Actions.resolve({ type: "sleep" }); },
    render() {
        return '<p>' + esc(Madlib(TEXT.madlibs.sleep, "sleep:" + state.day)) + '</p>' +
            '<a data-goto="Corridor"><kbd>⏎</kbd> Get up</a>';
    },
});

Engine.register("Chasm", {
    kind: "transition",
    render() {
        let html = '<div id="chasm-view">';
        const alt = Chasm.getAltitude();
        const chasmKey = "chasm_" + alt;
        const chasmText = TEXT.screens[chasmKey] || TEXT.screens.chasm_abyss;
        html += '<p>' + esc(T(chasmText, chasmKey + ":" + state.tick)) + '</p>';
        if (state.floor === 0n) {
            html += '<p><em>You are at the bottom. There is nowhere to fall.</em></p>';
        } else if (Despair.chasmSkipsConfirm()) {
            html += '<p><em>' + esc(T(TEXT.screens.chasm_jump_confirm, "chasm_confirm:" + state.tick)) + '</em></p>';
        } else {
            html += '<p>' + esc(T(TEXT.screens.chasm_jump_confirm, "chasm_confirm:" + state.tick)) + '</p>';
            html += '<a id="chasm-jump-yes"><kbd>y</kbd> Yes</a> | ';
        }
        html += '<a data-goto="Corridor"><kbd>n</kbd> Back</a>';
        html += '</div>';
        return html;
    },
    afterRender() {
        if (state.floor === 0) return;
        if (Despair.chasmSkipsConfirm()) {
            Actions.resolve({ type: "chasm_jump" });
            setTimeout(function () { Engine.goto("Falling"); }, 0);
            return;
        }
        const btn = document.getElementById("chasm-jump-yes");
        if (btn) {
            btn.addEventListener("click", function (ev) {
                ev.preventDefault();
                Actions.resolve({ type: "chasm_jump" });
                Engine.goto("Falling");
            });
        }
    },
});

/* ---------- Falling ---------- */

Engine.register("Falling", {
    kind: "state",
    enter() {},
    render() {
        const f = state.falling;
        if (!f) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }

        const alt = Chasm.getAltitude();
        const chance = Chasm.getGrabChance(Social.getQuicknessGrabBonus());
        let html = '<div id="falling-view">';
        html += '<p class="location-header">Falling</p>';

        // Altitude × speed prose (or darkness)
        if (!state.lightsOn) {
            html += '<p>' + esc(T(TEXT.screens.falling_dark, "falling_dark:" + state.tick)) + '</p>';
        } else {
            const speedKey = f.speed < 10 ? "slow" : "fast";
            const textKey = "falling_" + alt + "_" + speedKey;
            const fallText = TEXT.screens[textKey];
            if (fallText) {
                html += '<p>' + esc(T(fallText, textKey + ":" + state.tick)) + '</p>';
            }
        }

        // Grab failure feedback
        if (state._grabFailed) {
            const gf = state._grabFailed;
            if (gf.mortalityHit > 0) {
                html += '<p class="grab-fail">Your hand catches the railing and tears free. Pain shoots up your arm.</p>';
            } else {
                html += '<p class="grab-fail">You reach out — your fingers brush metal, then nothing.</p>';
            }
            state._grabFailed = null;
        }

        // Grab — described as perception, not a number
        if (chance <= 0) {
            html += '<p class="grab-desc">' + esc(T(TEXT.screens.falling_grab_hopeless, "grab_hopeless:" + state.tick)) + '</p>';
        } else if (chance < 0.2) {
            html += '<p class="grab-desc">The railings flash past. Maybe — just barely — you could catch one.</p>';
        } else if (chance < 0.5) {
            html += '<p class="grab-desc">The railings are moving fast, but you can track them.</p>';
        } else {
            html += '<p class="grab-desc">The railings pass within reach.</p>';
        }

        // Survival warnings
        const warnings = Surv.warnings();
        if (warnings.length > 0) {
            html += '<p class="warnings">';
            for (let w = 0; w < warnings.length; w++) html += esc(warnings[w]) + " ";
            html += '</p>';
        }

        // Actions
        html += '<div id="actions">';
        html += '<a id="fall-wait"><kbd>w</kbd> fall</a>';
        if (chance > 0) {
            html += ' <a id="fall-grab"><kbd>g</kbd> grab railing</a>';
        }
        if (state.heldBook !== null) {
            html += ' <a id="fall-throw"><kbd>t</kbd> throw book</a>';
        }
        html += '</div>';

        html += debugPanelHTML();
        html += '</div>';
        return html;
    },
    afterRender() {
        const waitBtn = document.getElementById("fall-wait");
        const grabBtn = document.getElementById("fall-grab");
        const throwBtn = document.getElementById("fall-throw");

        if (waitBtn) {
            waitBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                const r = Actions.resolve({ type: "fall_wait" });
                if (r.screen) Engine.goto(r.screen);
            });
        }
        if (grabBtn) {
            grabBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                const r = Actions.resolve({ type: "grab_railing" });
                if (r.data && r.data.success) {
                    Engine.goto("Corridor");
                } else {
                    const r2 = Actions.resolve({ type: "fall_wait" });
                    if (r2.screen) Engine.goto(r2.screen);
                }
            });
        }
        if (throwBtn) {
            throwBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                Actions.resolve({ type: "throw_book" });
                Engine.goto("Falling");
            });
        }
    },
});

/* ---------- Memory ---------- */

const MEMORY_TYPE_PROSE = {
    witnessChasm:    "memory_witness_chasm",
    foundBody:       "memory_found_body",
    companionDied:   "memory_companion_died",
    groupDissolved:  "memory_group_dissolved",
    witnessEscape:   "memory_witness_escape",
    foundWords:      "memory_found_words",
    witnessMadness:  "memory_witness_madness",
    companionMad:    "memory_companion_mad",
};

function memoryVividness(weight, initialWeight) {
    if (initialWeight <= 0) return "";
    const r = weight / initialWeight;
    if (r >= 0.8) return "vivid";
    if (r >= 0.5) return "clear";
    if (r >= 0.25) return "fading";
    return "distant";
}

function memoryAgeStr(tick, currentTick) {
    const age = currentTick - tick;
    const days = Math.floor(age / 240);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    return days + " days ago";
}

Engine.registerSidebarAction({ label: "memory", key: "m", screen: "Memory" });

Engine.register("Memory", {
    kind: "state",
    render() {
        const mem = Social.getPlayerMemory();
        const currentTick = (state.day - 1) * 240 + state.tick;

        let html = '<div class="memory-view">';
        html += '<p class="location-header">Memory</p>';

        if (!mem || mem.entries.length === 0) {
            html += '<p>' + esc(TEXT.screens.memory_empty) + '</p>';
        } else {
            // Sort by weight descending (most vivid first)
            const sorted = mem.entries.slice().sort((a, b) => b.weight - a.weight);
            for (const entry of sorted) {
                const proseKey = MEMORY_TYPE_PROSE[entry.type];
                const prose = proseKey && TEXT.screens[proseKey] ? TEXT.screens[proseKey] : entry.type;
                const vividness = memoryVividness(entry.weight, entry.initialWeight);
                const age = memoryAgeStr(entry.tick, currentTick);
                const name = entry.subject != null ? Social.getEntityName(entry.subject) : null;

                html += '<div class="memory-entry memory-' + vividness + '">';
                html += '<span class="memory-prose">' + esc(prose) + '</span>';
                if (name) html += ' <span class="memory-subject">' + esc(name) + '.</span>';
                html += ' <span class="memory-meta">' + esc(age);
                if (entry.permanent) html += ' \u00b7 permanent';
                html += '</span>';
                html += '</div>';
            }
        }

        html += '<p class="key-hint"><a data-goto="Corridor"><kbd>q</kbd> Back</a></p>';
        html += '</div>';
        return html;
    },
});

/**
 * Ambient memory: return a line of prose if the player has a relevant memory
 * for the current location/context. Returns null if nothing fires.
 *
 * TODO: wire into corridor render — call this and append to room description
 * when it returns a non-null string. Deliberately not wired yet.
 *
 * @param {string} context — "chasm", "body", "escape", "madness"
 */
export function getAmbientMemoryProse(context) {
    const mem = Social.getPlayerMemory();
    if (!mem || mem.entries.length === 0) return null;

    const CONTEXT_TYPES = {
        chasm:   ["witnessChasm"],
        body:    ["foundBody", "companionDied"],
        escape:  ["witnessEscape"],
        madness: ["witnessMadness", "companionMad"],
    };

    const relevant = CONTEXT_TYPES[context];
    if (!relevant) return null;

    // Find strongest relevant memory above threshold (weight > 1)
    let best = null;
    for (const entry of mem.entries) {
        if (!relevant.includes(entry.type)) continue;
        if (entry.weight <= 1) continue;
        if (!best || entry.weight > best.weight) best = entry;
    }
    if (!best) return null;

    const proseKey = "ambient_memory_" + context;
    const options = TEXT.screens[proseKey];
    if (!options || !options.length) return null;

    // Deterministic pick based on memory ID so it's stable across renders
    return options[best.id % options.length];
}

/* ---------- Death ---------- */

Engine.register("Death", {
    kind: "state",
    _cause: null,
    enter() {
        this._cause = state.deathCause || "mortality";
        Tick.advanceToDawn();
    },
    render() {
        const causeKey = "death_" + this._cause;
        const causeText = TEXT.screens[causeKey] || TEXT.screens.death_mortality;
        return '<div id="death-view">' +
            '<p>' + esc(T(causeText, causeKey + ":" + state.day)) + '</p>' +
            '<hr>' +
            '<p>' + esc(T(TEXT.screens.resurrection, "resurrection:" + state.day)) + '</p>' +
            '<p>Day ' + state.day + '. Deaths: ' + state.deaths + '.</p>' +
            '<p><a data-goto="Corridor"><kbd>⏎</kbd> Continue</a></p>' +
            '</div>';
    },
});
