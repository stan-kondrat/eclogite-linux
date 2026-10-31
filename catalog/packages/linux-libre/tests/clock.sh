#!/bin/sh
# The guest clock must not start at 1970: it must be at least the build time.
# Test variables: SOURCE_DATE_EPOCH, the system's build timestamp
set -eu
[ "$(date +%s)" -ge "$SOURCE_DATE_EPOCH" ]
