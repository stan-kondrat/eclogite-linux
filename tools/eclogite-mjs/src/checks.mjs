// Catalog checks: what the schemas cannot say (schemas/README.md, "What the
// schemas enforce"). Every check reports file:line:column and a JSON Pointer.

import { existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { Index, providesOf, referenceNames } from "./index.mjs";

const OPS = {
  string: ["eq", "ne", "in"],
  ordered: ["eq", "in", "ge", "gt", "le", "lt"],
  integer: ["eq", "ge", "gt", "le", "lt"],
  set: ["has", "has_any"],
  boolean: ["eq"],
};

const HOOK_STEPS = ["pre-configure", "configure", "post-configure", "pre-build", "build", "post-build", "pre-install", "install", "post-install"];

export function checkCatalog(docs, { whole = true } = {}) {
  const diagnostics = [];
  const report = (doc, ptr, message, onKey = false) => diagnostics.push(doc.diag(ptr, message, onKey));
  const idx = new Index(docs, report);
  const { facts } = idx;

  // ---- names match files
  for (const d of docs) {
    const name = d.value.name;
    if (typeof name !== "string" || !d.root || d.misplaced) continue;
    const expected = d.kind === "package" ? basename(dirname(d.abs)) : basename(d.abs).replace(/\.jsonc?$/, "");
    if (name !== expected) report(d, "/name", `name ${JSON.stringify(name)} does not match its file (${d.kind === "package" ? "directory" : "file"} name ${JSON.stringify(expected)})`, true);
  }

  // ---- predicates
  function predicate(d, p, ptr) {
    if (p === null || typeof p !== "object") return;
    const keys = Object.keys(p);
    if (keys.length !== 1) return; // the schema reports it
    const [k] = keys;
    if (k === "all" || k === "any") return Array.isArray(p[k]) && p[k].forEach((s, i) => predicate(d, s, `${ptr}/${k}/${i}`));
    if (k === "not") return predicate(d, p.not, `${ptr}/not`);
    const fact = facts[k];
    if (!fact) return report(d, `${ptr}/${k}`, `unknown fact ${JSON.stringify(k)}`, true);
    const test = p[k];
    if (test === null || typeof test !== "object") return;
    for (const [op, operand] of Object.entries(test)) {
      if (!OPS[fact.type]?.includes(op)) { report(d, `${ptr}/${k}/${op}`, `operator ${op} does not apply to ${fact.type} fact ${k}`, true); continue; }
      const values = Array.isArray(operand) ? operand : [operand];
      values.forEach((v, i) => {
        const vp = Array.isArray(operand) ? `${ptr}/${k}/${op}/${i}` : `${ptr}/${k}/${op}`;
        if (v && typeof v === "object" && v.fact !== undefined) {
          if (!facts[v.fact]) report(d, `${vp}/fact`, `unknown fact ${JSON.stringify(v.fact)}`);
        } else if (fact.values && (fact.type === "string" || fact.type === "set") && !fact.values.includes(v)) {
          report(d, vp, `${JSON.stringify(v)} is not a value of fact ${k}`);
        }
      });
    }
  }

  const toolchains = [...idx.kinds.toolchain.values()];
  const toolNames = new Set(toolchains.flatMap((t) => Object.keys(t.value.tools ?? {})));
  const compilerNames = new Set(toolchains.flatMap((t) => Object.keys(t.value.compilers ?? {})));

  function refs(d, list, ptr, what, { builderTools = false } = {}) {
    (list ?? []).forEach((ref, i) => {
      const p = `${ptr}/${i}`;
      if (typeof ref === "string" && ref.startsWith("builder:")) {
        if (builderTools && !toolNames.has(ref.slice(8))) report(d, p, `${ref}: no toolchain lists a tool ${JSON.stringify(ref.slice(8))}`);
        return;
      }
      referenceNames(ref).forEach((n, j) => {
        const np = typeof ref === "string" ? p : ref.first ? `${p}/first/${j}` : `${p}/package`;
        if (!idx.isReference(n)) report(d, np, `${what} ${JSON.stringify(n)} is neither a package nor a capability`);
      });
      if (ref && typeof ref === "object") {
        if (ref.when) predicate(d, ref.when, `${p}/when`);
        if (ref.package && ref.config) { /* options are checked when a provider is chosen */ }
      }
    });
  }

  const pathExists = (d, rel) => existsSync(join(d.dir, rel));
  function packageFiles(d, args, ptr) {
    if (!args || typeof args !== "object") return;
    for (const [step, names] of Object.entries(args.hooks ?? {})) {
      if (!HOOK_STEPS.includes(step)) continue;
      (names ?? []).forEach((n, i) => {
        if (!pathExists(d, `hooks/${n}.sh`)) report(d, `${ptr}/hooks/${step}/${i}`, `hook file hooks/${n}.sh does not exist`);
      });
    }
    for (const src of Object.keys(args.files ?? {})) {
      if (!pathExists(d, src)) report(d, `${ptr}/files/${src.replace(/~/g, "~0").replace(/\//g, "~1")}`, `file ${src} does not exist`, true);
    }
  }

  // ---- packages
  const packages = [...idx.kinds.package.values()];
  const platformNames = new Set(idx.kinds.platform.keys());
  for (const d of packages) {
    const p = d.value;
    for (const cap of providesOf(p)) {
      if (idx.kinds.package.has(cap) && cap !== p.name) report(d, "/provides", `capability ${JSON.stringify(cap)} is also the name of a package`);
    }
    if (p.source?.type === "git" && /^0{40}$/.test(p.source.revision)) report(d, "/source/revision", "the revision is not a real commit");
    (p.patches ?? []).forEach((rel, i) => {
      if (!pathExists(d, rel)) report(d, `/patches/${i}`, `patch ${rel} does not exist`);
    });
    if (p.fetch) {
      if (!pathExists(d, `hooks/${p.fetch.hook}.sh`)) report(d, "/fetch/hook", `hook file hooks/${p.fetch.hook}.sh does not exist`);
      const out = p.fetch.output_sha256;
      if (out && typeof out === "object") {
        for (const k of Object.keys(out)) if (!platformNames.has(k)) report(d, `/fetch/output_sha256/${k}`, `${JSON.stringify(k)} is not a platform`, true);
      }
    }
    if (p.matches_builder_tool) {
      const tools = toolchains.map((t) => t.value.tools?.[p.matches_builder_tool]).filter(Boolean);
      if (!tools.length) report(d, "/matches_builder_tool", `no toolchain lists a tool ${JSON.stringify(p.matches_builder_tool)}`);
      for (const t of tools) {
        if (t.revision && p.source?.revision && t.revision !== p.source.revision) {
          report(d, "/matches_builder_tool", `source revision ${p.source.revision} differs from the toolchain tool's ${t.revision}`);
        }
      }
    }
    packageFiles(d, p.arguments, "/arguments");
    (p.variants ?? []).forEach((v, i) => {
      predicate(d, v.when, `/variants/${i}/when`);
      packageFiles(d, v.arguments, `/variants/${i}/arguments`);
    });
    if (p.compatible) for (const s of ["build", "target", "machine"]) if (p.compatible[s]) predicate(d, p.compatible[s], `/compatible/${s}`);
    refs(d, p.dependencies?.build, "/dependencies/build", "dependency", { builderTools: true });
    refs(d, p.dependencies?.link, "/dependencies/link", "dependency");
    refs(d, p.dependencies?.run, "/dependencies/run", "dependency");
    if (p.kind === undefined && p.provides && !Array.isArray(p.provides)) {
      for (const [cap, owned] of Object.entries(p.provides)) {
        for (const src of Object.keys(owned.files ?? {})) if (!pathExists(d, src)) report(d, `/provides/${cap}/files/${src.replace(/\//g, "~1")}`, `file ${src} does not exist`, true);
      }
    }
    for (const [name, t] of Object.entries(p.tests ?? {})) {
      if (!pathExists(d, `tests/${name}.sh`)) report(d, `/tests/${name}`, `test script tests/${name}.sh does not exist`, true);
      if (t.when) predicate(d, t.when, `/tests/${name}/when`);
      (t.needs ?? []).forEach((n, i) => {
        if (!idx.kinds.package.has(n)) report(d, `/tests/${name}/needs/${i}`, `package ${JSON.stringify(n)} does not exist`);
      });
    }
    if (p.configurable) {
      for (const [opt, o] of Object.entries(p.configurable.options)) {
        if (!o.values.includes(o.default)) report(d, `/configurable/options/${opt}/default`, `the default ${JSON.stringify(o.default)} is not one of the values`);
        for (const [req, val] of Object.entries(o.requires ?? {})) {
          const target = p.configurable.options[req];
          if (!target) report(d, `/configurable/options/${opt}/requires/${req}`, `${req} is not declared by this package`, true);
          else if (!target.values.includes(val)) report(d, `/configurable/options/${opt}/requires/${req}`, `${JSON.stringify(val)} is not a value of ${req}`);
        }
      }
    }
  }

  // ---- machines
  const devices = idx.devices;
  for (const d of idx.kinds.machine.values()) {
    const m = d.value;
    if (m.platform && !idx.kinds.platform.has(m.platform)) report(d, "/platform", `platform ${JSON.stringify(m.platform)} does not exist`);
    if (m.extends) {
      const chain = [m.name];
      let cur = m;
      while (cur.extends) {
        const next = idx.kinds.machine.get(cur.extends);
        if (!next) { report(d, "/extends", `machine ${JSON.stringify(cur.extends)} does not exist`); break; }
        if (chain.includes(next.value.name)) { report(d, "/extends", `extends cycle: ${[...chain, next.value.name].join(" -> ")}`); break; }
        chain.push(next.value.name);
        cur = next.value;
      }
    }
    (m.devices ?? []).forEach((dev, i) => {
      const model = devices[dev.model];
      if (!model) report(d, `/devices/${i}/model`, `device model ${JSON.stringify(dev.model)} is not in devices.jsonc`);
      else if (model.kind !== dev.kind) report(d, `/devices/${i}/kind`, `device model ${dev.model} is a ${model.kind}, not a ${dev.kind}`);
    });
  }
  for (const d of idx.kinds.platform.values()) void d;

  // ---- software
  const volumeNames = new Set();
  const serviceNames = new Set(packages.flatMap((d) => [
    ...Object.keys(d.value.services ?? {}),
    ...(Array.isArray(d.value.provides) || !d.value.provides ? [] : Object.values(d.value.provides).flatMap((o) => Object.keys(o.services ?? {}))),
  ]));
  for (const d of idx.kinds.software.values()) {
    const s = d.value;
    if (s.abi && !idx.kinds.abi.has(s.abi)) report(d, "/abi", `ABI ${JSON.stringify(s.abi)} does not exist`);
    if (s.compiler && !compilerNames.has(s.compiler)) report(d, "/compiler", `no toolchain lists compiler ${JSON.stringify(s.compiler)}`);
    refs(d, s.packages, "/packages", "package");
    providers(d, s.providers, "/providers");
    for (const [i, v] of (s.volumes ?? []).entries()) {
      v.packages.forEach((n, j) => { if (!idx.kinds.package.has(n)) report(d, `/volumes/${i}/packages/${j}`, `package ${JSON.stringify(n)} does not exist`); });
    }
    for (const name of Object.keys(s.service_overrides ?? {})) {
      if (!serviceNames.has(name)) report(d, `/service_overrides/${name}`, `no package has a service ${JSON.stringify(name)}`, true);
    }
    for (const list of ["state", "volumes"]) {
      const seen = new Set();
      (s[list] ?? []).forEach((v, i) => {
        if (seen.has(v.name)) report(d, `/${list}/${i}/name`, `duplicate ${list} name ${JSON.stringify(v.name)}`);
        seen.add(v.name);
      });
    }
    void volumeNames;
  }

  function providers(d, map, ptr) {
    for (const [cap, prov] of Object.entries(map ?? {})) {
      if (!idx.isCapability(cap)) report(d, `${ptr}/${cap}`, `${JSON.stringify(cap)} is not a capability`, true);
      const pkg = idx.pkg(prov);
      if (!pkg) report(d, `${ptr}/${cap}`, `package ${JSON.stringify(prov)} does not exist`);
      else if (!providesOf(pkg).includes(cap) && prov !== cap) report(d, `${ptr}/${cap}`, `package ${prov} does not provide ${cap}`);
    }
  }

  // ---- systems
  for (const d of idx.kinds.system.values()) {
    const s = d.value;
    if (!idx.find("machine", s.machine)) report(d, "/machine", `machine ${JSON.stringify(s.machine)} does not exist`);
    if (!idx.find("software", s.software)) report(d, "/software", `software ${JSON.stringify(s.software)} does not exist`);
    if (s.abi && !idx.kinds.abi.has(s.abi)) report(d, "/abi", `ABI ${JSON.stringify(s.abi)} does not exist`);
    if (s.compiler && !compilerNames.has(s.compiler)) report(d, "/compiler", `no toolchain lists compiler ${JSON.stringify(s.compiler)}`);
    providers(d, s.providers, "/providers");
  }

  // ---- abis, toolchains, defaults, facts
  for (const d of idx.kinds.abi.values()) {
    if (!idx.kinds.toolchain.has(d.value.toolchain)) report(d, "/toolchain", `toolchain ${JSON.stringify(d.value.toolchain)} does not exist`);
  }
  for (const d of toolchains) {
    for (const [c, tools] of Object.entries(d.value.compilers ?? {})) {
      tools.forEach((t, i) => { if (!(t in (d.value.tools ?? {}))) report(d, `/compilers/${c}/${i}`, `tool ${JSON.stringify(t)} is not in tools`); });
    }
  }
  const dd = idx.single.defaults;
  if (dd) {
    if (!idx.kinds.abi.has(dd.value.abi)) report(dd, "/abi", `ABI ${JSON.stringify(dd.value.abi)} does not exist`);
    if (!compilerNames.has(dd.value.compiler)) report(dd, "/compiler", `no toolchain lists compiler ${JSON.stringify(dd.value.compiler)}`);
    for (const [cap, ref] of Object.entries(dd.value.providers ?? {})) {
      for (const n of referenceNames(ref)) {
        const pkg = idx.pkg(n);
        if (!pkg) report(dd, `/providers/${cap}`, `package ${JSON.stringify(n)} does not exist`);
        else if (!providesOf(pkg).includes(cap)) report(dd, `/providers/${cap}`, `package ${n} does not provide ${cap}`);
      }
    }
  }
  for (const [name, f] of Object.entries(facts)) {
    if (f.order_by && !facts[f.order_by]) report(idx.single.facts, `/facts/${name}/order_by`, `unknown fact ${JSON.stringify(f.order_by)}`);
  }
  void whole;
  return { idx, diagnostics };
}
