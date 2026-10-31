#!/bin/sh
# Passes once some interface has a global IPv4 address; the test runner
# enforces the timeout.
set -eu
# Works with iproute2 and with BusyBox ip
until ip -4 addr show | grep 'inet ' | grep -qv ' 127\.'; do
	sleep 1
done
