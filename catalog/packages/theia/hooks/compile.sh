#!/bin/sh
# TypeScript compile of every workspace package, one at a time (memory).
set -eu
cd "$WORK"
npx lerna run compile --concurrency 1
