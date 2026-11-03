// Resolution: docs/resolution.md, step by step. The function resolveSystem()
// has one section per step; every choice records why. It has no search and no
// randomness, and visits things in document order, so its result depends only
// on the inputs.

import { providesOf } from "./index.mjs";
import { evalPredicate, evalKnown, makeEnv, scopeFacts, targetDocument, FactError, compactJson } from "./facts.mjs";

export class ResolveError extends Error {
  constructor(step, message, chain = [], location = null) {
    super(message);
    this.step = step;
    this.chain = chain;
    this.location = location;
  }
}

const NO_COMPILER_BUILDERS = new Set(["files", "source-tree"]);
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Machines

/** The machine with `extends` merged: resources field by field, the rest replaced. */
export function mergeMachine(idx, name) {
  const doc = idx.kinds.machine.get(name);
  const m = doc.value;
  if (!m.extends) {
    const { aliases, ...rest } = m;
    void aliases;
    return { ...clone(rest), merged_from: [m.name] };
  }
  const base = mergeMachine(idx, m.extends);
  const out = clone(base);
  out.name = m.name;
  out.merged_from = [m.name, ...base.merged_from];
  out.resources = { ...base.resources, ...clone(m.resources ?? {}) };
  for (const k of ["devices", "limitations", "references", "status"]) if (m[k] !== undefined) out[k] = clone(m[k]);
  return out;
}

// ---------------------------------------------------------------------------
// Parameters (docs/configuration.md, "Parameters")

function pointerGet(doc, ptr) {
  let node = doc;
  for (const part of ptr.split("/").slice(1)) {
    node = node !== null && typeof node === "object" ? node[part.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined;
  }
  return node;
}

/** { time: "build", value } or { time: "start" } for a parameter value. */
export function evalParameter(value, { system, where }) {
  if (typeof value === "string") value = { pointer: value };
  if (value.pointer !== undefined) {
    const v = pointerGet(system, value.pointer);
    if (v === undefined || v === null || typeof v === "object") throw new ResolveError(5, `${where}: pointer ${value.pointer} does not resolve to a string, integer or boolean`);
    return { time: "build", value: v };
  }
  if (value.setting !== undefined) {
    if (!system.software.settings || !(value.setting in system.software.settings)) {
      throw new ResolveError(5, `${where}: setting ${value.setting} is not defined by the software profile`);
    }
    return { time: "start" };
  }
  if (value.host !== undefined) return { time: "start" };
  if (value.scale !== undefined) {
    const inner = evalParameter(value.scale, { system, where });
    if (inner.time === "start") return inner;
    if (!Number.isInteger(inner.value)) throw new ResolveError(5, `${where}: scale needs an integer, got ${JSON.stringify(inner.value)}`);
    return { time: "build", value: Math.floor((inner.value * value.multiply) / value.divide) };
  }
  evalParameter(value.crypt_sha512, { system, where });
  return { time: "start" };
}

export function expandStrings(node, values) {
  if (typeof node === "string") {
    return node.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (m, n) => (n in values ? String(values[n]) : m));
  }
  if (Array.isArray(node)) return node.map((n) => expandStrings(n, values));
  if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, expandStrings(v, values)]));
  return node;
}

function mentions(node, name) {
  const re = new RegExp(`\\$\\{${name}\\}`);
  if (typeof node === "string") return re.test(node);
  if (Array.isArray(node)) return node.some((n) => mentions(n, name));
  if (node && typeof node === "object") return Object.values(node).some((n) => mentions(n, name));
  return false;
}

// ---------------------------------------------------------------------------
// Resolution

export function resolveSystem(idx, systemValue, systemFile = "") {
  const where = (m) => `${systemFile ? `${systemFile}: ` : ""}${m}`;
  const defaults = idx.defaults;
  const facts = idx.facts;

  // ---- inputs
  const machineDoc = idx.find("machine", systemValue.machine);
  const softwareDoc = idx.find("software", systemValue.software);
  if (!machineDoc) throw new ResolveError(1, where(`machine ${systemValue.machine} does not exist`));
  if (!softwareDoc) throw new ResolveError(1, where(`software ${systemValue.software} does not exist`));
  const machine = mergeMachine(idx, machineDoc.value.name);
  const software = softwareDoc.value;

  // ---- step 1: target
  const platformDoc = idx.kinds.platform.get(machine.platform);
  if (!platformDoc) throw new ResolveError(1, `platform ${machine.platform} does not exist`);
  const platform = platformDoc.value;
  const abiFrom = systemValue.abi ? "system" : software.abi ? "software" : "defaults";
  const abiName = systemValue.abi ?? software.abi ?? defaults.abi;
  const abiDoc = idx.kinds.abi.get(abiName);
  if (!abiDoc) throw new ResolveError(1, `unknown ABI ${abiName}`);
  const abi = abiDoc.value;
  const suffix = abi.triplet[platform.architecture];
  if (!suffix) throw new ResolveError(1, `ABI ${abiName} has no triplet for architecture ${platform.architecture}`);
  const triplet = `${platform.triplet_cpu}-${suffix}`;
  const toolchainDoc = idx.kinds.toolchain.get(abi.toolchain);
  if (!toolchainDoc) throw new ResolveError(1, `toolchain ${abi.toolchain} does not exist`);
  const toolchain = toolchainDoc.value;
  const targetEntry = toolchain.targets[triplet];
  if (!targetEntry) throw new ResolveError(1, `toolchain ${toolchain.name} does not list ${triplet}`);
  if (targetEntry.status === "planned") throw new ResolveError(1, `target ${triplet} is planned in toolchain ${toolchain.name}`);

  const targetFacts = scopeFacts(facts, "target", targetDocument(platform, abi));
  const machineFacts = scopeFacts(facts, "machine", machine);
  const targetEnv = makeEnv(facts, targetFacts);
  const machineEnv = makeEnv(facts, machineFacts);
  const whenEnv = makeEnv(facts, targetFacts, machineFacts);
  const system = { machine, software, platform, abi };

  const holds = (pred, env, what) => {
    try {
      return evalPredicate(pred, env);
    } catch (e) {
      if (e instanceof FactError) throw new ResolveError(5, `${what}: ${e.message}`);
      throw e;
    }
  };

  /** Where a package's constraints fail: null, or { scope, predicate }. */
  function failedConstraint(name) {
    const c = idx.pkg(name).compatible;
    if (c?.target && !holds(c.target, targetEnv, `${name} compatible.target`)) return { scope: "target", predicate: c.target };
    if (c?.machine && !holds(c.machine, machineEnv, `${name} compatible.machine`)) return { scope: "machine", predicate: c.machine };
    return null;
  }
  const constraintMessage = (name, f, chain) => `${name} fails its ${f.scope} ${compactJson(f.predicate)} (${chain.join(" -> ")})`;
  function requireConstraints(name, chain) {
    const f = failedConstraint(name);
    if (f) throw new ResolveError(5, constraintMessage(name, f, chain), chain);
  }

  // ---- step 2: selected set
  const conditions = [];
  const seenConditions = new Set();
  function condition(from, index, entry) {
    const key = `${from}|${index}`;
    const held = holds(entry.when, whenEnv, `${from} dependency ${entry.package ?? ""}`);
    if (!seenConditions.has(key)) {
      seenConditions.add(key);
      conditions.push({ from, dependency: entry.package, when: entry.when, held });
    }
    return held;
  }
  const selected = [];
  const selectedSet = new Set();
  function select(entry, from, index) {
    if (entry.when !== undefined && !condition(from, index, entry)) return;
    const name = typeof entry === "string" ? entry : entry.package;
    if (name === undefined || !idx.kinds.package.has(name) || selectedSet.has(name)) return;
    selectedSet.add(name);
    selected.push(name);
    const p = idx.pkg(name);
    if (!p.builder) (p.dependencies?.run ?? []).forEach((e, i) => select(e, name, i));
  }
  software.packages.forEach((e) => select(e, "software", -1));

  // ---- step 3: references
  const choices = new Map();
  const overrideOf = (cap) =>
    systemValue.providers?.[cap] !== undefined
      ? { provider: systemValue.providers[cap], reason: "system override" }
      : software.providers?.[cap] !== undefined
        ? { provider: software.providers[cap], reason: "software override" }
        : null;

  function chooseCapability(cap, chain) {
    if (choices.has(cap)) return choices.get(cap).provider;
    let c;
    const ov = overrideOf(cap);
    if (ov) {
      const p = idx.pkg(ov.provider);
      if (!p || !providesOf(p).includes(cap)) throw new ResolveError(3, `${ov.reason}: ${ov.provider} does not provide ${cap}`, chain);
      c = ov;
    } else {
      const sel = selected.filter((n) => providesOf(idx.pkg(n)).includes(cap));
      if (sel.length > 1) throw new ResolveError(3, `several selected packages provide ${cap}: ${[...sel].sort().join(", ")}; name one in providers`, chain);
      if (sel.length === 1) c = { provider: sel[0], reason: "selected" };
      else {
        const via = [...choices.entries()].find(([, v]) => providesOf(idx.pkg(v.provider)).includes(cap));
        if (via) c = { provider: via[1].provider, reason: "already chosen", via: via[0] };
        else {
          const ref = defaults.providers[cap];
          if (ref === undefined) throw new ResolveError(3, `no provider for capability ${cap}`, chain);
          c = { provider: resolveReference(ref, chain), reason: "default", reference: ref };
        }
      }
    }
    requireConstraints(c.provider, chain);
    choices.set(cap, c);
    return c.provider;
  }

  /** A string (package or capability) or { first } to a package. */
  function resolveReference(ref, chain) {
    if (typeof ref === "string") return idx.kinds.package.has(ref) ? ref : chooseCapability(ref, chain);
    const inSelected = ref.first.find((n) => selectedSet.has(n));
    if (inSelected) {
      requireConstraints(inSelected, chain);
      return inSelected;
    }
    const why = [];
    for (const n of ref.first) {
      try {
        const provider = idx.kinds.package.has(n) ? n : chooseCapability(n, chain);
        const f = failedConstraint(provider);
        if (!f) return provider;
        why.push(`${provider}: ${f.scope} ${compactJson(f.predicate)}`);
      } catch (e) {
        if (!(e instanceof ResolveError)) throw e;
        why.push(`${n}: ${e.message}`);
      }
    }
    throw new ResolveError(3, `no alternative of ${compactJson(ref)} fits: ${why.join("; ")}`, chain);
  }

  // ---- step 4: kernel and init
  chooseCapability("kernel", ["software"]);
  chooseCapability("init", ["software"]);

  // ---- step 5: closure
  const closure = [];
  const closureSet = new Set();
  const chains = new Map();
  const deps = new Map(); // package -> { build, link, run } resolved entries
  const configReqs = []; // from dependency entries
  const softwareReqs = [];
  const builderTools = new Map(); // package -> [tool names]

  function resolveEntry(entry, chain, declaring) {
    const name = typeof entry === "string" ? entry : entry.package;
    const out = {};
    if (entry.first) {
      out.reference = { first: entry.first };
      out.package = resolveReference(entry, chain);
    } else {
      out.reference = name;
      out.package = resolveReference(name, chain);
      if (!idx.kinds.package.has(name)) out.capability = name;
    }
    if (entry.config) {
      out.config = entry.config;
      if (declaring !== null) configReqs.push({ target: out.package, config: entry.config, source: { kind: "dependency", package: declaring } });
    }
    return out;
  }

  const buildOnlyQueue = [];
  function resolveBuildLink(name, chain) {
    const p = idx.pkg(name);
    const rec = { build: [], link: [], run: [] };
    deps.set(name, rec);
    for (const list of ["build", "link"]) {
      for (const entry of p.dependencies?.[list] ?? []) {
        if (typeof entry === "string" && entry.startsWith("builder:")) {
          rec.build.push({ tool: entry.slice(8) });
          continue;
        }
        const r = resolveEntry(entry, chain, name);
        rec[list].push(r);
        buildOnlyQueue.push({ name: r.package, chain: [...chain, r.package] });
      }
    }
    return rec;
  }

  function visit(name, parentChain) {
    if (closureSet.has(name)) return;
    const chain = [...parentChain, name];
    closureSet.add(name);
    closure.push(name);
    chains.set(name, chain);
    requireConstraints(name, parentChain);
    const p = idx.pkg(name);
    const rec = p.builder ? resolveBuildLink(name, chain) : (deps.set(name, { build: [], link: [], run: [] }), deps.get(name));
    (p.dependencies?.run ?? []).forEach((entry, i) => {
      if (entry.when !== undefined && !condition(name, i, entry)) return;
      const r = resolveEntry(entry, chain, name);
      rec.run.push(r);
      visit(r.package, chain);
    });
  }
  software.packages.forEach((entry) => {
    const r = resolveEntry(entry, ["software"], null);
    if (entry.config) softwareReqs.push({ target: r.package, config: entry.config, source: { kind: "software" } });
    visit(r.package, ["software"]);
  });

  // build-only packages: reached by build and link dependencies only
  const buildOnly = [];
  const buildOnlySet = new Set();
  while (buildOnlyQueue.length) {
    const { name, chain } = buildOnlyQueue.shift();
    if (closureSet.has(name) || buildOnlySet.has(name)) continue;
    buildOnlySet.add(name);
    buildOnly.push(name);
    chains.set(name, chain);
    const f = failedConstraint(name);
    if (f && f.scope === "target") throw new ResolveError(5, constraintMessage(name, f, chain.slice(0, -1)), chain.slice(0, -1));
    if (idx.pkg(name).builder) resolveBuildLink(name, chain);
    else deps.set(name, { build: [], link: [], run: [] });
  }

  // dependency cycles in build and link (run dependencies may cycle)
  const buildGraph = new Map();
  for (const n of [...closure, ...buildOnly]) {
    if (!idx.pkg(n).builder) continue;
    const d = deps.get(n);
    buildGraph.set(n, [...new Set([...d.build, ...d.link].filter((e) => e.package).map((e) => e.package))].filter((m) => idx.pkg(m).builder));
  }
  const state = new Map();
  const stack = [];
  function cycle(n) {
    state.set(n, 1);
    stack.push(n);
    for (const m of [...(buildGraph.get(n) ?? [])].sort()) {
      if (state.get(m) === 1) throw new ResolveError(5, `build/link dependency cycle: ${[...stack.slice(stack.indexOf(m)), m].join(" -> ")}`, chains.get(n) ?? []);
      if (!state.has(m)) cycle(m);
    }
    stack.pop();
    state.set(n, 2);
  }
  for (const n of [...buildGraph.keys()].sort()) if (!state.has(n)) cycle(n);

  // ---- step 6: bootable
  for (const cap of ["kernel", "init"]) {
    const providers = closure.filter((n) => providesOf(idx.pkg(n)).includes(cap));
    if (providers.length > 1) throw new ResolveError(6, `the closure has several ${cap} providers: ${providers.join(", ")}`);
    if (providers.length === 0) {
      const chosen = choices.get(cap).provider;
      closure.push(chosen);
      closureSet.add(chosen);
      chains.set(chosen, ["software", chosen]);
      if (!deps.has(chosen)) resolveBuildLink(chosen, ["software", chosen]);
    }
  }

  // ---- step 8 (before 7: config needs every chosen provider): every capability provided in the closure
  for (const n of closure) for (const cap of providesOf(idx.pkg(n))) chooseCapability(cap, chains.get(n));

  // ---- step 7: config
  const config = new Map(); // package -> Map(option -> { value, source })
  const sourceText = (s) =>
    s.kind === "dependency" ? s.package : s.kind === "software" ? "software" : s.kind === "device" ? `device ${s.model}` : `implied by ${s.option}`;
  function require(target, option, value, source) {
    const p = idx.pkg(target);
    if (!p.configurable) throw new ResolveError(7, `${target} is not configurable; ${sourceText(source)} requires ${option}`);
    const decl = p.configurable.options[option];
    if (!decl) throw new ResolveError(7, `${target} does not declare ${option}; ${sourceText(source)} requires it`);
    if (!decl.values.includes(value)) throw new ResolveError(7, `${option}=${value} (${sourceText(source)}) is not allowed by ${target}: ${decl.values.join(", ")}`);
    if (!config.has(target)) config.set(target, new Map());
    const have = config.get(target).get(option);
    if (have) {
      if (have.value !== value) throw new ResolveError(7, `${option} is required as ${have.value} by ${sourceText(have.source)} and as ${value} by ${sourceText(source)}`);
      return;
    }
    config.get(target).set(option, { value, source });
    if (value !== "n") for (const [o, v] of Object.entries(decl.requires ?? {})) require(target, o, v, { kind: "implied", option });
  }
  for (const r of [...configReqs, ...softwareReqs]) for (const [o, v] of Object.entries(r.config)) require(r.target, o, v, r.source);
  for (const dev of machine.devices) {
    const model = idx.devices[dev.model];
    for (const [cap, opts] of Object.entries(model?.requires ?? {})) {
      const c = choices.get(cap);
      if (!c || !closureSet.has(c.provider)) continue;
      for (const [o, v] of Object.entries(opts)) require(c.provider, o, v, { kind: "device", model: dev.model, device_kind: dev.kind });
    }
  }

  // ---- step 9: compilers and builder tools
  const compilerFrom = systemValue.compiler ? "system" : software.compiler ? "software" : "defaults";
  const compilerName = systemValue.compiler ?? software.compiler ?? defaults.compiler;
  if (!toolchain.compilers[compilerName]) throw new ResolveError(9, `unknown compiler ${compilerName} in toolchain ${toolchain.name}`);
  const toolPlanned = (t) => toolchain.tools[t]?.status === "planned";
  const compilerUsable = (c) => toolchain.compilers[c].every((t) => toolchain.tools[t] && !toolPlanned(t));
  const compilers = new Map();
  for (const n of [...closure, ...buildOnly]) {
    const p = idx.pkg(n);
    if (!p.builder) continue;
    for (const entry of deps.get(n).build) {
      if (entry.tool === undefined) continue;
      const t = toolchain.tools[entry.tool];
      if (!t) throw new ResolveError(9, `${n}: builder tool ${entry.tool} is not in toolchain ${toolchain.name}`, chains.get(n));
      if (t.status === "planned") throw new ResolveError(9, `${n}: builder tool ${entry.tool} is planned`, chains.get(n));
      if (t.version !== undefined) entry.version = t.version;
      if (t.revision !== undefined) entry.revision = t.revision;
    }
    if (p.matches_builder_tool) {
      const t = toolchain.tools[p.matches_builder_tool];
      if (!t || t.revision !== p.source.revision) throw new ResolveError(9, `${n}: source revision ${p.source.revision} differs from builder tool ${p.matches_builder_tool} (${t?.revision ?? "no revision"})`, chains.get(n));
    }
    if (NO_COMPILER_BUILDERS.has(p.builder)) continue;
    const allows = (c) => {
      const build = p.compatible?.build;
      if (!build) return true;
      const env = makeEnv(facts, targetFacts, { compiler: c });
      return evalKnown(build, env) !== false;
    };
    const order = [compilerName, ...Object.keys(toolchain.compilers).filter((c) => c !== compilerName)];
    const choice = order.find((c) => allows(c));
    if (!choice) throw new ResolveError(9, `no compiler satisfies ${n} compatible.build ${compactJson(p.compatible.build)}`, chains.get(n));
    if (!compilerUsable(choice)) throw new ResolveError(9, `${n}: compiler ${choice} is planned in toolchain ${toolchain.name}`, chains.get(n));
    compilers.set(n, { name: choice, reason: choice === compilerName ? "system" : "fallback" });
  }

  // ---- step 10: owned files and services
  const owned = new Map();
  for (const cap of [...choices.keys()].sort()) {
    const provider = choices.get(cap).provider;
    if (!closureSet.has(provider)) continue;
    const map = idx.pkg(provider).provides;
    if (!map || Array.isArray(map) || !map[cap]) continue;
    const files = [
      ...Object.entries(map[cap].symlinks ?? {}).map(([path, target]) => [path, { type: "symlink", target }]),
      ...Object.entries(map[cap].files ?? {}).map(([src, path]) => [path, { type: "file", target: src }]),
    ];
    for (const [path, f] of files) {
      if (owned.has(path)) {
        const o = owned.get(path);
        throw new ResolveError(10, `${path} is owned by both ${o.provider}:${o.capability} and ${provider}:${cap}`);
      }
      owned.set(path, { provider, capability: cap, ...f });
    }
  }

  // ---- step 11: tests
  const tests = [];
  for (const n of closure) {
    for (const [tname, t] of Object.entries(idx.pkg(n).tests ?? {})) {
      if (t.when && !holds(t.when, whenEnv, `test ${n}:${tname}`)) continue;
      for (const need of t.needs ?? []) {
        const provider = idx.kinds.package.has(need) ? need : choices.get(need)?.provider;
        if (!provider || !closureSet.has(provider)) throw new ResolveError(11, `test ${n}:${tname} needs ${need}, which is not in the closure`, chains.get(n));
      }
      tests.push({ id: `${n}:${tname}`, timeout_seconds: t.timeout_seconds });
    }
  }

  // ---- machine totals: additive facts across the closure
  for (const [fname, fact] of Object.entries(facts)) {
    if (fact.aggregate?.machine !== "sum" || fact.type !== "integer" || machineFacts[fname] === undefined || machineFacts[fname] === "unbounded") continue;
    let need = 0;
    const parts = [];
    for (const n of closure) {
      const t = idx.pkg(n).compatible?.machine;
      for (const leaf of t ? leaves(t) : []) {
        const test = leaf[fname];
        if (test?.ge !== undefined && typeof test.ge === "number") { need += test.ge; parts.push(`${n} ${test.ge}`); }
      }
    }
    if (need > machineFacts[fname]) {
      throw new ResolveError(5, `the closure needs ${fname} >= ${need} (${parts.join(" + ")}), machine ${machine.name} provides ${machineFacts[fname]}`);
    }
  }

  // ---- variants and parameters, per package
  const packages = new Map();
  const startValues = new Map(); // owner -> { NAME: value spec }
  for (const n of [...closure, ...buildOnly]) {
    const p = idx.pkg(n);
    const info = { variants: [], arguments: undefined, params: {}, buildValues: {} };
    packages.set(n, info);
    if (!p.builder) continue;
    const args = clone(p.arguments ?? {});
    const scalars = new Map();
    (p.variants ?? []).forEach((v, i) => {
      if (!holds(v.when, whenEnv, `${n} variants/${i}`)) return;
      info.variants.push(i);
      mergeArguments(args, v.arguments, "", scalars, n, i);
    });
    for (const [pname, spec] of Object.entries(p.parameters ?? {})) {
      const r = evalParameter(spec, { system, where: `${n} parameter ${pname}` });
      if (r.time === "build") {
        info.params[pname] = { from: spec, value: r.value };
        info.buildValues[pname] = r.value;
      } else {
        if (mentions(args, pname)) throw new ResolveError(5, `${n}: start-time parameter ${pname} is used in the build arguments`, chains.get(n));
        if (!startValues.has(n)) startValues.set(n, {});
        startValues.get(n)[pname] = spec;
      }
    }
    info.arguments = expandStrings(args, info.buildValues);
  }
  const softwareStart = {};
  const softwareBuild = {};
  for (const [pname, spec] of Object.entries(software.parameters ?? {})) {
    const r = evalParameter(spec, { system, where: `software ${software.name} parameter ${pname}` });
    if (r.time === "build") softwareBuild[pname] = r.value;
    else softwareStart[pname] = spec;
  }
  if (Object.keys(softwareStart).length) startValues.set("software", softwareStart);

  return {
    system: systemValue, machine, software, platform, abi, abiFrom, triplet, toolchain, targetEnv, machineEnv,
    facts: { target: targetFacts, machine: machineFacts },
    compiler: { name: compilerName, from: compilerFrom },
    selected, choices, closure, closureSet, chains, deps, buildOnly, conditions, config, owned, tests, compilers,
    packages, startValues, softwareBuild, whenEnv,
  };
}

function leaves(pred) {
  const [k] = Object.keys(pred);
  if (k === "all") return pred.all.flatMap(leaves);
  if (k === "any" || k === "not") return [];
  return [pred];
}

function mergeArguments(dst, src, path, scalars, pkg, variant) {
  for (const [k, v] of Object.entries(src)) {
    const here = `${path}/${k}`;
    if (Array.isArray(v)) dst[k] = [...(dst[k] ?? []), ...clone(v)];
    else if (v !== null && typeof v === "object") {
      if (dst[k] === undefined || typeof dst[k] !== "object") dst[k] = {};
      mergeArguments(dst[k], v, here, scalars, pkg, variant);
    } else {
      const prev = scalars.get(here);
      if (prev && prev.value !== v) throw new ResolveError(5, `${pkg}: variants ${prev.variant} and ${variant} set ${here} to different values`);
      scalars.set(here, { value: v, variant });
      dst[k] = v;
    }
  }
}
