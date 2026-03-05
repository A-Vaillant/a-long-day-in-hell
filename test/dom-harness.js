/**
 * DOM test harness — loads the full game into a jsdom window.
 *
 * Usage:
 *   import { createGame } from "./dom-harness.js";
 *   const { window, document, state, Engine } = createGame();
 *
 * Each call returns a fresh, isolated game instance.
 * Engine.init() is NOT called automatically — tests control boot.
 */

import { JSDOM } from "jsdom";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSync } from "esbuild";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

const HTML_TEMPLATE = readFileSync(resolve(ROOT, "src/html/index.html"), "utf8")
    .replace("/* INJECT:CSS */", "/* tests skip CSS */");

// Bundle the game JS via esbuild (same as build-vanilla.js)
const entryPoint = resolve(ROOT, "src/js/main.js");
const bundleResult = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify: false,
});
const bundledJS = bundleResult.outputFiles[0].text;

// Strip the auto-boot block from the bundle so tests control init.
// The boot code is at the end: `if (document.readyState ...` through to Engine.init()
const bootPattern = /\/\/ Boot when DOM is ready[\s\S]*?Engine\.init\(\);\s*\}/;
const testJS = bundledJS.replace(bootPattern, "// Auto-boot disabled for tests");

// Build window.TEXT from content/*.json (mirrors build-vanilla.js)
const contentDir = resolve(ROOT, "content");
const contentMap = {
    "events.json": "events",
    "npcs.json": null,
    "screens.json": "screens",
    "lifestory.json": "lifestory",
    "stats.json": "stats",
    "stories.json": "stories",
    "dictionary.json": "dictionary",
};
const TEXT = {};
for (const [file, key] of Object.entries(contentMap)) {
    const data = JSON.parse(readFileSync(resolve(contentDir, file), "utf8"));
    if (key) {
        TEXT[key] = data;
    } else {
        TEXT.npc_names = data.names;
        TEXT.npc_dialogue = data.dialogue;
    }
}

/**
 * Create a fresh game environment. Returns { window, document, state, Engine }.
 * Engine.init() is NOT called — call it yourself or use bootGame() for a
 * fully initialized game at the Corridor screen.
 */
export function createGame() {
    const dom = new JSDOM(HTML_TEMPLATE, {
        url: "http://localhost/",
        pretendToBeVisual: true,
        runScripts: "dangerously",
    });
    const win = dom.window;

    // Inject TEXT
    const textEl = win.document.createElement("script");
    textEl.textContent = "window.TEXT = " + JSON.stringify(TEXT) + ";";
    win.document.body.appendChild(textEl);

    // Inject bundled game code
    const scriptEl = win.document.createElement("script");
    scriptEl.textContent = testJS;
    win.document.body.appendChild(scriptEl);

    return {
        window: win,
        document: win.document,
        get state() { return win.state; },
        get Engine() { return win.Engine; },
        get PRNG() { return win.PRNG; },
        get Surv() { return win.Surv; },
        get Tick() { return win.Tick; },
        get Events() { return win.Events; },
        get Npc() { return win.Npc; },
        get Despair() { return win.Despair; },
        dom,
    };
}

/**
 * Create a fully booted game at the Corridor screen with a fixed seed.
 * Convenience for tests that don't care about the init sequence.
 */
export function bootGame(seed = "test-seed-42") {
    const game = createGame();
    game.PRNG.seed(seed);
    const win = game.window;
    win.state.seed = seed;
    win.state.side = 0;
    win.state.position = 0;
    win.state.floor = 10;
    win.state.move = "";
    win.state.heldBook = null;
    win.state.shelfOffset = 0;
    win.state.openBook = null;
    win.state.openPage = 0;
    win.state.debug = true;
    win.state.deaths = 0;
    win.state.deathCause = null;

    const story = win.LifeStory.generate(seed, {
        placement: "gaussian",
        startLoc: { side: 0, position: 0, floor: 10 },
    });
    win.state.lifeStory = story;
    win.state.targetBook = story.bookCoords;

    game.Surv.init();
    game.Tick.init();
    game.Events.init();
    game.Npc.init();

    // Set up event delegation (mirrors Engine.init)
    game.document.getElementById("passage").addEventListener("click", function (ev) {
        var link = ev.target.closest("[data-goto]");
        if (!link) return;
        ev.preventDefault();
        var actionName = link.getAttribute("data-action");
        if (actionName && game.Engine._actions[actionName]) {
            game.Engine._actions[actionName]();
        }
        game.Engine.goto(link.getAttribute("data-goto"));
    });

    game.Engine.goto("Corridor");
    return game;
}
