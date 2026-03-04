#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist
TWEEGO_PATH=tweego/storyformats tweego/tweego -f sugarcube-2 -o dist/index.html src/story/ src/js/
echo "Built: dist/index.html"
