// Compiling a resolution into the lock (schemas/lock.schema.json,
// eclogite.lock/v0.1), with canonical hashes. Everything here is a pure
// function of the resolution and the package directories.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { providesOf } from "./index.mjs";
import { hashOf, sha256, sortKeys, sortedMap } from "./canonical.mjs";
import { expandStrings, ResolveError } from "./resolve.mjs";

export const ZERO = "0".repeat(64);
export const DEFAULT_SOURCE_DATE_EPOCH = 1793059200; // 2026-10-27T00:00:00Z

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Key inputs (docs/build-model.md): a package's key is the hash of these parts.

/**
 * The named parts of a buildable package's key, from its lock entry and the
 * lock's global parts. `keyOf(name)` gives a dependency's key.
 */
export function keyParts(entry, g, keyOf) {
  const dep = (e) => (e.tool !== undefined ? { tool: e.tool, version: e.version, revision: e.revision } : { package: e.package, key: keyOf(e.package) });
  return {
    recipe: { name: entry.name, version: entry.version, builder: entry.builder },
    source: { source: entry.source, source_tree_sha256: entry.source_tree_sha256 },
    patches: entry.hashes.patches,
    hooks: entry.hashes.hooks,
    files: entry.hashes.files,
    builder: entry.hashes.builder,
    compiler: entry.compiler?.name,
    arguments: entry.arguments,
    parameters: Object.fromEntries(Object.entries(entry.parameters).map(([k, v]) => [k, v.value])),
    fetch: entry.fetch?.output_sha256,
    config: g.config[entry.name]?.effective,
    platform: g.platform_sha256,
    toolchain: g.toolchain,
    environment: g.environment_sha256,
    "build dependencies": entry.dependencies.build.map(dep),
    "link dependencies": entry.dependencies.link.map(dep),
  };
}

export function globalParts(lock) {
  return {
    config: lock.config,
    platform_sha256: hashOf(lock.platform),
    toolchain: lock.target.toolchain,
    environment_sha256: hashOf(lock.build_environment),
  };
}

export function packageKey(entry, g, keyOf) {
  return hashOf({ format: "eclogite.key/v0.1", ...keyParts(entry, g, keyOf) });
}

// ---------------------------------------------------------------------------

function fileSha(dir, rel) {
  return sha256(readFileSync(join(dir, rel)));
}

function builderHash(projectDir, builder) {
  const dir = join(projectDir, "builders", builder);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return hashOf({ builder, implementation: "none" });
  const files = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else files.push({ path: r, sha256: sha256(readFileSync(join(dir, r))) });
    }
  };
  walk("");
  return hashOf({ builder, files });
}

function uuidFrom(hex) {
  const b = Buffer.from(hex, "hex").subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sourceText = (s) => s;

function origin(doc, alias) {
  const o = { name: doc.value.name, defined_in: doc.root ? `catalog:${basename(doc.root)}` : basename(doc.abs), document_sha256: hashOf(doc.value) };
  if (alias !== undefined && alias !== doc.value.name) o.alias = alias;
  return o;
}

/** Order buildable packages: build and link dependencies first, ties by name. */
function buildOrder(names, edges) {
  const left = new Map(names.map((n) => [n, new Set(edges.get(n) ?? [])]));
  const out = [];
  while (left.size) {
    const ready = [...left.entries()].filter(([, d]) => d.size === 0).map(([n]) => n).sort();
    if (!ready.length) throw new ResolveError(5, `build/link dependency cycle among ${[...left.keys()].sort().join(", ")}`);
    const [n] = ready;
    out.push(n);
    left.delete(n);
    for (const d of left.values()) d.delete(n);
  }
  return out;
}

const depOut = (e) => {
  if (e.tool !== undefined) return clone({ tool: e.tool, ...(e.version !== undefined && { version: e.version }), ...(e.revision !== undefined && { revision: e.revision }) });
  const o = { reference: clone(e.reference), package: e.package };
  if (e.capability !== undefined) o.capability = e.capability;
  if (e.config !== undefined) o.config = clone(e.config);
  return o;
};

/**
 * Compile a resolution to a lock. Returns { lock, unpinned } where unpinned
 * lists the values the lock cannot pin yet (a pending fetch hash, an
 * unreleased toolchain); with allowUnpinned they are filled with the zero
 * digest, otherwise the caller must refuse the lock.
 */
export function compileLock(idx, R, { systemDoc, systemAlias, projectDir, sourceDateEpoch, host, allowUnpinned }) {
  void allowUnpinned;
  const unpinned = [];
  const sv = R.system;
  const pkgDoc = (n) => idx.kinds.package.get(n);
  const machineDoc = idx.find("machine", sv.machine);
  const softwareDoc = idx.find("software", sv.software);
  if (!R.toolchain.builder.hosts.includes(host)) {
    throw new ResolveError(5, `build host ${host} is not one of toolchain ${R.toolchain.name} hosts: ${R.toolchain.builder.hosts.join(", ")}`);
  }

  // ---- toolchain identity and build environment
  // the schema does not accept "unreleased": a development lock names the
  // toolchain by the hash of its document instead
  let release = R.toolchain.release;
  if (release === "unreleased") {
    unpinned.push(`toolchain ${R.toolchain.name}: release is "unreleased"`);
    release = `dev-${hashOf(R.toolchain).slice(0, 12)}`;
  }
  const toolchainIdentity = {
    name: R.toolchain.name,
    release,
    host,
    builder_image_sha256: hashOf({ name: R.toolchain.name, release, host, builder: R.toolchain.builder, tools: R.toolchain.tools }),
    target_sha256: hashOf({ triplet: R.triplet, target: R.toolchain.targets[R.triplet], compilers: R.toolchain.compilers }),
  };
  const buildEnvironment = {
    source_date_epoch: sourceDateEpoch,
    variables: {
      HOME: "/build/home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: `/opt/eclogite/toolchains/${R.triplet}/bin:/bin`,
      SOURCE_DATE_EPOCH: String(sourceDateEpoch),
      TZ: "UTC",
    },
    umask: "0022",
    build_directory: "/build/src",
    user: { uid: 1000, gid: 1000 },
    hostname: "eclogite-builder",
    network: "none",
    jobs: "not an input",
  };

  // ---- config
  const config = {};
  for (const n of R.closure) {
    const p = idx.pkg(n);
    if (!p.configurable) continue;
    const required = {};
    for (const [o, { value, source }] of R.config.get(n) ?? []) required[o] = { value, source: clone(source) };
    const effective = Object.fromEntries(Object.entries(p.configurable.options).map(([o, d]) => [o, required[o]?.value ?? d.default]));
    config[n] = { format: p.configurable.format, required: sortedMap(required), effective: sortedMap(effective) };
  }

  // ---- buildable packages, in build order
  const buildable = [...R.closure, ...R.buildOnly].filter((n) => idx.pkg(n).builder);
  const edges = new Map(buildable.map((n) => {
    const d = R.deps.get(n);
    return [n, [...d.build, ...d.link].filter((e) => e.package && idx.pkg(e.package).builder).map((e) => e.package)];
  }));
  const order = buildOrder(buildable, edges);
  const platformDoc = R.platform;
  const g = { config, platform_sha256: hashOf(platformDoc), toolchain: toolchainIdentity, environment_sha256: hashOf(buildEnvironment) };
  const entries = new Map();
  const keys = new Map();
  for (const n of order) {
    const doc = pkgDoc(n);
    const p = doc.value;
    const info = R.packages.get(n);
    const dir = doc.dir;
    const entry = { kind: "buildable", name: n, provides: providesOf(p), version: p.version, source: clone(p.source) };
    entry.builder = p.builder;
    const comp = R.compilers.get(n);
    if (comp) entry.compiler = { name: comp.name, reason: comp.reason };
    entry.arguments = sortKeys(info.arguments);
    entry.variants_applied = info.variants;
    entry.parameters = sortedMap(info.params);
    const d = R.deps.get(n);
    entry.dependencies = { build: d.build.map(depOut), link: d.link.map(depOut), run: d.run.map(depOut) };
    // hashes of the package directory files that enter the key
    const args = info.arguments;
    const patches = (p.patches ?? []).map((path) => ({ path, sha256: fileSha(dir, path) }));
    const hookNames = new Set(Object.values(args.hooks ?? {}).flat());
    if (p.fetch) hookNames.add(p.fetch.hook);
    const filePaths = new Set(Object.keys(args.files ?? {}));
    if (p.provides && !Array.isArray(p.provides)) for (const o of Object.values(p.provides)) for (const f of Object.keys(o.files ?? {})) filePaths.add(f);
    entry.hashes = {
      patches,
      hooks: [...hookNames].sort().map((name) => ({ name, sha256: fileSha(dir, `hooks/${name}.sh`) })),
      files: [...filePaths].sort().map((path) => ({ path, sha256: fileSha(dir, path) })),
      builder: builderHash(projectDir, p.builder),
    };
    if (p.source.type === "git") entry.source_tree_sha256 = hashOf({ revision: p.source.revision, patches: patches.map((x) => x.sha256) });
    if (p.fetch) {
      const out = p.fetch.output_sha256;
      let value = typeof out === "string" ? out : out[platformDoc.name];
      if (value === undefined) throw new ResolveError(5, `${n}: fetch.output_sha256 has no hash for platform ${platformDoc.name}`);
      if (value === "pending") {
        unpinned.push(`${n}: fetch output hash for ${platformDoc.name} is "pending"`);
        value = ZERO;
      }
      entry.fetch = { hook: p.fetch.hook, output_sha256: value };
    }
    entry.key = packageKey(entry, g, (m) => keys.get(m));
    keys.set(n, entry.key);
    entries.set(n, entry);
  }

  const metaEntry = (n) => ({ kind: "meta", name: n, provides: providesOf(idx.pkg(n)), run: R.deps.get(n).run.map(depOut) });
  const closure = R.closure.map((n) => (entries.get(n) ?? metaEntry(n)));
  const buildOnly = R.buildOnly.map((n) => entries.get(n));

  // ---- services
  const swBuild = R.softwareBuild;
  const services = {};
  const addService = (pkg, name, svc, capability) => {
    if (services[name]) throw new ResolveError(10, `service ${name} is defined by both ${services[name].package} and ${pkg}`);
    const values = R.packages.get(pkg)?.buildValues ?? {};
    const out = { ...expandStrings(clone(svc), values), package: pkg };
    if (capability) out.capability = capability;
    services[name] = out;
  };
  for (const n of R.closure) {
    const p = idx.pkg(n);
    for (const [name, svc] of Object.entries(p.services ?? {})) addService(n, name, svc);
    if (p.provides && !Array.isArray(p.provides)) {
      for (const [cap, o] of Object.entries(p.provides)) {
        if (R.choices.get(cap)?.provider !== n) continue;
        for (const [name, svc] of Object.entries(o.services ?? {})) addService(n, name, svc, cap);
      }
    }
  }
  for (const [name, ov] of Object.entries(R.software.service_overrides ?? {})) {
    const svc = services[name];
    if (!svc) throw new ResolveError(10, `service_overrides.${name}: no service ${name} in the closure`);
    const e = expandStrings(clone(ov), swBuild);
    const fields = Object.keys(e).sort();
    for (const f of fields) {
      if (f === "environment") svc.environment = { ...(svc.environment ?? {}), ...e.environment };
      else svc[f] = e[f];
    }
    svc.overridden = fields;
  }
  for (const s of Object.values(services)) if (s.environment) s.environment = sortedMap(s.environment);

  // ---- accounts
  const startNames = new Set([...Object.keys(R.startValues.get("software") ?? {}), ...[...R.startValues.entries()].flatMap(([, v]) => Object.keys(v))]);
  const usesStart = (v) => typeof v === "string" && [...v.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].some((m) => startNames.has(m[1]));
  const userDecls = [];
  const groupDecls = [];
  for (const n of R.closure) {
    for (const u of idx.pkg(n).users ?? []) userDecls.push({ from: n, u: expandStrings(clone(u), R.packages.get(n)?.buildValues ?? {}) });
    for (const gr of idx.pkg(n).groups ?? []) groupDecls.push({ from: n, g: clone(gr) });
  }
  for (const u of R.software.users ?? []) userDecls.push({ from: "software", u: expandStrings(clone(u), swBuild) });
  for (const gr of R.software.groups ?? []) groupDecls.push({ from: "software", g: clone(gr) });
  const used = new Set();
  for (const { u } of userDecls) if (Number.isInteger(u.uid)) used.add(u.uid);
  for (const { u } of userDecls) if (Number.isInteger(u.gid)) used.add(u.gid);
  for (const { g: gr } of groupDecls) if (Number.isInteger(gr.gid)) used.add(gr.gid);
  let next = 100;
  const allocate = () => {
    while (used.has(next)) next++;
    if (next > 999) throw new ResolveError(10, "no free account id in 100..999");
    used.add(next);
    return next;
  };
  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const users = [];
  const groups = [];
  const groupNames = new Set(groupDecls.map(({ g: gr }) => gr.name));
  for (const { u } of [...userDecls].sort((a, b) => byName(a.u.name, b.u.name))) if (u.uid === undefined) u.uid = allocate();
  for (const d of userDecls) {
    const u = d.u;
    const out = { name: u.name, uid: u.uid };
    out.group = u.group ?? u.name;
    if (u.gid !== undefined) out.gid = u.gid;
    for (const k of ["groups", "home", "shell", "password", "description"]) if (u[k] !== undefined) out[k] = u[k];
    out.from = d.from;
    users.push(out);
    if (!groupNames.has(out.group)) {
      const gid = u.gid ?? (u.group === undefined ? u.uid : undefined);
      if (gid === undefined) throw new ResolveError(10, `user ${u.name}: group ${u.group} is not declared and has no gid`);
      groups.push({ name: out.group, gid, from: d.from });
      groupNames.add(out.group);
    }
  }
  for (const { g: gr } of [...groupDecls].sort((a, b) => byName(a.g.name, b.g.name))) if (gr.gid === undefined) gr.gid = allocate();
  for (const d of groupDecls) groups.push({ name: d.g.name, gid: d.g.gid, from: d.from });
  const accountsFiles = [...users, ...groups].some((a) => Object.values(a).some(usesStart)) ? "start" : "image";

  // ---- runtime
  const settings = {};
  for (const [k, s] of Object.entries(R.software.settings ?? {})) {
    const c = clone(s);
    if (c.secret) delete c.default; // a secret is never written to the lock
    settings[k] = c;
  }
  const values = {};
  for (const [owner, v] of [...R.startValues.entries()].sort((a, b) => byName(a[0], b[0]))) values[owner] = sortedMap(clone(v));
  const runtime = {
    settings: sortedMap(settings),
    values,
    delivery: { device: "config-disk", mount: "/run/eclogite/config" },
    state: clone(R.software.state ?? []),
    endpoints: sortedMap(clone(R.software.endpoints ?? {})),
    commands: sortedMap(clone(R.software.commands ?? {})),
  };

  // ---- mounts
  const root = R.machine.boot.kernel_arguments?.find((a) => a.startsWith("root="))?.slice(5) ?? "/dev/vda";
  const diskAt = (i) => {
    let m = /^\/dev\/vd([a-z])$/.exec(root);
    if (m) return `/dev/vd${String.fromCharCode(m[1].charCodeAt(0) + i)}`;
    m = /^(\/dev\/mmcblk\d+p)(\d+)$/.exec(root);
    if (m) return `${m[1]}${Number(m[2]) + i}`;
    throw new ResolveError(10, `cannot name the disk after root device ${root}`);
  };
  const mounts = {};
  const sw = R.software;
  const rootImage = { format: sw.image.format };
  mounts["/"] = { type: rootImage.format, source: root, ...(sw.root.readonly && { options: ["ro"] }), from: "software.root" };
  for (const t of sw.root.tmpfs) mounts[t] = { type: "tmpfs", source: "none", from: "software.tmpfs" };
  let disk = 1;
  for (const v of sw.volumes ?? []) {
    mounts[v.mount] = { type: v.format, source: diskAt(disk++), ...(v.readonly && { options: ["ro"] }), from: "software.volumes" };
  }
  for (const s of sw.state ?? []) mounts[s.mount] = { type: s.format, source: diskAt(disk++), from: "software.state" };
  if (Object.keys(settings).length || Object.keys(values).length) {
    mounts[runtime.delivery.mount] = { type: "ext4", source: diskAt(disk++), options: ["ro"], from: "runtime.config" };
  }
  for (const n of R.closure) {
    for (const [path, m] of Object.entries(idx.pkg(n).mounts ?? {})) {
      if (mounts[path]) throw new ResolveError(10, `mount point ${path} is declared by both ${mounts[path].from} and ${n}`);
      mounts[path] = { ...expandStrings(clone(m), R.packages.get(n)?.buildValues ?? {}), from: n };
    }
  }
  const blocks = R.facts.machine.block_devices;
  if (blocks !== "unbounded" && blocks !== undefined && disk > blocks) {
    throw new ResolveError(10, `the system needs ${disk} block devices (root, volumes, state, config), machine ${R.machine.name} has ${blocks}`);
  }

  // ---- tests and images
  const tests = [{ id: "boot-shell" }, ...R.tests.map((t) => (t.timeout_seconds ? { id: t.id, timeout_seconds: t.timeout_seconds } : { id: t.id })), { id: "shutdown" }];
  const imageInputs = {
    packages: [...entries.values()].filter((e) => R.closureSet.has(e.name)).map((e) => [e.name, e.key]).sort((a, b) => byName(a[0], b[0])),
    owned: [...R.owned.entries()],
    services,
    users,
    groups,
    mounts,
  };
  const image = (role, extra) => ({
    ...extra,
    filesystem_uuid: uuidFrom(hashOf({ image: role, uuid: "filesystem", imageInputs, extra })),
    hash_seed: uuidFrom(hashOf({ image: role, uuid: "hash_seed", imageInputs, extra })),
  });
  const rootExtra = { format: sw.image.format, readonly: sw.root.readonly, strip: sw.image.strip ?? false, exclude: clone(sw.image.exclude ?? []) };
  if (sw.image.size_mib !== undefined) rootExtra.size_mib = sw.image.size_mib;
  if (sw.image.free_mib !== undefined) rootExtra.free_mib = sw.image.free_mib;
  const images = {
    root: image("root", rootExtra),
    volumes: (sw.volumes ?? []).map((v) => image(`volume:${v.name}`, { ...clone(v), strip: false, exclude: [] })),
  };

  // ---- the document
  const softwareOut = clone(sw);
  delete softwareOut.aliases;
  if (softwareOut.settings) for (const s of Object.values(softwareOut.settings)) if (s.secret) delete s.default;
  const { aliases: _a, extends: _e, ...machineOut } = clone(R.machine);
  void _a; void _e;
  const selectedBy = {};
  for (const n of [...R.closure, ...R.buildOnly]) selectedBy[n] = R.chains.get(n);

  const needed = new Set([...R.closure, ...R.buildOnly]);
  const inputs = {
    format: "eclogite.input/v0.1",
    system: sv,
    machines: R.machine.merged_from.map((m) => idx.kinds.machine.get(m).value),
    software: softwareDoc.value,
    platform: R.platform,
    abi: R.abi,
    toolchain: R.toolchain,
    defaults: idx.defaults,
    facts: idx.facts,
    devices: idx.devices,
    packages: Object.fromEntries([...needed].sort().map((n) => [n, { document: idx.pkg(n), hashes: entries.get(n)?.hashes }])),
    capabilities: [...idx.capabilities.entries()].sort((a, b) => byName(a[0], b[0])),
    options: { source_date_epoch: sourceDateEpoch, host },
  };

  const lock = {
    schema: "eclogite.lock/v0.1",
    input_sha256: hashOf(inputs),
    system: {
      name: sv.name ?? systemDoc.value.name,
      origin: origin(systemDoc),
      machine: origin(machineDoc, sv.machine),
      software: origin(softwareDoc, sv.software),
    },
    machine: machineOut,
    software: softwareOut,
    platform: clone(R.platform),
    abi: clone(R.abi),
    target: { platform: R.platform.name, abi: R.abi.name, abi_from: R.abiFrom, triplet: R.triplet, toolchain: toolchainIdentity },
    facts: { target: sortedMap(R.facts.target), machine: sortedMap(R.facts.machine) },
    compiler: { name: R.compiler.name, from: R.compiler.from },
    build_environment: buildEnvironment,
    choices: sortedMap(Object.fromEntries([...R.choices].map(([cap, c]) => {
      const o = { provider: c.provider, reason: c.reason };
      if (c.via !== undefined) o.via = c.via;
      if (c.reference !== undefined) o.reference = clone(c.reference);
      return [cap, o];
    }))),
    closure,
    selected_by: sortedMap(selectedBy),
    build_only: buildOnly,
    build_order: order,
    conditions: R.conditions.map((c) => ({ from: c.from, dependency: c.dependency, when: clone(c.when), held: c.held })),
    config: sortedMap(config),
    owned_files: sortedMap(Object.fromEntries([...R.owned].map(([path, o]) => [path, o]))),
    services: sortedMap(services),
    accounts: { users, groups, files: accountsFiles },
    runtime,
    mounts: sortedMap(mounts),
    tests,
    images,
  };
  void sourceText;
  return { lock: sortKeys(lock), unpinned };
}
