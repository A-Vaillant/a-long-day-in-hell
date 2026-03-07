/* Godmode — library observation mode.
 * Activated by ?godmode=1 URL param.
 * Replaces the normal game UI with a simulation viewer:
 * vertical chasm cross-section, NPC dots, click to follow.
 *
 * World setup (seed, NPCs, social, tick) is shared with normal mode
 * and handled by Engine.init(). This module only handles the godmode
 * UI, tick loop, and rendering.
 */

import { state } from "./state.js";
import { Social } from "./social.js";
import { Tick } from "./tick.js";
import { GodmodeMap } from "./godmode-map.js";
import { GodmodePanel } from "./godmode-panel.js";
import { GodmodeLog } from "./godmode-log.js";
import { detectEvents } from "./godmode-detect.js";
import { getComponent } from "../../lib/ecs.core.js";
import { TICKS_PER_DAY, LIGHTS_ON_TICKS } from "../../lib/tick.core.js";

let running = false;
let speed = 1;          // ticks per second (continuous via slider)
let lastFrame = 0;
let accumulator = 0;
let selectedNpcId = null;
let followMode = false;
let activeTab = "log"; // "log" | "npc"
let prevSnap = null;
let ffBusy = false;     // true during async fast-forward

// Slider: logarithmic 1x–200x
const SPEED_MIN = 0;    // log2(1)
const SPEED_MAX = Math.log2(200);

function tickOnce() {
    const before = snapshot();
    Tick.advance(1);
    Social.onTick();
    const after = snapshot();
    const events = detectEvents(before, after);
    for (const ev of events) GodmodeLog.push(ev);
    prevSnap = after;
}

function snapshot() {
    const npcs = [];
    if (!state.npcs) return { npcs, day: state.day, tick: state.tick, lightsOn: state.lightsOn };

    const world = Social.getWorld();

    for (const npc of state.npcs) {
        const psych = Social.getNpcPsych(npc.id);
        const ent = Social.getNpcEntity(npc.id);

        let personality = null;
        let bonds = [];
        let groupId = null;

        if (world && ent !== undefined) {
            const persComp = getComponent(world, ent, "personality");
            if (persComp) {
                personality = { ...persComp };
            }
            const groupComp = getComponent(world, ent, "group");
            if (groupComp) groupId = groupComp.groupId;

            const relsComp = getComponent(world, ent, "relationships");
            if (relsComp && relsComp.bonds) {
                for (const [otherEnt, bond] of relsComp.bonds) {
                    const otherIdent = getComponent(world, otherEnt, "identity");
                    if (otherIdent) {
                        bonds.push({
                            name: otherIdent.name,
                            familiarity: bond.familiarity,
                            affinity: bond.affinity,
                        });
                    }
                }
            }
        }

        npcs.push({
            id: npc.id,
            name: npc.name,
            side: npc.side,
            position: npc.position,
            floor: npc.floor,
            disposition: npc.disposition,
            alive: npc.alive,
            lucidity: psych ? psych.lucidity : 100,
            hope: psych ? psych.hope : 100,
            personality,
            bonds,
            groupId,
        });
    }

    return {
        npcs,
        day: state.day,
        tick: state.tick,
        lightsOn: state.lightsOn,
    };
}

const LOG_COLORS = {
    bond: "#b8a878",
    disposition: "#c49530",
    death: "#9a2a2a",
    resurrection: "#6a8a5a",
    group: "#7a8ab8",
};

function renderLog() {
    const el = document.getElementById("gm-log-pane");
    if (!el) return;

    const recent = GodmodeLog.getRecent(100);
    let html = '';
    for (const ev of recent) {
        const color = LOG_COLORS[ev.type] || "#b8a878";
        const mins = (ev.tick / 240) * 24 * 60 + 6 * 60;
        const hh = String(Math.floor(mins / 60) % 24).padStart(2, "0");
        const mm = String(Math.floor(mins % 60)).padStart(2, "0");
        html += '<div class="gm-log-entry" style="color:' + color + '">' +
            '<span class="gm-log-time">d' + (ev.day - 1) + ' ' + hh + ':' + mm + '</span>' +
            ev.text + '</div>';
    }
    if (recent.length === 0) {
        html = '<div class="gm-log-empty">No events yet.</div>';
    }
    el.innerHTML = html;
}

function switchTab(tab) {
    activeTab = tab;
    const logPane = document.getElementById("gm-log-pane");
    const npcPane = document.getElementById("gm-npc-pane");
    const logTab = document.getElementById("gm-tab-log");
    const npcTab = document.getElementById("gm-tab-npc");
    if (!logPane) return;

    logPane.className = tab === "log" ? "gm-pane gm-pane-active" : "gm-pane";
    npcPane.className = tab === "npc" ? "gm-pane gm-pane-active" : "gm-pane";
    logTab.className = tab === "log" ? "gm-tab gm-tab-active" : "gm-tab";
    npcTab.className = tab === "npc" ? "gm-tab gm-tab-active" : "gm-tab";
}

function render() {
    const snap = snapshot();
    GodmodeMap.draw(snap, selectedNpcId, followMode);
    GodmodePanel.update(snap, selectedNpcId);
    if (activeTab === "log") renderLog();
}

function cancelFF() {
    if (!ffBusy) return;
    ffBusy = false;
    updateFFStatus(0, 0);
    updatePlayButton();
    render();
}

function fastForward(n) {
    if (ffBusy || n <= 0) return;
    ffBusy = true;
    const wasRunning = running;
    running = false;
    updatePlayButton();

    const BATCH = 50;
    let remaining = n;

    function step() {
        if (!ffBusy) return; // cancelled
        const chunk = Math.min(remaining, BATCH);
        for (let i = 0; i < chunk; i++) tickOnce();
        remaining -= chunk;
        updateFFStatus(n - remaining, n);

        if (remaining > 0) {
            requestAnimationFrame(step);
        } else {
            ffBusy = false;
            updateFFStatus(0, 0);
            if (wasRunning) {
                running = true;
                updatePlayButton();
            }
            render();
        }
        render();
    }
    requestAnimationFrame(step);
}

function skipToDawn() {
    const ticksLeft = TICKS_PER_DAY - state.tick;
    if (ticksLeft > 0) fastForward(ticksLeft);
}

function skipToNight() {
    if (state.tick < LIGHTS_ON_TICKS) {
        fastForward(LIGHTS_ON_TICKS - state.tick);
    } else {
        // Already past lights-out; skip to next day's lights-out
        fastForward(TICKS_PER_DAY - state.tick + LIGHTS_ON_TICKS);
    }
}

function skipDays(n) {
    fastForward(TICKS_PER_DAY * n);
}

function updatePlayButton() {
    const btn = document.getElementById("gm-play");
    if (btn) btn.textContent = running ? "\u23F8" : "\u25B6";
}

function updateFFStatus(done, total) {
    const el = document.getElementById("gm-status");
    if (!el) return;
    if (total === 0) { el.textContent = ""; return; }
    el.textContent = "FF " + done + "/" + total;
}

function updateSpeedLabel() {
    const el = document.getElementById("gm-speed-label");
    if (el) el.textContent = (speed < 10 ? speed.toFixed(1) : Math.round(speed)) + "x";
}

function setSpeedFromSlider(val) {
    speed = Math.pow(2, val);
    if (speed < 1.05) speed = 1;
    updateSpeedLabel();
}

function loop(now) {
    if (!running || ffBusy) {
        lastFrame = now;
        requestAnimationFrame(loop);
        return;
    }

    const dt = Math.min(now - lastFrame, 1000);
    lastFrame = now;

    const tickInterval = 1000 / speed;
    accumulator += dt;

    // Batch multiple ticks per frame at high speeds (cap at 10 per frame)
    let ticked = 0;
    while (accumulator >= tickInterval && ticked < 10) {
        accumulator -= tickInterval;
        tickOnce();
        ticked++;
    }
    if (accumulator > tickInterval * 2) accumulator = 0;

    render();
    requestAnimationFrame(loop);
}

function setupDOM() {
    document.body.innerHTML = '';
    document.body.className = 'godmode';

    const container = document.createElement("div");
    container.id = "godmode-container";

    const mapWrap = document.createElement("div");
    mapWrap.id = "godmode-map-wrap";
    const canvas = document.createElement("canvas");
    canvas.id = "godmode-canvas";
    mapWrap.appendChild(canvas);

    const controls = document.createElement("div");
    controls.id = "godmode-controls";
    controls.innerHTML =
        '<span id="gm-day">Day 0</span>' +
        '<span id="gm-tick">0:00</span>' +
        '<div class="gm-ctrl-sep"></div>' +
        '<button id="gm-play"><kbd>\u2423</kbd>\u25B6</button>' +
        '<button id="gm-step"><kbd>.</kbd>+1</button>' +
        '<div class="gm-ctrl-sep"></div>' +
        '<div class="gm-speed-wrap">' +
            '<kbd>[</kbd>' +
            '<input type="range" id="gm-speed-slider" min="' + SPEED_MIN + '" max="' + SPEED_MAX.toFixed(2) + '" step="0.01" value="0">' +
            '<kbd>]</kbd>' +
            '<span id="gm-speed-label">1x</span>' +
        '</div>' +
        '<div class="gm-ctrl-sep"></div>' +
        '<button id="gm-skip-dawn"><kbd>d</kbd>\u263C</button>' +
        '<button id="gm-skip-night"><kbd>n</kbd>\u263E</button>' +
        '<button id="gm-skip-day"><kbd>D</kbd>+1d</button>' +
        '<input type="number" id="gm-ff-input" min="1" placeholder="ticks" title="Type ticks, Enter to skip">' +
        '<div class="gm-ctrl-sep"></div>' +
        '<span id="gm-zoom">1x</span>' +
        '<span id="gm-status"></span>';
    mapWrap.appendChild(controls);

    // Tabbed right panel
    const panel = document.createElement("div");
    panel.id = "godmode-panel";

    const tabBar = document.createElement("div");
    tabBar.id = "gm-tab-bar";
    tabBar.innerHTML =
        '<button id="gm-tab-log" class="gm-tab gm-tab-active">log</button>' +
        '<button id="gm-tab-npc" class="gm-tab">npc</button>';
    panel.appendChild(tabBar);

    const logPane = document.createElement("div");
    logPane.id = "gm-log-pane";
    logPane.className = "gm-pane gm-pane-active";
    logPane.innerHTML = '<div class="gm-log-empty">No events yet.</div>';
    panel.appendChild(logPane);

    const npcPane = document.createElement("div");
    npcPane.id = "gm-npc-pane";
    npcPane.className = "gm-pane";
    npcPane.innerHTML = '<div class="gm-panel-empty">Click an NPC to observe</div>';
    panel.appendChild(npcPane);

    container.appendChild(mapWrap);
    container.appendChild(panel);
    document.body.appendChild(container);

    return canvas;
}

function setupInput(canvas) {
    document.getElementById("gm-play").addEventListener("click", function () {
        running = !running;
        updatePlayButton();
    });

    document.getElementById("gm-step").addEventListener("click", function () {
        tickOnce();
        render();
    });

    const slider = document.getElementById("gm-speed-slider");
    slider.addEventListener("input", function () {
        setSpeedFromSlider(parseFloat(this.value));
    });

    document.getElementById("gm-skip-dawn").addEventListener("click", skipToDawn);
    document.getElementById("gm-skip-night").addEventListener("click", skipToNight);
    document.getElementById("gm-skip-day").addEventListener("click", function () { skipDays(1); });

    const ffInput = document.getElementById("gm-ff-input");
    ffInput.addEventListener("keydown", function (ev) {
        ev.stopPropagation(); // don't let godmode keys fire while typing
        if (ev.key === "Enter") {
            const n = parseInt(this.value, 10);
            if (n > 0) fastForward(n);
            this.value = "";
            this.blur();
        } else if (ev.key === "Escape") {
            this.value = "";
            this.blur();
        }
    });

    document.getElementById("gm-tab-log").addEventListener("click", function () { switchTab("log"); });
    document.getElementById("gm-tab-npc").addEventListener("click", function () { switchTab("npc"); });

    // Drag to pan
    canvas.addEventListener("mousedown", function (ev) {
        GodmodeMap.dragStart(ev.clientX - canvas.getBoundingClientRect().left,
                             ev.clientY - canvas.getBoundingClientRect().top);
        canvas.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", function (ev) {
        const rect = canvas.getBoundingClientRect();
        GodmodeMap.dragMove(ev.clientX - rect.left, ev.clientY - rect.top);
        render();
    });

    window.addEventListener("mouseup", function (ev) {
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const wasDrag = GodmodeMap.dragEnd(x, y);
        canvas.style.cursor = "crosshair";

        // Only select NPC on click (not drag)
        if (!wasDrag && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
            const hit = GodmodeMap.hitTest(x, y);
            if (hit !== null) {
                selectedNpcId = hit;
                followMode = true;
                switchTab("npc");
            } else {
                selectedNpcId = null;
                followMode = false;
            }
        }
        render();
    });

    // Scroll to zoom
    canvas.addEventListener("wheel", function (ev) {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const delta = ev.deltaY < 0 ? 1 : -1;
        GodmodeMap.zoom(delta, px, py);
        followMode = false;
        render();
    }, { passive: false });

    document.addEventListener("keydown", function (ev) {
        // Don't handle keys when typing in the FF input
        if (document.activeElement === ffInput) return;

        // Cancel fast-forward on Escape or Space
        if (ffBusy && (ev.key === "Escape" || ev.key === " ")) {
            ev.preventDefault();
            cancelFF();
            return;
        }

        if (ev.key === " ") {
            ev.preventDefault();
            running = !running;
            updatePlayButton();
        } else if (ev.key === ".") {
            tickOnce();
            render();
        } else if (ev.key === "d" && !ev.shiftKey) {
            skipToDawn();
        } else if (ev.key === "D") {
            skipDays(1);
        } else if (ev.key === "n") {
            skipToNight();
        } else if (ev.key === "[") {
            // Decrease speed
            const cur = parseFloat(slider.value);
            const next = Math.max(SPEED_MIN, cur - 0.25);
            slider.value = next;
            setSpeedFromSlider(next);
        } else if (ev.key === "]") {
            // Increase speed
            const cur = parseFloat(slider.value);
            const next = Math.min(SPEED_MAX, cur + 0.25);
            slider.value = next;
            setSpeedFromSlider(next);
        } else if (ev.key === "Escape") {
            selectedNpcId = null;
            followMode = false;
            render();
        } else if (ev.key === "e") {
            switchTab(activeTab === "log" ? "npc" : "log");
        } else if (ev.key === "Tab") {
            ev.preventDefault();
            GodmodeMap.handleKey(ev.key);
            render();
        } else {
            GodmodeMap.handleKey(ev.key);
            if (ev.key !== " ") followMode = false;
            render();
        }
    });
}

export const Godmode = {
    /** Force a re-render (for screenshots / debug). */
    render,

    /** Called by Engine.init() after shared world setup. Replaces DOM and starts observation loop. */
    start() {
        GodmodeLog.init();
        const canvas = setupDOM();
        GodmodeMap.init(canvas, state);
        GodmodePanel.init({
            onSelect(id) {
                selectedNpcId = id;
                followMode = true;
                switchTab("npc");
                render();
            },
            onCenter(id) {
                selectedNpcId = id;
                followMode = true;
                render();
            },
            onDeselect() {
                selectedNpcId = null;
                followMode = false;
                render();
            },
        });
        setupInput(canvas);

        render();
        lastFrame = performance.now();
        requestAnimationFrame(loop);
    },
};
