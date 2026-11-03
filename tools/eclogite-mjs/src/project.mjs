// Locating the repository: schemas and the default catalog.

import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll, isCatalogRoot } from "./catalog.mjs";
import { checkCatalog } from "./checks.mjs";

const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = resolve(TOOL_DIR, "../..");

export function schemasDir(opts) {
  return opts.schemas ? resolve(opts.schemas) : join(REPO, "schemas");
}

/** Catalog roots: <project>/catalog, then each --catalog (repeatable). */
export function catalogRoots(opts) {
  const project = opts.project ? resolve(opts.project) : REPO;
  return [join(project, "catalog"), ...opts.catalog.map((c) => resolve(c))];
}

export class ExitError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const EXIT = { ok: 0, usage: 2, invalid: 10, resolution: 11, mismatch: 22, internal: 30 };

/** Load roots plus loose files, check, and return { idx, docs, diagnostics }. */
export function loadAndCheck({ roots, files = [], opts }) {
  const { docs, diagnostics } = loadAll({ roots, files, schemasDir: schemasDir(opts) });
  const { idx, diagnostics: more } = checkCatalog(docs);
  return { docs, idx, diagnostics: [...diagnostics, ...more] };
}

export function isDir(p) {
  return existsSync(p) && statSync(p).isDirectory();
}
export { isCatalogRoot };
