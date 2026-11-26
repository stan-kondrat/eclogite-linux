// Package builds (docs/cli.md, "Sources and build execution";
// builders/README.md). Eclogite runs inside the pinned builder (the dev VM or
// its container), so a build is a set of processes here, not a VM.
//
// For one locked package:
//   1. its source tree (from fetch) is copied to a writable WORK and patched;
//   2. the steps configure, build and install run in order: pre-<step> hooks,
//      then the package's <step> hooks if it names any (an empty list skips
//      the step) or else builders/<builder>/build.sh <step>, then post-<step>;
//   3. eclogite normalizes the installed tree (programs into /bin, #! lines)
//      and applies the common arguments: files, symlinks, remove, strip;
//   4. the tree becomes the immutable layer <cache>/layers/<key>/ with a
//      manifest <key>.json written last. A complete layer is a cache hit.
//
// Layout of a build's temporary directory <cache>/temporary/build-<key>-<pid>/:
//   src/     WORK: writable, patched copy of the source tree
//   build/   BUILD: out-of-tree build directory
//   dest/    DESTDIR: the install root, which becomes the layer
//   home/    HOME

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, lstatSync, readlinkSync, symlinkSync, copyFileSync, chmodSync, openSync, closeSync, appendFileSync, utimesSync, lutimesSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { hashOf } from "./canonical.mjs";
import { sourceKey, entryState } from "./sources.mjs";

export const LAYER_FORMAT = "eclogite.layer/v0.1";
const STEPS = ["configure", "build", "install"];

export class BuildError extends Error {
  constructor(message, log) {
    super(message);
    this.log = log;
  }
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
function removeTree(path) {
  if (!existsSync(path)) return;
  sh("chmod", ["-R", "u+w", path]);
  rmSync(path, { recursive: true, force: true });
}

export function layerState(cache, key) {
  const manifest = join(cache, "layers", `${key}.json`);
  if (!existsSync(manifest)) return existsSync(join(cache, "layers", key)) ? "incomplete" : "missing";
  try {
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    if (m.format === LAYER_FORMAT && m.key === key && existsSync(join(cache, "layers", key))) return "complete";
  } catch { /* corrupt */ }
  return "incomplete";
}
export const layerDir = (cache, key) => join(cache, "layers", key);
export const readLayer = (cache, key) => JSON.parse(readFileSync(join(cache, "layers", `${key}.json`), "utf8"));

/** The variables every step and hook gets (docs/build-model.md, "Hook variables"). */
export function stepEnvironment({ lock, entry, dirs, toolchainRoot, packageDir, jobs, depLayers }) {
  const triplet = lock.target.triplet;
  const tc = toolchainRoot;
  const env = {
    // a constructed environment: nothing inherited from the caller but these
    ...lock.build_environment.variables,
    PATH: `${tc}/bin:/bin:/usr/bin`,
    HOME: dirs.home,
    SRC: dirs.source,
    WORK: dirs.work,
    BUILD: dirs.build,
    DESTDIR: dirs.dest,
    PACKAGE: packageDir,
    JOBS: String(jobs),
    TOOLCHAIN: tc,
    SYSROOT: `${tc}/${triplet}/sysroot`,
    TARGET_TRIPLET: triplet,
    BUILD_TRIPLET: sh("gcc", ["-dumpmachine"]).stdout.trim(),
    KERNEL_ARCH: lock.platform.kernel_architecture,
    SOURCE_DATE_EPOCH: String(lock.build_environment.source_date_epoch),
  };
  if (entry.compiler?.name === "gcc" || !entry.compiler) {
    const t = (tool) => `${triplet}-${tool}`;
    Object.assign(env, { CC: t("gcc"), CXX: t("g++"), LD: t("ld"), AR: t("ar"), RANLIB: t("ranlib"), NM: t("nm"), STRIP: t("strip"), OBJCOPY: t("objcopy") });
  }
  // the work directory must not leak into outputs (debug info, __FILE__)
  const prefixMap = `-ffile-prefix-map=${dirs.work}=${lock.build_environment.build_directory} -ffile-prefix-map=${dirs.build}=${dirs.build.replace(/.*\//, "/build/")}`;
  env.CFLAGS = `-O2 ${prefixMap}`;
  env.CXXFLAGS = env.CFLAGS;
  env.LDFLAGS = "";
  for (const [name, dir] of Object.entries(depLayers)) env[`DEP_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`] = dir;
  // builder arguments: ARG_<NAME>, lists one item per line, maps as K=V lines
  for (const [k, v] of Object.entries(entry.arguments ?? {})) {
    if (["hooks", "files", "symlinks", "remove", "strip", "environment"].includes(k)) continue;
    const name = `ARG_${k.toUpperCase()}`;
    if (Array.isArray(v)) env[name] = v.join("\n");
    else if (v && typeof v === "object") env[name] = Object.entries(v).map(([a, b]) => `${a}=${b}`).join("\n");
    else env[name] = String(v);
  }
  for (const [k, v] of Object.entries(entry.arguments?.environment ?? {})) env[k] = String(v);
  const kconfig = lock.config?.[entry.name];
  if (kconfig?.format === "kconfig") {
    env.KCONFIG = Object.entries(kconfig.effective).map(([k, v]) => `${k}=${v}`).join("\n");
    // the options a dependent, the software or a machine device asked for
    env.KCONFIG_REQUIRED = Object.keys(kconfig.required ?? {}).join("\n");
  }
  for (const [k, p] of Object.entries(entry.parameters ?? {})) env[k] = String(p.value);
  return env;
}

/** Run one command with the step environment, appending to the log. */
function runLogged(cmd, args, { env, cwd, log, title }) {
  appendFileSync(log, `\n==== ${title}\n`);
  const fd = openSync(log, "a");
  try {
    const r = spawnSync(cmd, args, { env, cwd, stdio: ["ignore", fd, fd] });
    if (r.error) throw new BuildError(`${title}: ${r.error.message}`, log);
    if (r.status !== 0) throw new BuildError(`${title} failed (exit ${r.status ?? r.signal})`, log);
  } finally {
    closeSync(fd);
  }
}

/** Build one package into its layer. Returns { key, dir, hit }. */
export function buildPackage(args) {
  // the work directory: <cache>/temporary, or workDir, for a cache on a
  // filesystem builds cannot use (9p has no writable shared mmap, which the
  // kernel's relacheck needs)
  const tmp = join(args.workDir ?? join(args.cache, "temporary"), `build-${args.entry.key.slice(0, 16)}-${process.pid}`);
  try {
    return buildInto(args, tmp);
  } catch (e) {
    // a failed build keeps its directory only with --keep-work (the log stays)
    if (e instanceof BuildError && !args.keepWork) removeTree(tmp);
    else if (e instanceof BuildError) e.message += `; work kept in ${tmp}`;
    throw e;
  }
}

function buildInto({ lock, entry, cache, project, packageDir, toolchainRoot, jobs = cpus().length, keepWork = false, logDir, depLayers = {} }, tmp) {
  const key = entry.key;
  if (layerState(cache, key) === "complete") return { key, dir: layerDir(cache, key), hit: true };
  if (layerState(cache, key) === "incomplete") { removeTree(layerDir(cache, key)); rmSync(join(cache, "layers", `${key}.json`), { force: true }); }

  removeTree(tmp);
  const dirs = { root: tmp, work: join(tmp, "src"), build: join(tmp, "build"), dest: join(tmp, "dest"), home: join(tmp, "home") };
  for (const d of [dirs.build, dirs.dest, dirs.home]) mkdirSync(d, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `${entry.name}.log`);
  writeFileSync(log, `eclogite build ${entry.name} ${entry.version} key ${key}\n`);

  // 1. source: a writable, patched copy of the fetched tree
  if (entry.source.type === "git") {
    const sk = sourceKey(entry.source);
    if (entryState(cache, sk) !== "complete") throw new BuildError(`${entry.name}: source ${entry.source.revision.slice(0, 12)} is not fetched; run eclogite fetch`, null);
    dirs.source = join(cache, "sources", sk);
    // Copying a large tree is slow, so a build gets the least it needs:
    // with patches, a writable copy; an out-of-tree build without patches
    // (linux-kernel, configure with out_of_tree) reads the immutable tree
    // itself; an in-tree build gets hard links with writable directories,
    // so new files are fine and an in-place write fails loudly instead of
    // changing the cache.
    const outOfTree = entry.builder === "linux-kernel" || (entry.builder === "configure" && entry.arguments?.out_of_tree);
    let r;
    if (entry.hashes.patches.length) {
      r = sh("cp", ["-a", dirs.source, dirs.work]);
      if (r.status === 0) sh("chmod", ["-R", "u+w", dirs.work]);
    } else if (outOfTree) {
      dirs.work = dirs.source;
    } else {
      r = sh("cp", ["-al", dirs.source, dirs.work]);
      if (r.status === 0) r = sh("find", [dirs.work, "-type", "d", "-exec", "chmod", "u+w", "{}", "+"]);
    }
    if (r && r.status !== 0) throw new BuildError(`${entry.name}: preparing the source failed: ${r.stderr}`, log);
  } else {
    dirs.source = dirs.work;
    mkdirSync(dirs.work, { recursive: true });
  }
  const env = stepEnvironment({ lock, entry, dirs, toolchainRoot, packageDir, jobs, depLayers });
  for (const p of entry.hashes.patches) {
    checkHash(packageDir, p.path, p.sha256, entry.name);
    // the dev image has no patch(1); git apply works outside a repository
    runLogged("git", ["apply", "--whitespace=nowarn", "-p1", join(packageDir, p.path)], { env, cwd: dirs.work, log, title: `patch ${p.path}` });
  }

  // 2. steps
  const hooks = entry.arguments?.hooks ?? {};
  for (const h of entry.hashes.hooks) checkHash(packageDir, `hooks/${h.name}.sh`, h.sha256, entry.name);
  const hook = (name) => runLogged("/bin/sh", ["-eu", join(packageDir, "hooks", `${name}.sh`)], { env, cwd: dirs.work, log, title: `hook ${name}` });
  const builder = join(project, "builders", entry.builder, "build.sh");
  if (!existsSync(builder)) throw new BuildError(`${entry.name}: builder ${entry.builder} has no ${relative(project, builder)} yet`, null);
  for (const step of STEPS) {
    for (const h of hooks[`pre-${step}`] ?? []) hook(h);
    if (hooks[step]) for (const h of hooks[step]) hook(h);
    else runLogged("/bin/sh", ["-eu", builder, step], { env, cwd: dirs.work, log, title: `${entry.builder} ${step}` });
    for (const h of hooks[`post-${step}`] ?? []) hook(h);
  }

  // 3. normalize and apply the common arguments
  normalizeLayout(dirs.dest);
  for (const f of entry.hashes.files) {
    checkHash(packageDir, f.path, f.sha256, entry.name);
    const guest = entry.arguments?.files?.[f.path];
    if (!guest) continue; // a capability's file (the image step) or a config fragment (the builder)
    const to = join(dirs.dest, guest);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(packageDir, f.path), to);
    chmodSync(to, lstatSync(join(packageDir, f.path)).mode & 0o777);
  }
  for (const [link, target] of Object.entries(entry.arguments?.symlinks ?? {})) {
    const at = join(dirs.dest, link);
    mkdirSync(dirname(at), { recursive: true });
    rmSync(at, { force: true });
    symlinkSync(target, at);
  }
  for (const pattern of entry.arguments?.remove ?? []) removeMatching(dirs.dest, pattern);
  if (entry.arguments?.strip) stripTree(dirs.dest, `${lock.target.triplet}-strip`, env);

  // 4. the layer: fixed times, a manifest, published atomically
  const files = manifestOf(dirs.dest, lock.build_environment.source_date_epoch);
  const manifest = { format: LAYER_FORMAT, key, name: entry.name, version: entry.version, tree_sha256: hashOf(files), files };
  sh("chmod", ["-R", "a-w", dirs.dest]);
  sh("chmod", ["u+w", dirs.dest]);
  mkdirSync(join(cache, "layers"), { recursive: true });
  try {
    renameSync(dirs.dest, layerDir(cache, key));
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    // the work directory is on another filesystem: copy, then remove
    const r = sh("cp", ["-a", dirs.dest, `${layerDir(cache, key)}.tmp`]);
    if (r.status !== 0) throw new BuildError(`${entry.name}: copying the layer into the cache failed: ${r.stderr}`, log);
    renameSync(`${layerDir(cache, key)}.tmp`, layerDir(cache, key));
    removeTree(dirs.dest);
  }
  sh("chmod", ["a-w", layerDir(cache, key)]);
  writeFileSync(join(cache, "layers", `${key}.json.tmp`), `${JSON.stringify(manifest, null, 1)}\n`);
  renameSync(join(cache, "layers", `${key}.json.tmp`), join(cache, "layers", `${key}.json`));
  if (!keepWork) removeTree(tmp);
  return { key, dir: layerDir(cache, key), hit: false, files: files.length, log };
}

function checkHash(dir, rel, want, name) {
  const got = createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex");
  if (got !== want) throw new BuildError(`${name}: ${rel} changed since the lock (sha256 ${got.slice(0, 12)}, locked ${want.slice(0, 12)}); run eclogite lock`, null);
}

// ---------------------------------------------------------------------------
// post-processing

/** Programs live in /bin: move /usr/bin, /usr/sbin, /sbin there; rewrite #! lines. */
export function normalizeLayout(root) {
  for (const from of ["usr/bin", "usr/sbin", "sbin"]) {
    const dir = join(root, from);
    if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) continue;
    mkdirSync(join(root, "bin"), { recursive: true });
    for (const name of readdirSync(dir)) {
      const to = join(root, "bin", name);
      if (existsSync(to)) throw new BuildError(`layout: both /${from}/${name} and /bin/${name} exist`, null);
      renameSync(join(dir, name), to);
    }
    rmSync(dir, { recursive: true });
  }
  // an /usr that only held programs is left empty
  const usr = join(root, "usr");
  if (existsSync(usr) && lstatSync(usr).isDirectory() && readdirSync(usr).length === 0) rmSync(usr, { recursive: true });
  const bin = join(root, "bin");
  if (!existsSync(bin)) return;
  for (const name of readdirSync(bin)) {
    const p = join(bin, name);
    const st = lstatSync(p);
    if (!st.isFile()) continue;
    const head = readFileSync(p).subarray(0, 256).toString("latin1");
    if (!head.startsWith("#!")) continue;
    const text = readFileSync(p, "latin1");
    const fixed = text.replace(/^#!\s*\/(?:usr\/(?:local\/)?)?s?bin\//, "#!/bin/");
    if (fixed !== text) { chmodSync(p, st.mode | 0o200); writeFileSync(p, fixed, "latin1"); chmodSync(p, st.mode); }
  }
}

/** Guest path pattern → RegExp: `**` any depth, `*` one name part. */
export function patternRegExp(pattern) {
  const p = pattern.replace(/^\//, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") { re += p[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += p[i + 2] === "/" ? 2 : 1; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}(?:/.*)?$`);
}

function walk(root, fn, rel = "") {
  for (const name of readdirSync(join(root, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(root, r));
    fn(r, st);
    if (st.isDirectory()) walk(root, fn, r);
  }
}

function removeMatching(root, pattern) {
  const re = patternRegExp(pattern);
  const hits = [];
  walk(root, (r) => { if (re.test(r) && !hits.some((h) => r.startsWith(`${h}/`))) hits.push(r); });
  for (const h of hits) rmSync(join(root, h), { recursive: true, force: true });
}

function stripTree(root, strip, env) {
  walk(root, (r, st) => {
    if (!st.isFile()) return;
    const p = join(root, r);
    const magic = readFileSync(p).subarray(0, 4);
    if (magic.length === 4 && magic[0] === 0x7f && magic.toString("latin1", 1, 4) === "ELF") {
      chmodSync(p, st.mode | 0o200);
      sh(strip, ["--strip-unneeded", p], { env });
      chmodSync(p, st.mode);
    }
  });
}

/** Every entry with type, mode and content hash; times set to the epoch. */
export function manifestOf(root, epoch) {
  const files = [];
  walk(root, (r, st) => {
    const p = join(root, r);
    if (st.isSymbolicLink()) { files.push({ path: r, type: "symlink", target: readlinkSync(p) }); lutimesSync(p, epoch, epoch); return; }
    if (st.isDirectory()) files.push({ path: r, type: "dir", mode: (st.mode & 0o7777).toString(8) });
    else if (st.isFile()) files.push({ path: r, type: "file", mode: (st.mode & 0o7777).toString(8), size: st.size, sha256: createHash("sha256").update(readFileSync(p)).digest("hex") });
    else throw new BuildError(`layer: ${r} is neither a file, a directory nor a symlink`, null);
  });
  // directories last, so setting a file's time does not change its directory's
  for (const f of files) if (f.type === "file") utimesSync(join(root, f.path), epoch, epoch);
  for (const f of [...files].reverse()) if (f.type === "dir") utimesSync(join(root, f.path), epoch, epoch);
  utimesSync(root, epoch, epoch);
  return files;
}
