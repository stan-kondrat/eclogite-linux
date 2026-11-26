// Package sources in the cache (docs/storage.md, "Package source cache"):
//
//   <cache>/git/mirrors/<url-key>.git/   bare mirror holding the locked commits
//   <cache>/sources/<source-key>/        immutable, read-only source tree
//   <cache>/sources/<source-key>.json    its manifest, written last: an entry
//                                        is complete only when this exists
//   <cache>/temporary/                   work in progress, safe to delete
//
// A source key names the unpatched tree of one commit of one URL. Patches are
// applied later, by source preparation, into a build's own work directory.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { hashOf, sha256 } from "./canonical.mjs";

export const SOURCE_FORMAT = "eclogite.source/v0.1";

/** --cache-dir, else $XDG_CACHE_HOME/eclogite, else ~/.cache/eclogite (docs/cli.md). */
export function cacheDir(opts = {}) {
  if (opts.cacheDir) return resolvePath(opts.cacheDir);
  const xdg = process.env.XDG_CACHE_HOME;
  return join(xdg && xdg.startsWith("/") ? xdg : join(homedir(), ".cache"), "eclogite");
}

/** The key of the unpatched source tree of a locked git source. */
export function sourceKey(source) {
  return hashOf({ format: SOURCE_FORMAT, type: source.type, url: source.url, revision: source.revision });
}

/** Mirror directory name: readable, plus a hash so different URLs never collide. */
export function mirrorName(url) {
  const readable = url.replace(/^[a-z+]+:\/\//, "").replace(/\.git$/, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
  return `${readable}-${sha256(Buffer.from(url)).slice(0, 12)}.git`;
}

export class SourceError extends Error {}

function git(args, { cwd, env, input } = {}) {
  const r = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // never prompt for credentials; never read the user's or system git config
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", ...env },
  });
  if (r.error) throw new SourceError(`git: ${r.error.message}`);
  return r;
}

const hasCommit = (mirror, rev) => git(["--git-dir", mirror, "cat-file", "-e", `${rev}^{commit}`]).status === 0;

/** Make the mirror hold the locked commit; network only when it does not. */
export function ensureCommit(cache, source, log = () => {}) {
  const mirror = join(cache, "git/mirrors", mirrorName(source.url));
  if (!existsSync(join(mirror, "HEAD"))) {
    mkdirSync(mirror, { recursive: true });
    const r = git(["init", "--quiet", "--bare", mirror]);
    if (r.status !== 0) throw new SourceError(`git init ${mirror}: ${r.stderr.trim()}`);
  }
  if (hasCommit(mirror, source.revision)) return { mirror, downloaded: false };
  log(`fetching ${source.revision.slice(0, 12)} from ${source.url}`);
  // the commit alone, without history; servers speaking protocol v2 serve any
  // reachable commit by id
  let r = git(["--git-dir", mirror, "-c", "protocol.version=2", "fetch", "--quiet", "--no-tags", "--depth=1", source.url, source.revision]);
  if (r.status !== 0 || !hasCommit(mirror, source.revision)) {
    // a server that refuses a commit id: every branch and tag, then look again
    log(`${source.url} refused the commit id; fetching all refs`);
    r = git(["--git-dir", mirror, "fetch", "--quiet", "--no-tags", source.url, "+refs/heads/*:refs/eclogite/heads/*", "+refs/tags/*:refs/eclogite/tags/*"]);
    if (r.status !== 0) throw new SourceError(`cannot fetch ${source.url}: ${r.stderr.trim()}`);
  }
  if (!hasCommit(mirror, source.revision)) throw new SourceError(`${source.url} has no commit ${source.revision}`);
  // keep the commit reachable so git gc never drops it
  git(["--git-dir", mirror, "update-ref", `refs/eclogite/locked/${source.revision}`, source.revision]);
  return { mirror, downloaded: true };
}

/** Status of a source tree entry: "complete", "incomplete" or "missing". */
export function entryState(cache, key) {
  const dir = join(cache, "sources", key);
  const manifest = `${dir}.json`;
  if (existsSync(manifest)) {
    try {
      const m = JSON.parse(readFileSync(manifest, "utf8"));
      if (m.format === SOURCE_FORMAT && m.key === key && existsSync(dir)) return "complete";
    } catch { /* corrupt manifest: incomplete */ }
    return "incomplete";
  }
  return existsSync(dir) ? "incomplete" : "missing";
}

export function readManifest(cache, key) {
  return JSON.parse(readFileSync(join(cache, "sources", `${key}.json`), "utf8"));
}

function removeTree(path) {
  if (!existsSync(path)) return;
  spawnSync("chmod", ["-R", "u+w", path]);
  rmSync(path, { recursive: true, force: true });
}

/**
 * Materialize the locked commit as a read-only tree under sources/<key>/.
 * A complete entry is never replaced; an incomplete one only with force.
 */
export function materialize(cache, source, { force = false } = {}) {
  const key = sourceKey(source);
  const dir = join(cache, "sources", key);
  const state = entryState(cache, key);
  if (state === "complete") return { key, dir, created: false };
  if (state === "incomplete") {
    if (!force) throw new SourceError(`${dir} is incomplete or corrupt; run fetch --force to replace it`);
    removeTree(`${dir}.json`);
    removeTree(dir);
  }
  const { mirror, downloaded } = ensureCommit(cache, source);
  const tree = git(["--git-dir", mirror, "rev-parse", `${source.revision}^{tree}`]);
  if (tree.status !== 0) throw new SourceError(`${source.revision}: no tree: ${tree.stderr.trim()}`);

  const tmpRoot = join(cache, "temporary");
  mkdirSync(tmpRoot, { recursive: true });
  const tmp = join(tmpRoot, `source-${key.slice(0, 16)}-${process.pid}`);
  const index = `${tmp}.index`;
  removeTree(tmp);
  mkdirSync(tmp, { recursive: true });
  try {
    // checkout-index with a private index: every tracked file, unlike git
    // archive, which drops export-ignore paths
    const env = { GIT_INDEX_FILE: index };
    let r = git(["--git-dir", mirror, "read-tree", source.revision], { env });
    if (r.status !== 0) throw new SourceError(`read-tree ${source.revision}: ${r.stderr.trim()}`);
    r = git(["--git-dir", mirror, "--work-tree", tmp, "-c", "core.autocrlf=false", "-c", "core.symlinks=true", "checkout-index", "--all", "--force"], { env });
    if (r.status !== 0) throw new SourceError(`checkout ${source.revision}: ${r.stderr.trim()}`);
    const files = git(["--git-dir", mirror, "ls-tree", "-r", "--name-only", source.revision]).stdout.split("\n").filter(Boolean).length;
    // read-only, except the top directory until it is moved: moving a
    // directory to another parent needs write permission on it
    spawnSync("chmod", ["-R", "a-w", tmp]);
    spawnSync("chmod", ["u+w", tmp]);
    mkdirSync(join(cache, "sources"), { recursive: true });
    renameSync(tmp, dir);
    spawnSync("chmod", ["a-w", dir]);
    const manifest = { format: SOURCE_FORMAT, key, type: source.type, url: source.url, revision: source.revision, tree: tree.stdout.trim(), files };
    writeFileSync(`${dir}.json.tmp`, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(`${dir}.json.tmp`, `${dir}.json`);
    return { key, dir, created: true, downloaded, files };
  } finally {
    removeTree(tmp);
    rmSync(index, { force: true });
  }
}
