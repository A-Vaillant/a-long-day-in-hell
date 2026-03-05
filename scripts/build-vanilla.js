#!/usr/bin/env node
// Builds dist/index.html by inlining CSS and JS into the HTML template.

import { readFileSync, writeFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, "..");

// Read template
let html = readFileSync(resolve(ROOT, "src/html/index.html"), "utf8");

// Inline CSS
const css = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8");
html = html.replace("/* INJECT:CSS */", css);

// Collect JS files in load order:
// 1. 00_prng_core_bundle.js (the IIFE bundle — must be first)
// 2. prng.js, library.js, book.js, lifestory.js, survival.js, tick.js (wrappers)
// 3. engine.js (state + router)
// 4. screens.js (screen renderers)
// 5. keybindings.js (input handling)
// 6. debug.js (debug API)
const jsOrder = [
    "00_prng_core_bundle.js",
    "prng.js",
    "library.js",
    "book.js",
    "lifestory.js",
    "despairing.js",
    "survival.js",
    "tick.js",
    "events.js",
    "npc.js",
    "engine.js",
    "screens.js",
    "keybindings.js",
    "debug.js",
];

const jsDir = resolve(ROOT, "src/js");
const skipDebug = process.env.PRODUCTION === "1";
const scripts = jsOrder
    .filter(name => !(skipDebug && name === "debug.js"))
    .map(name => readFileSync(resolve(jsDir, name), "utf8"));

// Assemble window.TEXT from content/*.json
const contentDir = resolve(ROOT, "content");
const contentMap = {
    "events.json":    "events",
    "npcs.json":      null,       // keys merge at top level (names → npc_names, dialogue → npc_dialogue)
    "screens.json":   "screens",
    "lifestory.json": "lifestory",
    "stats.json":     "stats",
};
const TEXT = {};
for (const [file, key] of Object.entries(contentMap)) {
    const data = JSON.parse(readFileSync(resolve(contentDir, file), "utf8"));
    if (key) {
        TEXT[key] = data;
    } else {
        // npcs.json: remap to legacy keys
        TEXT.npc_names = data.names;
        TEXT.npc_dialogue = data.dialogue;
    }
}
const textBlock = "<script>window.TEXT = " + JSON.stringify(TEXT) + ";</script>";

const jsBlock = "<script>\n" + scripts.join("\n\n") + "\n</script>";
html = html.replace("<!-- INJECT:JS -->", textBlock + "\n" + jsBlock);

writeFileSync(resolve(ROOT, "dist/index.html"), html, "utf8");
console.log("Built: dist/index.html");
