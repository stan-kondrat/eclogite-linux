# Eclogite host tool

This directory is reserved for the standalone C17 host tool. No implementation
is present during the research/layout phase.

When implemented, it must remain buildable without the Linux catalog, guest
sources, Python, a package-manager library, or a network connection.

## Planned source-build contract

Requirements: a C17 compiler, POSIX shell, and GNU Make or compatible Make.

The tool's own `Makefile` will provide this interface:

```sh
make -C tools/eclogite
make -C tools/eclogite check
make install PREFIX="$HOME/.local"
```

## Prebuilt binaries

Tagged GitHub releases should provide directly downloadable executables for
Linux and macOS on `x86_64` and `arm64`, plus checksum files. The selected asset
is renamed to `eclogite`, marked executable, and placed anywhere on `PATH`,
normally `~/.local/bin/eclogite`. It does not require an archive layout, the
source repository, Python, Node.js, or a separately installed JSON parser.

The tool runs only on the host. It is never included in generated guest images.
See [installation and shared storage](../../docs/storage.md) for remote catalog,
source-cache, and build-layer locations.
