# Architecture

## Boundary between `eclogite` and builders

`eclogite` is both the configuration compiler and the build executor. Builders
are small shell programs that know how to build one style of package and
nothing about the graph.

`eclogite` owns:

- strict parsing of catalog and system JSONC;
- type, name, and schema validation;
- [resolution](resolution.md): target, capability choices, dependency
  closure, conditional dependencies, compilers and config;
- compatibility checks, variants and parameters;
- cycle detection over build and link edges, and topological order;
- input hashing and lock generation;
- scheduling: starting the builder VM, running ready packages, checking the
  store before each one, and publishing outputs;
- image composition, generated services, `/etc/fstab` and `/etc/hostname`,
  config merged into configurable dependencies (kernel options from packages
  and machine devices), and boot tests;
- explanations of what will be built and why.

A builder (`builders/<name>/build.sh`) owns one build style: it runs the
`configure`, `build` and `install` steps for one package, calls the package's
hooks, and writes a package tree. It never reads the catalog or another
package's metadata.

GNU Make is not an execution layer. Its model is "rebuild when a file is newer";
Eclogite's is "the input key is a hash; reuse it if it is in the store". With
builds running one at a time in a VM and the graph, keys and order already in
the lock, a generated `plan.mk` would only add a second language to debug.
Packages may still use Make inside their own builds.

The tool will be isolated under `tools/eclogite/` as a standalone C17 project.
It will be built and tested with `make -C tools/eclogite check` without guest
sources or catalog dependencies. Tagged releases will publish native Linux and
macOS binaries; building from source remains the bootstrap path and requires
only a C17 compiler, Make, and a POSIX shell.

Release artifacts contain one host executable. Catalog Git repositories,
package source repositories, and immutable build layers live in the per-user
shared cache described in [Installation, remote catalogs, and shared storage](storage.md).
They are not embedded in the executable and are not duplicated per project.

## Core model

The following nouns are intentionally different:

- **Package**: a versioned buildable unit with sources, typed dependencies,
  builder data, owned patches/hooks/files/config, services, tests and kernel
  option requirements, and one output. Linux-libre, runit and `base-files`
  are packages too.
- **Capability**: a name such as `kernel`, `init`, `libc`, `sh` or
  `core-utils` that packages declare in `provides`, optionally with the files
  they own for it. Dependencies may name a capability or ordered alternatives;
  `providers` overrides, the explicit selection, the distribution defaults
  and `compatible` constraints decide the provider, without search.
- **Meta-package**: a package with only run dependencies, used as a named
  selection of other packages. It never has source, build steps or output.
- **Step**: an operation within one package build: `prepare`, `patch`,
  `configure`, `build`, or `install`.
- **Platform**: hardware target: architecture, triplet CPU and ISA policy.
- **ABI**: operating system and C library, the triplet suffix, and the
  toolchain that builds for it. Chosen by the system or software, not the
  hardware; fixed at compile time.
- **Defaults**: the distribution's ABI and provider per capability, used only
  where a system selects nothing.
- **Machine profile**: hardware and runtime contract: platform, CPU count,
  memory, boot method, firmware, devices, console, and VM backend.
  Plain QEMU and UTM are distinct runtime contracts even when they expose the
  same QEMU machine model. A profile never selects guest packages.
- **Software profile**: target contents and construction policy: packages,
  root filesystem, image, and volumes. It never sets a platform, kernel, CPU
  count, memory, or hypervisor devices, so one profile serves every
  compatible machine.
- **Toolchain**: the `linux-libre-vm` builder image: cross toolchains and
  sysroots per target triplet, the compilers (gcc, and clang once shipped),
  and the tool manifest. Eclogite never builds a toolchain; it is a release
  artifact of `linux-libre-vm`, pinned by hash, and that identity, with each
  package's compiler, is part of every dependent key.
- **Target package**: every file in a guest comes from an Eclogite package
  built from source, including glibc, the GCC runtime libraries and language
  runtimes such as Python and Node.js. Nothing is copied from the builder
  image or a toolchain sysroot into a guest; see [Build model](build-model.md).
- **Build runtime**: where builders execute. There is exactly one: a VM booted
  from the `linux-libre-vm` dev image for the host's architecture. It is not a
  package. `linux-libre-vm` publishes a tool manifest with it, and packages
  declare the builder tools they use as `builder:<tool>`.
- **System**: the graph root that composes exactly one machine profile and one
  software profile.

Self-hosting — building the compiler, binutils and libc from source and then
rebuilding the system with them — is out of scope. `linux-libre-vm` provides
that capability, including cross toolchains for every Eclogite target; Eclogite
consumes them as inputs, as the builder only. Everything installed in a guest
is built by Eclogite from source ([Build model](build-model.md)).

## Planned data flow

```text
catalog/**/* + builders
                    |
                    | eclogite validate / lock / plan
                    v
       state/<system>/system.lock.json
       state/<system>/explain/*
                    |
                    | eclogite build (builders/<name>/build.sh in the builder VM)
                    v
 out/work -> out/store/<input-key> -> out/roots -> out/images
```

The lock is the only build input after resolution. Catalog edits that have not
been locked cause a hard error rather than silently changing a build.

## Repository structure

```text
catalog/
  packages/<name>/
    package.jsonc  one buildable unit or meta-package
    patches/       package-owned source changes
    hooks/         package-specific step implementations
    tests/         checks run in the booted guest
    files/         package-owned installed files
    config/        structured fragments, including kernel configuration
  machines/       CPU, memory, boot, device, and runtime profiles
  software/       package, kernel, rootfs, image, and volume profiles
  platforms/      hardware: architecture, triplet CPU, ISA
  abis/           operating system, libc, triplet suffix, toolchain
  toolchains/     the linux-libre-vm builder image and tool manifest
  systems/        machine + software compositions
  facts.jsonc     fact vocabulary for compatible and variants
  defaults.jsonc  default ABI and provider per capability
  devices.jsonc   device models and the kernel options their drivers require
schemas/          root config schema, per-kind and per-builder schemas
builders/
  lib.sh          hermetic environment and standard step contract
  configure/      ./configure, make, make install
  make/           make, make install
  cmake/          cmake and ninja
  linux-kernel/   config merge, verification, and kernel output
  files/          files, symlinks and generated services only
  source-tree/    prepared source as a build input
  npm-workspace/  offline npm workspace build
tools/eclogite/
  Makefile         standalone build and install entry point
  include/         public C interfaces
  src/
    cli/           command dispatch and presentation
    json/          JSONC lexer, parser, source locations, AST
    model/         typed catalog objects and validation
    resolve/       closure, compatibility, variants, parameters
    plan/          keys, lock writer, explanations
    build/         scheduler, builder VM, store, image, tests
  tests/           unit tests and parser fixtures
tools/vm.sh/
  vm.sh            portable template copied into every generated VM
  tests/           runner contract tests using a mock runtime driver
examples/           strict-JSON system inputs using catalog aliases or links
site/               website shell and catalog presentation
```

Directories are added when their first real file lands; this document, rather
than placeholder files, is the structure contract.

## Builder contract

Every builder receives explicit paths and identity through a generated
environment:

- immutable unpacked source directory;
- writable work directory;
- build-host tools directory;
- target sysroot;
- private destination directory;
- resolved arguments and environment;
- `SOURCE_DATE_EPOCH`, locale, timezone, and prefix-map flags.

A builder must not read package catalog files, discover undeclared host
libraries, access the network, or install directly into a shared root. It emits
a package tree and manifest. Image assembly composes package trees later.

Package-specific exceptions use a named hook under that package's `hooks/`
directory. The hook path and content hash become part of the package key. Inline
shell inside JSONC is not allowed.

## Builder handoff

For every resolved graph node, `eclogite` prepares a private intermediate unit
directory rather than constructing an opaque shell command. It contains:

- `unit.json`, the strict-JSON resolved package, platform, source, arguments,
  parameters, and expected-output description;
- `build.env`, a generated and safely quoted environment for the selected
  generic builder;
- `dependencies.list`, immutable store paths in deterministic order;
- `result.json`, `build.log`, and an output manifest after execution.

The package selects one of the generic builders (`configure`, `make`, `cmake`,
`linux-kernel`, `files`, `source-tree`, `npm-workspace`), which calls the package's
hooks at the named steps. `eclogite` schedules units and calls the builders. A successful unit is published as an immutable cache layer only
after declared outputs and manifests match. Cache hits revalidate their key and
manifest; repeated builds compare output hashes so nondeterminism is reported
rather than silently cached.

## System graph root

A resolved build is the graph root and has two explicit inputs. The machine
branch resolves the platform, resources, boot, devices, and runtime. The
software branch, or the system file, selects the ABI; platform and ABI make the
target triplet and select the toolchain. The software branch then resolves the
package closure for that target, including one `kernel` and one `init`
provider, and every package's `compatible`
constraints must hold before a plan can be emitted.

Runtime is locked rather than auto-switched after publication. The
`qemu-virt-arm64` and `utm-virt-arm64` profiles expose compatible ARM64 guest
hardware, but UTM additionally requires macOS on Apple Silicon, UTM 5 or newer,
HVF, bundle registration, and disk import. Selecting UTM therefore changes the
system lock and deployment bundle, while the compatible software and package
layers remain reusable.

```text
system
  |-- machine profile
  |   |-- platform
  |   |-- vCPU + memory
  |   `-- boot + devices + runtime
  `-- software profile
      |-- abi (or the system's, or the default)  -> triplet, toolchain
      `-- package closure for platform x abi
          |-- kernel provider  -> boot kernel     (linux-libre: default)
          |-- init provider    -> rootfs          (runit: default)
          `-- reference-system, capabilities resolved to providers -> rootfs
```

Linux-libre, mainline Linux, PREEMPT_RT and custom kernels participate as
ordinary package nodes that provide `kernel`, in dependency closure,
ordering, hashing, provenance, and rebuild explanations. Their builder is
specialized, but their graph status is not. A BSD target is an ABI with
`"os": "freebsd"`: its own toolchain, and default alternatives that include
BSD kernel, libc and init packages. The same software profile resolves
against it because packages name capabilities, not providers.

This boundary also controls reuse. Changing only memory produces a different
system lock and runtime bundle, but does not change package layer keys, unless
a package reads that value through a parameter. Changing the platform, kernel,
or package closure changes the corresponding build keys. Hidden CLI or `vm.sh` overrides may not cross this boundary.

## Immutable guest

The host-side `eclogite` program is never installed into the guest. The guest
contains no package manager, compiler metadata database, or command that mutates
the base system. Image construction happens entirely on the host.

The base root filesystem is mounted read-only. Runtime-writable locations such
as `/run` and `/tmp` use tmpfs; persistent application data, if a system needs
it, must use an explicitly declared separate volume. Updating the machine means
changing JSONC intent, regenerating its strict-JSON lock, rebuilding the image,
testing it, and replacing the old image atomically.

A package manifest and system provenance report may be included for auditing,
but they are passive data and do not imply an in-guest package manager.

## Generated state and cache

- `state/` contains locks, plans, and explanations. It is reproducible and
  disposable but separate from large output.
- `out/work/` contains temporary build directories.
- `out/store/<key>/` contains immutable package outputs plus their manifests and
  key documents.
- `out/roots/<system>/` contains composed root filesystems.
- `out/images/<system>/` contains bootable images and kernels.

The first cache is input-addressed. Output hashes are recorded to detect
non-reproducibility; content-addressed early cutoff can be considered later.

## Build runtime, toolchains and remote layers

Layers are normally built once, by GitHub Actions, and published to a remote
layer store keyed by input key: GitHub Container Registry (GHCR) first, an
S3-compatible store later. `eclogite fetch` pulls the layers that exist for a
lock into the shared per-user cache, verified by immutable digest, key document,
manifest, content hashes, and signed build provenance; `build` stays offline
and builds only what is still missing.

Every build — on a macOS or Linux workstation, `arm64` or `x86_64`, and in CI —
runs inside the same kind of build runtime: `eclogite` starts a VM from the
`linux-libre-vm` dev image for the host's architecture (UTM/HVF on macOS,
QEMU/KVM on Linux) and runs the builders there. The host's own compilers and
libraries are never used, so local and CI builds see the same environment.

Eclogite supports many target architectures, so builds are cross builds.
`linux-libre-vm` publishes, per host architecture, the dev image (host tools:
make, bison, flex, perl, …) and one toolchain artifact per target (binutils,
GCC and the target glibc sysroot). Eclogite mounts the selected artifact
read-only at `/opt/eclogite/toolchains/<triplet>` and constructs the builder
`PATH` from that location. Any convenience copies in the dev image's
`/opt/cross` are ignored. Builder tools such as Python and Node.js run only
during builds; the guest gets its own copies from target packages built from
the same revisions ([Build model](build-model.md)). The dev image and mounted artifact are pinned by
SHA-256, and their identities enter the keys:

```text
layer key ⊇ dev image identity (host arch) + toolchain identity (host arch × target)
```

When CI and a local build run on the same host architecture, their keys match
and the local build pulls. Version 1 does not share layers across build-host
architectures: an `x86_64`-hosted and an `arm64`-hosted toolchain have different
artifact hashes and therefore different keys. Cross-host comparison remains a
reproducibility check, not a cache-identity shortcut. See [CI](ci.md) and
[storage](storage.md).

## Runtime bundle boundary

The final construction step materializes a relocatable VM directory containing
the immutable image outputs, a strict-JSON runtime manifest, a generated driver,
and `vm.sh`. `eclogite` does not need to be present to run that directory.
`vm.sh` validates the bundle and dispatches lifecycle commands to the generated
driver; it does not know how to build packages or modify the guest image. The
full layout and lifecycle contract are defined in [Generated VM bundle](vm-bundle.md).

For UTM, `runtime/driver.sh` owns AppleScript configuration and `utmctl`
lifecycle operations. It may create and register a `.utm` instance beneath
`runtime/state/`, importing the immutable root image as a private disk copy.
The public `vm.sh` interface remains the same as for QEMU.

## Website output

Generating the site from the catalog is after version 1
([Migration](migration.md#after-version-1)); until then `site/` is a static
prototype with its own data file.

`site/` contains only maintained HTML, CSS, and dependency-free browser
JavaScript. Canonical engineering documentation remains in `docs/`.
`eclogite site` parses JSONC and strict JSON, validates versioned JSON Schema,
resolves the catalog, copies maintained assets, renders documentation and object
pages, and emits `catalog.json`, `graph.json`, and `search-index.json` into the
generated `_site/` tree. Browser code only renders that validated generated
data; it does not parse raw package definitions. `_site/` is final static output
and is never committed.
