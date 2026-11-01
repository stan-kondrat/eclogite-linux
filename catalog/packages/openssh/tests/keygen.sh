#!/bin/sh
# ssh-keygen works and sshd accepts its own configuration with a host key.
set -eu
dir=$(mktemp -d)
ssh-keygen -q -t ed25519 -N '' -f "$dir/host_key"
sshd -t -f /dev/null -h "$dir/host_key"
rm -rf "$dir"
