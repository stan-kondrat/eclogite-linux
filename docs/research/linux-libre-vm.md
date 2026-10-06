# Research: `linux-libre-vm`

This is a design review of the local `linux-libre-vm` working tree, which
Eclogite treats as a reference implementation. `linux-libre-vm` continues on its
own and will not implement the catalog/build-language design; its research on
that design was moved here on 2026-10-04, to
[package-build-dsl/](package-build-dsl/README.md).

## What already works

The original project builds Linux-libre systems for `x86_64` and `arm64`,
assembles ext4 root images, and boots them with QEMU or UTM. Its successful
runtime choices are useful reference behavior:

- Linux-libre, glibc, GNU userland, runit, dhcpcd, and a small Vim build.
- Direct kernel boot with an ext4 root filesystem and no bootloader.
- Native and cross builds selected from the host architecture.
- Read-only upstream source submodules, copied to patched and per-architecture
  build trees before modification.
- Root filesystem templates and VM runners kept outside package build rules.

The package set is 15 userland packages plus Linux-libre. Gnulib is a shared
source input.

`linux-libre-vm` can also build a native toolchain from source (binutils 2.47,
GCC 15.3.0, glibc 2.43, make, m4, bison, flex, bc, Perl; commit `e6d7ac1`) into
a "dev" disk image. A VM booted from that image built its own Linux-libre
kernel (73 s on 4 vCPUs), and a VM booted with that kernel. Self-hosting stays a
`linux-libre-vm` capability, extended there to cross toolchains for Eclogite's
targets: Eclogite does not build toolchains, and runs every build inside a VM
booted from the published dev image (see the lessons below).

## Current flow

```text
sources/<package>
    |
    | copy + loose patches
    v
sources-patched/<package>
    |
    | copy + configure/bootstrap/autoreconf
    v
sources-build/<architecture>/<package>
    |
    | DESTDIR install + host library collection + pruning
    v
rootfs/<architecture>
    |
    | mke2fs -d
    v
disks/disk-<architecture>.img
```

At commit `e6d7ac1`, the top-level Makefile includes 14 numbered fragments with
1,739 lines in total; the two largest are package build rules (429 lines) and
package/install assembly (304 lines). Its native-toolchain fragment accounts
for 234 lines. The later, still-uncommitted working-tree extension adds
`mk/15-cross-toolchain.mk`; its changing line count is intentionally excluded
from these pinned baseline measurements.

## Reusable patterns hiding in the Makefiles

The existing per-package logic falls into a small number of build styles:

| Style | Packages | Important variations |
|---|---|---|
| gnulib + autoreconf | coreutils, grep, sed, findutils, diffutils, gzip, tar | version seed, gettext stubs, host generators, tar/paxutils |
| configure | bash, gawk, dhcpcd, iproute2 | host triplet, cross pkg-config policy, gawk generated files |
| autoreconf | procps-ng, util-linux | version seed, per-architecture configure switches |
| custom make | runit | layout and compiler overrides |
| custom configure | Vim | tiny feature set and cross termcap stub |
| kernel | Linux-libre | architecture mapping, config, image path |
| toolchain component | GCC, glibc, binutils, build tools | ordered bootstrap context and staged sysroot |

These should become generic builders plus explicit hooks, not new Make macros
for each package.

## Problems the second version should solve

1. **Metadata and execution are mixed.** Source identity, versions, arguments,
   patches, workarounds, architecture rules, and shell execution all live in
   Make code. A package cannot be inspected without expanding Make.
2. **Invalidation is stamp-based but incomplete.** Patch, recipe, environment,
   builder, or flag changes are not comprehensively represented by the stamp
   prerequisites. A stale `.built` can survive a meaningful input change.
3. **Dependencies are mostly implicit.** Aggregate target membership describes
   what to build, but not typed build/link/runtime edges or why a package was
   selected.
4. **Host inputs can leak.** Libraries, `pkg-config`, generated programs, and
   host tools are handled with package-specific shell branches. Cross builds and
   cache identity need one central environment policy.
5. **Special cases are duplicated.** The help2man and gawk fixes appear in more
   than one macro. Architecture install and pruning logic is largely duplicated.
6. **A build can fetch.** The tar rule may populate paxutils while building, and
   GCC's prerequisite helper downloads inputs. Fetching must be a separate,
   lockable step; execution should be offline-capable.
7. **Package output and image policy are coupled.** Installing all packages into
   one root and then globally moving, pruning, stripping, and copying libraries
   prevents per-package manifests and reliable composition.

## Useful conclusions from the existing DSL research

The original research ([package-build-dsl/](package-build-dsl/README.md))
recommends JSON plus Python, but its system-design conclusions remain applicable
to a C implementation:

- Keep one catalog version per package. Dependency resolution is then graph
  closure plus topological sorting, not a package-version solver.
- Separate user intent from a fully resolved lock/plan.
- Use typed dependency edges: build, link, and run.
- Make features additive; validate conflicts instead of searching for a
  satisfying combination.
- Hash the resolved recipe, source, patches, builder implementation, platform,
  toolchain, and dependency keys. Store the key inputs for explanation.
- Separate build-host tools from target packages.
- Treat reproducibility and environment isolation as builder responsibilities.

## Package quirks found while making the build pass

These are facts about the sources, not about the old Makefiles, so they belong
in package data or package hooks:

| Package | Quirk | Reference fix |
|---|---|---|
| iproute2 | cross `configure` finds the build host's libraries through `pkg-config` (e.g. `libelf`) and the link fails | cross builds run `configure` with `PKG_CONFIG=false` |
| util-linux | cross `configure` picks up host Python and ncurses; `make install` runs `chgrp`/setuid | `--without-python`; cross adds `--without-ncursesw --without-ncurses --without-tinfo`; `--disable-makeinstall-chown --disable-makeinstall-setuid` |
| gawk | when a checkout leaves `doc/gawk.texi` newer than `awklib/stamp-eg`, the build deletes `awklib/eg/` and re-extracts it with the host gawk, losing `pwcat.c`/`grcat.c` | touch `awklib/stamp-eg` before building |
| procps-ng | `Makefile.am` generates `capnames.h` with `echo -e`, which dash prints literally | tracked patch replacing it with `printf` |
| gnulib packages | older `bootstrap` scripts lack `--gen`; the fallback needs the stub tools on `PATH` and must not fetch | `./bootstrap --skip-po --no-git` with an explicit `PATH` |
| GCC | `contrib/download_prerequisites` downloads gmp/mpfr/mpc/isl (SHA-512 checked) during the build | fetch them as locked sources instead |
| glibc | `configure` refuses an `LD_LIBRARY_PATH` that contains the current directory (an empty entry) | builders clear `LD_LIBRARY_PATH` |

## UTM runtime behavior to preserve

The reference repository's `vm/utm.sh` is a working ARM64 runner for UTM 5 on
Apple Silicon. It establishes details that Eclogite should preserve rather than
redesign from assumptions:

- UTM uses its QEMU backend with the `virt` machine and
  Hypervisor.framework acceleration; the profile is ARM64-only in version one.
- The kernel is booted directly without UEFI, using `ttyAMA0`; the disk,
  network, and shared-directory devices are virtio-mmio rather than PCI.
- The source root image is imported as a disk copy inside the `.utm` bundle.
  Recreating the instance refreshes that copy without changing the source
  artifact or the host/guest shared directory.
- VM creation uses the UTM AppleScript API, while lifecycle operations use the
  `utmctl` executable shipped inside UTM.app. Serial console and scripted
  execution use the host pseudo-terminal exposed by UTM.
- Kernel and initrd files must also be represented as removable UTM drives so
  the sandbox grants QEMU access. Direct additional-argument paths alone are
  insufficient.
- A linked `.utm` bundle can live inside the generated machine directory:
  create in UTM storage, export, remove the original registration, and open the
  exported bundle in place.

These are deployment-runtime rules. They belong in the generated UTM driver
and runtime manifest, not in package recipes or the guest software profile.

## Lessons for using `linux-libre-vm` as a build runtime

Eclogite runs every build inside a VM booted from the `linux-libre-vm` dev
image. These issues were found and fixed there and must be respected by the
runtime contract:

- **Shared-folder mode.** UTM's VirtFS uses `security_model=mapped-xattr`;
  symlinks created on the host are then unreadable in the guest ("Too many
  levels of symbolic links"), which broke the kernel build. A second
  `-fsdev … security_model=none` on the same folder passes host files through
  unchanged.
- **Never assemble root filesystems on a shared folder.** Setting file modes
  there failed for some files, which then appeared as `0600` to the Linux side;
  a `/bin/bash` without `+x` made runit power the VM off. Roots must be built on
  the runtime's own disk; an explicit check that every program is executable
  caught it.
- **Read sources from local disk.** Building the kernel straight from the 9p
  share took 800 s instead of 73 s from a copy on the VM disk; a source archive
  unpacked locally is the fast path.
- **Console environment.** agetty starts the shell with no environment and
  bash's built-in default `PATH` ends in `.`, which made GCC look for `cc1`
  relative to the working directory. The runtime must set `PATH` explicitly.
- **Clock and CPUs.** Without an RTC the guest starts in 1970 and `make` sees
  shared files as "from the future"; the kernel needs `RTC_DRV_PL031` and
  `RTC_HCTOSYS` (arm64) and a sufficient `NR_CPUS` for parallel builds.
- **Private library directories.** A shared-library check must accept libraries
  that live outside the default search path (glibc's gconv modules need
  `libJIS.so` and others from `/usr/lib/gconv`).

## What to carry forward

- The package versions, source pins, patches, kernel configurations, rootfs
  templates, QEMU/UTM runners, and boot tests are migration inputs.
- The old output is the compatibility oracle: file manifests, kernel settings,
  boot, DHCP, shutdown, and architecture behavior should be compared during
  migration.
- The old Make targets should remain usable until the new system produces an
  equivalent bootable image. Migration is package-by-package and additive.

## What not to copy directly

- Numbered Make fragments as the package database.
- Per-package Make macros and inline workaround shell.
- Generated build trees, root filesystems, disks, caches, or logs.
- The Python runner layout from the earlier plan; the new implementation uses a
  strict C JSONC parser, strict generated JSON, and versioned JSON schemas.
