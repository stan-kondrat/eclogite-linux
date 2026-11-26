#!/bin/sh
# files builder: no steps. The output is the package's files, symlinks and
# generated services, which eclogite adds after the (empty) install step.
set -eu
case $1 in
configure|build|install) ;;
*) echo "files builder: unknown step $1" >&2; exit 2 ;;
esac
