# PATH, npm cache and TMPDIR on the share, XDG_RUNTIME_DIR, NX_DISABLE_DB (its
# SQLite locking fails on 9p), PUPPETEER_SKIP_DOWNLOAD
export PATH=/bin
export NPM_CONFIG_CACHE="$HOME/.cache/npm"
export TMPDIR="$HOME/.cache/tmp"
export NX_DISABLE_DB=true
export PUPPETEER_SKIP_DOWNLOAD=1
