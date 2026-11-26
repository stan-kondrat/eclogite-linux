// fetch and the source cache (src/sources.mjs), offline: a local git
// repository stands in for the upstream URL.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { materialize, sourceKey, entryState, SourceError } from "../src/sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// git is not in the linux-libre-vm v0.4.0 dev image (the CI container)
const NO_GIT = spawnSync("git", ["--version"]).status !== 0 && "git is not installed";
const REPO = resolve(HERE, "../../..");
const CLI = resolve(HERE, "../bin/eclogite-mjs.mjs");

const sh = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** An upstream repository with two commits; returns { url, first, second }. */
function upstream(root) {
  const dir = join(root, "upstream");
  mkdirSync(join(dir, "sub"), { recursive: true });
  sh("git", ["init", "--quiet", "-b", "main"], dir);
  const commit = (msg) => {
    sh("git", ["add", "-A"], dir);
    sh("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "--quiet", "-m", msg], dir);
    return sh("git", ["rev-parse", "HEAD"], dir);
  };
  writeFileSync(join(dir, "README"), "one\n");
  writeFileSync(join(dir, "sub/file.c"), "int x;\n");
  // git archive would drop this file; the source tree must keep it
  writeFileSync(join(dir, ".gitattributes"), "sub/file.c export-ignore\n");
  const first = commit("one");
  writeFileSync(join(dir, "README"), "two\n");
  const second = commit("two");
  return { url: dir, first, second };
}

test("a source tree is materialized read-only, then served from the cache without the upstream", { skip: NO_GIT }, () => {
  const root = mkdtempSync(join(tmpdir(), "eclogite-fetch-"));
  try {
    const up = upstream(root);
    const cache = join(root, "cache");
    const source = { type: "git", url: up.url, revision: up.first };
    const r = materialize(cache, source);
    assert.equal(r.created, true);
    assert.equal(entryState(cache, sourceKey(source)), "complete");
    // the locked commit, not the branch tip, and every tracked file
    assert.equal(readFileSync(join(r.dir, "README"), "utf8"), "one\n");
    assert.ok(existsSync(join(r.dir, "sub/file.c")));
    // root (the CI container) ignores permissions: check the modes instead
    assert.equal(statSync(r.dir).mode & 0o222, 0);
    assert.equal(statSync(join(r.dir, "README")).mode & 0o222, 0);
    if (process.getuid?.() !== 0) assert.throws(() => writeFileSync(join(r.dir, "README"), "x"));
    const m = JSON.parse(readFileSync(`${r.dir}.json`, "utf8"));
    assert.deepEqual([m.revision, m.files, m.key], [up.first, 3, r.key]);
    assert.ok(!existsSync(join(cache, "temporary", `source-${r.key.slice(0, 16)}-${process.pid}`)));

    // no network: the upstream is gone, the entry is complete
    rmSync(up.url, { recursive: true, force: true });
    assert.equal(materialize(cache, source).created, false);
  } finally {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second commit of a mirrored URL is a second tree; an unknown commit fails", { skip: NO_GIT }, () => {
  const root = mkdtempSync(join(tmpdir(), "eclogite-fetch-"));
  try {
    const up = upstream(root);
    const cache = join(root, "cache");
    const a = materialize(cache, { type: "git", url: up.url, revision: up.first });
    const b = materialize(cache, { type: "git", url: up.url, revision: up.second });
    assert.notEqual(a.key, b.key);
    assert.equal(readFileSync(join(b.dir, "README"), "utf8"), "two\n");
    assert.throws(() => materialize(cache, { type: "git", url: up.url, revision: "0".repeat(39) + "1" }), SourceError);
  } finally {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("an incomplete entry is refused, and replaced only with force", { skip: NO_GIT }, () => {
  const root = mkdtempSync(join(tmpdir(), "eclogite-fetch-"));
  try {
    const up = upstream(root);
    const cache = join(root, "cache");
    const source = { type: "git", url: up.url, revision: up.first };
    // an interrupted publication: the tree without its manifest
    mkdirSync(join(cache, "sources", sourceKey(source)), { recursive: true });
    assert.equal(entryState(cache, sourceKey(source)), "incomplete");
    assert.throws(() => materialize(cache, source), /incomplete or corrupt; run fetch --force/);
    assert.equal(materialize(cache, source, { force: true }).created, true);
    assert.equal(entryState(cache, sourceKey(source)), "complete");
  } finally {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("fetch without a lock exits 11", () => {
  const project = mkdtempSync(join(tmpdir(), "eclogite-fetch-"));
  try {
    const r = spawnSync(process.execPath, [CLI, "--project", project, "--catalog", join(REPO, "catalog"), "-c", join(REPO, "catalog/systems/qemu-arm64-minimal-busybox.jsonc"), "--cache-dir", join(project, "cache"), "fetch"], { cwd: REPO, encoding: "utf8" });
    assert.equal(r.status, 11, r.stderr);
    assert.match(r.stderr, /no lock at .*system\.lock\.json; run eclogite-mjs lock/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
