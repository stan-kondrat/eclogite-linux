# Build model: builder image, target packages, fetch and runtime delivery

Status: design decision, 2026-10-06. Not yet implemented or schema-validated.

This document answers four questions that every package raises:

1. which programs may run while a package builds;
2. where every file in the guest comes from;
3. how network-dependent sources (npm, Cargo, Go modules) become locked inputs;
4. how a package's runtime needs reach the guest.

The worked example is Eclipse Theia, which already runs on the `linux-libre-vm`
arm64 image (`linux-libre-vm/vm_tmp/theia-vm`) but was built by hand.

## The rule

**`linux-libre-vm` is only the builder. Eclogite builds every file that ends up
in the guest, from source.**

| | Provided by | Examples |
|---|---|---|
| Build side: programs that run during builds | `linux-libre-vm` builder image | GCC, binutils, cross toolchains, make, perl, Python, Node.js |
| Target side: every file in a guest image | Eclogite packages | Linux-libre, glibc, `libstdc++`, coreutils, runit, Python, Node.js, Theia |

Nothing is copied from the builder image or from a toolchain sysroot into a
guest. In particular:

- the reference build's practice of copying glibc and other shared libraries
  from the toolchain sysroot ends; glibc and the GCC runtime libraries become
  target packages;
- the hand-built theia-vm's Debian `libstdc++` and the upstream Node.js binary
  are replaced by packages built from source.

## Build side: the builder image

The build runtime is a VM booted from the `linux-libre-vm` dev image for the
build host architecture, with the cross toolchain artifact for the target
mounted at `/opt/eclogite/toolchains/<triplet>` (see
[Architecture](architecture.md#build-runtime-toolchains-and-remote-layers)).
Together they are the **builder image**. Its identity is already part of every
package key.

`linux-libre-vm` publishes, with each builder image release, a **tool
manifest**: every program it provides, its version, and the exact source
revision it was built from. For the current `arm64` dev image:

| Tool | Version | Source revision |
|---|---|---|
| gcc | 15.3.0 | `4db0e8df15bef836558857c291c323add11d035c` |
| binutils | | `6ce87bbc521cf46eaee9a1f7ef61cee2cdfb3e32` |
| glibc (sysroot) | 2.43 | `f762ccf84f122d1354f103a151cba8bde797d521` |
| perl | | `e634cc838fb1785dfafb5d13b52807ea16b5c52c` |
| python3 | 3.14.8 | `8e6e75d9102e39bed2a2b279203a396741180f12` |
| node | 26.10.0 | `151845ab90d3926ceb36eedf1eade09619c3adc9` |
| bc | | `70c51d95e02d20fc3fc82791dc3f1aa0e9d47f0d` |
| make, m4, bison, flex, zlib, bzip2 | | pinned release tarballs |

Packages declare which builder tools they use, with a `builder:` prefix:

```jsonc
"dependencies": {
  "build": ["builder:node", "builder:python3", "builder:gcc"],
  "link": ["glibc"],
  "run": ["nodejs", "gcc-runtime"]
}
```

Resolution fails if the builder image's tool manifest does not provide a
declared tool. The declaration does not add to the key: the builder image's
identity is already in every key. Its purpose is to make the dependency visible
and checkable, and to let a builder construct a `PATH` that contains only the
declared tools.

When a build needs a tool the builder image lacks (Rust, Go, Meson), the
preferred fix is to add it to `linux-libre-vm`. Eclogite does not build its own
build-side tools in version 1.

## Target side: everything from source

### Base runtime

Two packages, which every dynamically linked program in the guest depends on,
are built from the **same source revisions** as the builder image's cross
toolchain:

| Package | Source | Why the revision must match |
|---|---|---|
| `glibc` | glibc git, the toolchain sysroot's revision | programs are linked against the sysroot's glibc and require its symbol versions at runtime |
| `gcc-runtime` | GCC git, the toolchain compiler's revision; builds only `libgcc_s`, `libstdc++`, `libatomic` | C++ programs require the `GLIBCXX_*` / `GCC_*` symbol versions of the compiler that linked them |

The lock verifies both revisions against the tool manifest. A mismatch is a
resolution error, not a warning.

### Language runtimes with native extensions

A language runtime in the guest and its build-side counterpart must also come
from the same revision when the target package builds native extensions with
the build-side tool:

- `nodejs` (target) and `builder:node`: addons built by `node-gyp` must match
  the guest's `NODE_MODULE_VERSION`;
- `python3` (target) and `builder:python3`: cross-compiling CPython requires a
  build-side Python of the same version, and extension modules must match the
  guest's ABI tag.

A target package declares the pairing with `matches_builder_tool`; the lock
fails unless the named tool in the toolchain's `tools` list
([catalog/toolchains/linux-libre-vm.jsonc](../catalog/toolchains/linux-libre-vm.jsonc)) has the
package's source revision. See
[catalog/packages/nodejs/package.jsonc](../catalog/packages/nodejs/package.jsonc):

```jsonc
"source": {
  "type": "git",
  "url": "https://github.com/nodejs/node.git",
  "revision": "151845ab90d3926ceb36eedf1eade09619c3adc9"
},
// the lock fails unless builder:node was built from this same revision
"matches_builder_tool": "node",
```

`glibc` and `gcc-runtime` use the same field against the toolchain's `glibc`
and `gcc` entries.

Updating Node.js is therefore a coordinated change: a new `linux-libre-vm`
builder image release first, then the Eclogite package revision.

### Cross builds

Every target package is built with the builder image's cross toolchain for the
target triplet, also when the target matches the build host architecture.
`linux-libre-vm` provides cross toolchains for `aarch64-linux-gnu`,
`x86_64-linux-gnu`, `armv6-linux-gnueabihf`, `armv7-linux-gnueabihf` and
`riscv64-linux-gnu` on both `arm64` and `x86_64` hosts.

Runtimes whose build runs some of its own programs on the build host get those
from the builder image's native side:

| Package | Host side (runs during the build) | Target side |
|---|---|---|
| `nodejs` | native GCC as `CC_host`/`CXX_host` for V8's `mksnapshot`, `torque` and other generators; `configure --cross-compiling --dest-cpu=<arch>` | cross GCC as `CC`/`CXX` |
| `python3` | `builder:python3` as `--with-build-python`, which is why the revisions must match | cross GCC, `--host=<triplet>` |
| `glibc`, `gcc-runtime` | native GCC for build-time generators | cross GCC |

Resolution checks the builder image supports the target before planning:

- the tool manifest must list a cross toolchain for the target triplet;
- the package's `target` constraint must hold for the target platform (see
  [Compatibility](#compatibility-facts-constraints-and-evidence)), so that an
  unsupported selection fails resolution rather than at build time.

## Compatibility: facts, constraints and evidence

A package states where it can be built and run with **constraints** over typed
**facts**. CI adds **evidence**: what was actually built and tested where.
Resolution evaluates all three before planning, and the same mechanism
replaces the separate device, memory and per-platform argument rules.

### Facts

A fact is a typed value that a platform, a machine or the builder image
provides. The vocabulary is one catalog document,
[catalog/facts.jsonc](../catalog/facts.jsonc), so new facts need no schema
change. A fact does not store values; it says where to read them in each
scope's documents, so existing fields such as a machine's
`resources.memory_mib` are not duplicated:

```jsonc
// an entry of "facts" in catalog/facts.jsonc
"isa": {
  "description": "Minimum instruction set level the target platform guarantees.",
  "type": "ordered",
  // values are ordered within one architecture family
  "order_by": "arch",
  "order": {
    "arm": ["armv5te", "armv6", "armv6k", "armv6zk", "armv7-a", "armv8-a"],
    "aarch64": ["armv8-a", "armv8.2-a", "armv9-a"],
    "x86_64": ["x86-64", "x86-64-v2", "x86-64-v3", "x86-64-v4"]
  },
  // JSON Pointers into the scope's document, first present one wins
  "from": {
    "platform": ["/cpu/isa"]
  }
}
```

Fact fields:

| Field | Meaning |
|---|---|
| `type` | `string`, `ordered`, `integer`, `set` or `boolean` |
| `values` | closed vocabulary for `string` and `set` facts; other values are errors |
| `order`, `order_by` | value order for `ordered` facts, per value of another fact |
| `from` | per scope, a list of JSON Pointers tried in order; `@detected` for values measured at plan time |
| `derive` | for array sources: `{ "collect": "<key>" }` (set of a key's values) or `{ "sum": { "where": {...}, "field": "count", "missing": ... } }` (sum of a field over matching entries; `"missing": "unbounded"` for entries without it) |
| `aggregate` | per scope, for `machine` and `builder` constraints across a closure: `sum` or `max` |

| Type | Facts in the catalog | Operators |
|---|---|---|
| string | `os`, `arch`, `abi`, `libc`, `endian`, `host_arch`, `compiler` | `eq`, `ne`, `in` |
| ordered | `isa` | `eq`, `in`, `ge`, `gt`, `le`, `lt` |
| integer | `bits`, `memory_mib`, `vcpus`, `block_devices` | `eq`, `ge`, `gt`, `le`, `lt` |
| set | `cpu_features`, `devices` | `has`, `has_any` |
| boolean | `mmu` | `eq` |

| Scope | Read from | Known when |
|---|---|---|
| `target` | the machine's `eclogite.platform/v0.1` (mainly `cpu`) merged with the selected `eclogite.abi/v0.1` (`os`, `libc`) | resolving a system |
| `machine` | `eclogite.machine/v0.1` `resources` and `devices` | resolving a system |
| `builder` | `eclogite.toolchain/v0.1` `builder`, the detected build host, and the compiler selected for the package | planning a build |

Platforms describe their CPU in one object, which replaces the former free-form
`isa` string:

```jsonc
// catalog/platforms/armv6-bcm2835.jsonc
"cpu": {
  "isa": "armv6zk",
  "bits": 32,
  "endian": "little",
  "features": ["vfpv2", "hard-float", "thumb"],
  "mmu": true
}
```

### Constraints

A constraint is a predicate tree in JSON, not an expression string. That keeps
it validatable by JSON Schema, hashable through the canonical lock form, and
lets every diagnostic point at the failing clause with a JSON Pointer.

The same predicate trees select conditional run dependencies and tests by
target and machine facts ([configuration](configuration.md#conditional-run-dependencies)).

Nodes: `all`, `any`, `not`, and comparisons `{ "<fact>": { "<op>": value } }`.
A value is a literal or a reference to another fact, `{ "fact": "<name>" }`,
which lets a `build` constraint compare the builder with the target:

```jsonc
// build on a host of the target's architecture only
{ "host_arch": { "eq": { "fact": "arch" } } }
```

A package has up to three constraints, one per phase:

```jsonc
"compatible": {
  // where it can be built: builder image and builder VM facts
  "build": { ... },
  // where its output can run: platform facts
  "target": { ... },
  // what a machine running it must provide: machine facts
  "machine": { ... }
}
```

Evaluation:

- `target` is checked when a system is resolved, against the machine's
  platform;
- `machine` is checked when a system is resolved, against its machine, and
  summed across the closure for additive integer facts: two packages that each
  need `memory_mib >= 1024` need 2048 together. Facts declare whether they are
  additive (`"aggregate": "sum"`) or not (`"aggregate": "max"`);
- `build` is checked when a build is planned, against the builder;
- a missing constraint means no restriction;
- a constraint that refers to a fact the object does not provide fails
  closed, with an error naming the missing fact.

### Variants: per-platform arguments

The same predicates select arguments, which replaces per-platform argument
maps; builders never see a platform-keyed argument:

```jsonc
"variants": [
  {
    "when": { "arch": { "eq": "arm" } },
    "arguments": { "configure": ["--with-arm-float-abi=hard", "--with-arm-fpu=vfp"] }
  }
]
```

Every variant whose `when` holds is applied in order: list values are
appended, maps merged, scalar values replaced. Overlapping variants that set the same
scalar to different values are a resolution error. The applied variants are
recorded in the lock and enter the package key.

### Evidence

CI builds and tests packages on each platform and machine it covers and
publishes the results with the layers in the remote store
([storage](storage.md#remote-layer-store)). A result is keyed by the package
input key and the platform or machine, signed like layer provenance, and is
one of:

| Result | Meaning |
|---|---|
| `passed` | built and its tests passed |
| `failed` | build or tests failed; the result links the log |
| `untested` | no result for this exact key |

Constraints say what should work; evidence says what was observed. A software
profile sets the policy:

```jsonc
// eclogite.software/v0.1
"evidence": {
  "default": "warn-untested",  // or "require-passed", "ignore"
  "require-passed": ["glibc", "gcc-runtime", "nodejs"]
}
```

- `failed` is always an error, unless the package is listed in
  `"allow-failed"` with a reason, which the lock records;
- the lock records the evidence digests it relied on, so a reviewer can see
  what was tested;
- evidence never overrides a failed constraint.

### Diagnostics

A failure names the phase, the dependency chain, the failing clause, and the
fact value it was compared with:

```text
error: theia cannot run on machine utm-virt-arm64
  selected by: software theia -> ide -> theia
  catalog/packages/theia/package.jsonc /compatible/machine/memory_mib/ge
  needs memory_mib >= 2048 (closure total 2112), machine provides 256
```

### Example

```jsonc
// package nodejs
"compatible": {
  "target": {
    "any": [
      { "all": [ { "arch": { "eq": "arm" } }, { "isa": { "ge": "armv6" } },
                 { "cpu_features": { "has": "vfpv2" } } ] },
      { "arch": { "in": ["aarch64", "x86_64"] } }
    ]
  },
  "machine": { "memory_mib": { "ge": 64 } }
},
"variants": [
  { "when": { "arch": { "eq": "arm" } },
    "arguments": { "configure": ["--with-arm-float-abi=hard", "--with-arm-fpu=vfp"] } }
]

// package theia
"compatible": {
  "build": { "memory_mib": { "ge": 6144 } },
  "target": { "arch": { "in": ["aarch64", "x86_64"] } },
  "machine": { "memory_mib": { "ge": 2048 } }
}
```

These are excerpts; the full versions are in
[packages/nodejs](../catalog/packages/nodejs/package.jsonc) and
[packages/theia](../catalog/packages/theia/package.jsonc). Node.js resolves on
the Raspberry Pi Model B (ARMv6 with VFPv2). Theia fails there on both its
`target` constraint and memory. Because software profiles no longer name a
platform, the same `theia` profile resolves on any aarch64 or x86_64 machine
with enough memory. The builder VM is sized from Theia's `build`
constraint instead of a free-form argument.

## Fetch and build are separate phases

Builders never access the network ([Architecture](architecture.md)). Package
managers that resolve dependencies from a lockfile therefore need a separate
**fixed-output fetch**:

| Phase | Network | Identity | Output |
|---|---|---|---|
| fetch | allowed | declared `output_sha256`, checked after the fetch | verified, read-only source tree |
| build | none | input key: sources + builder image + builder + hooks + dependencies | package tree and manifest |

The fetch is a phase of the package that needs it, declared next to its
source, not a separate package:

```jsonc
// in eclogite.package/v0.1, package theia
"source": { "type": "git", "url": "...", "revision": "3980769c..." },
"fetch": {
  // the parts of the source that determine what is downloaded
  "inputs": ["package-lock.json", "package.json#theiaPlugins"],
  // hooks/fetch.sh: npm ci --ignore-scripts into an npm cache directory,
  // then download:plugins
  "hook": "fetch",
  // prebuilt npm packages differ per architecture: one hash per platform,
  // filled by eclogite lock --update-fetch theia
  "output_sha256": { "arm64": "pending", "x86_64": "pending" }
}
```

Rules:

- a fetch runs in the builder image with network access, a read-only copy of
  the package source, and nothing else writable except its output directory;
  it may use the package's `builder:` tools;
- the build phase reads the verified output, read-only, as `FETCH`; the
  `output_sha256` replaces the network in the package's input key, so a
  change to `inputs` that does not change the fetched tree does not rebuild;
- the output is normalized (sorted tar, fixed mtimes and owners) before
  hashing;
- a hash mismatch is a hard error. `eclogite lock` never updates an
  `output_sha256` silently; only an explicit update command does;
- the verified result is stored like any other source under
  `sources/<source-key>/` ([storage](storage.md#package-source-cache)) and is
  published to the remote layer store, so CI and other users never fetch it
  again.

Alternatives considered: one catalog entry per npm dependency (2,253 entries
for Theia, unworkable); network access during builds (not reproducible, would
require an `impure` flag that CI must refuse); and a separate fetch-only
package that names its consumer's source with `from` (a pseudo-package that
nothing installs, with a back-reference into another package).

## Runtime delivery

A package's `run` closure reaches the guest in one of two ways, selected by the
software profile:

- **root** (default): package trees are merged into the root filesystem image,
  as today;
- **volume**: a named subset of the closure is composed into a separate image
  mounted at a fixed path. This keeps the root image small and unchanged for
  large applications:

```jsonc
// in eclogite.software/v0.1
"volumes": [
  {
    "name": "theia",
    "mount": "/opt/theia",
    "packages": ["theia"],
    "format": "ext4",
    "readonly": true
  }
]
```

A volume selects files by path: the files of the listed packages below
`mount` are installed in the volume, and their other files (a runit service in
`/etc/service`, for example) go to the root image with everything else. Run
dependencies of listed packages go to the root image unless another volume
lists them. The root image keeps an empty `mount` directory as the mount
point; a listed package with no files below `mount` is an error.
Each volume needs one more block device. A virtual machine attaches one per
image, so only physical boards, which declare a block device `count`, limit
the number of volumes. Images and volumes are sized from their contents plus
free space unless `size_mib` fixes the size.

Self-contained bundles (each application carrying its own runtime copy) are not
used: they duplicate runtimes and break the revision pairing described above.

## Worked example: Theia

The catalog contains the complete example; `eclogite` does not yet implement
it.

| File | Role |
|---|---|
| [systems/utm-arm64-theia.jsonc](../catalog/systems/utm-arm64-theia.jsonc) | pairs the machine and software below |
| [machines/utm-virt-arm64-8g.jsonc](../catalog/machines/utm-virt-arm64-8g.jsonc) | extends `utm-virt-arm64` with 2 vCPUs and 8 GiB |
| [software/theia.jsonc](../catalog/software/theia.jsonc) | `reference-system` + `ide`, `/opt/theia` volume, evidence policy |
| [packages/ide](../catalog/packages/ide/package.jsonc) | meta-package: run dependency on `theia` |
| [packages/glibc](../catalog/packages/glibc/package.jsonc), [packages/gcc-runtime](../catalog/packages/gcc-runtime/package.jsonc) | base runtime, revisions matched to the toolchain |
| [packages/nodejs](../catalog/packages/nodejs/package.jsonc) | target Node.js, revision matched to `builder:node`, per-architecture variants |
| [packages/theia](../catalog/packages/theia/package.jsonc) | fixed-output fetch (one hash per platform), offline build, hooks, keytar stub, `theia` service on port 3000 with the workspace on the bundle share, `http-3000` test, inotify kernel option |
| [toolchains/linux-libre-vm.jsonc](../catalog/toolchains/linux-libre-vm.jsonc) | builder image: targets, compilers, tool manifest snapshot |

```text
builder image (linux-libre-vm): gcc 15.3.0, glibc 2.43 sysroot,
                                python3 3.14.8, node 26.10.0, ...
  ── nothing below is copied from it ──
glibc           target, revision = toolchain glibc     run: [gcc-runtime]
gcc-runtime     target, revision = toolchain gcc (libgcc_s, libstdc++, libatomic)
nodejs          target, revision = builder:node
theia           fetch: npm cache + 100 plugins, one hash per platform
                build: [builder:node, builder:python3, builder:gcc,
                        builder:make]
                run:   [nodejs, glibc, gcc-runtime, runit, host-share]
                files: /opt/theia/...; service theia; test http-3000
image
  root    reference-system (with glibc) + nodejs + gcc-runtime
          + generated /etc/service/theia
  volume  /opt/theia: theia's files below /opt/theia
```

Resolution of `utm-arm64-theia`:

- `target`: `nodejs` holds (`arch` is `aarch64`); `theia` holds (`aarch64` is
  listed);
- `machine`: closure memory is 64 (`nodejs`) + 2048 (`theia`) = 2112 MiB of
  8192; `devices` has `network` and `shared-directory`, so `reference-system`'s
  conditional `host-share` is selected; the virtual machine attaches two
  disks, one for the root image and one for the volume;
- kernel: the 9p filesystem from `host-share`, inotify from `theia`, and the
  virtio-mmio, 9p transport, PL011 and PL031 drivers from the machine's
  devices;
- `build`: `theia` raises the builder VM to 6144 MiB and must build on an
  `aarch64` host; `nodejs` needs 3072 MiB.

The same software on `raspberry-pi-model-b-256mb` fails twice: `theia`'s
`target` constraint does not list `arm`, and the closure needs more than
256 MiB. `nodejs` alone would resolve there.

What changes compared with the hand-built VM:

| Hand-built theia-vm | Under this model |
|---|---|
| `npm ci --ignore-scripts`, no compiler | still `--ignore-scripts` (keytar would fail the install), then `npm rebuild node-pty drivelist` with the builder's g++ |
| prebuilt `pty.node` copied by `run.sh`, drivelist stub | both built from source |
| `keytar` stub | kept as `files/keytar-stub.js` until `libsecret` is packaged |
| Node 24 upstream binary on the share | `nodejs` package, built from source, same revision as `builder:node` |
| Debian `libstdc++`/`libgcc_s` on the share | `gcc-runtime` package, built from source |
| `/usr/bin/env` symlink added by hand | no `/usr/bin`: builders rewrite `#!/usr/bin/env` to `/bin/env` |
| clock set from the host after each boot | PL031 RTC in the kernel config; `linux-libre`'s `clock` test |
| `setsid nohup sh run.sh` by hand | generated runit service from `theia`'s `services` |
| build steps in `shared/build.sh` | builder `npm-workspace` plus hooks in `packages/theia/hooks/` |

## Schema coverage

The [schemas](../schemas/README.md) implement this model:

| Schema | Fields from this document |
|---|---|
| `eclogite.package/v0.1` | `builder:<tool>` in `dependencies.build`, `matches_builder_tool`, `fetch` (output hash per platform), `compatible`, `variants`, `parameters`, `services`, `tests`, `configurable` and `config` on dependencies, `provides`, capability references and `first` alternatives |
| `eclogite.facts/v0.1` | the fact vocabulary, `catalog/facts.jsonc` |
| `eclogite.devices/v0.1` | device models and the config their drivers `require` of a capability, `catalog/devices.jsonc` |
| `eclogite.platform/v0.1` | hardware only: `cpu` object, `triplet_cpu` |
| `eclogite.abi/v0.1` | `os`, `libc`, triplet suffixes, `toolchain` |
| `eclogite.defaults/v0.1` | default ABI and provider per capability |
| `eclogite.software/v0.1`, `eclogite.system/v0.1` | optional `abi`, `compiler` and `providers` |
| `eclogite.software/v0.1` | `packages`, `volumes` (selected by package and path), computed image sizes, `evidence` |
| `eclogite.toolchain/v0.1` | `builder` (hosts, VM resources), `targets` by triplet, `compilers`, and `tools` (manifest snapshot), each with an optional `planned` status |
| builder arguments | `schemas/builders/<builder>.schema.json`, common `hooks`, `environment`, `files`, `symlinks`, `remove`, `strip` |

Still to define in the builder contract: `PATH` constructed from the declared
builder tools.

## Open questions

- **Fact vocabulary review.** The 13 facts, ISA orders and CPU feature names
  in `catalog/facts.jsonc` cover the three existing platforms and seven
  machines.
- **Evidence store.** After version 1: the result format, signing and CI
  matrix are not yet defined; until they exist, every result is `untested`.
- **Builder tool declarations for existing packages.** The reference packages
  do not yet list their `builder:` tools or their `glibc` link and run
  dependencies; that needs a build audit.
- **Hook variables.** Hooks use provisional names (`SRC`, `WORK`, `OUT`,
  `FETCH`, `DESTDIR`, `DEP_<name>`, `TOOLCHAIN`, `TARGET_TRIPLET`, `CC`,
  `CXX`, `CFLAGS`, `LDFLAGS`) until the builder contract fixes them.
- **Tool manifest format.** `linux-libre-vm` must publish it with each builder
  image release; its format and signing are not yet defined.
- **PATH enforcement.** A constructed `PATH` catches undeclared tools found by
  name, but not a build system that hard-codes `/usr/bin/python3`. Since the
  builder image identity is in every key, this is a correctness check rather
  than a cache-safety issue; a mount namespace can close it later.
