#!/usr/bin/env bash
set -euo pipefail

# Compile TypeScript cores if any exist
if compgen -G "lib/*.core.ts" > /dev/null; then
    npx tsc
fi
mkdir -p dist
node scripts/build-vanilla.js
