// resolve, lock, plan, explain, graph, why.

import { EXIT, ExitError } from "./project.mjs";
import { ResolveError } from "./resolve.mjs";
import { loadSystem, compile, resolveOrExit, defaultLockPath, writeAtomic, readLock, lockText } from "./system.mjs";
import { goldenResult, goldenFailure } from "./golden.mjs";
import { prettyJson, hashOf, canonicalJson } from "./canonical.mjs";
import { keyParts, globalParts } from "./lock.mjs";
import { resolve as resolvePath } from "node:path";

const out = (s) => process.stdout.write(s);

export async function run(command, args, opts) {
  const sys = loadSystem(opts);
  const name = sys.systemValue.name;
  switch (command) {
    case "resolve": {
      // the resolution result in the format of tests/reference/golden/
      const machine = sys.idx.find("machine", sys.systemValue.machine)?.value.name;
      const software = sys.idx.find("software", sys.systemValue.software)?.value.name;
      let result;
      try {
        result = goldenResult(resolveOrExit(sys.idx, sys.systemValue));
      } catch (e) {
        if (!(e instanceof ExitError)) throw e;
        result = goldenFailure(machine, software, new ResolveError(0, e.message.replace(/^error: /, "")));
        write(opts, prettyJson(result));
        return EXIT.resolution;
      }
      write(opts, prettyJson(result));
      return EXIT.ok;
    }
    case "lock": {
      const { lock } = compile(sys, opts);
      const text = lockText(lock);
      const path = opts.output ?? defaultLockPath(opts, name);
      if (path === "-") out(text);
      else {
        writeAtomic(resolvePath(path), text);
        process.stderr.write(`wrote ${path}\n`);
      }
      return EXIT.ok;
    }
    case "plan":
    case "explain": {
      const { lock } = compile(sys, opts, { requirePinned: false });
      const path = opts.lock ?? defaultLockPath(opts, name);
      const old = readLock(path);
      const plan = makePlan(lock, old);
      if (opts.locked && (!old || plan.stale)) throw new ExitError(EXIT.resolution, `error: ${old ? "the lock is stale" : `no lock at ${path}`}; run eclogite-mjs lock`);
      out(command === "plan" ? renderPlan(plan, lock) : renderExplain(plan, lock));
      return EXIT.ok;
    }
    case "graph": {
      const { lock } = compile(sys, opts, { requirePinned: false });
      out(renderGraph(lock, opts));
      return EXIT.ok;
    }
    case "why": {
      if (args.length !== 1) throw new ExitError(EXIT.usage, "why needs one NODE");
      const { lock } = compile(sys, opts, { requirePinned: false });
      out(renderWhy(lock, args[0], opts));
      return EXIT.ok;
    }
    default:
      throw new ExitError(EXIT.usage, `unknown command ${command}`);
  }
}

function write(opts, text) {
  if (opts.output && opts.output !== "-") writeAtomic(resolvePath(opts.output), text);
  else out(text);
}

// ---------------------------------------------------------------------------
// plan and explain: compare a fresh compile with the lock on disk

function buildables(lock) {
  return new Map([...lock.closure, ...lock.build_only].filter((e) => e.kind === "buildable").map((e) => [e.name, e]));
}

// canonical text of a possibly absent part
const canon = (v) => canonicalJson({ v });

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** A changed part; for an object, only the keys that differ. */
function changedPart(part, before, after) {
  if (!isMap(before) || !isMap(after)) return { part, detail: "changed", before, after };
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((k) => canon(before[k]) !== canon(after[k]));
  const pick = (o) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  return { part, detail: `changed (${keys.join(", ")})`, before: pick(before), after: pick(after) };
}

export function makePlan(lock, old) {
  const fresh = buildables(lock);
  const plan = { stale: !old || old.input_sha256 !== lock.input_sha256, hasLock: !!old, rebuild: [] };
  const before = old ? buildables(old) : new Map();
  const g = globalParts(lock);
  const og = old ? globalParts(old) : null;
  const keyOf = (m) => fresh.get(m)?.key;
  const okeyOf = (m) => before.get(m)?.key;
  const rebuilt = new Set();
  for (const name of lock.build_order) {
    const e = fresh.get(name);
    const o = before.get(name);
    if (o && o.key === e.key) continue;
    const reasons = [];
    if (!o) reasons.push({ part: "new", detail: "not in the lock" });
    else {
      const a = keyParts(o, og, okeyOf);
      const b = keyParts(e, g, keyOf);
      for (const part of Object.keys(b)) {
        if (part.endsWith("dependencies")) {
          const was = new Map(a[part].filter((d) => d.package).map((d) => [d.package, d.key]));
          for (const d of b[part].filter((x) => x.package)) {
            if (was.get(d.package) !== d.key) reasons.push({ part: `dependency ${d.package}`, detail: "rebuilt" });
          }
          if (canon(a[part].map((d) => d.package ?? d.tool)) !== canon(b[part].map((d) => d.package ?? d.tool))) {
            reasons.push({ part, detail: "changed", before: a[part], after: b[part] });
          } else if (canon(a[part].filter((d) => d.tool)) !== canon(b[part].filter((d) => d.tool))) {
            reasons.push({ part, detail: "builder tools changed", before: a[part].filter((d) => d.tool), after: b[part].filter((d) => d.tool) });
          }
        } else if (canon(a[part]) !== canon(b[part])) reasons.push(changedPart(part, a[part], b[part]));
      }
    }
    rebuilt.add(name);
    plan.rebuild.push({ name, reasons });
  }
  plan.removed = [...before.keys()].filter((n) => !fresh.has(n)).sort();
  plan.total = fresh.size;
  plan.oldHash = old?.input_sha256;
  plan.newHash = lock.input_sha256;
  return plan;
}

function renderPlan(plan, lock) {
  const lines = [];
  lines.push(`system ${lock.system.name}`);
  lines.push(!plan.hasLock ? "lock: none" : plan.stale ? `lock: stale (input ${plan.oldHash.slice(0, 12)} -> ${plan.newHash.slice(0, 12)})` : `lock: current (input ${plan.newHash.slice(0, 12)})`);
  lines.push(`rebuild ${plan.rebuild.length} of ${plan.total} packages${plan.rebuild.length ? ":" : ""}`);
  for (const r of plan.rebuild) lines.push(`  ${r.name}: ${[...new Set(r.reasons.map((x) => x.part))].join(", ")}`);
  if (plan.removed.length) lines.push(`no longer built: ${plan.removed.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

const short = (v) => {
  if (v === undefined) return "none";
  const s = canonicalJson(v);
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
};

function renderExplain(plan, lock) {
  const lines = [renderPlan(plan, lock).trimEnd()];
  for (const r of plan.rebuild) {
    lines.push("", `${r.name}:`);
    for (const x of r.reasons) {
      if (x.before !== undefined || x.after !== undefined) lines.push(`  ${x.part} ${x.detail}`, `    was ${short(x.before)}`, `    now ${short(x.after)}`);
      else lines.push(`  ${x.part} ${x.detail}`);
    }
  }
  if (!plan.rebuild.length) lines.push("", "nothing to rebuild");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// graph and why

function graphModel(lock) {
  const nodes = [];
  const edges = [];
  const installed = new Set(lock.closure.map((e) => e.name));
  for (const e of [...lock.closure, ...lock.build_only]) {
    nodes.push({ name: e.name, kind: e.kind, installed: installed.has(e.name) });
    const deps = e.kind === "meta" ? { run: e.run } : e.dependencies;
    for (const type of ["build", "link", "run"]) {
      for (const d of deps[type] ?? []) if (d.package) edges.push({ from: e.name, to: d.package, type, via: d.capability ?? null });
    }
  }
  return { nodes, edges };
}

function renderGraph(lock, opts) {
  const kind = opts.kind ?? "packages";
  const format = opts.format ?? "tree";
  if (!["packages", "full"].includes(kind)) throw new ExitError(EXIT.usage, "--kind is packages or full");
  if (!["tree", "dot", "json"].includes(format)) throw new ExitError(EXIT.usage, "--format is tree, dot or json");
  const { nodes, edges } = graphModel(lock);
  const root = `system:${lock.system.name}`;
  if (kind === "full") {
    nodes.unshift({ name: root, kind: "system", installed: true }, { name: `machine:${lock.machine.name}`, kind: "machine", installed: true }, { name: `software:${lock.software.name}`, kind: "software", installed: true });
    edges.unshift({ from: root, to: `machine:${lock.machine.name}`, type: "machine", via: null }, { from: root, to: `software:${lock.software.name}`, type: "software", via: null });
    for (const p of lock.software.packages) {
      const n = typeof p === "string" ? p : p.package ?? null;
      if (n && nodes.some((x) => x.name === n)) edges.splice(2, 0, { from: `software:${lock.software.name}`, to: n, type: "selects", via: null });
    }
  }
  if (format === "json") return prettyJson({ nodes, edges });
  if (format === "dot") {
    const l = ["digraph eclogite {", "  rankdir=LR;"];
    for (const n of nodes) l.push(`  "${n.name}"${n.installed ? "" : " [style=dashed]"};`);
    for (const e of edges) l.push(`  "${e.from}" -> "${e.to}" [label="${e.type}${e.via ? `:${e.via}` : ""}"${e.type === "run" || e.type === "selects" ? "" : ", style=dashed"}];`);
    l.push("}");
    return `${l.join("\n")}\n`;
  }
  // tree: the selection tree, each package under the package that first pulled it in
  const parent = (n) => (lock.selected_by[n] ?? [])[Math.max((lock.selected_by[n] ?? []).length - 2, 0)];
  const kids = new Map();
  for (const n of [...lock.closure.map((e) => e.name), ...lock.build_only.map((e) => e.name)]) {
    const p = parent(n);
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  const lines = [kind === "full" ? root : "software"];
  const walk = (n, prefix) => {
    const list = kids.get(n) ?? [];
    list.forEach((c, i) => {
      const last = i === list.length - 1;
      const isBuildOnly = !lock.closure.some((e) => e.name === c);
      lines.push(`${prefix}${last ? "└── " : "├── "}${c}${isBuildOnly ? " (build only)" : ""}`);
      walk(c, prefix + (last ? "    " : "│   "));
    });
  };
  walk("software", "");
  return `${lines.join("\n")}\n`;
}

function renderWhy(lock, nodeArg, opts) {
  const node = nodeArg.replace(/^(package|capability):/, "");
  const lines = [];
  const chosen = lock.choices[node];
  const inClosure = lock.closure.some((e) => e.name === node) || lock.build_only.some((e) => e.name === node);
  if (!inClosure && !chosen) throw new ExitError(EXIT.usage, `${nodeArg} is neither a package of this system nor a capability it chose`);
  if (chosen && !(nodeArg.startsWith("package:") && inClosure)) {
    const c = chosen;
    lines.push(`capability ${node}: provider ${c.provider}, ${c.reason}${c.via ? ` (via ${c.via})` : ""}${c.reference ? ` from default ${canonicalJson(c.reference)}` : ""}`);
    if (!opts.all) return `${lines.join("\n")}\n${renderWhy(lock, c.provider, opts)}`;
  }
  if (!inClosure) return `${lines.join("\n")}\n`;
  const entry = [...lock.closure, ...lock.build_only].find((e) => e.name === node);
  const installed = lock.closure.some((e) => e.name === node);
  lines.push(`package ${node}: ${installed ? "installed" : "built only"}${entry.kind === "meta" ? " (meta-package)" : ""}`);
  if (!opts.all) {
    lines.push(`  ${lock.selected_by[node].join(" -> ")}`);
    return `${lines.join("\n")}\n`;
  }
  // every path: along run dependencies from the software roots, then build and link edges
  const g = graphModel(lock);
  const incoming = new Map();
  for (const e of g.edges) {
    if (!incoming.has(e.to)) incoming.set(e.to, []);
    incoming.get(e.to).push(e.from);
  }
  const roots = new Set(lock.software.packages.map((p) => (typeof p === "string" ? lock.choices[p]?.provider ?? p : p.package)));
  const paths = [];
  const walk = (n, trail) => {
    if (roots.has(n)) paths.push(["software", n, ...trail]);
    for (const from of [...new Set(incoming.get(n) ?? [])].sort()) if (!trail.includes(from) && from !== node) walk(from, [n, ...trail]);
  };
  walk(node, []);
  const unique = [...new Set(paths.map((p) => p.join(" -> ")))].sort((a, b) => a.split(" -> ").length - b.split(" -> ").length || (a < b ? -1 : 1));
  for (const p of unique) lines.push(`  ${p}`);
  return `${lines.join("\n")}\n`;
}

void hashOf;
