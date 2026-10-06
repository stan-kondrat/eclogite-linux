# Superseded plan: JSON build DSL and `vmctl` (Python)

> **Status: superseded.** This was the implementation plan written in
> `linux-libre-vm` before Eclogite existed. Eclogite replaced it with a C17
> configuration compiler plus GNU Make ([architecture](../../architecture.md),
> [migration plan](../../migration.md)), JSONC instead of strict JSON, and
> machine/software/system composition instead of one copied `vm.json` per VM.
> The milestones below are kept for their reasoning, not as a plan to follow.
> Self-hosting (the "Prerequisite" section) stays in `linux-libre-vm`; Eclogite
> treats toolchains as inputs. See [README](README.md) for what carried over.

Design background: [research report](report.md) and its [notes](notes/).

The new system is built **alongside** the current Makefile and replaces it only
once it produces an equivalent, bootable image.

## Starting point and constraints

- Today: 16 source submodules + gnulib, per-package Makefile rules with special
  cases (gnulib bootstrap, autoreconf, iproute2/util-linux cross flags, gawk
  stamp), loose patches for coreutils and procps-ng plus vim's
  `termcap-stub.c`. glibc and libraries such as ncurses come from the **build
  host** (Void Linux in `void-dev`, Ubuntu in CI).
- Python on macOS is 3.9.6: `graphlib` is available; no 3.10+ syntax (`match`,
  `X | Y` type hints).
- `check` / `lock` / `plan` are pure Python and run anywhere, including the Mac.
  `build` / `image` need Linux (toolchain, `mke2fs`): `void-dev` and CI.
- The cache lives inside the repo (git-ignored), so the Mac sees kernels and
  images built in `void-dev` through the shared folder.

## Layout

```
catalog/
  schema/        recipe.json  group.json  vm.json  lock.json    (JSON Schema: docs + editor completion)
  pkgs/          linux-libre.json  coreutils.json  bash.json  …  (one per package, 17 total)
  groups/        base.json  net.json
  builders/      autotools.sh  configure.sh  make.sh  kernel.sh  script.sh  lib.sh
  patches/<pkg>/ …                                                (moved from sources-patches/)
  templates/     default.json                                     (≈ today's linux-libre-default)
vm/vmctl/        __main__.py  load.py  schema.py  resolve.py  key.py  lock.py  build.py  image.py  test.py
                 tests/  (unittest: canonical JSON, merge-patch, fixpoint, tsort, keys)
build/cache/     keys/<key>/{out/, keydoc.json, output.sha256}   (git-ignored)
vm_tmp/<vm>/     vm.json  vm.lock.json  vm.sh  shared/  <runner state>
```

## Milestones

### M1 — data model + `check` / `lock` / `plan` (Mac-only, no building)
- Strict loader (reject duplicate keys, `null`, unknown keys), subset JSON Schema
  validator, semantic checks (missing names, cycles, 40-hex commits, no
  `-march` / `native` in recipe data).
- Catalog: recipes for all 17 packages converted from today's Makefile rules
  (special cases become `args` / `env` / `bootstrap`); groups `@base`, `@net`;
  `templates/default.json`.
- `lock`: expand groups → closure over `build` / `link` / `run` → feature
  fixpoint → RFC 7396 `override` merge → tsort → keys bottom-up (canonical JSON)
  → `vm.lock.json` with `inputs_hash` and `why` provenance.
- `plan`: diff against the previous lock ("dhcpcd: abc → def; N rebuild").
- `check` verifies each recipe commit equals its submodule's checked-out commit.
- **Done when:** locking `templates/default.json` twice is byte-identical, unit
  tests pass, and a deliberate typo yields an error with its JSON path.

### M2 — builders + `build` (in `void-dev`)
- Sources via `git archive <commit>` from the submodule clones (local mirror);
  loose patches checked with `git apply --check` at lock time.
- Builders: `autotools` (+ `bootstrap` for gnulib packages, `autoreconf`
  option), `configure` (dhcpcd, iproute2), `make`, `script` (runit, vim stub).
- `lib.sh` sets once for every package: `SOURCE_DATE_EPOCH` from the commit,
  `LC_ALL=C`, `TZ=UTC`, `-ffile-prefix-map`, `PKG_CONFIG_LIBDIR` limited to the
  package's own sysroot (fixes the pkg-config / Python / ncurses host leaks),
  `-march` only from `platform`.
- `host-toolchain` pseudo-unit: key covers gcc / binutils / glibc versions and
  host library versions in use (ncurses …), so keys stay complete while glibc
  still comes from the host.
- Per-package output directories in the cache by key, with `keydoc.json` and the
  output hash; `explain <pkg>` diffs keydocs.
- **Done when:** all 16 userland packages build in `void-dev` (native arm64), a
  second `build` is 100 % cache hits, and installed file lists match the
  Makefile build.

### M3 — kernel builder
- Convert `kernel-*.config` into structured base maps.
- `kernel` builder: merge maps (recipe + features + groups + VM) →
  `merge_config.sh` → `olddefconfig` → verify every requested symbol
  (`optional` entries excepted). Key = resolved `.config` hash.
- **Done when:** the kernel has today's effective options, silently ignored
  options are reported (and the base maps cleaned), and two VMs with equivalent
  settings share one kernel.

### M4 — `image` + `test`
- Root image from the `link`+`run` closure only, plus `copy-libs` for host
  libraries; `/etc` generated (users, runit service links from today's
  `templates/`, files); `mke2fs -d`, read-only root.
- `test`: image checks (no missing shared libraries, required files) and the
  serial boot test from `vm.json` `tests` (reusing `vm/serial-exec.py`).
- **Done when:** the image boots in UTM and QEMU and passes today's checks
  (shell, DHCP network, shared folder).

### M5 — VM integration
- `vmctl new vm_tmp/<name> --from default` (copy template + lock).
- Generic `vm.sh` asks `vmctl` for kernel / disk paths from the lock and calls
  `vm/utm.sh` / `vm/qemu.sh`; remove `vm/write-vm-sh.sh`; update docs.

### M6 — features and system features
- Typed `bool` / `enum` features with `on` / `off` effects (args, deps, kernel
  symbols), `follows` for system features, `requires` / `conflicts` checked
  after resolution.
- First real uses: `9p` (kernel + stage-1 mount) and `ipv6` (dhcpcd + kernel).

### M7 — CI migration
- Workflow: `vmctl lock && vmctl build && vmctl image` per arch (native x86_64,
  cross arm64), `build/cache` kept by `actions/cache`.
- Then delete the per-package Makefile rules; `make` stays a thin wrapper.

### Later
- Patches as commits on fork branches (drop loose patch files).
- Own glibc / toolchain (`host-toolchain` becomes real units); builder-vm.
- `isa_level` variants; output-hash early cutoff once builds are reproducible;
  X11 and other layers.

## Defaults assumed (confirm or change)

1. Keep git submodules as local source mirrors for now; recipes hold URL +
   commit, `check` enforces they match.
2. glibc and libraries come from the host in phase 1 (`host-toolchain`).
3. Names: `catalog/` and `vm/vmctl/`.
4. Keep the old Makefile until M7 as a reference build.

## Prerequisite: self-hosting stage 0

Before M1, the current Makefile image is extended so a VM can build its own
kernel (see `docs/self-hosting.md` once written): a toolchain and build tools in
the image, enough disk / RAM / CPUs, and a working clock.
