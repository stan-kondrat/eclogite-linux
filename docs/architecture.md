# Architecture

## Boundary between C and Make

The C program is a configuration compiler. GNU Make is an execution engine.
Neither should take over the other's job.

`eclogite` owns:

- strict parsing of catalog and system JSONC;
- type, name, and schema validation;
- meta-package expansion and dependency closure;
- stage and step validation;
- cycle detection and topological order;
- feature resolution;
- input hashing and lock generation;
- explanations and deterministic Make-plan emission.

Make owns:

- parallel scheduling of the already-resolved graph;
- incremental execution using plan targets;
- invoking generic builder entry points;
- log routing and user-facing convenience targets.

Make must not parse the catalog. The C tool emits `state/<system>/plan.mk`, and
the root Makefile includes that generated file for build targets. This keeps GNU
Make metaprogramming out of package metadata and makes `eclogite validate` useful
on any host with a C compiler.

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
  builder data, owned patches/files/config, and one or more outputs. Linux-libre
  and `base-files` are packages too.
- **Meta-package**: a named set of packages or other meta-packages. It never has
  source or build steps.
- **Step**: an operation within one package build, such as `prepare`, `patch`,
  `configure`, `compile`, `install`, or `package`.
- **Stage**: a graph context in the system pipeline: target userland, target
  kernel, and image assembly. Stages never build toolchains; see below.
- **Platform**: target architecture, ABI, libc, and ISA policy.
- **Machine profile**: hardware and runtime contract: platform compatibility,
  CPU count, memory, boot method, firmware, devices, console, and VM backend.
  Plain QEMU and UTM are distinct runtime contracts even when they expose the
  same QEMU machine model. A profile never selects guest packages.
- **Software profile**: target contents and construction policy: stages,
  packages, kernel or operating-system family, services, root filesystem,
  image format, and tests. It never sets CPU count, memory, or hypervisor
  devices.
- **Toolchain**: a compiler/binutils/libc/sysroot for one target, native or
  cross. Eclogite never builds a toolchain; toolchains are release artifacts of
  `linux-libre-vm`, pinned by hash, and that identity is part of every
  dependent key.
- **Build runtime**: where builders execute. There is exactly one: a VM booted
  from the `linux-libre-vm` dev image for the host's architecture. It is not a
  package.
- **System**: the graph root that composes exactly one machine profile and one
  software profile.

Keeping stages separate from steps prevents build and image contexts from being
encoded as fake package phases.

Self-hosting — building the compiler, binutils and libc from source and then
rebuilding the system with them — is out of scope. `linux-libre-vm` provides
that capability, including cross toolchains for every Eclogite target; Eclogite
consumes them as inputs.

## Planned data flow

```text
catalog/**/* + builders
                    |
                    | eclogite validate / lock / plan
                    v
       state/<system>/system.lock.json
       state/<system>/plan.mk
       state/<system>/explain/*
                    |
                    | make -f Makefile -f plan.mk
                    v
 out/work -> out/store/<input-key> -> out/roots -> out/images
```

The lock is the only build input after resolution. Catalog edits that have not
been locked cause a hard error rather than silently changing a build.

## Repository structure

```text
catalog/
  packages/<name>/
    package.jsonc  one buildable unit
    patches/       package-owned source changes
    hooks/         package-specific step implementations
    files/         package-owned installed files
    config/        structured fragments, including kernel configuration
  metapackages/   named selections such as base, network, and development
  machines/       CPU, memory, boot, device, and runtime profiles
  software/       kernel, package, rootfs, image, and test profiles
  stages/         build and image graph contexts
  platforms/      x86_64 and arm64 target properties
  toolchains/     external toolchain descriptions and fingerprint rules
  systems/        machine + software compositions
  schemas/        JSON Schema documents for editors and documentation
builders/
  common.mk       hermetic environment and standard step contract
  autotools.mk    generic configure/build/install implementation
  configure.mk    non-autoconf configure implementation
  make.mk         direct Make implementation
  kernel.mk       config merge, verification, and kernel output
  image.mk        root composition and filesystem image
  script.mk       constrained hook runner for tracked package hooks
tools/eclogite/
  Makefile         standalone build and install entry point
  include/         public C interfaces
  src/
    cli/           command dispatch and presentation
    json/          JSONC lexer, parser, source locations, AST
    model/         typed catalog objects and validation
    resolve/       meta-package, dependency, feature, and stage resolution
    plan/          keys, lock writer, Make emitter, explanations
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

Every builder receives explicit paths and identity through generated Make
variables:

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

- `unit.json`, the strict-JSON resolved package, stage, platform, source, and
  expected-output description;
- `build.env`, a generated and safely quoted environment for the selected
  generic builder;
- `dependencies.list`, immutable store paths in deterministic order;
- `result.json`, `build.log`, and an output manifest after execution.

The plan selects a generic adapter such as `make`, `cmake`, `autotools`,
`kernel`, or a constrained package-owned hook. Make schedules units and calls
the adapters. A successful unit is published as an immutable cache layer only
after declared outputs and manifests match. Cache hits revalidate their key and
manifest; repeated builds compare output hashes so nondeterminism is reported
rather than silently cached.

## System graph root

A resolved build is the graph root and has two explicit inputs. The machine
branch resolves resources, boot, devices, and runtime. The software branch
resolves the build stages, kernel package, and root filesystem package closure.
Both branches must resolve to the same platform compatibility key before a plan
can be emitted.

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
      |-- platform
      `-- image
          |-- linux-libre:kernel
          `-- rootfs
              `-- @base + @network + explicit packages
```

This diagram shows the current imported Linux-libre fixture. Linux-libre,
mainline Linux, and PREEMPT_RT kernels participate as ordinary selectable
package nodes in dependency closure, ordering, hashing, provenance, and rebuild
explanations. Their builders are specialized, but their graph status is not.
A future BSD family will compose a different kernel/userland software graph
rather than masquerading as a Linux kernel variant.

This boundary also controls reuse. Changing only memory produces a different
system lock and runtime bundle, but does not change package layer keys. Changing
the software platform, kernel, or package closure changes the corresponding
build keys. Hidden CLI or `vm.sh` overrides may not cross this boundary.

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
`/opt/cross` are ignored. The dev image and mounted artifact are pinned by
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

`site/` contains only maintained HTML, CSS, and dependency-free browser
JavaScript. Canonical engineering documentation remains in `docs/`.
`eclogite site` parses JSONC and strict JSON, validates versioned JSON Schema,
resolves the catalog, copies maintained assets, renders documentation and object
pages, and emits `catalog.json`, `graph.json`, and `search-index.json` into the
generated `_site/` tree. Browser code only renders that validated generated
data; it does not parse raw package definitions. `_site/` is final static output
and is never committed.
