#!/bin/sh
# Install the bundle where Debian-style tools expect it.
# Builder variables (provisional until the builder contract lands):
#   WORK, DESTDIR
set -eu
mkdir -p "$DESTDIR/etc/ssl/certs"
install -m 0644 "$WORK/src/certifi/cacert.pem" "$DESTDIR/etc/ssl/certs/ca-certificates.crt"
