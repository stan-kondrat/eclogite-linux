// verify: the conformance run over the catalog.
//
// For every machine x software profile of the catalog:
//   1. the resolution equals tests/reference/golden/<machine>/<software>.json
//      (a failed resolution equals its recorded error);
//   2. for a resolution that succeeds, the compiled lock validates against
//      schemas/lock.schema.json (checked by compile), locking twice is
//      byte-identical, every package key can be recomputed from the lock
//      alone, and the lock's SHA-256 equals tests/reference/lock-hashes.json.
// Golden files and lock hashes are rewritten only with --update, and every
// rewrite is printed. The build host is fixed at aarch64 and the date at the
// default SOURCE_DATE_EPOCH, so the result does not depend on the machine.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXIT, ExitError, REPO } from "./project.mjs";
import { loadCatalog, compile, resolveOrExit } from "./system.mjs";
import { goldenResult, goldenFailure } from "./golden.mjs";
import { ResolveError } from "./resolve.mjs";
import { prettyJson, sha256, sortedMap } from "./canonical.mjs";
import { lockText } from "./system.mjs";
import { packageKey, globalParts } from "./lock.mjs";

export async function run(command, args, opts) {
  if (args.length) throw new ExitError(EXIT.usage, "verify takes no arguments");
  const project = opts.project ? resolve(opts.project) : REPO;
  const goldenDir = join(project, "tests/reference/golden");
  const hashFile = join(project, "tests/reference/lock-hashes.json");
  const idx = loadCatalog(opts);
  const fixed = { ...opts, host: "aarch64", sourceDateEpoch: undefined, allowUnpinned: true };
  const savedEpoch = process.env.SOURCE_DATE_EPOCH;
  delete process.env.SOURCE_DATE_EPOCH;
  const problems = [];
  const updated = [];
  const hashes = {};
  const oldHashes = existsSync(hashFile) ? JSON.parse(readFileSync(hashFile, "utf8")) : {};
  const expectedFiles = new Set();
  let cases = 0;
  let locked = 0;

  const machines = [...idx.kinds.machine.keys()].sort();
  const softwares = [...idx.kinds.software.keys()].sort();
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true; // the unpinned warnings are expected here
  try {
    for (const m of machines) {
      for (const s of softwares) {
        cases++;
        const id = `${m}/${s}`;
        const value = { schema: "eclogite.system/v0.1", name: `${m}+${s}`, machine: m, software: s };
        let golden;
        let R = null;
        try {
          R = resolveOrExit(idx, value);
          golden = goldenResult(R);
        } catch (e) {
          if (!(e instanceof ExitError)) throw e;
          golden = goldenFailure(m, s, new ResolveError(0, e.message.replace(/^error: /, "")));
        }
        const path = join(goldenDir, m, `${s}.json`);
        expectedFiles.add(path);
        const text = prettyJson(golden);
        const have = existsSync(path) ? readFileSync(path, "utf8") : null;
        if (have !== text) {
          if (opts.update) {
            mkdirSync(join(goldenDir, m), { recursive: true });
            writeFileSync(path, text);
            updated.push(`tests/reference/golden/${id}.json`);
          } else problems.push(`${id}: the resolution differs from tests/reference/golden/${id}.json${have === null ? " (missing)" : ""}`);
        }
        if (!R) continue;
        locked++;
        const sys = { idx, systemDoc: { value, abs: "shorthand", root: null }, systemValue: value };
        let a;
        let b;
        try {
          a = compile(sys, fixed);
          b = compile(sys, fixed);
        } catch (e) {
          problems.push(`${id}: ${e.message}`);
          continue;
        }
        const ta = lockText(a.lock);
        if (ta !== lockText(b.lock)) problems.push(`${id}: locking twice gives different bytes`);
        const g = globalParts(a.lock);
        const keyOf = (n) => [...a.lock.closure, ...a.lock.build_only].find((e) => e.name === n)?.key;
        for (const e of [...a.lock.closure, ...a.lock.build_only]) {
          if (e.kind === "buildable" && packageKey(e, g, keyOf) !== e.key) problems.push(`${id}: the key of ${e.name} cannot be recomputed from the lock`);
        }
        if (JSON.stringify(a.lock.closure.map((e) => e.name)) !== JSON.stringify(golden.closure)) problems.push(`${id}: the lock's closure differs from the golden closure`);
        hashes[id] = sha256(ta);
        if (oldHashes[id] !== hashes[id] && !opts.update) problems.push(`${id}: the lock's SHA-256 differs from tests/reference/lock-hashes.json`);
      }
    }
  } finally {
    process.stderr.write = origWrite;
    if (savedEpoch !== undefined) process.env.SOURCE_DATE_EPOCH = savedEpoch;
  }

  // golden files that no machine x software pair produces
  for (const m of existsSync(goldenDir) ? readdirSync(goldenDir).sort() : []) {
    for (const f of readdirSync(join(goldenDir, m)).sort()) {
      if (!expectedFiles.has(join(goldenDir, m, f))) problems.push(`tests/reference/golden/${m}/${f}: no such machine and software pair`);
    }
  }
  const hashText = prettyJson(sortedMap(hashes));
  if (opts.update) {
    if (!existsSync(hashFile) || readFileSync(hashFile, "utf8") !== hashText) {
      writeFileSync(hashFile, hashText);
      updated.push("tests/reference/lock-hashes.json");
    }
  } else {
    for (const id of Object.keys(oldHashes)) if (!(id in hashes)) problems.push(`tests/reference/lock-hashes.json: ${id} is not a resolvable pair`);
  }

  for (const u of updated) process.stdout.write(`updated ${u}\n`);
  if (problems.length) {
    for (const p of problems) process.stderr.write(`${p}\n`);
    process.stderr.write(`verify: ${problems.length} problem${problems.length === 1 ? "" : "s"}; use --update to rewrite the reference files after reviewing the difference\n`);
    return EXIT.mismatch;
  }
  process.stdout.write(`verify: ok; ${cases} machine x software cases, ${cases - locked} recorded errors, ${locked} locks (valid, byte-identical twice, keys recomputed)\n`);
  return EXIT.ok;
}
