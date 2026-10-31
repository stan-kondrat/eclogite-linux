# Migration plan

The original project stays buildable throughout migration and remains an
independent project. Eclogite reaches parity when its images boot and pass the
same comparison tests.

## Milestone 0 — research and repository boundary

- Record the old package styles, pipeline, risks, and reusable assets.
- Define the `eclogite`/builder responsibility boundary and repository layout.
- Draft JSONC shapes and JSON Schemas for packages (including meta-packages),
  platforms, machine profiles, software profiles, toolchains, facts, and system
  compositions.
- Document the standalone C17 CLI boundary and its test strategy.

Exit condition: the design documents agree on names, ownership, graph semantics,
VM-bundle boundaries, and the implementation sequence. No executable code is
required in this milestone.

## Milestone 1 — syntax and diagnostics

- Implement arena allocation, source buffers, tokens, and a strict JSONC parser
  under `tools/eclogite/src/json/`.
- Decode JSONC objects into versioned catalog object types.
- Add fixtures for duplicate fields, unknown fields, malformed escapes, integer
  overflow, and source-location diagnostics.
- Implement `eclogite validate [PATH...]` without building anything.

Exit condition: valid fixtures produce stable AST dumps and every invalid
fixture reports an exact file/line/column and field path.

## Milestone 2 — typed catalog and graph

- Decode AST nodes into package, platform, machine, software, toolchain,
  facts, and system structures.
- Validate references, hook/test/file paths, and immutable source revisions.
- Merge machine `extends`; take the platform from the machine and the ABI and
  compiler from the system, software or defaults; derive the triplet, and
  each package's compiler with its fallback.
- Resolve build/link/run dependencies, including meta-packages,
  capabilities, `providers` overrides, `first` alternatives, capability-owned
  files and the one-kernel, one-init rule, with `why` provenance for every
  choice.
- Evaluate `compatible` constraints and apply `variants` and `parameters`.
- Detect cycles in build and link dependencies; run dependencies may be cyclic.
- Implement `validate`, `graph`, and `why` commands.
- Implement [resolution](resolution.md) step by step; the
  [golden results](../tests/reference/) are the acceptance tests.

Exit condition: a catalog describing the original userland resolves in a
byte-stable topological order on macOS and Linux.

## Milestone 3 — lock and plan

- Define canonical serialization and SHA-256 input keys.
- Hash recipes, sources, patches, builders/hooks, parameters, platform,
  toolchain, and dependency keys.
- Write a resolved lock atomically.
- Implement `lock`, `plan`, and `explain`.
- Make stale locks a hard error.

Exit condition: locking twice is byte-identical, and a one-field change
produces an explained rebuild set.

## Milestone 4 — first packages

- Add immutable source preparation and per-package output trees.
- Implement the scheduler and the builder VM, then the `configure` builder
  (without bootstrap), the `make` builder, and hooks.
- Migrate bash, dhcpcd, iproute2, and runit first; they cover the main simple
  styles without beginning with the gnulib bootstrap complexity.
- Compare file manifests with the old build.

Exit condition: repeat builds are cache hits and no builder accesses the
network or undeclared target libraries.

## Milestone 5 — complete userland and kernel

- Add the `autoreconf` and `gnulib` bootstraps of the `configure` builder.
- Migrate all 15 userland packages, `glibc` and `gcc-runtime`.
- Import kernel config as verified fragments and implement the `linux-kernel`
  builder,
  merging the config that dependencies on `linux` and the machine's devices
  require.
- Record effective `.config` and reject silently ignored required symbols.

Exit condition: package manifests and effective kernel settings match the
reference within documented differences.

## Milestone 6 — root, image, and boot tests

- Compose package outputs instead of installing into one shared root.
- Migrate the remaining rootfs templates into `base-files`; generate runit
  services from package `services`, and `/etc/fstab` and `/etc/hostname`
  from the software profile and package `mounts`.
- Resolve shared libraries from declared outputs/toolchain sysroot.
- Build ext4 images sized from their contents; run the built-in boot checks
  and every package's `tests` over the serial console.
- Generate both QEMU and UTM runtime drivers from the same locked ARM64 image;
  verify UTM on Apple Silicon with direct boot, console, shared networking,
  disk import, and preservation of the bundle-local shared directory.

Exit condition: both architectures boot, acquire DHCP, and shut down under the
same checks as the original project.

## Milestone 7 — remote layers and build runtimes

- Publish layers from dedicated KVM-capable GitHub Actions runners to GHCR by
  input key and immutable OCI digest. Pull requests validate plans on hosted
  runners but never execute package hooks on the self-hosted builders.
- Sign provenance with the protected publication workflow's GitHub OIDC
  identity and reject layers that fail the configured store trust policy.
- `eclogite fetch` pulls available layers for a lock; `build` stays offline and
  builds only what is missing.
- Start the `linux-libre-vm` build-runtime VM (UTM on macOS, QEMU/KVM on Linux
  and CI) and run builders inside it; mount the selected pinned toolchain at its
  authoritative read-only path and record its identity in the lock.
- Build host-specific layer matrices; version 1 does not share layer identities
  across `x86_64` and `arm64` build hosts.
- Add an S3-compatible layer store with the same contract (later).

Exit condition: on a fresh machine, `fetch` + `build` for a published system
builds nothing and boots an image identical to the published one.

Self-hosting — building the toolchain from source — is not an Eclogite
milestone. `linux-libre-vm` builds native and cross toolchains and the dev
image, and Eclogite uses them as its build runtime.

The original `linux-libre-vm` build stays an independent project; Eclogite
never removes or archives its Make rules.

## After version 1

Designed, but deliberately outside version 1. The documents describing them
stay as direction, not as work to refine now:

- generating the website from the catalog (`eclogite site`); `site/` stays a
  static prototype with its own data file;
- the CI evidence store and the `evidence` policy beyond `warn-untested`;
- S3-compatible layer stores and signed provenance beyond the GHCR store of
  Milestone 7;
- physical Raspberry Pi machine profiles, which stay `profile-only`;
- the Theia IDE example, which needs `npm-workspace`, fetch phases and volumes
  on top of the reference system.
