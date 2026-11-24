# Login environment of the devbox user. PATH has only /bin (builders move
# programs there); npm's cache and TMPDIR live under the home on the share;
# sockets cannot live on the share, so XDG_RUNTIME_DIR is on tmpfs; NX's
# SQLite locking fails on 9p; Puppeteer must not download a browser.
export PATH=/bin
export PAGER=less
export NPM_CONFIG_CACHE="$HOME/.cache/npm"
export TMPDIR="$HOME/.cache/tmp"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export NX_DISABLE_DB=true
export PUPPETEER_SKIP_DOWNLOAD=1
mkdir -p "$NPM_CONFIG_CACHE" "$TMPDIR" 2>/dev/null
[ -d "$XDG_RUNTIME_DIR" ] || { mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"; } 2>/dev/null
true
