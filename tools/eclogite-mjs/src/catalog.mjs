// Loading catalog roots: finding documents, parsing them, validating each
// against its schema. Cross-document checks are in checks.mjs.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, basename, dirname } from "node:path";
import { parseJsonc, Diagnostic } from "./jsonc.mjs";
import { Validator, loadSchemas } from "./validator.mjs";

export const KINDS = {
  "eclogite.package/v0.1": { kind: "package", schema: "package.schema.json" },
  "eclogite.machine/v0.1": { kind: "machine", schema: "machine.schema.json" },
  "eclogite.software/v0.1": { kind: "software", schema: "software.schema.json" },
  "eclogite.platform/v0.1": { kind: "platform", schema: "platform.schema.json" },
  "eclogite.abi/v0.1": { kind: "abi", schema: "abi.schema.json" },
  "eclogite.toolchain/v0.1": { kind: "toolchain", schema: "toolchain.schema.json" },
  "eclogite.system/v0.1": { kind: "system", schema: "system.schema.json" },
  "eclogite.facts/v0.1": { kind: "facts", schema: "facts.schema.json" },
  "eclogite.devices/v0.1": { kind: "devices", schema: "devices.schema.json" },
  "eclogite.defaults/v0.1": { kind: "defaults", schema: "defaults.schema.json" },
};

/** The directory of a catalog root that holds each kind. Singletons are files. */
export const LAYOUT = {
  abi: "abis",
  machine: "machines",
  platform: "platforms",
  software: "software",
  system: "systems",
  toolchain: "toolchains",
  package: "packages",
};
const SINGLETONS = { defaults: "defaults", facts: "facts", devices: "devices" };

const isDoc = (n) => n.endsWith(".jsonc") || n.endsWith(".json");

export function displayPath(abs, cwd = process.cwd()) {
  const rel = relative(cwd, abs);
  return rel.startsWith("..") || rel === "" ? abs : rel;
}

let schemaCache;
export function schemaValidator(schemasDir) {
  if (!schemaCache || schemaCache.dir !== schemasDir) schemaCache = { dir: schemasDir, v: new Validator(loadSchemas(schemasDir)) };
  return schemaCache.v;
}

export function isCatalogRoot(dir) {
  return Object.values(LAYOUT).some((d) => existsSync(join(dir, d)) && statSync(join(dir, d)).isDirectory()) &&
    Object.keys(SINGLETONS).some((s) => existsSync(join(dir, `${s}.jsonc`)));
}

/** Files of a catalog root, as { abs, expect } where expect is the kind its place implies. */
function catalogFiles(root) {
  const out = [];
  const list = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)) : []);
  for (const s of Object.keys(SINGLETONS)) {
    for (const ext of [".jsonc", ".json"]) if (existsSync(join(root, s + ext))) out.push({ abs: join(root, s + ext), expect: s });
  }
  for (const [kind, sub] of Object.entries(LAYOUT)) {
    for (const e of list(join(root, sub))) {
      if (kind === "package") {
        if (!e.isDirectory()) continue;
        for (const ext of [".jsonc", ".json"]) {
          const p = join(root, sub, e.name, `package${ext}`);
          if (existsSync(p)) out.push({ abs: p, expect: kind });
        }
      } else if (e.isFile() && isDoc(e.name)) out.push({ abs: join(root, sub, e.name), expect: kind });
    }
  }
  return out;
}

/** Every .jsonc/.json below a directory that is not a catalog root. */
function looseFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...looseFiles(p));
    else if (isDoc(e.name)) out.push({ abs: p, expect: null });
  }
  return out;
}

/**
 * Parse and schema-validate one file. Returns { doc?, diagnostics }.
 * `expect` is the kind the file's place implies (or null).
 */
export function loadDocument(abs, expect, schemasDir) {
  const file = displayPath(abs);
  const diagnostics = [];
  let parsed;
  try {
    parsed = parseJsonc(readFileSync(abs), file, { jsonc: abs.endsWith(".jsonc") });
  } catch (e) {
    if (e instanceof Diagnostic) return { diagnostics: [e] };
    throw e;
  }
  const { value, positions } = parsed;
  const at = (ptr, onKey = false) => {
    let p = ptr;
    for (;;) {
      const pos = positions.get(p);
      if (pos) return onKey && pos.keyLine ? { line: pos.keyLine, column: pos.keyColumn } : pos;
      if (p === "") return { line: 1, column: 1 };
      p = p.slice(0, p.lastIndexOf("/"));
    }
  };
  const diag = (ptr, message, onKey = false) => {
    const pos = at(ptr, onKey);
    return new Diagnostic(file, pos.line, pos.column, message, ptr);
  };
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { diagnostics: [diag("", "a document must be an object")] };
  }
  const info = typeof value.schema === "string" ? KINDS[value.schema] : undefined;
  if (!info) {
    const msg = value.schema === undefined ? 'missing required property "schema"' : `unknown schema ${JSON.stringify(value.schema)}`;
    return { diagnostics: [diag(value.schema === undefined ? "" : "/schema", msg)] };
  }
  const doc = { kind: info.kind, file, abs, dir: dirname(abs), value, positions, at, diag };
  if (expect && expect !== info.kind) {
    doc.misplaced = true;
    diagnostics.push(diag("/schema", `a ${expect} document is expected here, but this is ${info.kind} (${value.schema})`));
    return { doc, diagnostics };
  }
  for (const e of schemaValidator(schemasDir).validate(value, info.schema)) diagnostics.push(diag(e.pointer, e.message, e.onKey));
  return { doc, diagnostics };
}

/**
 * Load documents. `roots` are catalog roots (directories in catalog layout);
 * `files` are loose documents. Returns { docs, diagnostics }.
 */
export function loadAll({ roots = [], files = [], schemasDir }) {
  const docs = [];
  const diagnostics = [];
  const jobs = [];
  for (const r of roots) for (const f of catalogFiles(resolve(r))) jobs.push({ ...f, root: resolve(r) });
  for (const f of files) jobs.push({ abs: resolve(f), expect: null, root: null });
  for (const j of jobs) {
    const r = loadDocument(j.abs, j.expect, schemasDir);
    diagnostics.push(...r.diagnostics);
    if (r.doc) { r.doc.root = j.root; docs.push(r.doc); }
  }
  return { docs, diagnostics };
}

export { looseFiles, catalogFiles, basename };
