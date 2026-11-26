// build (src/build.mjs), offline: a tiny package with a local git source,
// built with the real builders/make/build.sh and the host's own tools.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readlinkSync, lstatSync, symlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { buildPackage, layerState, patternRegExp, normalizeLayout, BuildError } from "../src/build.mjs";
import { materialize } from "../src/sources.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// git is not in the linux-libre-vm v0.4.0 dev image (the CI container)
const NO_GIT = spawnSync("git", ["--version"]).status !== 0 && "git is not installed";
const REPO = resolve(HERE, "../../..");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const git = (args, cwd) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const cleanup = (root) => { spawnSync("chmod", ["-R", "u+w", root]); rmSync(root, { recursive: true, force: true }); };

test("remove patterns: ** at any depth, * within a name", () => {
  const t = (p, path) => patternRegExp(p).test(path);
  assert.ok(t("**/*.a", "usr/lib/libc.a"));
  assert.ok(t("**/*.a", "libc.a"));
  assert.ok(!t("**/*.a", "usr/lib/libc.so"));
  assert.ok(t("/usr/include", "usr/include"));
  assert.ok(t("/usr/include", "usr/include/stdio.h"));
  assert.ok(!t("/usr/include", "usr/include2"));
  assert.ok(t("**/*-gdb.py", "usr/share/gcc/x/libstdc++.so.6-gdb.py"));
});

test("layout: programs move to /bin and #! lines are rewritten", () => {
  const root = mkdtempSync(join(tmpdir(), "eclogite-build-"));
  try {
    mkdirSync(join(root, "usr/bin"), { recursive: true });
    mkdirSync(join(root, "sbin"), { recursive: true });
    writeFileSync(join(root, "usr/bin/tool"), "#!/usr/bin/perl\nprint 1;\n", { mode: 0o755 });
    writeFileSync(join(root, "sbin/admin"), "#! /sbin/sh -e\n", { mode: 0o755 });
    normalizeLayout(root);
    assert.ok(!existsSync(join(root, "usr/bin")) && !existsSync(join(root, "sbin")));
    assert.equal(readFileSync(join(root, "bin/tool"), "utf8"), "#!/bin/perl\nprint 1;\n");
    assert.equal(readFileSync(join(root, "bin/admin"), "utf8"), "#!/bin/sh -e\n");
  } finally {
    cleanup(root);
  }
});

test("a make package builds into a read-only layer, patched, with its files and symlinks; then it is a hit", { skip: NO_GIT }, () => {
  const root = mkdtempSync(join(tmpdir(), "eclogite-build-"));
  try {
    // upstream: a Makefile that builds and installs one program (portable:
    // macOS's install has no -D)
    const up = join(root, "upstream");
    mkdirSync(up);
    writeFileSync(join(up, "Makefile"), "all:\n\techo 'echo hello' > hello\ninstall:\n\tmkdir -p $(DESTDIR)/usr/bin\n\tcp hello $(DESTDIR)/usr/bin/hello\n\tchmod 0755 $(DESTDIR)/usr/bin/hello\n");
    git(["init", "-q", "-b", "main"], up);
    git(["add", "-A"], up);
    git(["-c", "user.name=t", "-c", "user.email=t@example.org", "commit", "-qm", "one"], up);
    const revision = git(["rev-parse", "HEAD"], up);
    // the package: a patch, a hook, a file, a symlink, a removal
    const pkg = join(root, "pkg");
    mkdirSync(join(pkg, "patches"), { recursive: true });
    mkdirSync(join(pkg, "hooks"));
    mkdirSync(join(pkg, "files"));
    writeFileSync(join(pkg, "patches/0001.patch"), "--- a/Makefile\n+++ b/Makefile\n@@ -1,3 +1,3 @@\n all:\n-\techo 'echo hello' > hello\n+\techo 'echo patched' > hello\n install:\n");
    writeFileSync(join(pkg, "hooks/post-install.sh"), "mkdir -p \"$DESTDIR/usr/share/doc\"; echo x > \"$DESTDIR/usr/share/doc/README\"; echo \"$TARGET_TRIPLET\" > \"$DESTDIR/triplet\"\n");
    writeFileSync(join(pkg, "files/motd"), "welcome\n");
    const cache = join(root, "cache");
    const source = { type: "git", url: up, revision };
    materialize(cache, source);
    const entry = {
      kind: "buildable", name: "hello", version: "1", key: "a".repeat(64), builder: "make", source,
      arguments: { hooks: { "post-install": ["post-install"] }, files: { "files/motd": "/etc/motd" }, symlinks: { "/bin/hi": "hello" }, remove: ["/usr/share/doc"] },
      dependencies: { build: [], link: [], run: [] }, parameters: {},
      hashes: { patches: [{ path: "patches/0001.patch", sha256: sha(join(pkg, "patches/0001.patch")) }], hooks: [{ name: "post-install", sha256: sha(join(pkg, "hooks/post-install.sh")) }], files: [{ path: "files/motd", sha256: sha(join(pkg, "files/motd")) }] },
    };
    const lock = {
      target: { triplet: "aarch64-linux-gnu" },
      platform: { kernel_architecture: "arm64" },
      build_environment: { source_date_epoch: 1793059200, build_directory: "/build/src", variables: { LC_ALL: "C.UTF-8", TZ: "UTC", SOURCE_DATE_EPOCH: "1793059200" } },
      config: {},
    };
    const args = { lock, entry, cache, project: REPO, packageDir: pkg, toolchainRoot: join(root, "no-toolchain"), jobs: 1, logDir: join(root, "logs") };
    let r;
    try { r = buildPackage(args); } catch (e) { if (e.log) console.error(readFileSync(e.log, "utf8")); throw e; }
    assert.equal(r.hit, false);
    assert.equal(layerState(cache, entry.key), "complete");
    assert.equal(readFileSync(join(r.dir, "bin/hello"), "utf8"), "echo patched\n");
    assert.equal(readFileSync(join(r.dir, "etc/motd"), "utf8"), "welcome\n");
    assert.equal(readlinkSync(join(r.dir, "bin/hi")), "hello");
    assert.equal(readFileSync(join(r.dir, "triplet"), "utf8"), "aarch64-linux-gnu\n");
    assert.ok(!existsSync(join(r.dir, "usr/share/doc")));
    assert.equal(lstatSync(join(r.dir, "bin/hello")).mtimeMs, 1793059200 * 1000);
    // root (the CI container) ignores permissions
    if (process.getuid?.() !== 0) assert.throws(() => writeFileSync(join(r.dir, "bin/hello"), "x"));
    const m = JSON.parse(readFileSync(join(cache, "layers", `${entry.key}.json`), "utf8"));
    assert.deepEqual(m.files.find((f) => f.path === "bin/hello").mode, "755");
    assert.ok(!existsSync(join(cache, "temporary", `build-${"a".repeat(16)}-${process.pid}`)));
    // a hit: nothing runs
    assert.equal(buildPackage(args).hit, true);
    // a package file that changed since the lock is refused
    writeFileSync(join(pkg, "files/motd"), "changed\n");
    assert.throws(() => buildPackage({ ...args, entry: { ...entry, key: "b".repeat(64) } }), /changed since the lock/);
  } finally {
    cleanup(root);
  }
});

test("a failing step is a BuildError with its log", () => {
  const root = mkdtempSync(join(tmpdir(), "eclogite-build-"));
  try {
    const pkg = join(root, "pkg");
    mkdirSync(join(pkg, "hooks"), { recursive: true });
    writeFileSync(join(pkg, "hooks/fail.sh"), "echo before-failing; exit 3\n");
    const entry = {
      kind: "buildable", name: "broken", version: "1", key: "c".repeat(64), builder: "files", source: { type: "none" },
      arguments: { hooks: { install: ["fail"] } }, dependencies: { build: [], link: [], run: [] }, parameters: {},
      hashes: { patches: [], hooks: [{ name: "fail", sha256: sha(join(pkg, "hooks/fail.sh")) }], files: [] },
    };
    const lock = { target: { triplet: "aarch64-linux-gnu" }, platform: { kernel_architecture: "arm64" }, build_environment: { source_date_epoch: 1, build_directory: "/build/src", variables: {} }, config: {} };
    let error;
    try { buildPackage({ lock, entry, cache: join(root, "cache"), project: REPO, packageDir: pkg, toolchainRoot: root, jobs: 1, logDir: join(root, "logs") }); } catch (e) { error = e; }
    assert.ok(error instanceof BuildError);
    assert.match(error.message, /hook fail failed \(exit 3\)/);
    assert.match(readFileSync(error.log, "utf8"), /before-failing/);
    assert.equal(layerState(join(root, "cache"), entry.key), "missing");
  } finally {
    cleanup(root);
  }
});
