# Catalog

This directory contains a first-pass declarative translation of the working
`linux-libre-vm` build. Every file validates against the
[schemas](../schemas/README.md), but it is design data for review, not yet an
executable catalog. The source revisions are exact Git commits read from the
reference repository on 2026-10-04.

The inventory is:

- 15 installed userland packages from the reference build, plus `glibc` and
  `gcc-runtime` built from the toolchain's source revisions;
- Linux-libre as an ordinary package that provides the `kernel` capability,
  with per-architecture image targets as `variants` and a `clock` test;
- Gnulib as a source-only build dependency;
- system packages split by who needs them: `base-files` (filesystem
  skeleton, for every system), `runit` (init and its stage scripts),
  `console-login` (getty on the machine's serial console, read as a
  parameter) and `host-share` (the 9p mount of the VM bundle's share,
  selected only on machines with a shared directory);
- capabilities with interchangeable providers: `kernel` (linux-libre),
  `init` (runit), `libc` (glibc, musl), `cc-runtime` and `c++-runtime`
  (gcc-runtime, llvm-runtime), `sh` (bash, busybox), `core-utils`
  (coreutils, busybox), `system-utils` (util-linux, busybox), `utils`
  (gnu-utils, busybox), `dhcp-client` (dhcpcd, busybox), `ip` (iproute2,
  busybox) and `vi` (vim, busybox);
- `busybox` 1.38.0, `musl` 1.2.6 and `llvm-runtime` 23.1.3, at their
  release commits;
- six meta-packages, which are packages with run dependencies only: `base`,
  `gnu-utils`, `network`, `editor`, `reference-system`, and `ide`;
- `x86_64`, `arm64`, and BCM2835-specific ARMv6 hardware platforms;
- the `linux-gnu` and `linux-musl` ABIs in `abis/`;
- `defaults.jsonc`: the default ABI (`linux-gnu`) and provider per
  capability;
- QEMU `virt` ARM64 and `q35` x86-64 machine profiles, each retaining the
  reference build's one-vCPU and 256-MiB defaults;
- a UTM 5 ARM64 profile for Apple Silicon, using UTM's QEMU backend with HVF,
  direct kernel boot, an imported disk copy, shared networking, and VirtFS/9p,
  and `utm-virt-arm64-8g`, which extends it with more memory;
- 512-MiB and 256-MiB Raspberry Pi Model B physical profiles, the second
  extending the first;
- a QEMU `raspi1ap` ARMv6 profile for the closest currently implemented
  BCM2835 board model;
- four software profiles, each usable on any compatible machine: `minimal`
  (`base` only, stripped, no documentation), `minimal-busybox` (the same with
  BusyBox providing the shell and utilities), `reference` (the complete
  reference userland) and `theia` (alias `ide`);
- meta-packages that nest and are written in capabilities: `base` holds only
  what boot uses, `gnu-utils` the other GNU tools (the default `utils`
  provider), and `reference-system` combines them with `network`, `editor`
  and the conditional `host-share`;
- one filesystem layout: programs only in `/bin`, with no `/usr/bin` or
  `/sbin` ([configuration](../docs/configuration.md#filesystem-layout));
- QEMU x86_64, QEMU arm64, and UTM arm64 system compositions;
- the fact vocabulary in `facts.jsonc` that `compatible` constraints and
  `variants` are evaluated against ([build model](../docs/build-model.md));
- the device models in `devices.jsonc`, each with the kernel options its
  driver needs: virtio over MMIO and PCI, PL011 and 16550A consoles, PL031
  and CMOS clocks, and the BCM2835 peripherals;
- the `linux-libre-vm` toolchain: the builder image's targets, compilers and
  tool manifest. What it does not ship yet is marked `planned`: the musl
  targets, clang and lld, CMake and Ninja, so a linux-musl or clang system
  fails resolution with that reason until it does;
- `gcc-runtime` and `llvm-runtime` (LLVM 23.1.3), both providing
  `cc-runtime` and `c++-runtime`; glibc and gcc-runtime build only with gcc
  and fall back to it on clang systems;
- a Theia IDE example: `nodejs` and `theia` packages (`theia` owns its fetch
  phase, service and test), the `ide` meta-package and the `utm-arm64-theia`
  system.

Every package owns a directory rather than a detached recipe:

```text
catalog/packages/dhcpcd/
  package.jsonc
  patches/       optional source patches
  hooks/         optional package-specific build steps
  tests/         optional checks run in the booted guest
  files/         optional files installed by this package
  config/        optional structured configuration fragments
```

A package carries everything about itself: how it builds, which services it
runs (`dhcpcd` declares its DHCP service), what it mounts (`host-share`
mounts `/mnt/shared`), how to check it works (`dhcpcd` declares a `dhcp`
test), and which kernel options it needs, as config on its dependency on
`linux` (`host-share` needs 9p, `theia` inotify). `linux-libre` declares every
option the catalog may require, with allowed values, a default of `n`, and
the options each one depends on; a requirement it does not declare is an
error. Selecting a
package brings all of these with it. Hardware support comes from the machine
instead: its device models supply their drivers' kernel options, so a
Raspberry Pi kernel gets no virtio or 9p.

Linux-libre is the currently imported kernel package at
`packages/linux-libre/`; its kernel config fragments will live in that
package's `config/` directory. Mainline, PREEMPT_RT or custom kernels are
peer packages that provide `kernel`. `defaults.jsonc` names the default
provider of every capability; packages depend on the capability (`vim` links
`libc`, `dhcpcd` runs under `init`), so a software profile names a provider
only when it wants a different one. A FreeBSD target would be an ABI with
`"os": "freebsd"`, its toolchain, and providers appended to the defaults'
alternatives; no FreeBSD packages or toolchain exist yet.

Machine and software are intentionally not one object. Files under `machines/`
own the platform, CPU, memory, boot, device topology, console, and runtime
backend. Files under `software/` own the package selection, kernel, root
filesystem, image, and volumes. Files under `systems/` only pair the two.

The two Raspberry Pi Model B memory variants are separate machine identities,
written once with `extends`. Memory is a locked resource, so a profile must
never mean either 256 MiB or 512 MiB depending on whichever board happens to be
present. The QEMU ARMv6 profile is separate from the physical profiles: QEMU's
`raspi1ap` machine models a Raspberry Pi 1 Model A+, not a Model B, and
therefore does not claim the Model B Ethernet or identical board topology.

The UTM ARM64 profile is separate from plain QEMU even though both expose the
QEMU `virt` machine to the guest. UTM adds a host contract—macOS on Apple
Silicon, UTM 5 or newer, HVF acceleration, `.utm` bundle registration, disk
import, and sandbox-aware file access—that must be visible in the system lock
and generated runtime driver.

## Deliberate migration gaps

The catalog records only facts that are clear in the reference build. It does
not silently convert reference-build behavior into a supposedly finished model:

- the two tracked source patches are noted but not yet copied into package
  `patches/` directories;
- Vim's generated termcap compatibility source is noted but no hook code is
  migrated;
- `passwd`, `group` and `dhcpcd.conf` are not yet copied from the reference
  rootfs into `base-files/files/` and `dhcpcd/files/`;
- the full x86_64 and arm64 kernel configurations are not yet split into
  verified fragments under `linux-libre/config/`;
- most packages do not yet declare their `glibc` link and run dependencies or
  their `builder:` tools; that needs an ELF and service-level audit;
- the hooks of `runit`, `busybox` and `theia` use provisional builder
  variables until the builder contract is written;
- BusyBox's applet lists per capability, its `udhcpc` script and its
  `getty`/`setsid` option compatibility are written from upstream
  documentation and not yet booted;
- toolchains are not built by Eclogite: `linux-libre-vm` builds the native
  toolchain and dev image in `mk/14-toolchain.mk` and the target toolchain
  artifacts in `mk/15-cross-toolchain.mk`. Eclogite uses those as its build
  runtime and pinned inputs, and only as the builder: nothing from them is
  installed into a guest ([build model](../docs/build-model.md));
- the Raspberry Pi profiles are `profile-only` until after version 1
  ([migration](../docs/migration.md#after-version-1)).

Until these gaps are resolved, the JSONC files are fixtures for reviewing the
data model. They must not be presented as reproducibly buildable definitions.
