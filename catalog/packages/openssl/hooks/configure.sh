#!/bin/sh
# OpenSSL's own configuration script, with the cross compiler prefix empty
# because the builder already sets CC and AR for the target.
# Builder variables (provisional until the builder contract lands):
#   WORK, OPENSSL_TARGET (from the package's variants)
set -eu
cd "$WORK/src"
./Configure "$OPENSSL_TARGET" \
	--prefix=/usr --openssldir=/etc/ssl --libdir=lib \
	shared no-tests no-docs no-ssl3 no-comp
