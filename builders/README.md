# Builders

A builder is a generic build style: `builders/<name>/build.sh`, run by
`eclogite` inside the builder (the dev VM or its container) for one package at a time. It runs the
`configure`, `build` and `install` steps, calls the package's hooks at the
steps the package names, and writes a package tree. It receives only resolved,
generated inputs and never reads the catalog.

| Builder | Steps |
|---|---|
| `configure` | optional bootstrap (`autoreconf` or gnulib `./bootstrap`), `./configure`, `make`, `make install` |
| `make` | `make`, `make install` in a chosen directory |
| `cmake` | `cmake` with the target toolchain file, `ninja`, `ninja install` |
| `linux-kernel` | apply config fragments, then the package's declared options: defaults overridden by what dependents on `linux`, the software and the machine's devices require; verify the effective `.config`; build the image |
| `files` | none: package files, symlinks and generated services only |
| `source-tree` | none: the prepared source is the output |
| `npm-workspace` | offline workspace build from the package's fetch output |

Compiling builders set `CC`, `CXX`, `LD` and `AR` for the compiler resolution
chose for the package (gcc and binutils, or clang, `ld.lld` and `llvm-ar`);
`linux-kernel` passes `LLVM=1` for clang.

Every builder then normalizes the layout (programs move to `/bin`, and `#!`
lines naming `/usr/bin`, `/usr/sbin` or `/sbin` are rewritten to `/bin`) and
applies the common `files`, `symlinks`, `remove` and `strip` arguments to the
output. See [filesystem layout](../docs/configuration.md#filesystem-layout). Each builder's arguments are described by
[`schemas/builders/<name>.schema.json`](../schemas/builders/).

Package-specific behavior must be a named tracked hook, never an inline
catalog command, and only when arguments cannot express it.

## The interface (`make`, `configure`, `files`, `linux-kernel` so far)

`eclogite build` runs `build.sh STEP` for `configure`, `build` and `install`
in order, in a constructed environment (nothing inherited), with the current
directory at `WORK`. A package hook named for a step replaces it, and
`pre-<step>`/`post-<step>` hooks run around it. The script's directory is part
of every package key that uses it, so a change to it rebuilds those packages.

| Variable | |
|---|---|
| `SRC` | the immutable fetched source tree |
| `WORK` | the tree to build in: a patched writable copy if the package has patches, `SRC` itself for an out-of-tree build (`linux-kernel`, `configure` with `out_of_tree`), else hard links with writable directories (an in-place write fails) |
| `BUILD` | an empty out-of-tree build directory |
| `DESTDIR` | the install root; it becomes the package's layer |
| `PACKAGE` | the package's catalog directory (config fragments, files) |
| `TOOLCHAIN`, `SYSROOT`, `TARGET_TRIPLET`, `BUILD_TRIPLET` | the cross toolchain (`/opt/cross/<triplet>`) and triplets |
| `CC`, `CXX`, `LD`, `AR`, `RANLIB`, `NM`, `STRIP`, `OBJCOPY` | the target tools of the package's compiler |
| `CFLAGS`, `CXXFLAGS`, `LDFLAGS` | `-O2` and `-ffile-prefix-map` so the work path does not reach the output |
| `KERNEL_ARCH`, `KCONFIG`, `KCONFIG_REQUIRED` | `linux-kernel`: the kernel architecture, the resolved options (one `CONFIG_X=value` per line) and the names of the required ones; a required option that does not survive fails the build, a default the defconfig overrides is a warning |
| `JOBS`, `HOME`, `SOURCE_DATE_EPOCH`, `LC_ALL`, `TZ`, `PATH` | from the lock's `build_environment`; `PATH` is the toolchain, `/bin`, `/usr/bin` |
| `ARG_<NAME>` | the package's builder arguments: a list one item per line, a map as `K=V` lines |
| `DEP_<NAME>` | the layer of each build or link dependency that is a package |
| package parameters | by name, such as `CONSOLE` |

After `install`, eclogite moves programs to `/bin`, rewrites `#!` lines,
applies `files`, `symlinks`, `remove` and `strip`, sets every time to
`SOURCE_DATE_EPOCH`, and publishes the tree read-only as
`<cache>/layers/<key>/` with the manifest `<key>.json` written last. The
`cmake`, `source-tree` and `npm-workspace` scripts come with the packages that
need them.
