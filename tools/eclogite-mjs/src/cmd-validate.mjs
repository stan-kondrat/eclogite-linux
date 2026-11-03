// validate [PATH...] and canonical FILE.

import { resolve, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { loadAll, looseFiles, isCatalogRoot } from "./catalog.mjs";
import { catalogRoots, schemasDir, isDir, EXIT, ExitError } from "./project.mjs";
import { checkCatalog } from "./checks.mjs";
import { formatDiagnostic, parseJsonc } from "./jsonc.mjs";
import { canonicalJson } from "./canonical.mjs";

/** Order: by file as listed, then line and column, then message. */
export function sortDiagnostics(list, fileOrder = []) {
  const rank = (f) => {
    const i = fileOrder.indexOf(f);
    return i < 0 ? fileOrder.length : i;
  };
  return [...list].sort(
    (a, b) => rank(a.file) - rank(b.file) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || a.column - b.column || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
  );
}

function findRootAbove(file) {
  let dir = dirname(file);
  for (;;) {
    if (isCatalogRoot(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export async function run(command, args, opts) {
  if (command === "canonical") {
    if (args.length !== 1) throw new ExitError(EXIT.usage, "canonical needs one FILE");
    const { value } = parseJsonc(readFileSync(args[0]), args[0], { jsonc: args[0].endsWith(".jsonc") });
    process.stdout.write(`${canonicalJson(value)}\n`);
    return EXIT.ok;
  }
  const paths = args.length ? args : catalogRoots(opts);
  const roots = [];
  const wanted = []; // files whose diagnostics are reported (null: all)
  let reportAll = false;
  const looseOnly = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (isDir(abs)) {
      if (isCatalogRoot(abs)) { roots.push(abs); reportAll = true; }
      else looseOnly.push(...looseFiles(abs).map((f) => f.abs));
    } else {
      const root = findRootAbove(abs);
      if (root && !roots.includes(root)) roots.push(root);
      wanted.push(abs);
      if (!root) looseOnly.push(abs);
    }
  }
  for (const c of opts.catalog) if (!roots.includes(resolve(c))) roots.push(resolve(c));
  const { docs, diagnostics } = loadAll({ roots, files: looseOnly, schemasDir: schemasDir(opts) });
  const { idx, diagnostics: more } = checkCatalog(docs);
  let all = [...diagnostics, ...more];
  if (!reportAll) {
    // only the named files; the rest of the catalog was loaded for context
    const named = new Set(docs.filter((d) => wanted.includes(d.abs) || looseOnly.includes(d.abs)).map((d) => d.file));
    all = all.filter((d) => named.has(d.file));
  }
  const sorted = sortDiagnostics(all);
  for (const d of sorted) process.stderr.write(`${formatDiagnostic(d)}\n`);
  if (sorted.length) {
    process.stderr.write(`${sorted.length} problem${sorted.length === 1 ? "" : "s"}\n`);
    return EXIT.invalid;
  }
  const count = (k) => idx.kinds[k].size;
  const buildable = [...idx.kinds.package.values()].filter((d) => d.value.builder).length;
  process.stdout.write(
    `ok: ${docs.length} documents; ${count("package")} packages (${buildable} buildable), ${count("machine")} machines, ${count("software")} software profiles, ${count("system")} systems\n`,
  );
  return EXIT.ok;
}
