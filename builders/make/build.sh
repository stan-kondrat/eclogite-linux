#!/bin/sh
# make builder: `make`, then `make install`, in ARG_DIRECTORY of the work tree.
# Called once per step by eclogite: build.sh STEP (configure, build, install).
# Inputs (docs/build-model.md, "Hook variables"): WORK, DESTDIR, JOBS, CC...,
# and the package's arguments as ARG_* (lists one item per line).
set -eu
step=$1
nl='
'
cd "$WORK/${ARG_DIRECTORY:-.}"
set -f
IFS=$nl
case $step in
configure) ;;
build) make -j"$JOBS" ${ARG_VARIABLES:-} ${ARG_MAKE_TARGETS:-} ;;
install) make ${ARG_VARIABLES:-} DESTDIR="$DESTDIR" ${ARG_INSTALL_TARGETS:-install} ;;
*) echo "make builder: unknown step $step" >&2; exit 2 ;;
esac
