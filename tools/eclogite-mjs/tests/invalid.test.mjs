// Invalid-input fixtures: each tests/fixtures/invalid/<case>/catalog/ holds the
// files that make the case invalid, as a second catalog root next to the
// repository's catalog/ (so a case only contains what it needs), and
// `expected.txt`, the exact diagnostics `--catalog <case>/catalog validate
// catalog` prints on stderr, run from the repository root, then the exit code.
//
// UPDATE_EXPECTED=1 node --test tests/*.test.mjs rewrites expected.txt files:
// review the diff before committing, as for golden files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const CLI = resolve(HERE, "../bin/eclogite-mjs.mjs");
const CASES = join(HERE, "fixtures/invalid");

for (const name of readdirSync(CASES).sort()) {
  test(`invalid: ${name}`, () => {
    const root = `tools/eclogite-mjs/tests/fixtures/invalid/${name}/catalog`;
    const r = spawnSync(process.execPath, [CLI, "--catalog", root, "validate", "catalog"], { cwd: REPO, encoding: "utf8" });
    const actual = `${r.stderr}exit ${r.status}\n`;
    const file = join(CASES, name, "expected.txt");
    if (process.env.UPDATE_EXPECTED) writeFileSync(file, actual);
    assert.ok(existsSync(file), `${file} is missing; run with UPDATE_EXPECTED=1`);
    assert.equal(actual, readFileSync(file, "utf8"));
    assert.equal(r.status, 10);
  });
}
