// Resolution fixtures: each tests/fixtures/resolve/<case>/ has `args.txt` (the
// system to lock, relative `catalog/` paths refer to the case), a `catalog/`
// root laid next to the repository's, and `expected.txt`: stderr and the exit
// code of `lock --allow-unpinned -o -`; for a lock that succeeds, its
// `choices` and `owned_files` instead of stderr.
//
// UPDATE_EXPECTED=1 rewrites expected.txt files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const CLI = resolve(HERE, "../bin/eclogite-mjs.mjs");
const CASES = join(HERE, "fixtures/resolve");

for (const name of readdirSync(CASES).sort()) {
  test(`resolve: ${name}`, () => {
    const dir = `tools/eclogite-mjs/tests/fixtures/resolve/${name}`;
    const args = readFileSync(join(CASES, name, "args.txt"), "utf8").trim().split(" ").map((a) => (a.startsWith("catalog/") ? `${dir}/${a}` : a));
    const r = spawnSync(process.execPath, [CLI, "--catalog", `${dir}/catalog`, "--host", "aarch64", "lock", "--allow-unpinned", "-o", "-", ...args], { cwd: REPO, encoding: "utf8" });
    let actual;
    if (r.status === 0) {
      const lock = JSON.parse(r.stdout);
      actual = `exit 0\nchoices ${JSON.stringify(lock.choices)}\nowned_files ${JSON.stringify(lock.owned_files)}\n`;
    } else actual = `${r.stderr.split("\n").filter((l) => !l.startsWith("warning: unpinned")).join("\n")}exit ${r.status}\n`;
    const file = join(CASES, name, "expected.txt");
    if (process.env.UPDATE_EXPECTED) writeFileSync(file, actual);
    assert.ok(existsSync(file), "run with UPDATE_EXPECTED=1");
    assert.equal(actual, readFileSync(file, "utf8"));
  });
}
