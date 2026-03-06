/* Screens — all passage templates as JS render functions. */

import { state } from "./state.js";
import { Engine, T } from "./engine.js";
import { PRNG } from "./prng.js";
import { seedFromString } from "../../lib/prng.core.js";
import { Lib } from "./library.js";
import { Book } from "./book.js";
import { LifeStory } from "./lifestory.js";
import { Surv } from "./survival.js";
import { Tick } from "./tick.js";
import { Npc } from "./npc.js";
import { Despair } from "./despairing.js";
import { Chasm } from "./chasm.js";

function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Wrap fragment runs in <mark class="fragment"> tags within page text.
 * fragments: array of { start, end, text } from Book.findFragments
 */
function highlightFragments(text, fragments) {
    if (!fragments.length) return esc(text);
    // Build a set of character ranges to highlight
    // Fragments refer to word indices; we need character positions
    const words = text.split(/(\s+)/);  // split preserving whitespace
    let html = "";
    let wordIdx = 0;
    let inFragment = false;
    const fragStarts = new Set(fragments.map(f => f.start));
    const fragEnds = new Set(fragments.map(f => f.end));
    for (let i = 0; i < words.length; i++) {
        if (i % 2 === 0) {  // word token (even indices)
            if (fragStarts.has(wordIdx)) {
                html += '<mark class="fragment">';
                inFragment = true;
            }
            html += esc(words[i]);
            wordIdx++;
            if (fragEnds.has(wordIdx) && inFragment) {
                html += '</mark>';
                inFragment = false;
            }
        } else {  // whitespace
            html += esc(words[i]);
        }
    }
    if (inFragment) html += '</mark>';
    return html;
}

/* ---------- helpers ---------- */

export function doMove(dir) {
    const loc = { side: state.side, position: state.position, floor: state.floor };
    const available = Lib.availableMoves(loc);
    if (available.indexOf(dir) === -1) return false;
    const dest = Lib.applyMove(loc, dir);
    state.side     = dest.side;
    state.position = dest.position;
    state.floor    = dest.floor;
    Tick.onMove();
    return true;
}

Engine.action("move-left",  function () { doMove("left"); });
Engine.action("move-right", function () { doMove("right"); });
Engine.action("move-up",    function () { doMove("up"); });
Engine.action("move-down",  function () { doMove("down"); });
Engine.action("move-cross", function () { doMove("cross"); });
Engine.action("page-prev",  function () { state.openPage -= 1; });
Engine.action("page-next",  function () { state.openPage += 1; });
Engine.action("drop-book",  function () { state.heldBook = null; });

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
    if (state.floor > 0) {
        html += ' <a data-goto="Chasm"><kbd>J</kbd> ' + (state.despairing ? 'jump' : 'chasm') + '</a>';
    }
    if (seg.restArea) {
        html += '<a data-goto="Bedroom">bedroom</a>';
    }
    html += '</div>';

    html += debugPanelHTML();
    html += '</div>';
    return html;
}

Engine.register("Corridor", {
    enter() {
        Book.clearDwell();
    },
    render() {
        const loc = { side: state.side, position: state.position, floor: state.floor };
        const moves = Lib.availableMoves(loc);

        if (!state.lightsOn) return renderCorridorDark(loc, moves);

        const seg = Lib.getSegment(state.side, state.position, state.floor);
        const warnings = Surv.warnings();

        let html = '<div id="corridor-view" class="mode-explore">';
        html += '<p class="location-header">' + (state.side === 0 ? 'The Corridor' : 'The Other Corridor') + '</p>';

        if (seg.lightLevel === "dim") {
            html += '<p class="dim-notice">' + esc(T(TEXT.screens.corridor_dim, "corridor_dim:" + locKey(loc))) + '</p>';
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

        html += '<p>' + esc(T(TEXT.screens.corridor, "corridor:" + locKey(loc))) + '</p>';

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
                    html += '<span class="npc-name" data-npc-id="' + n.id + '">' + esc(n.name) + '</span> ';
                    html += '<span class="npc-dialogue">' + esc(Npc.talk(n)) + '</span>';
                }
                html += '</p>';
            }
            html += '</div>';
        }

        if (seg.restArea) {
            html += '<p class="feature">' + esc(T(TEXT.screens.corridor_rest, "corridor_rest:" + locKey(loc)));
            html += (state.floor > 0) ? ' Stairs lead up and down.' : ' Stairs lead up.';
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
        if (state.floor > 0) {
            html += ' <a data-goto="Chasm"><kbd>J</kbd> ' + (state.despairing ? 'jump' : 'chasm') + '</a>';
        }
        if (seg.restArea) {
            html += '<a data-goto="Kiosk"><kbd>K</kbd> kiosk</a> <a data-goto="Bedroom"><kbd>b</kbd> bedroom</a> <a data-goto="Submission Slot"><kbd>s</kbd> submit</a>';
        }
        html += '</div>';

        html += debugPanelHTML();
        html += '</div>';
        return html;
    },

    afterRender() {
        if (!state.lightsOn) return;
        const seg = Lib.getSegment(state.side, state.position, state.floor);
        if (seg.restArea) return;

        const COUNT = 192;
        const grid = document.createElement("div");
        grid.className = "shelf-grid";

        for (let bi = 0; bi < COUNT; bi++) {
            const isHeld = state.heldBook !== null && state.heldBook.side === state.side &&
                state.heldBook.position === state.position && state.heldBook.floor === state.floor &&
                state.heldBook.bookIndex === bi;
            const isTarget = state.targetBook.side === state.side &&
                state.targetBook.position === state.position && state.targetBook.floor === state.floor &&
                state.targetBook.bookIndex === bi;
            const rng = seedFromString("spine:" + PRNG.getSeed() + ":" + state.side + ":" + state.position + ":" + state.floor + ":" + bi);
            const h = Math.floor(rng.next() * 30);
            const s = 15 + Math.floor(rng.next() * 20);
            const l = 12 + Math.floor(rng.next() * 14);
            const spine = document.createElement("div");
            spine.className = "book-spine" + (isHeld ? " held" : "") + (isTarget ? " target-nearby" : "");
            spine.style.background = "hsl(" + h + "," + s + "%," + l + "%)";
            spine.addEventListener("click", (function (idx) {
                return function () {
                    if (Despair.isReadingBlocked()) {
                        state._readBlocked = true;
                        Engine.goto("Corridor");
                        return;
                    }
                    state.openBook = { side: state.side, position: state.position, floor: state.floor, bookIndex: idx };
                    if (state.morale >= 80) {
                        state.openPage = 0;  // cover
                    } else {
                        var pageRng = PRNG.fork("pageopen:" + state.tick);
                        state.openPage = pageRng.nextInt(Book.PAGES_PER_BOOK) + 1;  // random content page
                    }
                    Engine.goto("Shelf Open Book");
                };
            })(bi));
            grid.appendChild(spine);
        }

        const container = document.getElementById("corridor-grid");
        if (container) container.appendChild(grid);
    },
});

/* ---------- Shelf Open Book ---------- */

Engine.register("Shelf Open Book", {
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

        if (pg === 0) {
            html += '<p class="location-header">Book #' + (bk.bookIndex + 1) + ' — Cover</p>';
        } else if (pg === maxPage) {
            html += '<p class="location-header">Book #' + (bk.bookIndex + 1) + ' — Back Cover</p>';
        } else {
            html += '<p class="location-header">Book #' + (bk.bookIndex + 1) + ' — Page ' + pg + ' / ' + Book.PAGES_PER_BOOK + '</p>';
        }

        if (bk.side === state.targetBook.side && bk.position === state.targetBook.position &&
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
            state.heldBook = { side: bk.side, position: bk.position, floor: bk.floor, bookIndex: bk.bookIndex };
        });

        html += '<div id="book-actions">';
        if (isHeld) {
            html += '<a data-goto="Corridor" data-action="drop-book"><kbd>p</kbd> put back</a> ';
        } else if (state.heldBook !== null) {
            html += '<a data-goto="Corridor" data-action="take-book"><kbd>t</kbd> swap</a> ';
        } else {
            html += '<a data-goto="Corridor" data-action="take-book"><kbd>t</kbd> take</a> ';
        }
        html += '<a data-goto="Corridor"><kbd>q</kbd> close</a>';
        html += '</div>';
        html += '</div>';

        html += '</div>';
        return html;
    },

    afterRender() {
        const pg = state.openPage;
        const bk = state.openBook;
        if (!bk) { Book.clearDwell(); return; }
        const el = document.getElementById("book-single");
        if (!el) return;

        if (pg === 0) {
            el.className = "book-single book-page-cover";
            el.textContent = "Book " + (bk.bookIndex + 1);
            Book.clearDwell();
        } else if (pg === Book.PAGES_PER_BOOK + 1) {
            el.className = "book-single book-page-cover book-page-back";
            Book.clearDwell();
        } else {
            const pageResult = Book.getPage(bk.side, bk.position, bk.floor, bk.bookIndex, pg - 1);
            // Check if dwell already fired (re-render after morale update)
            const dwellFired = state._dwellFired &&
                state._dwellFired.bookIndex === bk.bookIndex &&
                state._dwellFired.pageIndex === (pg - 1);
            if (dwellFired && pageResult.storyId >= 0) {
                // Render with fragment highlighting
                const fragments = Book.findFragments(pageResult.storyId, pageResult.text);
                if (fragments.length > 0) {
                    el.innerHTML = highlightFragments(pageResult.text, fragments);
                    // Trigger reveal animation
                    setTimeout(function () {
                        const marks = el.querySelectorAll(".fragment");
                        for (let i = 0; i < marks.length; i++) marks[i].classList.add("revealed");
                    }, 50);
                } else {
                    el.textContent = pageResult.text;
                }
            } else {
                el.textContent = pageResult.text;
                Book.startDwell(bk, pg - 1, pageResult);
            }
        }
    },
});

/* ---------- Life Story ---------- */

Engine.register("Life Story", {
    render() {
        return '<div id="lifestory-view">' +
            LifeStory.format(state.lifeStory) +
            '<hr>' +
            '<p><em>Your book is somewhere on the ' + (state.targetBook.side === 0 ? "west" : "east") +
            ' side, floor ' + state.targetBook.floor + '.</em></p>' +
            '<p class="key-hint"><a data-goto="Corridor">Continue <kbd>E</kbd></a></p>' +
            '</div>';
    },
});

/* ---------- Kiosk ---------- */

Engine.register("Kiosk", {
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
    enter() { Tick.advance(1); Surv.onDrink(); },
    render() {
        return '<p>' + esc(T(TEXT.screens.kiosk_drink, "kiosk_drink:" + state.tick)) + '</p>' +
            '<a data-goto="Kiosk"><kbd>⏎</kbd> Continue</a>';
    },
});

Engine.register("Kiosk Get Food", {
    enter() { Tick.advance(1); Surv.onEat(); },
    render() {
        return '<p>' + esc(T(TEXT.screens.kiosk_food, "kiosk_food:" + state.tick)) + '</p>' +
            '<a data-goto="Kiosk"><kbd>⏎</kbd> Continue</a>';
    },
});

Engine.register("Kiosk Get Alcohol", {
    enter() { Tick.advance(1); Surv.onAlcohol(); },
    render() {
        return '<p>' + esc(T(TEXT.screens.kiosk_alcohol, "kiosk_alcohol:" + state.tick)) + '</p>' +
            '<a data-goto="Kiosk"><kbd>⏎</kbd> Continue</a>';
    },
});

/* ---------- Bedroom ---------- */

Engine.register("Bedroom", {
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
    enter() {
        state.submissionsAttempted = (state.submissionsAttempted || 0) + 1;
        state._submissionWon = false;
        const hb = state.heldBook;
        const tb = state.targetBook;
        if (hb && hb.side === tb.side && hb.position === tb.position &&
            hb.floor === tb.floor && hb.bookIndex === tb.bookIndex) {
            state._submissionWon = true;
        }
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
    enter() {
        if (!state._menuReturn) state._menuReturn = "Corridor";
        if (state._menuSaved === undefined) state._menuSaved = false;
        if (state._menuConfirmNew === undefined) state._menuConfirmNew = false;
    },
    render() {
        let html = '<div id="menu-view">';
        html += '<p class="location-header">Menu</p>';

        if (state._menuSaved) {
            html += '<p class="menu-confirm">Game saved. (Day ' + state.day + ', ' + Tick.getTimeString() + ')</p>';
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

/* ---------- Stubs ---------- */

Engine.register("Wait", {
    enter() { Tick.onMove(); },
    render() {
        setTimeout(function () { Engine.goto("Corridor"); }, 0);
        return "";
    },
});

Engine.register("Sleep", {
    enter() { Tick.onSleep(); },
    render() {
        return '<p>' + esc(T(TEXT.screens.sleep, "sleep:" + state.day)) + '</p>' +
            '<a data-goto="Corridor"><kbd>⏎</kbd> Get up</a>';
    },
});

Engine.register("Chasm", {
    render() {
        let html = '<div id="chasm-view">';
        const alt = Chasm.getAltitude();
        const chasmKey = "chasm_" + alt;
        const chasmText = TEXT.screens[chasmKey] || TEXT.screens.chasm_abyss;
        html += '<p>' + esc(T(chasmText, chasmKey + ":" + state.tick)) + '</p>';
        if (state.floor === 0) {
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
            Chasm.jump(state.side);
            setTimeout(function () { Engine.goto("Falling"); }, 0);
            return;
        }
        const btn = document.getElementById("chasm-jump-yes");
        if (btn) {
            btn.addEventListener("click", function (ev) {
                ev.preventDefault();
                Chasm.jump(state.side);
                Engine.goto("Falling");
            });
        }
    },
});

/* ---------- Falling ---------- */

Engine.register("Falling", {
    enter() {},
    render() {
        const f = state.falling;
        if (!f) {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }

        const alt = Chasm.getAltitude();
        const chance = Chasm.getGrabChance();
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

        function doFallTick() {
            // Preserve trauma damage — applyMortality resets to 100 when healthy
            const mortalityBefore = state.mortality;
            Tick.onMove();
            state.mortality = Math.min(state.mortality, mortalityBefore);

            if (state.dead) {
                Engine.goto("Death");
            } else if (!state.falling) {
                // Landed (fatal landing goes through state.dead above)
                Engine.goto("Corridor");
            } else {
                Engine.goto("Falling");
            }
        }

        if (waitBtn) {
            waitBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                doFallTick();
            });
        }
        if (grabBtn) {
            grabBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                const result = Chasm.grab();
                if (result.success) {
                    Engine.goto("Corridor");
                } else {
                    state._grabFailed = { mortalityHit: result.mortalityHit };
                    doFallTick();
                }
            });
        }
        if (throwBtn) {
            throwBtn.addEventListener("click", function (ev) {
                ev.preventDefault();
                Chasm.throwBook();
                Engine.goto("Falling");
            });
        }
    },
});

/* ---------- Death ---------- */

Engine.register("Death", {
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
