# Configuration formats: v0.1 decision record

Status: **draft, 2026-10-26.** Nothing here is final until each decision
below is agreed. Once a decision is agreed, it is applied to `schemas/`,
`catalog/`, `examples/`, `docs/configuration.md`, `docs/resolution.md` and the
golden files in `tests/reference/golden/`.

## Inventory

| Schema id | File | Required | Optional |
|---|---|---|---|
| `eclogite.config/v0.1` | `eclogite.schema.json` | schema, system, machines, software, platforms, abis, toolchains, packages, facts, devices, defaults | none |
| `eclogite.system/v0.1` | `system.schema.json` | schema, name, machine, software | abi, compiler, providers |
| `eclogite.software/v0.1` | `software.schema.json` | schema, name, packages, root, image | aliases, abi, compiler, providers, volumes, evidence |
| `eclogite.machine/v0.1` | `machine.schema.json`: complete or derived (`extends`) | complete: schema, name, platform, resources, runtime, boot, devices; derived: schema, name, extends | aliases, status, gpio, limitations, references |
| `eclogite.platform/v0.1` | `platform.schema.json` | schema, name, architecture, triplet_cpu, cpu, kernel_architecture | none |
| `eclogite.abi/v0.1` | `abi.schema.json` | schema, name, os, libc, triplet, toolchain | none |
| `eclogite.toolchain/v0.1` | `toolchain.schema.json` | schema, name, provider, release, builder, targets, compilers, tools | per-entry `status: planned` |
| `eclogite.package/v0.1` | `package.schema.json`: buildable or meta | buildable: schema, name, version, source, builder; meta: schema, name, dependencies.run | buildable: fetch, matches_builder_tool, compatible, provides, configurable, patches, parameters, dependencies, services, mounts, tests, arguments, variants; meta: provides |
| `eclogite.facts/v0.1` | `facts.schema.json` | schema, facts | none |
| `eclogite.devices/v0.1` | `devices.schema.json` | schema, devices | none |
| `eclogite.defaults/v0.1` | `defaults.schema.json` | schema, abi, compiler, providers (with `kernel` and `init`) | none |
| none: builder arguments | `builders/*.schema.json` | none (variants are partial) | per builder |
| `eclogite.host/v0.1` | **no schema**; only in `docs/storage.md` | not defined | not defined |
| lock (`system.lock.json`) | **no schema id** | not defined | not defined |

## Open decisions

Each item gives its options, with the recommendation listed first.

### A. Scope and versioning
1. **`eclogite.host/v0.1`.** Options: (a) add a schema for it now; (b) list it as
   outside v0.1.
2. **Lock file.** Options: (a) reserve `eclogite.lock/v0.1` and document that it
   is generated output, defined with the lock and plan commands; (b) define it now.
3. **Builder argument versioning.** Options: (a) version builder arguments
   with the package schema id (a builder change bumps `eclogite.package`);
   (b) give each builder its own id.
4. **`evidence` in software.** the plan puts it after v0.1, but the
   schema and every catalog software profile already have it. Options:
   (a) remove it from v0.1 and reserve the name; (b) keep it with only
   `warn-untested` working.

### B. Inconsistencies (fixes that need no design choice)
5. `docs/configuration.md` says "There are six" builders, but its table lists
   seven.
6. The cmake builder names its targets `targets`; configure and make use
   `make_targets`. cmake also has no `install_targets`. Rename to `build_targets`
   and `install_targets` everywhere, or keep `make_targets` and give cmake
   both names.
7. The `reference` description in `common.schema.json` says "the platform's
   default"; it should say the defaults document.
8. The `docs/build-model.md` status line says "Not yet implemented or
   schema-validated", which is out of date.
9. Prose says linux-libre-vm builds five triplets (and Drive notes say seven);
   the toolchain document lists three plus three planned musl targets. Decide
   whether to list every published triplet.
10. Entries with `config` or `when` use the key `package` even when the value
    is a capability (`{ "package": "linux" }`). Options: (a) keep `package`
    and document that it means "package or capability"; (b) rename it to
    `ref`.

### C. Semantics to settle before freezing
11. **Order in JSON objects.** `toolchain.compilers` relies on key order for
    fallback, and most JSON tools don't preserve object order. Options:
    (a) make it an array of `{ "name", "tools" }`; (b) keep the object and
    require the C parser to keep order.
12. **The compiler set is fixed in two places**: the `common` enum
    (gcc, clang) and the toolchain's `compilers`. Options: (a) keep the enum
    as the closed v0.1 set; (b) use names, checked against the toolchain.
13. **Magic strings.** These string values double as markers: `"release":
    "unreleased"`, `tools.*.source: "tarball"`, `output_sha256: "pending"`,
    `toolchain.provider` fixed to `"linux-libre-vm"`, and
    `firmware_policy: "unresolved"`. Decide whether each is kept as-is,
    replaced by a `status` field, or removed.
14. **Source types.** Only `git` and `none` exist. linux-libre uses
    `git://`, which is unauthenticated, and the toolchain mentions tarballs.
    Options: (a) git-only for v0.1, `https://` required, `git://` allowed only
    with a noted reason; (b) add `tarball` with `sha256`.
15. **`fetch.output_sha256` keys** are platform names. Theia's output
    depends on the target architecture, and its build needs host arch equal
    to target arch. Options: (a) key by target triplet; (b) keep platform
    names.
16. **`configurable.option.requires`** applies "whenever this one is not
    'n'", which is Kconfig semantics inside a generic format. Options:
    (a) make that rule part of `format: kconfig` only; (b) generalize it.
17. **`kernel_architecture` on the platform** is Linux-specific, but the
    platform is meant to be OS-neutral (FreeBSD). Options: (a) move it into
    the `linux-kernel` builder, derived from `arch`; (b) keep it.
18. **Metadata fields.** Packages have no `description`, `license` or
    `homepage`, and the site keeps its own copy of that data. Options:
    (a) add optional `description` and `license` (SPDX) to v0.1; (b) leave it
    for later.
19. **Aliases.** Machines and software have them; systems don't. Confirm
    that this is intended.
20. **Physical boards and Raspberry Pi fields** (`gpio`,
    `sd-card-firmware`, `firmware_policy`) are profile-only until after v0.1.
    Options: (a) keep them, marked unstable in v0.1; (b) remove them and
    reserve the names.

## Decisions

None agreed yet.
