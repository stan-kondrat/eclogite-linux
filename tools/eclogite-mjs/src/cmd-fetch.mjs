// fetch: download the sources the current lock names, verify them, and store
// them in the cache as immutable trees (docs/cli.md, "Sources and build
// execution"; docs/storage.md, "Package source cache"). The only network
// operation; build stays offline.
//
// The lock is the input: a missing or stale lock exits 11. Packages without a
// source ("type": "none") need nothing. Fixed-output fetch hooks (theia) and
// remote layers are not implemented yet and are reported as skipped.

import { EXIT, ExitError } from "./project.mjs";
import { loadSystem, compile, defaultLockPath, readLock } from "./system.mjs";
import { makePlan } from "./cmd-lock.mjs";
import { cacheDir, materialize, sourceKey, entryState, SourceError } from "./sources.mjs";
import { relative } from "node:path";

export async function run(command, args, opts) {
  if (args.length) throw new ExitError(EXIT.usage, "fetch takes no arguments; use --source NAME");
  const sys = loadSystem(opts);
  const name = sys.systemValue.name;
  const path = opts.lock ?? defaultLockPath(opts, name);
  const lock = readLock(path);
  if (!lock) throw new ExitError(EXIT.resolution, `error: no lock at ${path}; run eclogite-mjs lock`);
  const { lock: fresh } = compile(sys, opts, { requirePinned: false });
  if (makePlan(fresh, lock).stale) throw new ExitError(EXIT.resolution, `error: the lock ${path} is stale; run eclogite-mjs lock`);

  const entries = [...lock.closure, ...lock.build_only].filter((e) => e.kind === "buildable");
  const known = new Set(entries.map((e) => e.name));
  for (const s of opts.source) if (!known.has(s)) throw new ExitError(EXIT.usage, `--source ${s}: no buildable package of that name in the lock`);
  const selected = opts.source.length ? entries.filter((e) => opts.source.includes(e.name)) : entries;

  const cache = cacheDir(opts);
  const err = (s) => process.stderr.write(`${s}\n`);
  const rel = (p) => relative(cache, p);
  let fetched = 0, cached = 0, skipped = 0, failed = 0;
  // one tree per distinct source: gcc-runtime and the toolchain's gcc may share one
  const done = new Map();
  for (const e of selected.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.source.type === "none") continue;
    if (e.source.type !== "git") { err(`skip  ${e.name}: source type ${e.source.type} is not supported yet`); skipped++; continue; }
    const key = sourceKey(e.source);
    if (done.has(key)) { err(`ok    ${e.name}: same source as ${done.get(key)}`); continue; }
    done.set(key, e.name);
    const wasComplete = entryState(cache, key) === "complete";
    try {
      const r = materialize(cache, e.source, { force: !!opts.force });
      if (wasComplete) { err(`ok    ${e.name} ${e.source.revision.slice(0, 12)}: cached`); cached++; }
      else { err(`fetch ${e.name} ${e.source.revision.slice(0, 12)}: ${r.files} files -> ${rel(r.dir)}${r.downloaded ? "" : " (commit was in the mirror)"}`); fetched++; }
    } catch (x) {
      if (!(x instanceof SourceError)) throw x;
      err(`FAIL  ${e.name}: ${x.message}`);
      failed++;
    }
    if (e.fetch) { err(`skip  ${e.name}: the fetch hook "${e.fetch.hook}" is not implemented yet`); skipped++; }
  }
  err(`fetch: ${fetched} fetched, ${cached} cached, ${skipped} skipped, ${failed} failed; cache ${cache}`);
  return failed ? EXIT.source : EXIT.ok;
}
