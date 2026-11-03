// Valid-input conformance: validate, verify, the devbox lock, determinism, and
// "a one-field change gives an explained rebuild set".
//
// UPDATE_EXPECTED=1 rewrites tests/fixtures/devbox/expected.lock.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const CLI = resolve(HERE, "../bin/eclogite-mjs.mjs");
const DEVBOX = "tools/eclogite-mjs/tests/fixtures/devbox/catalog";
const SYSTEM = `${DEVBOX}/systems/utm-arm64-devbox.jsonc`;

const cli = (args, cwd = REPO) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });

test("validate catalog passes", () => {
  const r = cli(["validate", "catalog"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /35 buildable/);
});

test("validate accepts the devbox fixture next to the catalog", () => {
  const r = cli(["--catalog", DEVBOX, "validate", "catalog"]);
  assert.equal(r.status, 0, r.stderr);
});

test("verify passes", () => {
  const r = cli(["verify"]);
  assert.equal(r.status, 0, r.stderr);
});

test("the devbox lock equals the stored lock and is byte-identical twice", () => {
  const args = ["--catalog", DEVBOX, "--host", "aarch64", "lock", "--allow-unpinned", "-c", SYSTEM, "-o", "-"];
  const env = { ...process.env };
  delete env.SOURCE_DATE_EPOCH;
  const a = spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, encoding: "utf8", env });
  const b = spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, encoding: "utf8", env });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  const file = join(HERE, "fixtures/devbox/expected.lock.json");
  if (process.env.UPDATE_EXPECTED) writeFileSync(file, a.stdout);
  assert.ok(existsSync(file), "run with UPDATE_EXPECTED=1");
  assert.equal(a.stdout, readFileSync(file, "utf8"));
  const lock = JSON.parse(a.stdout);
  // secrets are never written to the lock: not as settings, not in the profile
    assert.equal(lock.runtime.settings.DEVBOX_PASSWORD.default, undefined);
  assert.equal(lock.software.settings.DEVBOX_PASSWORD.default, undefined);
  assert.equal(lock.accounts.files, "start");
  assert.equal(lock.services.theia.environment.NODE_OPTIONS, "--max-old-space-size=6144");
  assert.equal(lock.services.theia.user, "${USER}");
});

test("an unpinned value is refused without --allow-unpinned", () => {
  const r = cli(["lock", "--machine", "utm-virt-arm64-8g", "--software", "theia", "-o", "-"]);
  assert.equal(r.status, 11);
  assert.match(r.stderr, /pending/);
});

test("a failed resolution exits 11 with the golden message", () => {
  const r = cli(["lock", "--machine", "qemu-raspi1ap-armv6", "--software", "theia", "-o", "-"]);
  assert.equal(r.status, 11);
  assert.match(r.stderr, /theia fails its target/);
});

test("a one-field change gives an explained rebuild set, and the old lock is stale", () => {
  const work = mkdtempSync(join(tmpdir(), "eclogite-mjs-"));
  try {
    cpSync(join(REPO, "catalog"), join(work, "catalog"), { recursive: true });
    const base = ["--project", work, "--catalog", join(REPO, DEVBOX), "-c", join(REPO, SYSTEM), "--host", "aarch64"];
    const lockPath = join(work, "system.lock.json");
    const first = cli([...base, "lock", "--allow-unpinned", "-o", lockPath]);
    assert.equal(first.status, 0, first.stderr);
    const current = cli([...base, "plan", "--lock", lockPath, "--locked"]);
    assert.equal(current.status, 0, current.stderr);
    assert.match(current.stdout, /lock: current/);
    assert.match(current.stdout, /rebuild 0 of/);

    const pkg = join(work, "catalog/packages/openssl/package.jsonc");
    const text = readFileSync(pkg, "utf8");
    assert.ok(text.includes('"install_sw", "install_ssldirs"'));
    writeFileSync(pkg, text.replace('"install_sw", "install_ssldirs"', '"install_sw"'));

    const stale = cli([...base, "plan", "--lock", lockPath, "--locked"]);
    assert.equal(stale.status, 11);
    const plan = cli([...base, "plan", "--lock", lockPath]);
    assert.equal(plan.status, 0, plan.stderr);
    assert.match(plan.stdout, /lock: stale/);
    // openssl itself, and the packages that link it
    assert.match(plan.stdout, /openssl: arguments\n/);
    for (const dependent of ["curl", "openssh"]) assert.match(plan.stdout, new RegExp(`${dependent}: dependency openssl`));
    // git links curl and openssl: both rebuilt
    assert.match(plan.stdout, /git: dependency curl, dependency openssl/);
    assert.match(plan.stdout, /rebuild 4 of/);
    const explain = cli([...base, "explain", "--lock", lockPath]);
    assert.match(explain.stdout, /arguments changed \(install_targets\)\n    was .*\n    now .*install_sw"\]/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("why, graph and explain run on the devbox", () => {
  const base = ["--catalog", DEVBOX, "-c", SYSTEM];
  const why = cli([...base, "why", "git"]);
  assert.equal(why.status, 0, why.stderr);
  assert.match(why.stdout, /software -> devbox -> git/);
  const all = cli([...base, "why", "--all", "zlib"]);
  assert.match(all.stdout, /software -> devbox -> openssh -> zlib/);
  const cap = cli([...base, "why", "sh"]);
  assert.match(cap.stdout, /capability sh: provider bash, default/);
  const graph = cli([...base, "graph"]);
  assert.match(graph.stdout, /└── devbox\n/);
  assert.match(graph.stdout, /\(build only\)/);
  const json = cli([...base, "graph", "--format", "json"]);
  assert.ok(JSON.parse(json.stdout).edges.length > 50);
  void readdirSync;
});
