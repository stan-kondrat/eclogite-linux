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

JSON Schema files under [`schemas/`](../schemas/README.md) document the format, support editor
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

## Object kinds

| Kind | Where | Schema |
|---|---|---|
| package, including meta-packages | `catalog/packages/<name>/package.jsonc` | `eclogite.package/v0.1` |
| machine profile | `catalog/machines/<name>.jsonc` | `eclogite.machine/v0.1` |
| software profile | `catalog/software/<name>.jsonc` | `eclogite.software/v0.1` |
| system | `catalog/systems/<name>.jsonc`, or anywhere | `eclogite.system/v0.1` |
| hardware platform | `catalog/platforms/<name>.jsonc` | `eclogite.platform/v0.1` |
| ABI (OS + libc) | `catalog/abis/<name>.jsonc` | `eclogite.abi/v0.1` |
| toolchain | `catalog/toolchains/<name>.jsonc` | `eclogite.toolchain/v0.1` |
| distribution defaults | `catalog/defaults.jsonc` | `eclogite.defaults/v0.1` |
| fact vocabulary | `catalog/facts.jsonc` | `eclogite.facts/v0.1` |
| device models | `catalog/devices.jsonc` | `eclogite.devices/v0.1` |

[`eclogite.schema.json`](../schemas/eclogite.schema.json) describes the same
objects concatenated into one configuration document.

## Choices

Every choice a system makes has one place, and one mechanism decides it:

| Choice | Decided by | Fixed at |
|---|---|---|
| CPU architecture | the machine's hardware platform | hardware |
| ABI: OS and C library (glibc, musl, FreeBSD) | system `abi`, else software `abi`, else the defaults | compile time: triplet, sysroot, every package key |
| compiler (gcc, clang) | system `compiler`, else software `compiler`, else the defaults; per package, the first the package's build constraints allow | compile time: each package's key |
| kernel, init, shell, utilities, DHCP client, `ip`, `vi`, … | [capabilities](#capabilities-and-alternatives): system or software `providers`, else the provider the software selects, else the defaults | composition |
| hardware drivers | the machine's [device models](#device-models) | the kernel configuration |
| VM-only packages such as `host-share` | [conditional dependencies](#conditional-run-dependencies) on machine facts | composition |

Nothing is special-cased: Linux-libre, runit, glibc, bash and BusyBox are
packages that declare which capabilities they provide, and
[`catalog/defaults.jsonc`](#defaults) holds the distribution's choices for
systems that select nothing.

## Package

Package resources are relative to the directory containing `package.jsonc`.
Only `schema`, `name`, `version`, `source` and `builder` are required; every
other field defaults to empty.

```jsonc
{
  "schema": "eclogite.package/v0.1",
  "name": "coreutils",
  "version": "9.6",
  // Sources are immutable once locked.
  "source": {
    "type": "git",
    "url": "https://git.savannah.gnu.org/git/coreutils.git",
    "revision": "0123456789abcdef0123456789abcdef01234567"
  },
  "builder": "configure",
  "patches": ["patches/0001-example.patch"],
  "dependencies": {
    "build": ["gnulib"],
    "link": ["glibc"]
  },
  "arguments": {
    "bootstrap": "gnulib",
    "configure": ["--prefix=/usr", "--disable-nls"]
  }
}
```

### Filesystem layout

Programs live only in `/bin`; there is no `/usr/bin`, `/sbin` or `/usr/sbin`.
Packages keep their usual `--prefix=/usr`, so data, `libexec` and headers stay
under `/usr`, and every builder normalizes the output after `install`:

- programs installed in `/usr/bin`, `/usr/sbin` or `/sbin` move to `/bin`;
  two packages providing the same program is a resolution error;
- `#!` interpreter lines naming those directories are rewritten to `/bin`, so
  `#!/usr/bin/env node` scripts from npm work without a `/usr/bin/env` link;
- shared libraries stay where their build puts them; glibc's loader is at the
  path its ABI fixes (`/lib/ld-linux-aarch64.so.1`, `/lib64/ld-linux-x86-64.so.2`).

Paths compiled into a program are not rewritten. A package that hard-codes
`/sbin` or `/usr/bin` carries a patch, as `runit` does for `/sbin/runit`; the
kernel finds init at `/bin/init`.

### Builders and arguments

A builder is a generic build style. There are seven:

| Builder | For |
|---|---|
| `configure` | a `./configure` script, autoconf or hand-written, then `make` and `make install`; `bootstrap` produces the script with `autoreconf` or gnulib |
| `make` | a Makefile without a configure step |
| `cmake` | a CMake project, built with Ninja |
| `linux-kernel` | Linux-family kernels: config fragments, required options, image |
| `files` | no compilation: package files, symlinks and generated services |
| `source-tree` | the prepared source itself, as a build input for other packages |
| `npm-workspace` | an npm workspace built offline from the package's fetch output |

Each builder's `arguments` are validated by
`schemas/builders/<builder>.schema.json`. Every builder accepts the common
arguments `hooks`, `environment`, `files`, `symlinks`, `remove` and `strip`.

Package-specific behaviour is a hook: `hooks/<name>.sh` in the package
directory, named per step. `<step>` replaces the builder's `configure`,
`build` or `install` step; `pre-<step>` and `post-<step>` run around it:

```jsonc
"arguments": {
  "hooks": { "configure": ["conf-cc"], "install": ["install"] }
}
```

Hook content is hashed into the package key. JSONC never contains inline shell.
Prefer arguments over hooks: an environment variable, a make target or a
removed path is data, not a script.

### Variants

Arguments that differ by platform are `variants`: a predicate over target facts
and the arguments merged when it holds (lists appended, maps merged, scalars
replaced). Builders never see platform-keyed arguments.

```jsonc
"variants": [
  { "when": { "arch": { "eq": "aarch64" } }, "arguments": { "image": "Image.gz" } },
  { "when": { "arch": { "eq": "x86_64" } }, "arguments": { "image": "bzImage" } }
]
```

### Parameters

A package that needs a value from the selected system reads it by JSON Pointer.
The value is exposed to the builder, hooks and services as `${NAME}`, and
enters the package key, so only packages that read a value rebuild when it
changes:

```jsonc
// console-login
"parameters": {
  "CONSOLE": "/machine/boot/console"
}
```

Pointers are rooted at the resolved system: `/machine`, `/software` and
`/platform`.

### Services

Supervised services are declared, not written as init scripts. The image step
generates them for the software profile's init system (runit:
`/etc/service/<name>/run` and a `log/run` using `svlogd`):

```jsonc
"services": {
  "theia": {
    "run": ["node", "lib/backend/main.js", "/mnt/shared/workspace", "--port=3000"],
    "directory": "/opt/theia/examples/browser",
    "requires_mounts": ["/mnt/shared"],
    "create_directories": ["/mnt/shared/workspace"]
  }
}
```

`run` executes with `PATH=/bin`. Until every `requires_mounts` entry
is mounted, the service exits and the supervisor retries it. `stdin` opens a
file such as a console device, `log: false` disables log capture, and
`restart_delay_seconds` waits before a restart. Because the root is
read-only, each generated service's `supervise` directory is a link into
`/run`.

### Mounts

Filesystems a package needs at boot are declared like services. The image
step writes every package's mounts, plus the software profile's root and
tmpfs entries, to `/etc/fstab` and creates the mount points in the read-only
root; the init system mounts them:

```jsonc
// host-share
"mounts": {
  "/mnt/shared": {
    "type": "9p",
    "source": "share",
    "options": ["trans=virtio", "version=9p2000.L", "msize=262144"],
    "optional": true
  }
}
```

`optional` becomes `nofail`: boot continues when the VM runtime offers no
share.

### Tests

A package owns the checks that prove it works in a booted guest:
`tests/<name>.sh`, run over the serial console by the test runner, which
enforces `timeout_seconds` and exports `SOURCE_DATE_EPOCH`. `needs` names
packages the script uses, which must be in the closure, and `when` limits the
test to machines where it can pass:

```jsonc
"tests": {
  "dhcp": {
    "when": { "devices": { "has": "network" } },
    "needs": ["iproute2"],
    "timeout_seconds": 60
  }
}
```

A system runs the tests of every package in its closure, plus the runner's
built-in `boot-shell` and `shutdown` checks. Adding a package adds its tests.

### Config on a dependency

A dependency can require configuration of what it depends on. The kernel is
the main case: a package that needs a kernel option depends on the `linux`
capability, which every Linux-family kernel provides next to `kernel`, and
puts the option on that dependency:

```jsonc
// host-share
"dependencies": {
  "run": [{ "package": "linux", "config": { "CONFIG_9P_FS": "y" } }]
}

// theia: inotify on Linux; on another kernel family the entry does not apply
{ "package": "linux", "when": { "os": { "eq": "linux" } },
  "config": { "CONFIG_INOTIFY_USER": "y" } }
```

The provider defines what it accepts inside its own `package.jsonc`; there is
no separate schema file per package. `configurable.options` is the closed set
of settings, each with its allowed `values` and a `default`:

```jsonc
// linux-libre
"configurable": {
  "format": "kconfig",
  "options": {
    "CONFIG_TMPFS":  { "values": ["y", "n"], "default": "n" },
    "CONFIG_NET_9P": { "values": ["y", "m", "n"], "default": "n" },
    "CONFIG_9P_FS":  { "values": ["y", "m", "n"], "default": "n",
                       "requires": { "CONFIG_NET_9P": "y" } }
  }
}
```

The validator checks every requirement against the chosen provider's
definitions:

- the option must be declared: `CONFIG_EXT4_FS` on a kernel that does not
  declare it is an error;
- the value must be one of its `values`: `CONFIG_TMPFS=m` on a bool is an
  error;
- `requires` names options that must be on for this one to take effect,
  which Kconfig would otherwise drop silently. They are implied, recorded as
  "implied by CONFIG_9P_FS", and a requirement contradicting one is an error;
- an option nobody requires gets its `default`. With `"n"` defaults the
  kernel enables exactly what the system's packages and hardware ask for.

A package's definitions are also checked on their own: each default is one of
its values, and `requires` names declared options. Config on a package without
`configurable` is an error. The requirement goes to whichever package
resolution chooses: `linux-libre` by default, or a custom kernel, which
declares its own options.

The kernel builder merges every requirement on the chosen kernel, from three
sources, runs `olddefconfig`, and fails if the effective configuration drops
or changes any of them:

| Source | Says | Example |
|---|---|---|
| a software profile's `packages` entry | policy | `{ "package": "linux", "config": { "CONFIG_PREEMPT": "y" } }` |
| dependencies of packages in the closure | what the software uses | `host-share`: `CONFIG_9P_FS`; `runit`: `CONFIG_PROC_FS` |
| the machine's device models ([`devices.jsonc`](#device-models)) | what the hardware needs | `virtio-9p-device`: `CONFIG_NET_9P_VIRTIO`; `pl031`: `CONFIG_RTC_DRV_PL031` |

Only packages in the closure contribute, so hardware and features follow the
system: a Raspberry Pi kernel gets no virtio and no 9p, and `CONFIG_9P_FS`
appears only where `host-share` is selected. Two sources requiring different
values for one option is a resolution error naming both. The merged config
enters the kernel's key only, so adding a package that needs a new option
rebuilds the kernel and nothing else; the lock records each option with the
package or device that required it.

### Build-model fields

Defined by the [build model](build-model.md):

```jsonc
// builder tools a build runs, checked against the toolchain's tool manifest
"dependencies": { "build": ["builder:python3", "builder:gcc"] },
// the lock fails unless that builder tool has this package's source revision
"matches_builder_tool": "node",
// where the package can be built, run, and what a machine must provide
"compatible": {
  "build":   { "memory_mib": { "ge": 3072 } },
  "target":  { "arch": { "in": ["aarch64", "x86_64"] } },
  "machine": { "memory_mib": { "ge": 64 } }
}
```

A package without `compatible` has no restrictions. An optional `fetch` phase
runs a named hook with network access before the offline build and is pinned
by `output_sha256`, which may be keyed by platform.

### Capabilities and alternatives

A dependency names what it needs, which is not always one package:

- a **package**, by name;
- a **capability**, a name that packages declare in `provides`, such as
  `kernel`, `linux` (a Linux-family kernel), `init`, `libc`, `cc-runtime`
  (compiler runtime and unwinder),
  `c++-runtime` (C++ standard library), `sh`, `core-utils`, `system-utils`,
  `utils`, `dhcp-client`, `ip` or `vi`. Capability and package names share one
  namespace; a meta-package may provide a capability as a whole (`gnu-utils`
  provides `utils`);
- **ordered alternatives**, `{ "first": ["a", "b"] }`, each a package or a
  capability.

```jsonc
// linux-libre                        // glibc
"provides": ["kernel"],               "provides": ["libc"],
"compatible": { "target":             "compatible": { "target":
  { "os": { "eq": "linux" } } }         { "os": { "eq": "linux" } } }

// vim: runs wherever a C library does
"dependencies": { "link": ["libc"], "run": ["libc"] }

// alternatives: a board-specific kernel where it fits, Linux-libre elsewhere
{ "first": ["linux-board", "linux-libre"] }
```

In short, a capability resolves to the system's or software's `providers`
entry, else the one provider the software selects, else a provider already
chosen for another capability, else the [defaults](#defaults); alternatives
take the first selected, else the first compatible; every bootable system has
exactly one `kernel` and one `init`. Each choice depends only on the system's
facts and explicit selection, so resolution is deterministic and a conflict is
reported rather than solved. [Resolution](resolution.md) specifies every
step and error; the lock records each choice and its reason, and
`eclogite why package:linux-libre` prints it.

The kernel is therefore an ordinary package. A software profile of only
`"packages": ["vim"]` resolves to vim and the default libc, kernel and init on
Linux, and to a FreeBSD libc, kernel and init with `"abi": "freebsd"`. Naming
another kernel in `packages`, such as a custom `linux-board` package that
provides `kernel`, replaces the default.

### Capability-owned files

Two providers of one capability can share a system: a script may need
`/bin/bash` while BusyBox is the shell. A provider lists the files that belong
to a capability, and only the chosen provider's are installed:

```jsonc
// bash                                    // busybox
"provides": {                              "provides": {
  "sh": {                                    "sh": { "symlinks": { "/bin/sh": "busybox", "/bin/ash": "busybox" } },
    "symlinks": { "/bin/sh": "bash" }        "core-utils": { "symlinks": { "/bin/ls": "busybox", ... } },
  }                                          "dhcp-client": {
}                                              "symlinks": { "/bin/udhcpc": "busybox" },
                                               "files": { "files/udhcpc.script": "/usr/share/udhcpc/default.script" },
                                               "services": { "udhcpc": { "run": ["udhcpc", "-f", "-i", "eth0"] } }
                                             }
                                           }
```

Owned symlinks, files and services are composition, not package output: the
image step installs them, so package keys and the layer cache do not depend on
which provider was chosen. BusyBox is built once with every applet. Two chosen
providers owning the same path is an error.

A capability is also a contract: `system-utils` promises a `getty` with
agetty's options, so util-linux owns the `/bin/getty` link to `agetty`, and
`console-login` works with either provider.

### Conditional run dependencies

A run dependency may carry a predicate over target and machine facts; the
package is selected only on systems where it holds. This is how hardware-
dependent packages join a closure without a software profile naming a
machine:

```jsonc
// reference-system
"run": [
  "base", "network", "editor",
  { "package": "host-share", "when": { "devices": { "has": "shared-directory" } } }
]
```

The lock records which conditions held, so each system's closure is exact.
Conditions are allowed on run dependencies only: build and link dependencies
describe how a package is built, which must not depend on the machine.

Build and link dependencies order builds and must be acyclic. Run
dependencies only say what must be installed together and may form cycles:
`glibc` needs `gcc-runtime` at runtime, while `gcc-runtime` links against
`glibc`.

Packages with no upstream source are allowed: `base-files` has
`"source": { "type": "none" }` and the `files` builder.

## Meta-package

A meta-package is a package with no source, builder or files: only `run`
dependencies. It uses the same `eclogite.package/v0.1` schema, lives in the same
`catalog/packages/<name>/` layout, and is referenced by its plain name like
any other package:

```jsonc
{
  "schema": "eclogite.package/v0.1",
  "name": "network",
  "dependencies": {
    "run": ["iproute2", "dhcpcd"]
  }
}
```

Selecting a meta-package selects its run dependencies, which may be other
meta-packages. It is a graph node without a build or an output, and its name
shares the package namespace. Provenance is retained so
`eclogite why --config SYSTEM.jsonc package:NAME` can explain the selection
chain.

## Facts

Facts are typed values read from platform, machine and builder documents and
used by `compatible` and `variants`. The whole vocabulary is one document,
`catalog/facts.jsonc`:

```jsonc
{
  "schema": "eclogite.facts/v0.1",
  "facts": {
    "memory_mib": {
      "description": "Memory available to the guest, or to one build in the builder VM.",
      "type": "integer",
      "from": {
        "machine": ["/resources/memory_mib"],
        "builder": ["/builder/resources/memory_mib"]
      },
      "aggregate": { "machine": "sum", "builder": "max" }
    }
  }
}
```

The device-kind vocabulary belongs to the machine schema; the `devices` fact
collects it without repeating it. See
[Build model: compatibility](build-model.md#compatibility-facts-constraints-and-evidence)
for types, operators, scopes and evaluation.

## Device models

A machine names device models; `catalog/devices.jsonc` says what each model is
and, in `requires`, the config its driver needs from a capability:

```jsonc
{
  "schema": "eclogite.devices/v0.1",
  "devices": {
    "virtio-9p-device": {
      "kind": "shared-directory",
      "requires": { "linux": { "CONFIG_VIRTIO_MMIO": "y", "CONFIG_NET_9P": "y", "CONFIG_NET_9P_VIRTIO": "y" } }
    },
    "pl031": {
      "kind": "rtc",
      "requires": { "linux": { "CONFIG_RTC_CLASS": "y", "CONFIG_RTC_HCTOSYS": "y", "CONFIG_RTC_DRV_PL031": "y" } }
    }
  }
}
```

A requirement applies only when the system has that capability; a device
never adds a package. The same machine can therefore run a FreeBSD system,
whose kernel would provide its own capability for its own options. A
machine's device entry must use a listed model, and its `kind` must match the
model's. Model names are unique across kinds (`bcm2835-gpio`,
`bcm2835-spi`). A model without `requires` needs nothing beyond the kernel
defaults.

## Platform

A platform is hardware only: the architecture and what the CPU guarantees.
The machine selects it.

```jsonc
{
  "schema": "eclogite.platform/v0.1",
  "name": "arm64",
  "architecture": "aarch64",
  // CPU part of the target triplet
  "triplet_cpu": "aarch64",
  // source of the target-scope facts, with the ABI
  "cpu": {
    "isa": "armv8-a",
    "bits": 64,
    "endian": "little",
    "features": ["fp", "asimd"],
    "mmu": true
  },
  "kernel_architecture": "arm64"
}
```

Architecture and compiler flags are derived from closed platform fields. Raw
host-dependent values such as `-march=native` and `-mcpu=native` are rejected in
package arguments. The machine selects the platform; it is not where VM memory
or device topology is configured. `cpu.isa` must be a value of the `isa` fact's
order for the platform's architecture, and `cpu.features` values must be in the
`cpu_features` vocabulary.

## ABI

The ABI is the operating system and the C library. Unlike the kernel or the
shell it cannot be swapped late: every program is compiled and linked against
one libc, so the ABI selects the target triplet, the toolchain and sysroot,
and every package key.

```jsonc
{
  "schema": "eclogite.abi/v0.1",
  "name": "linux-musl",
  "os": "linux",
  "libc": "musl",
  // <platform triplet_cpu>-<suffix>: aarch64-linux-musl, armv6-linux-musleabihf
  "triplet": { "aarch64": "linux-musl", "x86_64": "linux-musl", "arm": "linux-musleabihf" },
  "toolchain": "linux-libre-vm"
}
```

A system's ABI is its system file's `abi`, else its software profile's, else
the defaults' (`linux-gnu`). Because the software profile chooses it, one
`minimal` profile becomes a musl system with `"abi": "linux-musl"` on any
machine, and the hardware profiles do not multiply. The `target` facts that
`compatible` constraints read are the platform merged with the ABI, so `os`
and `libc` come from here: glibc and musl each provide `libc` but are
compatible only with their own, and an `os` condition (`"when": { "os": ... }`)
keeps a Linux kernel requirement out of other systems.

The catalog defines `linux-gnu` and `linux-musl`. A FreeBSD target is an ABI
with `"os": "freebsd"`, its toolchain, and packages that provide `kernel`,
`libc` and `init` for it.

## Defaults

`catalog/defaults.jsonc` holds the distribution's choices, used only where a
system selects nothing:

```jsonc
{
  "schema": "eclogite.defaults/v0.1",
  "abi": "linux-gnu",
  "compiler": "gcc",
  "providers": {
    "kernel": "linux-libre",
    // the kernel already chosen wins when it is a Linux kernel
    "linux": "linux-libre",
    "init": "runit",
    // first compatible: glibc on linux-gnu, musl on linux-musl
    "libc": { "first": ["glibc", "musl"] },
    "cc-runtime": "gcc-runtime",
    "c++-runtime": "gcc-runtime",
    "sh": "bash",
    "core-utils": "coreutils",
    "system-utils": "util-linux",
    "utils": "gnu-utils",
    "dhcp-client": "dhcpcd",
    "ip": "iproute2",
    "vi": "vim"
  }
}
```

An entry may list alternatives, so one document serves every ABI: adding
FreeBSD means appending its kernel, libc and init to those lists.

## Compilers

The compiler is a build choice, not a capability: nothing it produces is
installed, but every package it compiles gets it in its key. A system chooses
one, `compiler` in its system file, else its software profile, else the
defaults (`gcc`). Each compiled package then uses:

1. the system's compiler, if the package's `compatible.build` allows it;
2. else the first other compiler, in the toolchain's `compilers` order, that
   it allows;
3. else resolution fails, naming the package.

```jsonc
// glibc: upstream builds only with GCC
"compatible": { "build": { "compiler": { "eq": "gcc" } } }
```

So `"compiler": "clang"` builds the userland and the kernel (`LLVM=1`) with
clang, while glibc and `gcc-runtime` fall back to gcc; the lock records each
package's compiler and why. Packages built with the `files` and `source-tree`
builders compile nothing and have no compiler.

LLVM needs no ABI of its own: clang targets every triplet with one binary and
uses the same glibc or musl sysroots. What changes at runtime is two
capabilities, which make the C++ library a provider choice like any other:

| Capability | `gcc-runtime` (default) | `llvm-runtime` |
|---|---|---|
| `cc-runtime` | libgcc_s | compiler-rt builtins, libunwind |
| `c++-runtime` | libstdc++ | libc++, libc++abi |

Each runtime matches its compiler's revision (`matches_builder_tool`), and
packages depend on the capability: glibc runs `cc-runtime`, nodejs links
`c++-runtime`. A system without any GNU runtime:

```jsonc
{
  "packages": ["base", "busybox"],
  "abi": "linux-musl",
  "compiler": "clang",
  "providers": { "cc-runtime": "llvm-runtime", "c++-runtime": "llvm-runtime" }
}
```

Mixing works too: clang with libstdc++, or gcc-built programs with libc++,
whose `llvm-runtime` itself falls back to clang.

## Machine profile

A machine profile describes the hardware boundary, whether the eventual target
is virtual or physical, and selects the platform. It never selects packages,
services, an init system, or root filesystem contents.

```jsonc
{
  "schema": "eclogite.machine/v0.1",
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

Devices include the serial console and the real-time clock, so the kernel
gets their drivers and packages can depend on them: `console-login` requires
a `serial` device, and `linux-libre`'s `clock` test runs only where there is
an `rtc`.

A virtual machine's block entry names the device model and attaches one disk
per image: the root image plus one per software volume. Physical boards declare
a `count`, which limits how many volumes a software profile may use.

`aliases` are optional, catalog-wide unique convenience names for CLI input.
They are exact matches, never prefix guesses: `--machine qemu-arm64` resolves
to this profile, while a path such as `--machine ./my-board.jsonc` selects a
local profile. Resolution writes the canonical name and document hash into the
generated request and lock, so the alias is not part of build identity.

### Extending a machine

A machine that differs from another only in resources, devices or notes
extends it:

```jsonc
{
  "schema": "eclogite.machine/v0.1",
  "name": "utm-virt-arm64-8g",
  "extends": "utm-virt-arm64",
  "resources": { "vcpus": 2, "memory_mib": 8192 }
}
```

`resources` is merged field by field; `devices`, `limitations`, `references`
and `status` replace the base's values; `name` and `aliases` are never
inherited. The runtime and boot contract cannot be overridden: a different
backend is a different machine. The lock records the merged result, so build
identity does not depend on how a profile was written.

The machine schema reserves `resources.cpu.model` for an exact processor model
such as `ARM1176JZF-S` or a QEMU CPU model. CPU identity affects platform
compatibility and the machine cache key; it is not an untracked runtime flag.

The kernel is a package, not a machine setting. Linux-libre, mainline Linux,
a PREEMPT_RT Linux and a board-specific kernel are peer packages that provide
`kernel`; the default applies unless the software selects another
([capabilities](#capabilities-and-alternatives)).

Physical boards and emulated boards remain different machine profiles even when
they share a CPU architecture. QEMU's `raspi1ap` profile supplies an
ARM1176JZF-S/BCM2835 execution target but models the Model A+ device topology,
so it does not extend the physical Model B profile.

UTM is an explicit runtime profile rather than an automatic macOS alias for
QEMU. The guest-facing machine is still QEMU `virt`, but the host contract is
different and is therefore locked:

```jsonc
"runtime": {
  "backend": "utm",
  "application": "UTM",
  "minimum_version": "5",
  "host": { "os": "macos", "architecture": "arm64" },
  "virtualization_backend": "qemu",
  "machine": "virt",
  "machine_options": ["gic-version=3"],
  "acceleration": "hvf",
  "bundle_format": "utm",
  "disk_import": "copy"
}
```

This follows the working `linux-libre-vm` runner. The generated driver uses
UTM's AppleScript API to configure the VM, `utmctl` for lifecycle operations,
direct kernel boot, a serial pseudo-terminal, shared NAT networking, and
VirtFS/9p. UTM imports the disks into the `.utm` bundle, so guest writes
never alter the immutable source images. Version one supports this profile only
on Apple Silicon.

A machine with `"status": "profile-only"` records hardware that is not yet
buildable; `eclogite create` rejects it. The Raspberry Pi profiles are
profile-only until after version 1 ([Migration](migration.md#after-version-1)).

## Toolchain and build runtime

Eclogite does not build compilers, binutils or libc. The toolchain document
describes the one builder image, `linux-libre-vm`: its release, the builder VM,
the cross toolchains and sysroots by target triplet, the compilers, and its
tool manifest. Each ABI names the toolchain that builds for it.

What the image does not ship yet is in the document, marked
`"status": "planned"`: the musl targets and sysroot, clang and lld, CMake and
Ninja. A system that needs a planned target, compiler or `builder:` tool fails
resolution with that reason, so the model is complete before the builder image
is.

```jsonc
{
  "schema": "eclogite.toolchain/v0.1",
  "name": "linux-libre-vm",
  "provider": "linux-libre-vm",
  // linux-libre-vm release that published the dev images and toolchains
  "release": "toolchains-2026.10.1",
  // source of the builder-scope facts
  "builder": {
    "hosts": ["aarch64", "x86_64"],
    "resources": { "vcpus": 4, "memory_mib": 4096 }
  },
  "targets": {
    "aarch64-linux-gnu": {},
    "aarch64-linux-musl": { "status": "planned" }
  },
  // in fallback order, each with the manifest tools it needs
  "compilers": { "gcc": ["gcc", "binutils"], "clang": ["clang", "lld"] },
  // tool manifest: what packages may name as builder:<tool>
  "tools": {
    "node": {
      "version": "26.10.0",
      "source": "https://github.com/nodejs/node.git",
      "revision": "151845ab90d3926ceb36eedf1eade09619c3adc9"
    },
    "clang": {
      "version": "23.1.3",
      "source": "https://github.com/llvm/llvm-project.git",
      "revision": "0d261d1ca552c95a8f007e061c787ac7132fbcbc",
      "status": "planned"
    }
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
cache input.

The dev image and toolchain artifact are the builder image: they run builds
but never contribute files to a guest. Packages declare the builder tools they
use as `builder:<tool>` in `dependencies.build`; glibc, the compiler runtimes,
Python, Node.js and everything else in the guest are target
packages built from source. Network-dependent sources such as npm lockfiles
use a fixed-output `fetch` phase in the package that needs them. See
[Build model](build-model.md).

## Software profile

A software profile describes everything installed or generated for the guest:
package selection, the ABI and capability providers when they differ from the
defaults, root filesystem policy, image and volumes. The kernel and init are
packages like any other. It never declares a platform, vCPU count, memory,
device models, firmware, or a hypervisor backend. The platform comes from the machine, so one profile serves
every compatible machine: `reference` builds for arm64 and x86_64 alike.

```jsonc
{
  "schema": "eclogite.software/v0.1",
  "name": "reference",
  "packages": ["reference-system"],
  "root": {
    "hostname": "linux-libre",
    "readonly": true,
    "tmpfs": ["/run", "/tmp"]
  },
  "image": {
    "format": "ext4"
  }
}
```

`packages` is the root of the userland closure; run dependencies come with it,
including conditional ones whose predicate holds on the selected machine.
`root` is applied by the image step: it writes `/etc/hostname`, and the root,
read-only flag and `tmpfs` entries into `/etc/fstab` together with every
package's mounts.
The kernel's build configuration belongs to the kernel package: its
`fragments` argument names files in its `config/` directory, per-architecture
fragments are its own `variants`, and software policy is a `packages` entry
with `config` on `linux`. Static root content, services and mounts come from
packages. The image step composes only declared package outputs; the
`kernel` provider's output becomes the boot kernel rather than root content.

An image without `size_mib` is sized from its package outputs plus `free_mib`
(default 64). A fixed `size_mib` is allowed when a deployment needs one; the
build fails if the outputs do not fit.

`image.strip` and `image.exclude` shrink the image without touching packages:
they are applied while package outputs are composed, so package keys and the
shared layer cache stay the same and another profile can include what this one
leaves out. The `minimal` profile uses them:

```jsonc
{
  "schema": "eclogite.software/v0.1",
  "name": "minimal",
  // base only: a root shell on the serial console
  "packages": ["base"],
  "image": {
    "format": "ext4",
    "strip": true,
    "exclude": ["/usr/include", "/usr/share/man", "/usr/share/info",
                "/usr/share/doc", "/usr/share/locale", "**/*.a", "**/*.la"],
    "free_mib": 16
  }
}
```

The package sets nest, and are written in capabilities: `base` is what boot
uses (`base-files`, `libc`, `init`, `sh`, `core-utils`, `system-utils`,
`console-login`); `reference-system` adds `utils`, `network` (`ip`,
`dhcp-client`), `editor` (`vi`) and, on machines with a shared directory,
`host-share`. With the defaults they resolve to the GNU reference userland;
`minimal-busybox` selects `busybox` as well, which then provides every
capability it offers:

```jsonc
{
  "schema": "eclogite.software/v0.1",
  "name": "minimal-busybox",
  "packages": ["base", "busybox"],
  // optional: a static BusyBox on musl, once the musl toolchain exists
  // "abi": "linux-musl",
  // optional: keep bash as /bin/sh next to BusyBox
  // "providers": { "sh": "bash" }
  ...
}
```

Optional software fields:

```jsonc
// the listed packages' files below mount go to a separate image mounted
// there; their other files go to the root image
"volumes": [
  { "name": "theia", "mount": "/opt/theia", "packages": ["theia"],
    "format": "ext4", "readonly": true }
],
// how CI build and test results are used: warn-untested, require-passed, ignore
"evidence": {
  "default": "warn-untested",
  "require-passed": ["glibc", "gcc-runtime", "nodejs"]
}
```

## System composition

A system is the preferred single input file for `validate`, `plan`, `lock`, and
`create`. It is deliberately small: it names one machine profile and one
software profile while keeping those reusable definitions separate.

References may use predefined catalog names or declared aliases:

```jsonc
{
  "schema": "eclogite.system/v0.1",
  "name": "utm-arm64",
  "machine": "utm-arm64",
  "software": "minimal"
}
```

They may instead link to files. Relative paths are resolved from the directory
containing the system file, not from the process working directory:

```jsonc
{
  "schema": "eclogite.system/v0.1",
  "name": "local-arm64",
  "machine": "./machines/my-utm-machine.jsonc",
  "software": "../software/reference.jsonc"
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

A system file may also set `abi` and `providers`, which override the software
profile's, so one reviewed software profile can be built as glibc and musl
systems side by side.

Resolution takes the platform from the machine and the ABI from the system,
software or defaults, then fails if the toolchain lacks the triplet, if a
needed target, compiler or tool is planned, if any
package in the closure has a `compatible` constraint that the target, machine
or builder does not satisfy, or if the machine cannot attach the root image and every
volume. The error names the package and the selection chain that pulled it in.

## Lock file

`eclogite lock --config SYSTEM.jsonc` writes `state/<system>/system.lock.json`.
It contains the merged machine and software profiles, platform, ABI and target
triplet, every capability choice and every package's compiler with its
reason, the package closure
in build order, provenance, the conditional dependencies that held, exact
source revisions, resolved arguments and parameters, patch, hook and builder
hashes, toolchain identity, dependency keys, the merged config of each
configurable package, such as the kernel options, with
the source of each, services, mounts, tests, resources, and image settings.

Builds read the lock, never unresolved intent. If catalog or system inputs no
longer match the lock's input hash, `build` fails and tells the user to inspect
`eclogite plan` before intentionally running `eclogite lock`.

The lock is pretty-printed deterministically for review. Hashes use a separate
canonical representation with lexicographically ordered keys, minimal string
escaping, decimal integers, and no insignificant whitespace.
