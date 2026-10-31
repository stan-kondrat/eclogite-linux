# Schemas

JSON Schema (draft 2020-12) for every Eclogite configuration document. They
give editors completion and documentation; the C host tool remains the
authoritative validator and also checks what a schema cannot, such as
whether a referenced name exists.

## Source of truth

These schemas are the only definition of the formats. The website's
TypeScript types in [`site/types/generated/schema/`](../site/types/) are
generated from them and never edited:

```sh
cd site/types
npm install
npm run types   # rewrite generated/: schema types, catalog, examples
npm run check   # fail on stale or invalid input; type-check and validate the examples
```

[`site/types/generate.mjs`](../site/types/generate.mjs) compiles every schema
with Ajv in strict mode and emits one exported type per schema root and per
`$defs` entry that has a `title`. `tsType` gives the TypeScript type where
JSON Schema cannot say it, such as the template literal `/${string}` of a
guest path. [`lock.schema.json`](lock.schema.json) describes the compiled
system (`eclogite.lock/v0.1`) and generates `generated/schema/compiled.ts`;
every other schema generates `generated/schema/input.ts`.

## One root, components by `$ref`

[`eclogite.schema.json`](eclogite.schema.json) describes one complete
configuration (`eclogite.config/v0.1`): a system and every catalog object it may
refer to. Each part is a `$ref` to a component schema:

```text
eclogite.schema.json             eclogite.config/v0.1
├── system        → system.schema.json        eclogite.system/v0.1
├── machines[]    → machine.schema.json       eclogite.machine/v0.1
│                     oneOf: complete | derived (extends another machine)
├── software[]    → software.schema.json      eclogite.software/v0.1
├── platforms[]   → platform.schema.json      eclogite.platform/v0.1   hardware
├── abis[]        → abi.schema.json           eclogite.abi/v0.1        OS + libc
├── toolchains[]  → toolchain.schema.json     eclogite.toolchain/v0.1
├── packages[]    → package.schema.json       eclogite.package/v0.1
│                     oneOf: buildable  source, builder, arguments, services, tests, ...
│                            meta       dependencies.run only
│                     arguments → builders/<builder>.schema.json
├── facts         → facts.schema.json         eclogite.facts/v0.1
├── devices       → devices.schema.json       eclogite.devices/v0.1
└── defaults      → defaults.schema.json      eclogite.defaults/v0.1

common.schema.json            shared $defs: names, hashes, paths, fact predicates
builders/common.schema.json   arguments every builder accepts: hooks, environment,
                              files, symlinks, remove, strip
builders/<builder>.schema.json  configure, make, cmake, linux-kernel, files, source-tree,
                              npm-workspace
```

The combined configuration is the concatenation of authored documents: every
array entry is exactly what a catalog file holds on its own, including its
`schema` field; `facts`, `devices` and `defaults` are `catalog/facts.jsonc`,
`catalog/devices.jsonc` and `catalog/defaults.jsonc`. The same component
schema therefore validates `catalog/packages/theia/package.jsonc` alone and
the `theia` entry of `packages` in a combined file.

```jsonc
{
  "schema": "eclogite.config/v0.1",
  "system": { "schema": "eclogite.system/v0.1", "name": "utm-arm64-theia",
              "machine": "utm-virt-arm64-8g", "software": "theia" },
  "machines": [ { "schema": "eclogite.machine/v0.1", "name": "utm-virt-arm64-8g", ... } ],
  "software": [ { "schema": "eclogite.software/v0.1", "name": "theia", ... } ],
  "packages": [ { "schema": "eclogite.package/v0.1", "name": "theia", ... }, ... ],
  "facts": { "schema": "eclogite.facts/v0.1", "facts": { ... } },
  ...
}
```

A meta-package is not a separate kind: it is a package whose only field
besides `schema` and `name` is `dependencies.run`. Buildable packages and
meta-packages share one `packages` array, one namespace and one reference
syntax, the plain name.

Components refer to each other by name (`"software": "theia"`,
`"run": ["nodejs"]`, `"packages": ["ide"]`, `"extends": "utm-virt-arm64"`),
never by JSON Pointer. Resolving names, checking that they exist and are
unique, merging `extends`, following dependencies and evaluating `compatible`
predicates is the host tool's job.

## What the schemas enforce

- the strict profile from [configuration](../docs/configuration.md): unknown
  keys are rejected, `null` and floating-point numbers are not accepted;
- the `schema` string of every document, so a component in the wrong array
  is rejected;
- the two package forms: a buildable package needs `source` and `builder`; a
  meta-package may not have them and needs a non-empty `dependencies.run`;
- builder arguments: the `builder` value selects the arguments schema, for
  `arguments` and for every variant's arguments, so an argument the builder
  does not know is rejected;
- services, mounts, tests and parameters: `run` argument
  vectors, absolute mount points, `CONFIG_*` names, upper-case parameter
  names mapped to JSON Pointers;
- conditional dependencies (`{ "package", "when" }`) only in `run` lists, and
  ordered alternatives (`{ "first": [...] }`, at least two) in any list;
- `config` on dependency entries, and device `requires` keyed by capability;
- `configurable` on providers: the shape of each option definition (`values`,
  `default`, optional `requires` and `description`). The definitions live in
  the provider's own `package.jsonc`; there is no schema file per package;
- `provides` as a list, or a map from capability to the symlinks, files and
  services the provider owns for it;
- toolchain targets as triplets, compilers and tools, with `planned` status;
  `abi`, `compiler` and `providers` on software and system files;
- the two machine forms: a complete machine, or one that `extends` another
  and overrides only resources, devices, limitations, references or status;
- name syntax, `builder:<tool>` references (only in `dependencies.build`),
  40-hex Git revisions, SHA-256 digests;
- backend-specific shapes: `runtime` is QEMU, UTM or a physical board, and
  `boot` is direct-kernel or SD-card firmware, each with its own fields;
- fact predicates in `compatible` and `variants`: exactly one of `all`,
  `any`, `not` or a fact name, with one operator (`eq`, `ne`, `ge`, `gt`,
  `le`, `lt`, `in`, `has`, `has_any`).

Not expressible in JSON Schema, and left to `eclogite`: that names exist and
are unique, that `hooks/<name>.sh`, `tests/<name>.sh` and `files` sources exist,
that a merged `extends` machine is complete, that parameter pointers
resolve in the selected system, that each machine device's model is in
`devices.jsonc` with the same kind, that capability names do not collide with
package names, the one-kernel, one-init rule, and that every config a
dependency, device or software profile requires is an option the chosen
provider declares, with an allowed value, its `requires` implied without
conflict.

## Editor setup

JSONC files select their schema by kind. For VS Code, map catalog
directories in `.vscode/settings.json`:

```json
"json.schemas": [
  { "fileMatch": ["catalog/packages/*/package.jsonc"], "url": "./schemas/package.schema.json" },
  { "fileMatch": ["catalog/machines/*.jsonc"], "url": "./schemas/machine.schema.json" },
  { "fileMatch": ["catalog/software/*.jsonc"], "url": "./schemas/software.schema.json" },
  { "fileMatch": ["catalog/platforms/*.jsonc"], "url": "./schemas/platform.schema.json" },
  { "fileMatch": ["catalog/toolchains/*.jsonc"], "url": "./schemas/toolchain.schema.json" },
  { "fileMatch": ["catalog/facts.jsonc"], "url": "./schemas/facts.schema.json" },
  { "fileMatch": ["catalog/devices.jsonc"], "url": "./schemas/devices.schema.json" },
  { "fileMatch": ["catalog/defaults.jsonc"], "url": "./schemas/defaults.schema.json" },
  { "fileMatch": ["catalog/abis/*.jsonc"], "url": "./schemas/abi.schema.json" },
  { "fileMatch": ["catalog/systems/*.jsonc", "examples/*.json"], "url": "./schemas/system.schema.json" }
]
```
