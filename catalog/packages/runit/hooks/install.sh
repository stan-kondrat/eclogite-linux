#!/bin/sh
# Install the programs listed in package/commands into /bin, where every
# Eclogite program lives.
# Builder variables (provisional until the builder contract lands):
#   WORK, DESTDIR
set -eu
mkdir -p "$DESTDIR/bin"
for command in $(cat "$WORK/package/commands"); do
	install -m 0755 "$WORK/src/$command" "$DESTDIR/bin/$command"
done
