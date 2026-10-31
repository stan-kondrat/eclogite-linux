#!/bin/sh
# Install the binary only; the image step creates the applet links of the
# capabilities busybox provides in this system.
# Builder variables (provisional until the builder contract lands):
#   WORK, DESTDIR
set -eu
install -D -m 0755 "$WORK/busybox" "$DESTDIR/bin/busybox"
