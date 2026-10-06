# JSON and JSONC configuration

Human-authored system intent and catalog metadata normally use JSONC: JSON with
comments. Strict `.json` inputs are accepted as well, which is useful for
machine-generated catalogs and remote indexes. The C host tool parses either
form, validates it against versioned JSON Schema, resolves the graph, and emits
a fully concrete strict-JSON lock file. GNU Make parses neither JSONC nor JSON
directly.

JSONC is used because these files are long-lived human configuration and need
comments. It is directly supported by editors such as VS Code and is familiar
from files such as `settings.json` and `tsconfig.json`. JSON Lines (`.jsonl`) is
not appropriate here: it is a stream format in which every line is an
independent JSON value, useful for logs and pipelines rather than one nested
system configuration.

## Strict JSONC profile

Eclogite accepts a deliberately small JSONC profile:

- every document is one object with a required versioned `schema` string;
- duplicate object keys are errors rather than last-value-wins;
- unknown keys are errors;
- `//` line comments and `/* ... */` block comments are accepted;
- trailing commas are rejected, keeping a source convertible to strict JSON by
  removing comments alone;
- strings must contain valid UTF-8;
- configuration uses integers only; floating-point numbers are rejected;
- `null` is rejected in source configuration;
- names and referenced paths are validated independently of JSON parsing;
- diagnostics include file, line, column, and a JSON Pointer field path.

JSON Schema files under `catalog/schemas/` document the format, support editor
completion, and are the validation contract used by `eclogite`. The
dependency-free C executable implements the required JSON Schema vocabulary
directly, so validation does not require a separate schema library. The
instance's versioned `schema` value selects the exact schema document; unknown
schema versions fail rather than falling back to a close version.

For `.json`, comments are rejected and normal strict JSON rules apply. For
`.jsonc`, comments are accepted according to the profile below. After parsing,
both formats produce the same typed model and therefore the same lock and input
keys.

Comments and formatting are not build inputs. Keys are computed from the
validated typed model, so editing a comment does not rebuild the system.

## Package

Package resources are relative to the directory containing `package.jsonc`.

```jsonc
{
  "schema": "eclogite.package/v1",
  "name": "coreutils",
  "version": "9.6",
  // Sources are immutable once locked.
  "source": {
    "type": "git",
    "url": "https://git.savannah.gnu.org/git/coreutils.git",
    "revision": "0123456789abcdef0123456789abcdef01234567"
  },
  "builder": "autotools",
  "patches": [
    "patches/0001-example.patch"
  ],
  "dependencies": {
    "build": ["gnulib"],
    "link": ["glibc"],
    "run": []
  },
  "arguments": {
    "configure": ["--prefix=/usr", "--disable-nls"]
  },
  "steps": {
    "prepare": "default",
    "configure": "default",
    "compile": "default",
    "install": "default",
    "package": "default"
  }
}
```

Most packages omit `steps`; the selected builder supplies them. A non-default
value names a registered file below the package's `hooks/` directory. Hook
content is hashed. JSONC never contains inline shell.

Packages with no upstream source are allowed. For example, `base-files` owns
tracked content below `files/` and produces a normal package output and manifest.

## Meta-package

```jsonc
{
  "schema": "eclogite.metapackage/v1",
  "name": "base",
  "members": [
    "base-files",
    "bash",
    "coreutils",
    "grep",
    "sed",
    "gawk",
    "findutils",
    "diffutils",
    "gzip",
    "tar",
    "util-linux",
    "procps-ng",
    "runit"
  ]
}
```

Meta-packages select packages or other meta-packages. They have no source,
builder, installed files, or empty binary output. Provenance is retained so
`eclogite why --config SYSTEM.jsonc package:NAME` can explain the selection
chain.

## Platform

```jsonc
{
  "schema": "eclogite.platform/v1",
  "name": "arm64",
  "architecture": "aarch64",
  "abi": "linux-gnu",
  "libc": "glibc",
  "isa": "baseline",
  "kernel_architecture": "arm64"
}
```

Architecture and compiler flags are derived from closed platform fields. Raw
host-dependent values such as `-march=native` and `-mcpu=native` are rejected in
package arguments. A platform is the compatibility key between a machine
profile and a software profile; it is not where VM memory or device topology is
configured.

## Machine profile

A machine profile describes the hardware boundary, whether the eventual target
is virtual or physical. It never selects packages, services, an init system, or
root filesystem contents.

```jsonc
{
  "schema": "eclogite.machine/v1",
  "name": "qemu-virt-arm64",
  "aliases": ["qemu-arm64", "arm64-vm"],
  "platform": "arm64",
  "resources": {
    "vcpus": 1,
    "memory_mib": 256
  },
  "runtime": {
    "backend": "qemu",
    "machine": "virt",
    "machine_options": ["gic-version=3"],
    "acceleration": "auto"
  },
  "boot": {
    "method": "direct-kernel",
    "console": "ttyAMA0",
    "kernel_arguments": ["root=/dev/vda", "ro", "console=ttyAMA0"]
  },
  "devices": [
    { "kind": "block", "model": "virtio-blk-device" },
    { "kind": "network", "model": "virtio-net-device" }
  ]
}
```

CPU count, memory, firmware or direct-kernel boot, console, storage and network
devices, and runtime backend compatibility belong here. Resource values are
locked inputs. They are not invisible `vm.sh` environment overrides.

`aliases` are optional, catalog-wide unique convenience names for CLI input.
They are exact matches, never prefix guesses: `--machine qemu-arm64` resolves
to this profile, while a path such as `--machine ./my-board.jsonc` selects a
local profile. Resolution writes the canonical name and document hash into the
generated request and lock, so the alias is not part of build identity.

The machine schema reserves `resources.cpu.model` for an exact processor model
such as `ARM1176JZF-S` or a QEMU CPU model. Profiles migrated from the reference
build may temporarily say that the model is backend-derived, but a release lock
must resolve that default to a concrete value. CPU identity affects platform
compatibility and the machine cache key; it is not an untracked runtime flag.

Kernel or operating-system selection remains on the software side. Linux-libre,
mainline Linux, and a PREEMPT_RT Linux package are peer choices; selecting one
changes the software graph and lock. A UI may present machine and kernel choices
together while composing a system, but it must emit them into separate machine
and software documents before validation. A future BSD target will need an
operating-system profile that defines its kernel and userland contract, not a
Linux-kernel name forced into the existing field.

Physical boards and emulated boards remain different machine profiles even when
they share a CPU architecture. For example, the 256-MiB and 512-MiB Raspberry
Pi Model B revisions are distinct locked profiles. QEMU's `raspi1ap` profile is
another profile: it supplies an ARM1176JZF-S/BCM2835 execution target but models
the Model A+ device topology, so it must not inherit the physical Model B's
Ethernet and connector claims.

UTM is an explicit runtime profile rather than an automatic macOS alias for
QEMU. The guest-facing machine is still QEMU `virt`, but the host contract is
different and is therefore locked:

```jsonc
{
  "schema": "eclogite.machine/v1",
  "name": "utm-virt-arm64",
  "aliases": ["utm-arm64", "arm64-utm"],
  "platform": "arm64",
  "resources": { "vcpus": 1, "memory_mib": 256 },
  "runtime": {
    "backend": "utm",
    "application": "UTM",
    "minimum_version": "5",
    "host": { "os": "macos", "architecture": "arm64" },
    "virtualization_backend": "qemu",
    "machine": "virt",
    "acceleration": "hvf",
    "bundle_format": "utm",
    "disk_import": "copy"
  }
}
```

This follows the working `linux-libre-vm` runner. The generated driver uses
UTM's AppleScript API to configure the VM, `utmctl` for lifecycle operations,
direct kernel boot, a serial pseudo-terminal, shared NAT networking, and
VirtFS/9p. UTM imports the root disk into the `.utm` bundle, so guest writes
never alter the immutable source image. Version one supports this profile only
on Apple Silicon; x86-64-on-Apple-Silicon emulation is not advertised as a
predefined UTM profile.

A machine profile may exist without a software profile or system composition.
Such a profile records supported hardware while remaining visibly
`profile-only`; `eclogite create` must reject it until compatible software,
kernel configuration, boot policy, and required device capabilities resolve.

## Stage

```jsonc
{
  "schema": "eclogite.stage/v1",
  "name": "target-userland",
  "context": "target",
  "after": [],
  "toolchain": "gnu",
  "packages": ["@base", "@network", "vim"]
}
```

A leading `@` denotes a meta-package. Stages describe build contexts (target
userland, target kernel, image), not steps within a package. Stage edges must
form a DAG. No stage builds a toolchain.

## Toolchain and build runtime

Eclogite does not build compilers, binutils or libc. Toolchains — native and
cross — are release artifacts of `linux-libre-vm`, built from source there. A
toolchain document names the `linux-libre-vm` release and the targets it
covers:

```jsonc
{
  "schema": "eclogite.toolchain/v1",
  "name": "gnu",
  "provider": "linux-libre-vm",
  // linux-libre-vm release that published the dev images and toolchains
  "release": "toolchains-2026.10.1",
  "targets": {
    "x86_64": { "triplet": "x86_64-linux-gnu" },
    "arm64": { "triplet": "aarch64-linux-gnu" },
    "armv6-bcm2835": { "triplet": "armv6-linux-gnueabihf" }
  }
}
```

`linux-libre-vm` builds toolchains for `aarch64-linux-gnu`, `x86_64-linux-gnu`,
`armv6-linux-gnueabihf`, `armv7-linux-gnueabihf` and `riscv64-linux-gnu`, on
both hosts. Its dev images currently contain convenience copies under
`/opt/cross/<triplet>`, but those copies are not Eclogite build inputs.

Builds always run in the single build runtime, a VM booted from the
`linux-libre-vm` dev image for the host's architecture (`x86_64` or `arm64`).
The exact target toolchain artifact is mounted read-only at
`/opt/eclogite/toolchains/<triplet>` and builders receive a `PATH` rooted there.
The lock records, by SHA-256, the dev image and that artifact for each (host
architecture, target) pair; these identities enter every dependent key. Version
1 never treats artifacts built for different host architectures as the same
cache input. The `reference-system-gcc` toolchain in the catalog
describes how the reference build used distribution compilers and is kept only
as migration data.

## Software profile

A software profile describes everything installed or generated for the guest:
target platform, build stages, kernel selection, package closure, services,
root filesystem policy, image format, and tests. It never declares vCPU count,
memory, emulated device models, firmware, or a hypervisor backend.

```jsonc
{
  "schema": "eclogite.software/v1",
  "name": "reference-arm64",
  "aliases": ["minimal-arm64"],
  "platform": "arm64",
  "stages": ["target-userland", "target-kernel", "image"],
  "kernel": {
    "package": "linux-libre",
    "fragments": ["base", "arm64", "qemu-virtio"]
  },
  "root": {
    "hostname": "eclogite",
    "init": "runit",
    "readonly": true,
    "tmpfs": ["/run", "/tmp"]
  },
  "image": {
    "format": "ext4",
    "size_mib": 256
  },
  "tests": ["boot-shell", "dhcp", "shutdown"]
}
```

The kernel package remains a normal graph node. Fragment names resolve below
`catalog/packages/linux-libre/config/`. Static root content comes from the
`base-files` package. The image builder composes only declared package outputs.

## System composition

A system is the preferred single input file for `validate`, `plan`, `lock`, and
`create`. It is deliberately small: it names one machine profile and one
software profile while keeping those reusable definitions separate.

References may use predefined catalog names or declared aliases:

```jsonc
{
  "schema": "eclogite.system/v1",
  "name": "utm-arm64",
  "machine": "utm-arm64",
  "software": "minimal-arm64"
}
```

They may instead link to files. Relative paths are resolved from the directory
containing the system file, not from the process working directory:

```jsonc
{
  "schema": "eclogite.system/v1",
  "name": "local-arm64",
  "machine": "./machines/my-utm-machine.jsonc",
  "software": "../software/minimal-arm64.jsonc"
}
```

Reference strings have deterministic syntax:

- a bare value such as `utm-arm64` is an exact typed catalog name or alias;
- a value beginning with `./` or `../` is a file path relative to this file;
- absolute paths are rejected in persisted system files because they are not
  portable; the user can place a local file behind a relative link instead;
- HTTP, HTTPS, and Git URLs are not object references. Remote definitions must
  be fetched and pinned through a registered catalog source before resolution;
- machine references may resolve only machine objects, and software references
  only software objects. A same-named object of another type is irrelevant.

The resolved lock records the canonical object name, defining catalog or file,
document hash, and alias provenance. Renaming an alias without changing the
target does not make the selected object ambiguous, while changing the linked
file changes the lock input hash.

Resolution fails if the machine and software profiles name different platforms
or if the software requires a device capability the machine does not provide.
This keeps hardware sizing and topology reusable without letting them silently
change the package graph, and keeps the software image reusable across every
compatible machine profile.

## Lock file

`eclogite lock minimal-arm64` writes
`state/minimal-arm64/system.lock.json`. It contains the resolved stage order,
expanded machine and software profiles, package closure, provenance, exact
source revisions, patch and builder hashes, toolchain identity, platform,
dependency keys, kernel fragment hashes, device requirements, resources, and
image settings.

Builds read the lock, never unresolved intent. If catalog or system inputs no
longer match the lock's input hash, `build` fails and tells the user to inspect
`eclogite plan` before intentionally running `eclogite lock`.

The lock is pretty-printed deterministically for review. Hashes use a separate
canonical representation with lexicographically ordered keys, minimal string
escaping, decimal integers, and no insignificant whitespace.
