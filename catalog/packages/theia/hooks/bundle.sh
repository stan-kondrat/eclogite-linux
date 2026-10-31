#!/bin/sh
# Production bundle of the browser example. Not 'npm run build': that also
# runs 'theia rebuild:browser', which would try keytar again. node-pty and
# drivelist were already built against builder:node by install.sh, and
# builder:node matches the guest's nodejs.
# Builder variables (provisional until the builder contract lands):
#   WORK, DESTDIR, INSTALL_PREFIX
set -eu
cd "$WORK/examples/browser"
npx theia build --mode production
mkdir -p "$DESTDIR$INSTALL_PREFIX"
cp -a "$WORK/." "$DESTDIR$INSTALL_PREFIX/"
