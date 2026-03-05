/* Screens — all passage templates as JS render functions.
 * Each screen: { render() → HTML string, afterRender() (optional) }
 */

(function () {
    "use strict";

    function esc(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    /* ---------- helpers ---------- */

    function doMove(dir) {
        var loc = { side: state.side, position: state.position, floor: state.floor };
        var available = Lib.availableMoves(loc);
        if (available.indexOf(dir) === -1) return false;
        var dest = Lib.applyMove(loc, dir);
        state.side     = dest.side;
        state.position = dest.position;
        state.floor    = dest.floor;
        Tick.onMove();
        return true;
    }
    window.doMove = doMove;

    // Register named actions for event delegation (no eval/new Function)
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

    /* ---------- Corridor ---------- */

    function renderCorridorDark(loc, moves) {
        var seg = Lib.getSegment(loc.side, loc.position, loc.floor);
        var html = '<div id="corridor-view" class="mode-explore dark">';
        html += '<p class="location-header">' + esc(Tick.getTimeString()) + '</p>';

        if (seg.restArea) {
            html += '<p>' + esc(T(TEXT.screens.darkness_rest_area, "darkness_rest_area:" + state.tick)) + '</p>';
        } else {
            html += '<p>' + esc(T(TEXT.screens.darkness_corridor, "darkness_corridor:" + state.tick)) + '</p>';
        }

        var warnings = Surv.warnings();
        if (warnings.length > 0) {
            html += '<p class="warnings">';
            for (var w = 0; w < warnings.length; w++) html += esc(warnings[w]) + " ";
            html += '</p>';
        }

        html += '<div id="moves"><strong>Move:</strong> ';
        var moveLinks = [
            { dir: "left",  label: "\u2190 Left" },
            { dir: "right", label: "Right \u2192" },
            { dir: "up",    label: "\u2191 Up" },
            { dir: "down",  label: "\u2193 Down" },
            { dir: "cross", label: "\u21cc Cross" }
        ];
        for (var m = 0; m < moveLinks.length; m++) {
            if (moves.indexOf(moveLinks[m].dir) !== -1) {
                html += '<a data-goto="Corridor" data-action="move-' + moveLinks[m].dir + '">' + moveLinks[m].label + '</a> ';
            }
        }
        html += '</div>';

        html += '<div id="actions">';
        html += '<a data-goto="Wait Stub">Wait</a> | <a data-goto="Sleep Stub">Sleep</a> | <a data-goto="Chasm Stub">Jump</a>';
        if (seg.restArea) {
            html += ' | <a data-goto="Bedroom">Bedroom</a>';
        }
        html += '</div>';

        html += debugPanelHTML();
        html += '</div>';
        return html;
    }

    Engine.register("Corridor", {
        enter: function () {
            Book.clearDwell();
        },
        render: function () {
            var loc = { side: state.side, position: state.position, floor: state.floor };
            var moves = Lib.availableMoves(loc);

            if (!state.lightsOn) return renderCorridorDark(loc, moves);

            var seg = Lib.getSegment(state.side, state.position, state.floor);
            var warnings = Surv.warnings();

            var html = '<div id="corridor-view" class="mode-explore">';
            html += '<p class="location-header">' + esc(Lib.describeLocation(loc)) + '</p>';

            if (seg.lightLevel === "dim") {
                html += '<p class="dim-notice">' + esc(T(TEXT.screens.corridor_dim, "corridor_dim:" + state.tick)) + '</p>';
            }
            if (warnings.length > 0) {
                html += '<p class="warnings">';
                for (var w = 0; w < warnings.length; w++) html += esc(warnings[w]) + " ";
                html += '</p>';
            }

            if (state._readBlocked) {
                html += '<p class="despair-notice">' + esc(T(TEXT.screens.despair_read_blocked, "despair_read:" + state.tick)) + '</p>';
                state._readBlocked = false;
            }

            html += '<p>' + esc(T(TEXT.screens.corridor, "corridor:" + state.tick)) + '</p>';

            if (state.lastEvent) {
                html += '<p class="event-text">' + esc(T(state.lastEvent.text, "event:" + state.lastEvent.id + ":" + state.tick)) + '</p>';
            }

            var npcsHere = (typeof Npc !== "undefined") ? Npc.here() : [];
            if (npcsHere.length > 0) {
                html += '<div class="npc-list">';
                for (var ni = 0; ni < npcsHere.length; ni++) {
                    var n = npcsHere[ni];
                    var dispClass = n.alive ? "npc-" + n.disposition : "npc-dead";
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
                html += '<p class="feature">' + esc(T(TEXT.screens.corridor_rest, "corridor_rest:" + state.tick));
                if (state.floor > 0) html += ' and down';
                html += '.</p>';
            } else {
                html += '<div id="corridor-grid"></div>';
            }

            if (seg.hasBridge) {
                html += '<p class="feature">' + esc(T(TEXT.screens.corridor_bridge, "corridor_bridge:" + state.tick)) + '</p>';
            }

            html += '<div id="moves"><strong>Move:</strong> ';
            var moveLinks = [
                { dir: "left",  label: "\u2190 Left" },
                { dir: "right", label: "Right \u2192" },
                { dir: "up",    label: "\u2191 Up" },
                { dir: "down",  label: "\u2193 Down" },
                { dir: "cross", label: "\u21cc Cross" }
            ];
            for (var m = 0; m < moveLinks.length; m++) {
                if (moves.indexOf(moveLinks[m].dir) !== -1) {
                    html += '<a data-goto="Corridor" data-action="move-' + moveLinks[m].dir + '">' + moveLinks[m].label + '</a> ';
                }
            }
            html += '</div>';

            html += '<div id="actions">';
            html += '<a data-goto="Wait Stub">Wait</a> | <a data-goto="Sleep Stub">Sleep</a> | <a data-goto="Chasm Stub">Jump</a>';
            if (seg.restArea) {
                html += ' | <a data-goto="Kiosk">Kiosk</a> | <a data-goto="Bedroom">Bedroom</a> | <a data-goto="Submission Slot">Submit</a>';
            }
            html += '</div>';

            html += debugPanelHTML();
            html += '</div>';
            return html;
        },

        afterRender: function () {
            if (!state.lightsOn) return;
            var seg = Lib.getSegment(state.side, state.position, state.floor);
            if (seg.restArea) return;

            var COUNT = 192;
            var grid = document.createElement("div");
            grid.className = "shelf-grid";

            for (var bi = 0; bi < COUNT; bi++) {
                var isHeld = state.heldBook !== null && state.heldBook.side === state.side &&
                    state.heldBook.position === state.position && state.heldBook.floor === state.floor &&
                    state.heldBook.bookIndex === bi;
                var isTarget = state.targetBook.side === state.side &&
                    state.targetBook.position === state.position && state.targetBook.floor === state.floor &&
                    state.targetBook.bookIndex === bi;
                var rng = PRNG.fork("spine:" + state.side + ":" + state.position + ":" + state.floor + ":" + bi);
                var h = Math.floor(rng.next() * 30);
                var s = 15 + Math.floor(rng.next() * 20);
                var l = 12 + Math.floor(rng.next() * 14);
                var spine = document.createElement("div");
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
                        state.openPage = 0;
                        Engine.goto("Shelf Open Book");
                    };
                })(bi));
                grid.appendChild(spine);
            }

            var container = document.getElementById("corridor-grid");
            if (container) container.appendChild(grid);
        }
    });

    /* ---------- Shelf Open Book ---------- */

    Engine.register("Shelf Open Book", {
        render: function () {
            if (state.openBook === null || !state.lightsOn) {
                Engine.goto("Corridor");
                return "";
            }
            var bk = state.openBook;
            var pg = state.openPage;
            var maxPage = Book.PAGES_PER_BOOK + 1; // +1 for back cover
            var isHeld = state.heldBook !== null && state.heldBook.side === bk.side &&
                state.heldBook.position === bk.position && state.heldBook.floor === bk.floor &&
                state.heldBook.bookIndex === bk.bookIndex;
            var isTarget = bk.side === state.targetBook.side && bk.position === state.targetBook.position &&
                bk.floor === state.targetBook.floor && bk.bookIndex === state.targetBook.bookIndex;

            var html = '<div id="book-view" class="mode-book">';

            if (pg === 0) {
                html += '<p class="location-header">Book #' + (bk.bookIndex + 1) + ' — Cover</p>';
            } else if (pg === maxPage) {
                html += '<p class="location-header">Book #' + (bk.bookIndex + 1) + ' — Back Cover</p>';
            } else {
                html += '<p class="location-header">Book #' + (bk.bookIndex + 1) + ' — Page ' + pg + ' / ' + Book.PAGES_PER_BOOK + '</p>';
            }

            if (isTarget) {
                html += '<p class="target-book-hint">Something about this book makes you stop.</p>';
            }

            html += '<div class="book-single" id="book-single"></div>';
            html += '<div id="book-notices"></div>';

            html += '<div id="page-nav">';
            if (pg > 0) html += '<a data-goto="Shelf Open Book" data-action="page-prev">\u25c0</a>  ';
            if (pg < maxPage) html += '<a data-goto="Shelf Open Book" data-action="page-next">\u25b6</a>';
            html += '</div>';

            // Register take/swap action for this specific book
            Engine.action("take-book", function () {
                state.heldBook = { side: bk.side, position: bk.position, floor: bk.floor, bookIndex: bk.bookIndex };
            });

            html += '<div id="book-actions">';
            if (isHeld) {
                html += '<a data-goto="Corridor" data-action="drop-book">Put back</a>';
            } else if (state.heldBook !== null) {
                html += '<a data-goto="Corridor" data-action="take-book">Swap</a>';
            } else {
                html += '<a data-goto="Corridor" data-action="take-book">Take</a>';
            }
            html += ' | <a data-goto="Corridor">Back</a>';
            html += '</div>';

            html += '</div>';
            return html;
        },

        afterRender: function () {
            var pg = state.openPage;
            var bk = state.openBook;
            if (!bk) { Book.clearDwell(); return; }
            var el = document.getElementById("book-single");
            if (!el) return;

            if (pg === 0) {
                el.className = "book-single book-page-cover";
                el.textContent = "Book " + (bk.bookIndex + 1);
                Book.clearDwell();
            } else if (pg === Book.PAGES_PER_BOOK + 1) {
                el.className = "book-single book-page-cover book-page-back";
                Book.clearDwell();
            } else {
                var pageText = Book.getPage(bk.side, bk.position, bk.floor, bk.bookIndex, pg - 1);
                el.textContent = pageText;
                var frag = Book.findCoherentFragment(pageText);
                var notices = document.getElementById("book-notices");
                if (notices && frag && frag.length > 6) {
                    notices.innerHTML = '<p class="coherent-fragment">You notice: <em>"' + esc(frag.trim()) + '"</em></p>';
                }
                Book.startDwell(bk, pg - 1, pageText);
            }
        }
    });

    /* ---------- Life Story ---------- */

    Engine.register("Life Story", {
        render: function () {
            return '<div id="lifestory-view">' +
                LifeStory.format(state.lifeStory) +
                '<hr>' +
                '<p><em>Your book is somewhere on the ' + (state.targetBook.side === 0 ? "west" : "east") +
                ' side, floor ' + state.targetBook.floor + '.</em></p>' +
                '<p class="key-hint"><a data-goto="Corridor">[E] Continue</a></p>' +
                '</div>';
        }
    });

    /* ---------- Kiosk ---------- */

    Engine.register("Kiosk", {
        render: function () {
            if (!state.lightsOn) {
                return '<div id="kiosk-view">' +
                    '<p class="location-header">Kiosk</p>' +
                    '<p>' + esc(T(TEXT.screens.kiosk_dark, "kiosk_dark:" + state.tick)) + '</p>' +
                    '<a data-goto="Corridor">Leave</a>' +
                    '</div>';
            }
            return '<div id="kiosk-view">' +
                '<p class="location-header">Kiosk</p>' +
                '<p>' + esc(T(TEXT.screens.kiosk_intro, "kiosk_intro:" + state.tick)) + '</p>' +
                '<a data-goto="Kiosk Get Drink">Ask for water</a><br>' +
                '<a data-goto="Kiosk Get Food">Ask for food</a><br>' +
                '<a data-goto="Kiosk Get Alcohol">Ask for a drink</a><br>' +
                '<a data-goto="Corridor">Leave</a>' +
                '</div>';
        }
    });

    Engine.register("Kiosk Get Drink", {
        enter: function () { Tick.advance(1); Surv.onDrink(); },
        render: function () {
            return '<p>' + esc(T(TEXT.screens.kiosk_drink, "kiosk_drink:" + state.tick)) + '</p>' +
                '<a data-goto="Kiosk">Continue</a>';
        }
    });

    Engine.register("Kiosk Get Food", {
        enter: function () { Tick.advance(1); Surv.onEat(); },
        render: function () {
            return '<p>' + esc(T(TEXT.screens.kiosk_food, "kiosk_food:" + state.tick)) + '</p>' +
                '<a data-goto="Kiosk">Continue</a>';
        }
    });

    Engine.register("Kiosk Get Alcohol", {
        enter: function () { Tick.advance(1); Surv.onAlcohol(); },
        render: function () {
            return '<p>' + esc(T(TEXT.screens.kiosk_alcohol, "kiosk_alcohol:" + state.tick)) + '</p>' +
                '<a data-goto="Kiosk">Continue</a>';
        }
    });

    /* ---------- Bedroom ---------- */

    Engine.register("Bedroom", {
        render: function () {
            return '<div id="bedroom-view">' +
                '<p class="location-header">Bedroom</p>' +
                '<p>' + esc(T(TEXT.screens.bedroom_intro, "bedroom_intro:" + state.tick)) + '</p>' +
                '<a data-goto="Sleep Stub">Sleep</a><br>' +
                '<a data-goto="Corridor">Leave</a>' +
                '</div>';
        }
    });

    /* ---------- Submission Slot ---------- */

    Engine.register("Submission Slot", {
        render: function () {
            var attempts = state.submissionsAttempted || 0;
            var html = '<div id="submission-view">' +
                '<p class="location-header">Submission Slot</p>' +
                '<p>' + esc(T(TEXT.screens.submission_intro, "submission_intro:" + state.tick)) + '</p>' +
                '<p>You have submitted ' + attempts + ' book' + (attempts !== 1 ? 's' : '') + ' so far.</p>';

            if (state.heldBook !== null) {
                html += '<a data-goto="Submission Attempt">Submit held book</a><br>';
            } else {
                html += '<p><em>You are not holding a book.</em></p>';
            }

            html += '<a data-goto="Corridor">Leave</a></div>';
            return html;
        }
    });

    Engine.register("Submission Attempt", {
        enter: function () {
            state.submissionsAttempted = (state.submissionsAttempted || 0) + 1;
            state._submissionWon = false;
            var hb = state.heldBook;
            var tb = state.targetBook;
            if (hb && hb.side === tb.side && hb.position === tb.position &&
                hb.floor === tb.floor && hb.bookIndex === tb.bookIndex) {
                state._submissionWon = true;
            } else {
                state.heldBook = null;
            }
        },
        render: function () {
            if (state._submissionWon) {
                setTimeout(function () { Engine.goto("Win"); }, 0);
                return "";
            }
            return '<p>' + esc(T(TEXT.screens.submission_fail, "submission_fail:" + state.tick)) + '</p>' +
                '<a data-goto="Corridor">Continue</a>';
        }
    });

    /* ---------- Win ---------- */

    Engine.register("Win", {
        enter: function () {
            state.won = true;
            Engine.save();
        },
        render: function () {
            var tb = state.targetBook;
            var sideLabel = tb.side === 0 ? "west" : "east";
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
        afterRender: function () {
            var link = document.getElementById("new-game-link");
            if (link) {
                link.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    Engine.clearSave();
                    window.location.reload();
                });
            }
        }
    });

    /* ---------- Menu ---------- */

    Engine.register("Menu", {
        enter: function () {
            if (!state._menuReturn) state._menuReturn = "Corridor";
            if (state._menuSaved === undefined) state._menuSaved = false;
            if (state._menuConfirmNew === undefined) state._menuConfirmNew = false;
        },
        render: function () {
            var html = '<div id="menu-view">';
            html += '<p class="location-header">Menu</p>';

            if (state._menuSaved) {
                html += '<p class="menu-confirm">Game saved. (Day ' + state.day + ', ' + Tick.getTimeString() + ')</p>';
            }

            if (state._menuConfirmNew) {
                html += '<p class="menu-warning">Start a new game? Current progress will be lost.</p>';
                html += '<p><a id="menu-confirm-new">Yes, start over</a> | <a data-goto="Menu">No, go back</a></p>';
            } else {
                html += '<p><a data-goto="' + esc(state._menuReturn) + '">Resume</a></p>';
                html += '<p><a id="menu-save">Save game</a></p>';
                html += '<p><a id="menu-new-game">New game</a></p>';
            }

            html += '</div>';
            return html;
        },
        afterRender: function () {
            var saveLink = document.getElementById("menu-save");
            if (saveLink) {
                saveLink.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    Engine.save();
                    state._menuSaved = true;
                    Engine.goto("Menu");
                });
            }
            var newLink = document.getElementById("menu-new-game");
            if (newLink) {
                newLink.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    state._menuConfirmNew = true;
                    Engine.goto("Menu");
                });
            }
            var confirmLink = document.getElementById("menu-confirm-new");
            if (confirmLink) {
                confirmLink.addEventListener("click", function (ev) {
                    ev.preventDefault();
                    Engine.clearSave();
                    window.location.reload();
                });
            }
        }
    });

    /* ---------- Stubs ---------- */

    Engine.register("Wait Stub", {
        enter: function () { Tick.onMove(); },
        render: function () {
            setTimeout(function () { Engine.goto("Corridor"); }, 0);
            return "";
        }
    });

    Engine.register("Sleep Stub", {
        enter: function () { Tick.onSleep(); },
        render: function () {
            return '<p>' + esc(T(TEXT.screens.sleep, "sleep:" + state.day)) + '</p>' +
                '<a data-goto="Corridor">Get up</a>';
        }
    });

    Engine.register("Chasm Stub", {
        render: function () {
            return '<p>' + esc(T(TEXT.screens.chasm, "chasm:" + state.tick)) + '</p>' +
                '<a data-goto="Corridor">Back</a>';
        }
    });

    /* ---------- Death ---------- */

    Engine.register("Death", {
        enter: function () {
            Tick.onForcedSleep();
        },
        render: function () {
            var causeKey = "death_" + (state.deathCause || "mortality");
            var causeText = TEXT.screens[causeKey] || TEXT.screens.death_mortality;
            return '<div id="death-view">' +
                '<p>' + esc(T(causeText, causeKey + ":" + state.day)) + '</p>' +
                '<hr>' +
                '<p>' + esc(T(TEXT.screens.resurrection, "resurrection:" + state.day)) + '</p>' +
                '<p>Day ' + state.day + '. Deaths: ' + state.deaths + '.</p>' +
                '<p><a data-goto="Corridor">Continue</a></p>' +
                '</div>';
        }
    });

}());
