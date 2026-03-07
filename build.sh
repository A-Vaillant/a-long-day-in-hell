#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist
node scripts/build-vanilla.js
