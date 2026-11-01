#!/bin/sh
set -eu
openssl version | grep -q '^OpenSSL 3\.'
