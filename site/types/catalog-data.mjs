// Writes ../assets/catalog-data.js, the site's catalog snapshot, from
// ../../catalog/ until `eclogite site` exists. The shape is what
// ../assets/graph.js, machines.js and site.js read; descriptions, which the
// catalog has no field for, come from descriptions.json.
//
//   node catalog-data.mjs           rewrite ../assets/catalog-data.js
//   node catalog-data.mjs --check   fail if it is stale or a description is missing

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../../tools/eclogite-mjs/src/system.mjs";
import { mergeMachine } from "../../tools/eclogite-mjs/src/resolve.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../assets/catalog-data.js");
const descriptions = JSON.parse(readFileSync(join(HERE, "descriptions.json"), "utf8"));
const missing = [];
const describe = (kind, name) => {
  const d = descriptions[kind]?.[name];
  if (!d) missing.push(`${kind}.${name}`);
  return d ?? "";
};

const camel = (k) => (k === "memory_mib" ? "memoryMiB" : k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
const camelDeep = (v) => (Array.isArray(v) ? v.map(camelDeep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [camel(k), camelDeep(x)])) : v);
const ref = (r) => (typeof r === "string" ? r : r.package ?? r.capability);
const packageRefs = (list) => (list ?? []).filter((r) => !(typeof r === "string" && r.startsWith("builder:"))).map(ref);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

const idx = loadCatalog({ catalog: [] });
const values = (kind) => [...idx.kinds[kind].values()].map((d) => d.value);
const defaults = idx.single.defaults.value;

const packages = [], metapackages = [];
for (const p of values("package")) {
  if (!p.builder) { metapackages.push({ name: p.name, description: describe("metapackages", p.name), members: packageRefs(p.dependencies?.run) }); continue; }
  const d = p.dependencies ?? {};
  packages.push({
    name: p.name,
    version: p.version,
    builder: p.builder,
    source: p.source.type === "git" ? p.source.url : "local",
    ...(p.source.revision && { revision: p.source.revision }),
    description: describe("packages", p.name),
    dependencies: { build: packageRefs(d.build), link: packageRefs(d.link), runtime: packageRefs(d.run) },
  });
}
packages.sort(byName);
metapackages.sort(byName);

const toolchainOf = (abi) => idx.kinds.abi.get(abi)?.value.toolchain;
const platforms = values("platform").sort(byName).map((p) => ({
  name: p.name, architecture: p.architecture, abi: defaults.abi, kernelArchitecture: p.kernel_architecture,
  toolchain: toolchainOf(defaults.abi), description: describe("platforms", p.name),
}));

const machines = values("machine").sort(byName).map((m) => {
  const r = mergeMachine(idx, m.name);
  return {
    name: m.name,
    aliases: m.aliases ?? [],
    description: describe("machines", m.name),
    platform: r.platform,
    ...(r.status && { status: r.status }),
    ...(m.extends && { extends: m.extends }),
    resources: camelDeep(r.resources),
    runtime: camelDeep(r.runtime),
    boot: camelDeep(r.boot),
    devices: (r.devices ?? []).map((d) => d.model),
  };
});

const software = values("software").sort(byName).map((s) => ({
  name: s.name, aliases: s.aliases ?? [], description: describe("software", s.name), packages: s.packages,
  image: { format: s.image.format },
  ...(s.volumes && { volumes: s.volumes.map((v) => ({ name: v.name, mount: v.mount, packages: v.packages })) }),
}));

const toolchains = values("toolchain").sort(byName).map((t) => ({
  name: t.name, release: t.release, description: describe("toolchains", t.name),
  targets: Object.keys(t.targets),
  planned: Object.entries(t.targets).filter(([, x]) => x.status === "planned").map(([n]) => n),
}));

const systems = values("system").sort(byName).map((s) => ({
  name: s.name, description: describe("systems", s.name), machine: s.machine, software: s.software, kernel: defaults.providers.kernel,
}));

// capability -> providers, the default first
const capabilities = {};
for (const p of values("package").sort(byName)) {
  const provides = Array.isArray(p.provides) ? p.provides : Object.keys(p.provides ?? {});
  for (const c of provides) (capabilities[c] ??= []).push(p.name);
}
for (const [c, list] of Object.entries(capabilities)) {
  const d = defaults.providers[c];
  const first = typeof d === "string" ? [d] : d?.first ?? [];
  list.sort((a, b) => (first.includes(a) ? first.indexOf(a) : 99) - (first.includes(b) ? first.indexOf(b) : 99) || (a < b ? -1 : 1));
}

const data = { packages, metapackages, platforms, machines, software, toolchains, systems, capabilities: Object.fromEntries(Object.entries(capabilities).sort(([a], [b]) => (a < b ? -1 : 1))) };
const text = `(function () {
  "use strict";

  // Generated from catalog/ by site/types/catalog-data.mjs (npm run site-data)
  // until \`eclogite site\` exists; do not edit. Meta-packages are packages with
  // run dependencies only; they are listed separately for the graph's colors.
  window.ECLOGITE_CATALOG = ${JSON.stringify(data, null, 2).replace(/\n/g, "\n  ")};
}());
`;

if (missing.length) {
  console.error(`site data: no description in site/types/descriptions.json for ${missing.join(", ")}`);
  process.exit(1);
}
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) {
    console.error("site data: site/assets/catalog-data.js is stale; run npm run site-data");
    process.exit(1);
  }
  console.log("site data: current");
} else {
  writeFileSync(OUT, text);
  console.log(`site data: wrote ${packages.length} packages, ${metapackages.length} meta-packages, ${machines.length} machines, ${software.length} software profiles, ${systems.length} systems`);
}
