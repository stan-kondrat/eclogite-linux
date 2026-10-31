#!/bin/sh
# Passes once the Theia backend answers on port 3000. The guest has no curl:
# node is already there. The test runner enforces the timeout.
set -eu
until node -e '
	require("http").get("http://127.0.0.1:3000/", r => process.exit(r.statusCode === 200 ? 0 : 1))
		.on("error", () => process.exit(1))'; do
	sleep 2
done
