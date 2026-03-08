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
import { Engine } from "./engine.js";
import { GodmodeMap } from "./godmode-map.js";
import { GodmodePanel } from "./godmode-panel.js";
import { GodmodeLog } from "./godmode-log.js";
import { GodmodeTrends } from "./godmode-trends.js";
import { detectEvents } from "./godmode-detect.js";
import { appendEvents } from "./event-log.js";
import { createSearchOverlay } from "./godmode-overlays.js";
import { getComponent } from "../../lib/ecs.core.ts";
import { TICKS_PER_DAY, LIGHTS_ON_TICKS } from "../../lib/tick.core.ts";

let running = true;
let speed = 1;          // ticks per second (continuous via slider)
let lastFrame = 0;
let accumulator = 0;
let selectedNpcId = null;
let followMode = false;
let activeTab = "log"; // "log" | "npc" | "grp" | "trend"
let prevSnap = null;
let ffBusy = false;     // true during async fast-forward
const BATCH_MODE = false; // TODO: re-enable once batch mode bugs are fixed
let possessing = false; // true while controlling an NPC
let godmodeDOM = null;  // saved godmode container for restoration

// Slider: logarithmic 1x–10000x
const SPEED_MIN = 0;    // log2(1)
const SPEED_MAX = Math.log2(10000);

function tickOnce() {
    const before = prevSnap || snapshot();
    Tick.advance(1);
    // Social.onTick() is already called by Tick.advance — do NOT double-call
    const after = snapshot();
    const events = detectEvents(before, after);
    if (events.length > 0) {
        appendEvents(events);
        for (const ev of events) GodmodeLog.push(ev);
    }
    GodmodeTrends.record(after);
    prevSnap = after;
}

// Components to skip in auto-discovery (redundant with flat fields or empty tags)
const SKIP_COMPONENTS = new Set(["identity", "position", "player", "ai", "movement"]);

function snapshot() {
    const npcs = [];
    if (!state.npcs) return { npcs, day: state.day, tick: state.tick, lightsOn: state.lightsOn };

    const world = Social.getWorld();
    const playerEnt = Social.getPlayerEntity();

    for (const npc of state.npcs) {
        const psych = Social.getNpcPsych(npc.id);
        const ent = Social.getNpcEntity(npc.id);

        // Auto-collect all ECS components for this entity
        const components = {};
        let bonds = [];
        let groupId = null;

        if (world && ent !== undefined) {
            for (const key of world.components.keys()) {
                if (SKIP_COMPONENTS.has(key)) continue;
                const comp = getComponent(world, ent, key);
                if (comp === undefined) continue;

                if (key === "relationships") {
                    // Serialize bonds Map → array with resolved names
                    if (comp.bonds) {
                        const pName = (state.lifeStory && state.lifeStory.name) || "Player";
                        for (const [otherEnt, bond] of comp.bonds) {
                            const otherIdent = getComponent(world, otherEnt, "identity");
                            if (otherIdent) {
                                bonds.push({
                                    name: otherEnt === playerEnt ? pName : otherIdent.name,
                                    familiarity: bond.familiarity,
                                    affinity: bond.affinity,
                                    isPlayer: otherEnt === playerEnt,
                                });
                            }
                        }
                    }
                    components[key] = { bonds };
                } else if (key === "habituation") {
                    // Serialize exposures Map → object
                    const exposures = {};
                    if (comp.exposures) {
                        for (const [k, v] of comp.exposures) {
                            const ident = getComponent(world, k, "identity");
                            exposures[ident ? ident.name : k] = v;
                        }
                    }
                    components[key] = { exposures };
                } else if (key === "memory") {
                    // Serialize memory entries — resolve subject entity → name
                    const entries = (comp.entries || []).map(e => {
                        let subjectName = null;
                        if (e.subject != null) {
                            const subjIdent = getComponent(world, e.subject, "identity");
                            subjectName = subjIdent ? subjIdent.name : String(e.subject);
                        }
                        return {
                            id: e.id,
                            type: e.type,
                            tick: e.tick,
                            weight: e.weight,
                            initialWeight: e.initialWeight,
                            permanent: e.permanent,
                            contagious: e.contagious,
                            subjectName,
                        };
                    });
                    components[key] = { entries, capacity: comp.capacity };
                } else if (key === "knowledge") {
                    // Serialize searchedSegments Set → array of "side:pos:floor" keys
                    components[key] = {
                        ...comp,
                        searchedSegments: comp.searchedSegments ? [...comp.searchedSegments] : [],
                    };
                } else {
                    // Shallow copy plain data components
                    components[key] = { ...comp };
                }
            }

            if (components.group) {
                groupId = components.group.groupId;
                // Resolve leaderId entity → name for display
                if (components.group.leaderId != null) {
                    const leaderIdent = getComponent(world, components.group.leaderId, "identity");
                    components.group.leaderName = leaderIdent ? leaderIdent.name : null;
                }
            }
        }

        // Check identity.free from ECS
        let free = false;
        if (world && ent !== undefined) {
            const identComp = getComponent(world, ent, "identity");
            if (identComp) free = !!identComp.free;
        }

        npcs.push({
            // Flat fields for backwards compat (detection, map, list view)
            id: npc.id,
            name: npc.name,
            side: npc.side,
            position: npc.position,
            floor: npc.floor,
            disposition: npc.disposition,
            alive: npc.alive,
            free,
            lucidity: psych ? psych.lucidity : 100,
            hope: psych ? psych.hope : 100,
            bonds,
            groupId,
            // All ECS components for auto-populating detail view
            components,
            falling: npc.falling || null,
        });
    }

    // Add player entity to snapshot
    if (world && playerEnt !== null) {
        const pPos = getComponent(world, playerEnt, "position");
        const pPsych = getComponent(world, playerEnt, "psychology");
        const pIdent = getComponent(world, playerEnt, "identity");
        if (pPos && pPsych && pIdent) {
            // Collect player ECS components + bonds like NPCs
            const pComponents = {};
            let pBonds = [];
            let pGroupId = null;
            for (const key of world.components.keys()) {
                if (SKIP_COMPONENTS.has(key)) continue;
                const comp = getComponent(world, playerEnt, key);
                if (comp === undefined) continue;
                if (key === "relationships") {
                    if (comp.bonds) {
                        for (const [otherEnt, bond] of comp.bonds) {
                            const otherIdent = getComponent(world, otherEnt, "identity");
                            if (otherIdent) {
                                pBonds.push({
                                    name: otherIdent.name,
                                    familiarity: bond.familiarity,
                                    affinity: bond.affinity,
                                    isPlayer: false,
                                });
                            }
                        }
                    }
                    pComponents[key] = { bonds: pBonds };
                } else if (key === "habituation") {
                    const exposures = {};
                    if (comp.exposures) {
                        for (const [k, v] of comp.exposures) {
                            const ident = getComponent(world, k, "identity");
                            exposures[ident ? ident.name : k] = v;
                        }
                    }
                    pComponents[key] = { exposures };
                } else if (key === "memory") {
                    const entries = (comp.entries || []).map(e => {
                        let subjectName = null;
                        if (e.subject != null) {
                            const subjIdent = getComponent(world, e.subject, "identity");
                            subjectName = subjIdent ? subjIdent.name : String(e.subject);
                        }
                        return {
                            id: e.id, type: e.type, tick: e.tick,
                            weight: e.weight, initialWeight: e.initialWeight,
                            permanent: e.permanent, contagious: e.contagious,
                            subjectName,
                        };
                    });
                    pComponents[key] = { entries, capacity: comp.capacity };
                } else {
                    pComponents[key] = { ...comp };
                }
            }
            if (pComponents.group) {
                pGroupId = pComponents.group.groupId;
                if (pComponents.group.leaderId != null) {
                    const leaderIdent = getComponent(world, pComponents.group.leaderId, "identity");
                    pComponents.group.leaderName = leaderIdent ? leaderIdent.name : null;
                }
            }

            const playerName = (state.lifeStory && state.lifeStory.name) || "Player";
            npcs.push({
                id: -1,
                name: playerName,
                side: pPos.side,
                position: pPos.position,
                floor: pPos.floor,
                disposition: "calm",
                alive: pIdent.alive,
                free: false,
                lucidity: pPsych.lucidity,
                hope: pPsych.hope,
                bonds: pBonds,
                groupId: pGroupId,
                components: pComponents,
                falling: null,
                isPlayer: true,
            });
        }
    }

    return {
        npcs,
        day: state.day,
        tick: state.tick,
        lightsOn: state.lightsOn,
    };
}

function renderLog() {
    GodmodeLog.renderTo(document.getElementById("gm-log-pane"), state.npcs, state.day);
}

function switchTab(tab) {
    activeTab = tab;
    const panes = { log: "gm-log-pane", npc: "gm-npc-pane", grp: "gm-grp-pane", trend: "gm-trend-pane" };
    const tabs = { log: "gm-tab-log", npc: "gm-tab-npc", grp: "gm-tab-grp", trend: "gm-tab-trend" };
    for (const key in panes) {
        const p = document.getElementById(panes[key]);
        const t = document.getElementById(tabs[key]);
        if (p) p.className = key === tab ? "gm-pane gm-pane-active" : "gm-pane";
        if (t) t.className = key === tab ? "gm-tab gm-tab-active" : "gm-tab";
    }
}

function render(forcePanel) {
    const snap = snapshot();
    GodmodeMap.draw(snap, selectedNpcId, followMode);
    GodmodePanel.update(snap, selectedNpcId, forcePanel);
    if (activeTab === "log") renderLog();
    if (activeTab === "grp") GodmodePanel.updateGroups(snap);
    if (activeTab === "trend") GodmodeTrends.renderTo(document.getElementById("gm-trend-pane"));
}

function cancelFF() {
    if (!ffBusy) return;
    ffBusy = false;
    updateFFStatus(0, 0);
    updatePlayButton();
    render();
}

function tickBatch(n) {
    // Advance n ticks — take before/after snapshots so events aren't lost.
    // Won't have exact tick timing, but catches deaths, disposition changes, etc.
    const before = prevSnap || snapshot();
    Tick.advance(n);
    const after = snapshot();
    const events = detectEvents(before, after);
    if (events.length > 0) {
        appendEvents(events);
        for (const ev of events) GodmodeLog.push(ev);
    }
    GodmodeTrends.record(after);
    prevSnap = after;
}

function fastForward(n) {
    if (ffBusy || n <= 0) return;
    ffBusy = true;
    const wasRunning = running;
    running = false;
    updatePlayButton();

    const useBatch = BATCH_MODE && n > 500;
    const CHUNK = useBatch ? 240 : 50;
    let remaining = n;

    function step() {
        if (!ffBusy) return; // cancelled
        const frameStart = performance.now();
        try {
            // Spend up to 12ms per frame on simulation
            while (remaining > 0 && (performance.now() - frameStart) < 12) {
                const chunk = Math.min(remaining, CHUNK);
                if (useBatch) {
                    tickBatch(chunk);
                } else {
                    for (let i = 0; i < chunk; i++) tickOnce();
                }
                remaining -= chunk;
            }
            updateFFStatus(n - remaining, n);
        } catch (err) {
            console.error("FF error:", err);
            remaining = 0;
        }

        if (remaining > 0) {
            render();
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
    if (possessing) return; // normal game loop runs instead
    if (!running || ffBusy) {
        lastFrame = now;
        requestAnimationFrame(loop);
        return;
    }

    const dt = Math.min(now - lastFrame, 1000);
    lastFrame = now;

    const tickInterval = 1000 / speed;
    accumulator += dt;

    // Batch multiple ticks per frame at high speeds
    let ticked = 0;
    const maxPerFrame = BATCH_MODE && speed > 500 ? 240 : 50;
    if (BATCH_MODE && speed > 500) {
        // Batch mode: advance in chunks, skip per-tick event detection
        while (accumulator >= tickInterval && ticked < maxPerFrame) {
            const chunk = Math.min(Math.floor(accumulator / tickInterval), maxPerFrame - ticked);
            accumulator -= tickInterval * chunk;
            tickBatch(chunk);
            ticked += chunk;
        }
    } else {
        while (accumulator >= tickInterval && ticked < maxPerFrame) {
            accumulator -= tickInterval;
            tickOnce();
            ticked++;
        }
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
        '<button id="gm-play" title="Play / Pause (Space)"><kbd>\u2423</kbd>\u23F8</button>' +
        '<button id="gm-step" title="Advance 1 tick (.)"><kbd>.</kbd>+1</button>' +
        '<div class="gm-ctrl-sep"></div>' +
        '<div class="gm-speed-wrap" title="Simulation speed ([ slower, ] faster)">' +
            '<kbd>[</kbd>' +
            '<input type="range" id="gm-speed-slider" min="' + SPEED_MIN + '" max="' + SPEED_MAX.toFixed(2) + '" step="0.01" value="0">' +
            '<kbd>]</kbd>' +
            '<span id="gm-speed-label">1x</span>' +
        '</div>' +
        '<div class="gm-ctrl-sep"></div>' +
        '<button id="gm-skip-dawn" title="Skip to dawn (d)"><kbd>d</kbd>\u263C</button>' +
        '<button id="gm-skip-night" title="Skip to nightfall (n)"><kbd>n</kbd>\u263E</button>' +
        '<button id="gm-skip-day" title="Skip 1 full day (D)"><kbd>D</kbd>+1d</button>' +
        '<button id="gm-skip-week" title="Skip 7 days (W)"><kbd>W</kbd>+7d</button>' +
        '<button id="gm-skip-month" title="Skip 30 days (Y)"><kbd>Y</kbd>+30d</button>' +
        '<div class="gm-ctrl-sep"></div>' +
        '<span id="gm-zoom" title="Zoom level (scroll wheel, +/-)">1x</span>' +
        '<span id="gm-pos" title="Viewport center (segment, floor)"></span>' +
        '<button id="gm-home" title="Reset view to start (H)"><kbd>H</kbd>\u2302</button>' +
        '<div class="gm-ctrl-sep"></div>' +
        '<button id="gm-save" title="Save state">save</button>' +
        '<button id="gm-reset" title="Reset to new seed">reset</button>' +
        '<span id="gm-status"></span>';
    mapWrap.appendChild(controls);

    // Tabbed right panel
    const panel = document.createElement("div");
    panel.id = "godmode-panel";

    const tabBar = document.createElement("div");
    tabBar.id = "gm-tab-bar";
    tabBar.innerHTML =
        '<button id="gm-tab-log" class="gm-tab gm-tab-active">log</button>' +
        '<button id="gm-tab-npc" class="gm-tab">npc</button>' +
        '<button id="gm-tab-grp" class="gm-tab">grp</button>' +
        '<button id="gm-tab-trend" class="gm-tab">trend</button>';
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

    const grpPane = document.createElement("div");
    grpPane.id = "gm-grp-pane";
    grpPane.className = "gm-pane";
    grpPane.innerHTML = '<div class="gm-panel-empty">No groups yet.</div>';
    panel.appendChild(grpPane);

    const trendPane = document.createElement("div");
    trendPane.id = "gm-trend-pane";
    trendPane.className = "gm-pane";
    trendPane.innerHTML = '<div class="gm-panel-empty">Collecting data...</div>';
    panel.appendChild(trendPane);

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
    document.getElementById("gm-home").addEventListener("click", function () {
        GodmodeMap.goHome();
        followMode = false;
        render(true);
    });
    document.getElementById("gm-skip-day").addEventListener("click", function () { skipDays(1); });
    document.getElementById("gm-skip-week").addEventListener("click", function () { skipDays(7); });
    document.getElementById("gm-skip-month").addEventListener("click", function () { skipDays(30); });

    document.getElementById("gm-save").addEventListener("click", function () {
        Engine.save();
        const el = document.getElementById("gm-status");
        if (el) { el.textContent = "saved"; setTimeout(function () { el.textContent = ""; }, 1500); }
    });
    document.getElementById("gm-reset").addEventListener("click", function () {
        if (!confirm("Reset simulation? This clears the save and reloads with a new seed.")) return;
        Engine.clearSave();
        window.location.href = window.location.pathname + "?godmode=1";
    });

    document.getElementById("gm-tab-log").addEventListener("click", function () { switchTab("log"); });
    document.getElementById("gm-tab-npc").addEventListener("click", function () { switchTab("npc"); });
    document.getElementById("gm-tab-grp").addEventListener("click", function () { switchTab("grp"); });
    document.getElementById("gm-tab-trend").addEventListener("click", function () { switchTab("trend"); });

    // Log filter toggles (event delegation)
    GodmodeLog.wireFilterClicks(document.getElementById("gm-log-pane"));

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

        if (wasDrag) followMode = false;

        // Only select NPC on click (not drag)
        if (!wasDrag && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
            const hit = GodmodeMap.hitTest(x, y);
            if (hit !== null) {
                selectedNpcId = hit;
                followMode = false;
                const npc = state.npcs && state.npcs.find(n => n.id === hit);
                if (npc) GodmodeMap.setSide(npc.side);
                switchTab("npc");
            } else {
                selectedNpcId = null;
                followMode = false;
            }
        }
        render();
    });

    // Double-click to center on NPC
    canvas.addEventListener("dblclick", function (ev) {
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const hit = GodmodeMap.hitTest(x, y);
        if (hit !== null) {
            selectedNpcId = hit;
            followMode = true;
            const npc = state.npcs && state.npcs.find(n => n.id === hit);
            if (npc) {
                GodmodeMap.setSide(npc.side);
                GodmodeMap.centerOn(npc.position, npc.floor);
            }
            switchTab("npc");
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
        render();
    }, { passive: false });

    // --- Touch events for mobile ---
    let touchState = null; // { id, startX, startY } for single-finger pan
    let pinchDist = null;  // distance between two fingers for pinch zoom

    function getTouchDist(t1, t2) {
        const dx = t1.clientX - t2.clientX;
        const dy = t1.clientY - t2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchCenter(t1, t2, rect) {
        return {
            x: (t1.clientX + t2.clientX) / 2 - rect.left,
            y: (t1.clientY + t2.clientY) / 2 - rect.top,
        };
    }

    canvas.addEventListener("touchstart", function (ev) {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        if (ev.touches.length === 2) {
            // Start pinch
            pinchDist = getTouchDist(ev.touches[0], ev.touches[1]);
            touchState = null; // cancel pan
        } else if (ev.touches.length === 1) {
            const t = ev.touches[0];
            const x = t.clientX - rect.left;
            const y = t.clientY - rect.top;
            touchState = { id: t.identifier, startX: x, startY: y, curX: x, curY: y };
            GodmodeMap.dragStart(x, y);
        }
    }, { passive: false });

    canvas.addEventListener("touchmove", function (ev) {
        ev.preventDefault();
        const rect = canvas.getBoundingClientRect();
        if (ev.touches.length === 2 && pinchDist !== null) {
            // Pinch zoom
            const newDist = getTouchDist(ev.touches[0], ev.touches[1]);
            const center = getTouchCenter(ev.touches[0], ev.touches[1], rect);
            const ratio = newDist / pinchDist;
            if (ratio > 1.15) {
                GodmodeMap.zoom(1, center.x, center.y);
                pinchDist = newDist;
                render();
            } else if (ratio < 0.85) {
                GodmodeMap.zoom(-1, center.x, center.y);
                pinchDist = newDist;
                render();
            }
        } else if (ev.touches.length === 1 && touchState !== null) {
            const t = ev.touches[0];
            const x = t.clientX - rect.left;
            const y = t.clientY - rect.top;
            touchState.curX = x;
            touchState.curY = y;
            GodmodeMap.dragMove(x, y);
            render();
        }
    }, { passive: false });

    canvas.addEventListener("touchend", function (ev) {
        ev.preventDefault();
        if (ev.touches.length === 0) {
            if (pinchDist !== null) {
                // End pinch — don't select NPC
                pinchDist = null;
                touchState = null;
                return;
            }
            if (touchState !== null) {
                const rect = canvas.getBoundingClientRect();
                const x = touchState.curX;
                const y = touchState.curY;
                const wasDrag = GodmodeMap.dragEnd(x, y);

                if (wasDrag) followMode = false;

                // Tap (not drag) → select NPC
                if (!wasDrag && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
                    const hit = GodmodeMap.hitTest(x, y);
                    if (hit !== null) {
                        selectedNpcId = hit;
                        followMode = false;
                        const npc = state.npcs && state.npcs.find(n => n.id === hit);
                        if (npc) GodmodeMap.setSide(npc.side);
                        switchTab("npc");
                    } else {
                        selectedNpcId = null;
                        followMode = false;
                    }
                }
                touchState = null;
                render();
            }
        } else if (ev.touches.length === 1) {
            // Went from 2 fingers to 1 — restart pan from remaining finger
            pinchDist = null;
            const rect = canvas.getBoundingClientRect();
            const t = ev.touches[0];
            const x = t.clientX - rect.left;
            const y = t.clientY - rect.top;
            touchState = { id: t.identifier, startX: x, startY: y, curX: x, curY: y };
            GodmodeMap.dragStart(x, y);
        }
    }, { passive: false });

    canvas.addEventListener("touchcancel", function () {
        touchState = null;
        pinchDist = null;
        GodmodeMap.dragEnd(0, 0);
    });

    document.addEventListener("keydown", function (ev) {
        // Don't handle godmode keys during possession — normal keybindings take over
        if (possessing) return;

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
        } else if (ev.key === "W") {
            skipDays(7);
        } else if (ev.key === "Y") {
            skipDays(30);
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
            const order = ["log", "npc", "grp", "trend"];
            switchTab(order[(order.indexOf(activeTab) + 1) % order.length]);
        } else if (ev.key === "Tab") {
            ev.preventDefault();
            GodmodeMap.handleKey(ev.key);
            render();
        } else {
            const navKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "h", "j", "k", "l", "Home", "H"]);
            if (navKeys.has(ev.key)) followMode = false;
            GodmodeMap.handleKey(ev.key);
            render();
        }
    });
}

function possessNpc(npcId) {
    if (possessing) return;

    // Check if possessing the player (id -1 in snapshot)
    const isPlayer = npcId === -1;
    const npc = isPlayer
        ? { id: -1, name: "yourself", alive: true, side: state.side, position: state.position, floor: state.floor, falling: state.falling }
        : state.npcs && state.npcs.find(n => n.id === npcId);
    if (!npc || !npc.alive) return;

    // Pause godmode sim
    const wasRunning = running;
    running = false;
    possessing = true;

    // Save the godmode DOM, switch body class for normal game styles
    godmodeDOM = document.getElementById("godmode-container");
    if (godmodeDOM) godmodeDOM.style.display = "none";
    document.body.classList.remove("godmode");

    // Tell Social to swap player state to NPC (skip for player — already there)
    if (!isPlayer) Social.possess(npcId);

    // Build the normal game DOM structure
    const gameWrap = document.createElement("div");
    gameWrap.id = "godmode-game-wrap";

    // Possess banner
    const banner = document.createElement("div");
    banner.id = "possess-banner";
    banner.innerHTML = isPlayer
        ? '<span>Playing as <strong>yourself</strong></span> <button id="unpossess-btn">return to godmode</button>'
        : '<span>Possessing <strong>' + (npc.name || "NPC") +
          '</strong></span> <button id="unpossess-btn"><kbd>Esc</kbd> release</button>';
    gameWrap.appendChild(banner);

    // Standard game layout
    const storyRight = document.createElement("div");
    storyRight.id = "story-right";
    const storyCaption = document.createElement("div");
    storyCaption.id = "story-caption";
    storyRight.appendChild(storyCaption);

    const passages = document.createElement("div");
    passages.id = "passages";
    const passage = document.createElement("div");
    passage.id = "passage";
    passages.appendChild(passage);

    gameWrap.appendChild(passages);
    gameWrap.appendChild(storyRight);
    document.body.appendChild(gameWrap);

    // Wire passage click delegation (normally done in Engine.init, but godmode skips it)
    passage.addEventListener("click", function (ev) {
        const link = ev.target.closest("[data-goto]");
        if (!link) return;
        ev.preventDefault();
        const actionName = link.getAttribute("data-action");
        if (actionName && Engine._actions[actionName]) {
            Engine._actions[actionName]();
        }
        Engine.goto(link.getAttribute("data-goto"));
    });

    // Navigate to appropriate screen
    if (state.falling) {
        Engine.goto("Falling");
    } else {
        Engine.goto("Corridor");
    }

    // Wire unpossess button
    document.getElementById("unpossess-btn").addEventListener("click", unpossessNpc);

    // Store state for restoration
    state._possessWasRunning = wasRunning;
    state._possessIsPlayer = isPlayer;
}

function unpossessNpc() {
    if (!possessing) return;
    possessing = false;

    // Tell Social to restore player state (skip for player — nothing to restore)
    if (!state._possessIsPlayer) Social.unpossess();

    // Remove game DOM
    const gameWrap = document.getElementById("godmode-game-wrap");
    if (gameWrap) gameWrap.remove();

    // Restore godmode DOM
    if (godmodeDOM) {
        godmodeDOM.style.display = "";
        document.body.className = "godmode";
    }

    // Resume simulation
    if (state._possessWasRunning) {
        running = true;
        updatePlayButton();
    }
    state._possessWasRunning = undefined;
    state._possessIsPlayer = undefined;

    // Re-render godmode
    lastFrame = performance.now();
    accumulator = 0;
    render();
    requestAnimationFrame(loop);
}

function npcJump(npcId) {
    Social.npcJump(npcId);
    render(true);
}

export const Godmode = {
    /** Force a re-render (for screenshots / debug). */
    render,

    /** Exit possession mode (callable from keybindings). */
    unpossess: unpossessNpc,

    /** Whether we're in possession mode. */
    isPossessing() { return possessing; },

    /** Whether we're possessing the player (vs an NPC). */
    isPossessingPlayer() { return possessing && !!state._possessIsPlayer; },

    /** Called by Engine.init() after shared world setup. Replaces DOM and starts observation loop. */
    start() {
        function onSelect(id) {
            selectedNpcId = id;
            followMode = false;
            const npc = state.npcs && state.npcs.find(n => n.id === id);
            if (npc) GodmodeMap.setSide(npc.side);
            switchTab("npc");
            render(true);
        }
        GodmodeLog.init(onSelect);
        GodmodeTrends.init(onSelect);
        const canvas = setupDOM();
        GodmodeMap.init(canvas, state);
        GodmodePanel.init({
            onSelect(id) {
                selectedNpcId = id;
                followMode = false;
                const npc = state.npcs && state.npcs.find(n => n.id === id);
                if (npc) GodmodeMap.setSide(npc.side);
                switchTab("npc");
                render(true);
            },
            onCenter(id) {
                selectedNpcId = id;
                followMode = true;
                const npc = state.npcs && state.npcs.find(n => n.id === id);
                if (npc) {
                    GodmodeMap.setSide(npc.side);
                    GodmodeMap.centerOn(npc.position, npc.floor);
                }
                render(true);
            },
            onDeselect() {
                selectedNpcId = null;
                followMode = false;
                render(true);
            },
            onPossess(id) {
                possessNpc(id);
            },
            onJump(id) {
                npcJump(id);
            },
            onVision(id) {
                Social.grantVision(id);
                render(true);
            },
            onSearchMap(data) {
                const key = "search:" + data.npcId;
                GodmodeMap.toggleOverlay(key, createSearchOverlay(data));
                render();
            },
        });
        setupInput(canvas);
        GodmodeTrends.wireClicks(document.getElementById("gm-trend-pane"));

        // Apply URL params: &gmZoom=3 &gmX=50 &gmY=100 &gmSide=west|east
        const params = new URLSearchParams(window.location.search);
        const gmZoom = params.get("gmZoom");
        if (gmZoom) GodmodeMap.setZoom(parseFloat(gmZoom));
        const gmX = params.get("gmX");
        const gmY = params.get("gmY");
        if (gmX !== null || gmY !== null) {
            GodmodeMap.setViewport(
                gmX !== null ? parseFloat(gmX) : undefined,
                gmY !== null ? parseFloat(gmY) : undefined
            );
        }
        const gmSide = params.get("gmSide");
        if (gmSide === "west") { GodmodeMap.setSide(0); }
        else if (gmSide === "east") { GodmodeMap.setSide(1); }
        const gmTab = params.get("gmTab");
        if (gmTab && ["log", "npc", "grp", "trend"].includes(gmTab)) switchTab(gmTab);
        const gmTicks = params.get("gmTicks");
        if (gmTicks) {
            const n = parseInt(gmTicks, 10);
            for (let i = 0; i < n; i++) tickOnce();
        }

        render();
        lastFrame = performance.now();
        requestAnimationFrame(loop);
    },
};
