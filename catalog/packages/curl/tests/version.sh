#!/bin/sh
# The build links the TLS library and zlib.
set -eu
curl --version | grep -q OpenSSL
curl --version | grep -q 'libz/'
