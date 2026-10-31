#!/bin/sh
# Fill an npm cache for package-lock.json and download the plugins listed in
# package.json theiaPlugins. Runs with network access; the output directory
# is normalized and hashed by eclogite afterwards.
# Builder variables (provisional until the builder contract lands):
#   SRC  read-only source;  WORK  scratch;  OUT  fetch output (FETCH in build hooks)
set -eu
cp -a "$SRC/." "$WORK/"
cd "$WORK"
npm ci --ignore-scripts --no-audit --no-fund --cache "$OUT/npm-cache"
npm run download:plugins
cp -a plugins "$OUT/plugins"
# logs and timestamps are not part of the output
rm -rf "$OUT/npm-cache/_logs" "$OUT/npm-cache/_update-notifier-last-checked"
