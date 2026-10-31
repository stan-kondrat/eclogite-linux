#!/bin/sh
# Install the workspace's npm dependencies from the fetched cache, offline,
# then compile only the native addons that can be built: node-pty and
# drivelist (node-gyp with builder:gcc). keytar needs libsecret and would fail
# the whole install, so install scripts are off and addons are rebuilt by name.
# Builder variables (provisional until the builder contract lands):
#   WORK                 writable copy of the source
#   FETCH                verified output of this package's fetch phase
set -eu
cd "$WORK"
npm ci --offline --ignore-scripts --no-audit --no-fund --cache "$FETCH/npm-cache"
# the root postinstall that --ignore-scripts skipped: pure JS
npm run postinstall
npm rebuild --offline node-pty drivelist
