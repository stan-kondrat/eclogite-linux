#!/bin/sh
# runit ignores CC; its build reads the compile and link commands from files.
# Builder variables (provisional until the builder contract lands):
#   WORK  writable copy of the source;  CC, CFLAGS, LDFLAGS  target compiler
set -eu
cd "$WORK/src"
echo "$CC $CFLAGS" > conf-cc
echo "$CC $LDFLAGS" > conf-ld
