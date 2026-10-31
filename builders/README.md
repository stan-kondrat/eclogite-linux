# Builders

A builder is a generic build style: `builders/<name>/build.sh`, run by
`eclogite` inside the builder VM for one package at a time. It runs the
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

Builder scripts will be added with the scheduler so their interface can be
tested rather than guessed in advance.
