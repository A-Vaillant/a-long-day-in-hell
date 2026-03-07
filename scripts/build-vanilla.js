#!/usr/bin/env node
// Builds dist/index.html by bundling JS with esbuild and inlining CSS + content.

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildSync } from "esbuild";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, "..");

// Read template
let html = readFileSync(resolve(ROOT, "src/html/index.html"), "utf8");

// Inline CSS (main + godmode)
const css = readFileSync(resolve(ROOT, "src/css/style.css"), "utf8") +
    "\n" + readFileSync(resolve(ROOT, "src/css/godmode.css"), "utf8");
html = html.replace("/* INJECT:CSS */", css);

// Bundle JS via esbuild
const skipDebug = process.env.PRODUCTION === "1";
const entryPoint = resolve(ROOT, "src/js/main.js");

const result = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2020",
    minify: false,
    // Drop debug module in production
    ...(skipDebug ? { drop: [], define: {} } : {}),
});

const jsBundle = result.outputFiles[0].text;

// Assemble window.TEXT from content/*.json
const contentDir = resolve(ROOT, "content");
const contentMap = {
    "events.json":    "events",
    "npcs.json":      null,
    "screens.json":   "screens",
    "lifestory.json": "lifestory",
    "stats.json":     "stats",
    "stories.json":   "stories",
    "dictionary.json": "dictionary",
    "madlibs.json":    "madlibs",
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
const textBlock = "<script>window.TEXT = " + JSON.stringify(TEXT) + ";</script>";

const jsBlock = "<script>\n" + jsBundle + "\n</script>";
html = html.replace("<!-- INJECT:JS -->", textBlock + "\n" + jsBlock);

writeFileSync(resolve(ROOT, "dist/index.html"), html, "utf8");
console.log("Built: dist/index.html");
