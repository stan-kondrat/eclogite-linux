// build: every buildable package of the current lock into its layer, in the
// lock's build_order, offline (docs/cli.md, "Sources and build execution").
// `build NODE...` builds those packages and what they build or link with.
//
// Before building, the machine must be the builder the lock names
// (tests/builder/check --lock); --no-builder-check skips that, for a dev VM
// that predates the release identity files.

import { EXIT, ExitError, REPO } from "./project.mjs";
import { loadSystem, compile, defaultLockPath, readLock } from "./system.mjs";
import { makePlan } from "./cmd-lock.mjs";
import { cacheDir } from "./sources.mjs";
import { buildPackage, layerState, BuildError } from "./build.mjs";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { cpus } from "node:os";

export async function run(command, args, opts) {
  const sys = loadSystem(opts);
  const name = sys.systemValue.name;
  const project = opts.project ? resolvePath(opts.project) : REPO;
  const path = opts.lock ?? defaultLockPath(opts, name);
  const lock = readLock(path);
  if (!lock) throw new ExitError(EXIT.resolution, `error: no lock at ${path}; run eclogite-mjs lock`);
  const { lock: fresh } = compile(sys, opts, { requirePinned: false });
  if (makePlan(fresh, lock).stale) throw new ExitError(EXIT.resolution, `error: the lock ${path} is stale; run eclogite-mjs lock`);
  const err = (s) => process.stderr.write(`${s}\n`);

  // the machine is the builder the lock names
  const toolchainRoot = resolvePath(opts.cross ?? "/opt/cross", lock.target.triplet);
  if (!existsSync(join(toolchainRoot, "bin", `${lock.target.triplet}-gcc`))) throw new ExitError(EXIT.builder, `error: no cross toolchain at ${toolchainRoot}; run inside the linux-libre-vm ${lock.target.toolchain.release} dev image`);
  if (opts.noBuilderCheck) err(`warning: --no-builder-check: not checking that this machine is linux-libre-vm ${lock.target.toolchain.release}`);
  else {
    const r = spawnSync(join(project, "tests/builder/check"), ["--lock", resolvePath(path)], { encoding: "utf8" });
    if (r.status !== 0) {
      err(r.stdout.split("\n").filter((l) => l.startsWith("FAIL")).join("\n"));
      throw new ExitError(EXIT.builder, "error: this machine is not the builder the lock names (tests/builder/check --lock); --no-builder-check skips the check");
    }
  }
  err("warning: builds are not isolated from the network here (no user namespaces); declared inputs only by convention");

  const entries = new Map([...lock.closure, ...lock.build_only].filter((e) => e.kind === "buildable").map((e) => [e.name, e]));
  // the selection: named packages plus their build and link dependencies
  let wanted = new Set(lock.build_order);
  if (args.length) {
    wanted = new Set();
    const add = (n) => {
      if (wanted.has(n)) return;
      wanted.add(n);
      const d = entries.get(n).dependencies;
      for (const x of [...d.build, ...d.link]) if (x.package) add(x.package);
    };
    for (const a of args) {
      const n = a.replace(/^package:/, "");
      if (!entries.has(n)) throw new ExitError(EXIT.usage, `${a}: no buildable package of that name in the lock`);
      add(n);
    }
  }

  const cache = cacheDir(opts);
  const logDir = join(dirname(resolvePath(path)), "logs");
  const jobs = Number(opts.jobs ?? cpus().length);
  const layers = {};
  let built = 0, hits = 0;
  const failed = [];
  for (const n of lock.build_order) {
    if (!wanted.has(n)) continue;
    const entry = entries.get(n);
    const d = entry.dependencies;
    const blockedBy = [...d.build, ...d.link].map((x) => x.package).filter((p) => p && failed.includes(p));
    if (blockedBy.length) { err(`skip  ${n}: ${blockedBy.join(", ")} failed`); failed.push(n); continue; }
    const depLayers = {};
    for (const x of [...d.build, ...d.link]) if (x.package && layers[x.package]) depLayers[x.package] = layers[x.package];
    const packageDir = sys.idx.kinds.package.get(n).dir;
    if (opts.noCache) err(`note  ${n}: --no-cache is not implemented yet; using the cache`);
    const wasHit = layerState(cache, entry.key) === "complete";
    if (!wasHit) err(`build ${n} ${entry.version} (${entry.builder}) ...`);
    const started = Date.now();
    try {
      const r = buildPackage({ lock, entry, cache, project, packageDir, toolchainRoot, jobs, keepWork: !!opts.keepWork, logDir, depLayers, workDir: opts.workDir && resolvePath(opts.workDir) });
      layers[n] = r.dir;
      if (r.hit) { err(`ok    ${n}: cached ${entry.key.slice(0, 12)}`); hits++; }
      else { err(`ok    ${n}: built ${entry.key.slice(0, 12)}, ${r.files} entries, ${Math.round((Date.now() - started) / 1000)} s`); built++; }
    } catch (e) {
      if (!(e instanceof BuildError)) throw e;
      err(`FAIL  ${n}: ${e.message}`);
      if (e.log && existsSync(e.log)) {
        const tail = readFileSync(e.log, "utf8").trimEnd().split("\n").slice(-25);
        err(tail.map((l) => `      | ${l}`).join("\n"));
        err(`      log: ${e.log}`);
      }
      failed.push(n);
      if (!opts.keepGoing) break;
    }
  }
  const total = [...wanted].length;
  err(`build: ${built} built, ${hits} cached, ${failed.length} failed of ${total}; layers in ${join(cache, "layers")}`);
  return failed.length ? EXIT.builder : EXIT.ok;
}
