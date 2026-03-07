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
import { getComponent } from "../../lib/ecs.core.js";

let running = false;
let speed = 1;
let lastFrame = 0;
let accumulator = 0;
let selectedNpcId = null;
let followMode = false;

const SPEEDS = [1, 2, 5, 10, 20];
let speedIndex = 0;

function tickOnce() {
    Tick.advance(1);
    Social.onTick();
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

function render() {
    const snap = snapshot();
    GodmodeMap.draw(snap, selectedNpcId, followMode);
    GodmodePanel.update(snap, selectedNpcId);
}

function loop(now) {
    if (!running) {
        lastFrame = now;
        requestAnimationFrame(loop);
        return;
    }

    const dt = Math.min(now - lastFrame, 1000);
    lastFrame = now;

    const tickInterval = 1000 / speed;
    accumulator += dt;

    if (accumulator >= tickInterval) {
        accumulator -= tickInterval;
        if (accumulator > tickInterval) accumulator = 0;
        tickOnce();
    }

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
        '<span id="gm-day">Day 1</span>' +
        '<span id="gm-tick">0:00</span>' +
        '<button id="gm-play">\u25B6</button>' +
        '<button id="gm-step">\u23ED</button>' +
        '<button id="gm-speed">1x</button>' +
        '<span id="gm-status"></span>';
    mapWrap.appendChild(controls);

    const panel = document.createElement("div");
    panel.id = "godmode-panel";
    panel.innerHTML = '<div class="gm-panel-empty">Click an NPC to observe</div>';

    container.appendChild(mapWrap);
    container.appendChild(panel);
    document.body.appendChild(container);

    return canvas;
}

function setupInput(canvas) {
    document.getElementById("gm-play").addEventListener("click", function () {
        running = !running;
        this.textContent = running ? "\u23F8" : "\u25B6";
    });

    document.getElementById("gm-step").addEventListener("click", function () {
        tickOnce();
        render();
    });

    document.getElementById("gm-speed").addEventListener("click", function () {
        speedIndex = (speedIndex + 1) % SPEEDS.length;
        speed = SPEEDS[speedIndex];
        this.textContent = speed + "x";
    });

    canvas.addEventListener("click", function (ev) {
        const rect = canvas.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const hit = GodmodeMap.hitTest(x, y);
        if (hit !== null) {
            selectedNpcId = hit;
            followMode = true;
        } else {
            followMode = false;
        }
        render();
    });

    document.addEventListener("keydown", function (ev) {
        if (ev.key === " ") {
            ev.preventDefault();
            running = !running;
            document.getElementById("gm-play").textContent = running ? "\u23F8" : "\u25B6";
        } else if (ev.key === ".") {
            tickOnce();
            render();
        } else if (ev.key === "Escape") {
            selectedNpcId = null;
            followMode = false;
            render();
        } else {
            GodmodeMap.handleKey(ev.key);
            render();
        }
    });
}

export const Godmode = {
    /** Called by Engine.init() after shared world setup. Replaces DOM and starts observation loop. */
    start() {
        const canvas = setupDOM();
        GodmodeMap.init(canvas, state);
        GodmodePanel.init();
        setupInput(canvas);

        render();
        lastFrame = performance.now();
        requestAnimationFrame(loop);
    },
};
