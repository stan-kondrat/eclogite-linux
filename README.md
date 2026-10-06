# Eclogite Linux

Eclogite Linux is the second-generation build system for the working
[`linux-libre-vm`](../linux-libre-vm/) project. The original repository remains
the reference implementation and is not modified by this project.

The new design has two deliberately small layers:

- `eclogite`, written in C17, parses and validates the configuration catalog,
  resolves meta-packages and stages, emits a deterministic build plan, executes
  the build, and materializes either a self-contained VM bundle or bootable
  images for a physical machine.
- GNU Make consumes that plan, schedules work, and invokes reusable builder
  rules. Package configuration stays data; Make recipes stay generic.

VM operation is a separate concern: every generated virtual-machine bundle
contains a `vm.sh` runner. It starts and controls that one already-built VM
without requiring `eclogite` inside the guest. Physical-machine profiles instead
produce boot-media images and manifests; they do not receive a pretend VM
runner.

Virtual profiles may target plain QEMU or UTM. The predefined `utm-arm64`
profile follows the proven `linux-libre-vm` arrangement: UTM 5 on Apple Silicon,
its QEMU backend with Hypervisor.framework acceleration, direct kernel boot,
serial console, shared networking, and an imported copy of the root disk.

The host builder is currently at the research and layout stage: its contracts,
catalog, and migration plan are being agreed before the C implementation
begins. A dependency-free static website prototype is already implemented in
`site/` so the catalog and graph model can be reviewed in a browser.

## Start here

Read these documents before adding packages:

- [Research: the original build](docs/research/linux-libre-vm.md)
- [Research: package build language](docs/research/package-build-dsl/README.md)
- [Architecture](docs/architecture.md)
- [JSON configuration](docs/configuration.md)
- [CLI design](docs/cli.md)
- [Generated VM bundle](docs/vm-bundle.md)
- [Installation, remote catalogs, and shared cache](docs/storage.md)
- [GitHub CI and release plan](docs/ci.md)
- [Migration plan](docs/migration.md)

The planned host-tool boundary is described in
[tools/eclogite/README.md](tools/eclogite/README.md). It will be independently
buildable from source and downloadable as a prebuilt release binary.

The release is a single executable, normally installed as
`~/.local/bin/eclogite`. Remote Git catalogs, package sources, and immutable
build layers are shared between projects under `~/.cache/eclogite/` rather than
being downloaded separately into every project.

## Repository map

```text
catalog/
  packages/<name>/
    package.jsonc    package metadata, sources, dependencies, and builder choice
    patches/         optional package-owned source patches
    hooks/           optional package-specific build hooks
    files/           optional files installed by the package
    config/          optional structured configuration fragments
  metapackages/      named package selections such as base and network
  machines/          CPU, memory, boot, device, and runtime profiles
  software/          kernel, package, rootfs, image, and test profiles
  platforms/         target architecture, ABI, libc, and ISA policy
  toolchains/        external toolchain descriptions (never built by Eclogite)
  stages/            build and image-construction graph contexts
  systems/           machine + software compositions
  schemas/           JSON Schema files for catalog and system JSON/JSONC
examples/             complete strict-JSON system inputs for common workflows
builders/            planned generic Make implementations of build styles
tools/eclogite/      reserved standalone C host-tool boundary
tools/vm.sh/         reserved bundle-local vm.sh runner boundary
scripts/             planned repository integration helpers
site/                maintained static website source and catalog presentation
docs/                research, design, and migration decisions
state/               planned locks, build plans, and explanations (ignored)
out/                 planned package outputs, roots, and images (ignored)
```

For example, Coreutils belongs at `catalog/packages/coreutils/`, and
Linux-libre belongs at `catalog/packages/linux-libre/`. Both are normal package
graph nodes and keep their own patches, hooks, installed files, and
configuration fragments beside `package.jsonc` when those resources exist.

`sources/` will be introduced during migration, after the source ownership and
pinning rules are implemented. Until then, sources remain in the original
repository.

`eclogite` is a host-side configuration compiler and image builder. Package
resolution is one responsibility, but the product boundary is the complete
machine configuration and its deployment output. The produced system is
immutable: it contains no package manager and its base root filesystem is
mounted read-only. System packages are never upgraded in place. A machine is
changed by editing its JSONC intent, regenerating the strict-JSON lock, and
building a replacement image.

Hardware and guest contents are separate inputs. A machine profile defines
vCPU, memory, boot, devices, console, and runtime backend. A software profile
defines the target platform, stages, kernel, packages, services, root policy,
image, and tests. A small system file composes one of each; validation rejects
an incompatible pair before planning.

The preferred workflow uses one system file. Its `machine` and `software`
fields accept catalog names or declared aliases; strings beginning with `./` or
`../` link to files relative to the system file:

```sh
mkdir demo
cd demo
eclogite create --config ../examples/utm-arm64.json --fetch
./vm.sh run
```

The example resolves `utm-arm64` and `minimal-arm64` aliases to their canonical
catalog files. The generated bundle keeps the same `vm.sh` lifecycle while its
driver uses UTM and `utmctl`. Separate `--machine` and `--software` options
remain an interactive shorthand, not the primary persisted format.

Without `--output`, `eclogite create` requires the current directory to be
completely empty. It builds in a temporary sibling and publishes the bundle
contents only after its manifest, artifacts, and runner validate. The generated
directory can then be moved to another compatible host. Virtual profiles are
operated with their own `vm.sh`; physical profiles contain bootable images,
manifests, and provenance instead.

GitHub Actions will validate the project on Linux and macOS. Dedicated
KVM-capable Linux runners will build package, kernel and image layers and
publish them to a remote layer store (GitHub Container Registry first,
S3-compatible storage later) with immutable digests and signed provenance, so
local builds mostly pull rather than compile. Every package build, local or in
CI, runs inside a VM booted from the `linux-libre-vm` dev image with a pinned
target toolchain that `linux-libre-vm` builds and publishes. Separate workflows
will publish host-tool release archives and deploy the static package catalog
and documentation. See [the CI plan](docs/ci.md) and
[site/README.md](site/README.md).
