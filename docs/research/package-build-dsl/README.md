# Research: package build description language

This directory holds the research behind Eclogite's catalog and build model. It
was produced in `linux-libre-vm` on 2026-10-03, before Eclogite existed, and
moved here because that repository will not implement it.

- [report.md](report.md) — synthesis: recipe format, graph resolution, feature
  flags, cache keys, intent and lock, with schema sketches.
- [notes/](notes/) — the cited source material behind the report:
  - [nix-guix.md](notes/nix-guix.md) — derivations, overrides, NixOS modules,
    flake.lock, Guix transformations;
  - [variants-solving.md](notes/variants-solving.md) — Spack, Gentoo USE,
    Cargo features, Conan, pkgsrc, Debian profiles, dependency solving;
  - [caching-platforms.md](notes/caching-platforms.md) — Bazel, Buck2,
    BuildKit, Yocto sstate, reproducible builds;
  - [recipe-formats.md](notes/recipe-formats.md) — Buildroot, Yocto,
    Void, Alpine, Arch, Homebrew;
  - [config-languages-locking.md](notes/config-languages-locking.md) — CUE,
    Nickel, Pkl, KCL, Dhall, Jsonnet, JSON Schema, Merge Patch, lock files,
    canonical JSON.
- [superseded-python-plan.md](superseded-python-plan.md) — the first
  implementation plan (Python `vmctl`), kept for its reasoning only.

## Adopted by Eclogite

- One version per package: resolution is closure plus topological sort, not a
  version solver.
- User intent separated from a fully resolved, strict-JSON lock; builds read
  only the lock, and a stale lock is an error.
- Typed `build` / `link` / `run` dependency edges; build-host tools separated
  from target packages.
- Input-addressed keys over the resolved recipe, sources, patches, builder and
  hooks, platform, toolchain and dependency keys; key documents stored for
  explanation; output hashes recorded to detect non-reproducibility.
- Platform-derived compiler flags; `-march=native` and similar rejected.
- Reproducibility (`SOURCE_DATE_EPOCH`, prefix maps, locale, timezone) and host
  isolation as builder responsibilities.
- Duplicate keys, unknown keys and `null` rejected; canonical serialization for
  hashing.
- Kernel built "like any package", with an effective `.config` recorded and
  silently ignored required symbols rejected.

## Decided differently

| Topic | Research recommendation | Eclogite |
|---|---|---|
| Implementation | Python standard library runner | C17 configuration compiler + GNU Make |
| Syntax | strict JSON, `description` fields | JSONC with comments; strict JSON for locks |
| VM description | one self-contained `vm.json` copied per VM | `system` = `machine` profile + `software` profile |
| Overrides | three fixed layers ending in a per-VM `override` (RFC 7396) | no override layers; duplicate names are errors, no `--set` |
| Toolchain | host toolchain as a pseudo-unit, self-hosting later | native and cross toolchains are `linux-libre-vm` release artifacts; every build runs in a `linux-libre-vm` VM; Eclogite never builds toolchains (see [linux-libre-vm research](../linux-libre-vm.md)) |
| Layer cache | local, per-user | shared cache plus a remote layer store on GitHub, S3-compatible later ([storage](../../storage.md)) |

## Open items carried over

These are recommendations from the report that Eclogite's design documents do
not yet decide. They are candidates, not commitments.

1. **Feature model** (report: "Typed, additive features beat USE flags without
   a solver"). The CLI mentions feature resolution, but no schema exists. The
   report proposes: `bool`/`enum` features; `on`/`off` effects as data
   (arguments, dependencies, kernel symbols), as in Yocto's PACKAGECONFIG;
   propagation by union (Cargo); opting into a few system-wide features with
   `follows`; `requires`/`conflicts` checked after propagation, never searched;
   negative conditions on propagated values forbidden so resolution is a
   monotone fixpoint.
2. **Patch/source coupling.** Package `patches/` exist, but nothing ties a
   patch to the revision it was written for. The report proposes patches as
   commits on a fork branch where possible (the pinned commit is then the
   patched tree), a mandatory `reason` for loose patches, and a
   `git apply --check` dry run when locking.
3. **Closed ISA levels and arch-independent outputs.** Platforms carry a free
   `isa` string (`x86-64-baseline`). The report proposes closed levels
   (`v1`–`v4` on x86-64), compiler flags derived only from them, build-context
   dependencies keyed by the build host rather than the target level, and a
   `"platform": "any"` marker so data-only outputs are shared across platforms.
4. **Kernel cache key on the resolved configuration.** Keying the kernel on the
   effective `.config` (after `olddefconfig`) instead of the fragment list lets
   systems whose fragments differ but resolve identically share one kernel. The
   report also proposes an `optional` marker for symbols that may not exist in
   every kernel version.
5. **Early cutoff.** Output hashes are recorded; skipping dependent rebuilds
   when an output is byte-identical is deferred until builds are shown to be
   reproducible (Nix CA derivations remain experimental for that reason).
