#!/bin/sh
# Passes once sshd accepts its configuration and answers on port 22 with an
# SSH banner. The test runner enforces the timeout.
set -eu
sshd -t -f /etc/ssh/devbox_sshd_config
until banner=$(node -e '
	const s = require("net").connect(22, "127.0.0.1");
	s.once("data", d => { process.stdout.write(String(d).split("\n")[0]); s.end(); });
	s.on("error", () => process.exit(1));' 2>/dev/null) && [ "${banner#SSH-2.0-}" != "$banner" ]; do
	sleep 1
done
