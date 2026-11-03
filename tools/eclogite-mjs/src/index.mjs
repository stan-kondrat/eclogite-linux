// The catalog index: documents by kind and name, aliases and capabilities.
// Shared by the catalog checks and the resolver.

export function providesOf(pkg) {
  const p = pkg.provides;
  if (!p) return [];
  return Array.isArray(p) ? p : Object.keys(p);
}

/** The package names a reference entry (string, alternatives or configured) can name. */
export function referenceNames(ref) {
  if (typeof ref === "string") return [ref];
  if (ref.first) return ref.first;
  return [ref.package];
}

export class Index {
  constructor(docs, report) {
    this.docs = docs;
    this.kinds = {};
    this.aliases = {};
    for (const k of ["package", "machine", "software", "platform", "abi", "toolchain", "system"]) {
      this.kinds[k] = new Map();
      this.aliases[k] = new Map();
    }
    this.single = {};
    for (const d of docs) {
      if (d.kind === "facts" || d.kind === "devices" || d.kind === "defaults") {
        if (this.single[d.kind]) {
          report(d, "", `a second ${d.kind} document; ${this.single[d.kind].file} already defines it`);
        } else this.single[d.kind] = d;
        continue;
      }
      const name = d.value.name;
      if (typeof name !== "string") continue;
      const map = this.kinds[d.kind];
      if (map.has(name)) {
        report(d, "/name", `${d.kind} ${JSON.stringify(name)} is already defined in ${map.get(name).file}`, true);
        continue;
      }
      map.set(name, d);
    }
    for (const [kind, map] of Object.entries(this.kinds)) {
      for (const d of map.values()) {
        (d.value.aliases ?? []).forEach((a, i) => {
          if (map.has(a) && map.get(a) !== d) report(d, `/aliases/${i}`, `alias ${JSON.stringify(a)} is the name of ${kind} ${a} (${map.get(a).file})`);
          else if (this.aliases[kind].has(a)) report(d, `/aliases/${i}`, `alias ${JSON.stringify(a)} is also an alias of ${this.aliases[kind].get(a).value.name} (${this.aliases[kind].get(a).file})`);
          else this.aliases[kind].set(a, d);
        });
      }
    }
    // capability -> provider package names, in package-name order
    this.capabilities = new Map();
    for (const name of [...this.kinds.package.keys()].sort()) {
      for (const cap of providesOf(this.kinds.package.get(name).value)) {
        if (!this.capabilities.has(cap)) this.capabilities.set(cap, []);
        this.capabilities.get(cap).push(name);
      }
    }
    const defaults = this.single.defaults?.value;
    this.defaultCapabilities = new Set(Object.keys(defaults?.providers ?? {}));
  }

  get facts() { return this.single.facts?.value.facts ?? {}; }
  get devices() { return this.single.devices?.value.devices ?? {}; }
  get defaults() { return this.single.defaults?.value; }
  pkg(name) { return this.kinds.package.get(name)?.value; }
  isCapability(name) { return this.capabilities.has(name) || this.defaultCapabilities.has(name); }
  isReference(name) { return this.kinds.package.has(name) || this.isCapability(name); }

  /** A kind's document by name or alias. */
  find(kind, nameOrAlias) {
    return this.kinds[kind].get(nameOrAlias) ?? this.aliases[kind].get(nameOrAlias);
  }
}
