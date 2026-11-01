#!/bin/sh
# Also checks that the HTTPS helper was built and is found.
set -eu
git --version | grep -q '^git version 2\.'
git remote-https 2>&1 | grep -qi usage || test -x "$(git --exec-path)/git-remote-https"
