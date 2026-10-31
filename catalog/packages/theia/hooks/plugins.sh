#!/bin/sh
# Plugins come from the fetch phase output, not from the network.
set -eu
mkdir -p "$DESTDIR$INSTALL_PREFIX/plugins"
cp -a "$FETCH/plugins/." "$DESTDIR$INSTALL_PREFIX/plugins/"
