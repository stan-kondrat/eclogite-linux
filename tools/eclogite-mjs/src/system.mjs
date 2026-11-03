// Loading a system: the catalog, the system document and its resolution.

import { resolve as resolvePath, join, basename } from "node:path";
import { mkdirSync, writeFileSync, renameSync, readFileSync, existsSync, rmSync } from "node:fs";
import { catalogRoots, schemasDir, loadAndCheck, ExitError, EXIT, REPO } from "./project.mjs";
import { loadDocument } from "./catalog.mjs";
import { formatDiagnostic, parseJsonc } from "./jsonc.mjs";
import { resolveSystem, ResolveError } from "./resolve.mjs";
import { compileLock, DEFAULT_SOURCE_DATE_EPOCH } from "./lock.mjs";
import { prettyJson } from "./canonical.mjs";
import { schemaValidator } from "./catalog.mjs";

export function hostArch(opts) {
  if (opts.host) return opts.host;
  return { arm64: "aarch64", x64: "x86_64" }[process.arch] ?? process.arch;
}

export function epoch(opts) {
  const v = opts.sourceDateEpoch ?? process.env.SOURCE_DATE_EPOCH;
  if (v === undefined || v === "") return DEFAULT_SOURCE_DATE_EPOCH;
  if (!/^[0-9]+$/.test(String(v))) throw new ExitError(EXIT.usage, `--source-date-epoch must be a non-negative integer, got ${v}`);
  return Number(v);
}

export function loadCatalog(opts) {
  const { idx, diagnostics } = loadAndCheck({ roots: catalogRoots(opts), opts });
  if (diagnostics.length) {
    for (const d of diagnostics) process.stderr.write(`${formatDiagnostic(d)}\n`);
    throw new ExitError(EXIT.invalid, `the catalog has ${diagnostics.length} problem${diagnostics.length === 1 ? "" : "s"}; run validate`);
  }
  return idx;
}

/** The system to compile: { idx, systemDoc, systemValue }. */
export function loadSystem(opts) {
  const idx = loadCatalog(opts);
  if (opts.config) {
    if (opts.machine || opts.software) throw new ExitError(EXIT.usage, "--config cannot be combined with --machine or --software");
    const abs = resolvePath(opts.config);
    let doc = [...idx.kinds.system.values()].find((d) => d.abs === abs);
    if (!doc) {
      const r = loadDocument(abs, "system", schemasDir(opts));
      if (r.diagnostics.length) {
        for (const d of r.diagnostics) process.stderr.write(`${formatDiagnostic(d)}\n`);
        throw new ExitError(EXIT.invalid, `${opts.config} is not a valid system file`);
      }
      doc = r.doc;
    }
    return { idx, systemDoc: doc, systemValue: doc.value };
  }
  if (!opts.machine || !opts.software) throw new ExitError(EXIT.usage, "a system needs --config FILE, or --machine and --software");
  const machine = idx.find("machine", opts.machine);
  const software = idx.find("software", opts.software);
  if (!machine) throw new ExitError(EXIT.usage, `unknown machine ${opts.machine}`);
  if (!software) throw new ExitError(EXIT.usage, `unknown software ${opts.software}`);
  const value = { schema: "eclogite.system/v0.1", name: `${machine.value.name}+${software.value.name}`, machine: machine.value.name, software: software.value.name };
  return { idx, systemDoc: { value, abs: "shorthand", root: null }, systemValue: value };
}

export function resolveOrExit(idx, systemValue) {
  try {
    return resolveSystem(idx, systemValue);
  } catch (e) {
    if (e instanceof ResolveError) throw new ExitError(EXIT.resolution, `error: ${e.message}`);
    throw e;
  }
}

/** Compile; throws ExitError(11) on resolution errors and, unless allowed, on unpinned values. */
export function compile(sys, opts, { requirePinned = true } = {}) {
  const R = resolveOrExit(sys.idx, sys.systemValue);
  let result;
  try {
    result = compileLock(sys.idx, R, {
      systemDoc: sys.systemDoc,
      projectDir: opts.project ? resolvePath(opts.project) : REPO,
      sourceDateEpoch: epoch(opts),
      host: hostArch(opts),
    });
  } catch (e) {
    if (e instanceof ResolveError) throw new ExitError(EXIT.resolution, `error: ${e.message}`);
    throw e;
  }
  const errors = schemaValidator(schemasDir(opts)).validate(result.lock, "lock.schema.json", "/$defs/compiledSystem");
  if (errors.length) {
    throw new Error(`internal error: the lock does not validate against lock.schema.json:\n${errors.slice(0, 10).map((e) => `  ${e.pointer}: ${e.message}`).join("\n")}`);
  }
  if (result.unpinned.length) {
    if (requirePinned && !opts.allowUnpinned) {
      throw new ExitError(EXIT.resolution, `error: the lock cannot pin ${result.unpinned.length} value${result.unpinned.length === 1 ? "" : "s"}:\n${result.unpinned.map((u) => `  ${u}`).join("\n")}\nrun eclogite-mjs lock --allow-unpinned to write a development lock that records them as zero digests`);
    }
    if (opts.allowUnpinned) for (const u of result.unpinned) process.stderr.write(`warning: unpinned: ${u}\n`);
  }
  return { R, ...result };
}

export function defaultLockPath(opts, name) {
  return join(opts.project ? resolvePath(opts.project) : REPO, "state", name, "system.lock.json");
}

/** Write atomically: a temporary file in the same directory, then rename. */
export function writeAtomic(path, text) {
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export function readLock(path) {
  if (!existsSync(path)) return null;
  try {
    return parseJsonc(readFileSync(path), path, { jsonc: false }).value;
  } catch (e) {
    throw new ExitError(EXIT.resolution, `error: ${formatDiagnostic(e)}`);
  }
}

export const lockText = (lock) => prettyJson(lock);
export { basename };
