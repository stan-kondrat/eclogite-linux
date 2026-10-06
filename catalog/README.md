# Catalog

This directory now contains a first-pass declarative translation of the working
`linux-libre-vm` build. It is design data for review, not yet an executable or
schema-validated catalog. The source revisions are exact Git commits read from
the reference repository on 2026-10-04.

The initial inventory is:

- 15 installed userland packages;
- Linux-libre as a normal kernel package;
- Gnulib as a source-only build dependency;
- `base-files` as the future owner of rootfs templates and service definitions;
- four meta-packages: `base`, `network`, `editor`, and `reference-system`;
- `x86_64`, `arm64`, and BCM2835-specific ARMv6 platforms;
- QEMU `virt` ARM64 and `q35` x86-64 machine profiles, each retaining the
  reference build's one-vCPU and 256-MiB defaults;
- a UTM 5 ARM64 profile for Apple Silicon, using UTM's QEMU backend with HVF,
  direct kernel boot, an imported disk copy, shared networking, and VirtFS/9p;
- concrete 256-MiB and 512-MiB Raspberry Pi Model B physical profiles;
- a QEMU `raspi1ap` ARMv6 profile for the closest currently implemented
  BCM2835 board model;
- separate ARM64 and x86-64 software profiles for the kernel, package closure,
  root filesystem, image, and tests;
- the reference build's external/native-or-cross GCC toolchain policy;
- target-userland, target-kernel, and image stages;
- QEMU x86_64, QEMU arm64, and UTM arm64 system compositions that pair machine
  and software.

Every package owns a directory rather than a detached recipe:

```text
catalog/packages/coreutils/
  package.jsonc
  patches/       optional source patches
  hooks/         optional package-specific build hooks
  files/         optional files installed by this package
  config/        optional structured configuration fragments
```

Linux-libre is the currently imported kernel package at
`packages/linux-libre/`; its kernel config fragments live in that package's
`config/` directory. Mainline and PREEMPT_RT Linux can be added as peer kernel
packages rather than hard-coded modes. Static root filesystem content is owned
by packages such as `base-files`, not by a global overlay.

Generic Make behavior still belongs in `builders/`. Package-specific resources
may live beside the recipe, where their contents can be hashed and exposed in
the generated catalog.

Every JSONC document has a versioned `schema` field. JSON Schema files under
`schemas/` provide editor completion and documentation; the C implementation
performs strict validation itself.

Machine and software are intentionally not one object. Files under `machines/`
own CPU, memory, boot, device topology, console, and runtime backend. Files
under `software/` own stages, kernel, package selection, root filesystem,
image policy, and tests. Files under `systems/` only pair those two profiles;
their platform references must match.

The two Raspberry Pi Model B memory variants are separate machine identities.
This is intentional: memory is a locked resource, so a profile must never mean
either 256 MiB or 512 MiB depending on whichever board happens to be present.
The QEMU ARMv6 profile is also separate from the physical profiles. QEMU's
`raspi1ap` machine models a Raspberry Pi 1 Model A+, not a Model B, and therefore
does not claim the Model B Ethernet or identical board topology.

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
- rootfs templates and runit service scripts are not yet copied into
  `base-files/files/`;
- the full x86_64 and arm64 kernel configurations are not yet split into
  verified fragments under `linux-libre/config/`;
- empty `link` and `run` dependency arrays mean the reference Makefiles did not
  declare those edges; they still require an ELF and service-level audit;
- the reference build copies libc and other shared libraries from an external
  sysroot. The catalog treats that as part of the toolchain context until a
  proper target-libc package is designed;
- builder names describe reference build families and may be reduced to generic
  adapters plus package-owned hooks when the builder contract is finalized;
- toolchains are not built by Eclogite: `linux-libre-vm` builds the native
  toolchain and dev image in `mk/14-toolchain.mk` and the target toolchain
  artifacts in `mk/15-cross-toolchain.mk`. Eclogite uses those as its build
  runtime and pinned inputs. `reference-system-gcc` only records how the reference
  build used distribution compilers.
- the Raspberry Pi profiles are hardware fixtures only until an ARMv6 software
  profile, kernel configuration, boot-media layout, and acceptable physical
  boot-firmware policy are defined.

Until these gaps are resolved and schemas exist, the JSONC files are fixtures
for reviewing the data model. They must not be presented as reproducibly
buildable definitions.
