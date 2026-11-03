# Reference results

Acceptance data for the host tool's resolver. For the current catalog,
[`golden/`](golden/) records the expected resolution of every machine ×
software profile, following the steps of
[docs/resolution.md](../../docs/resolution.md).

`golden/<machine>/<software>.json` records one of two things:

- the ABI, the target triplet, the closure, every capability choice with its
  reason, each package's compiler, the config required of each configurable
  package with its source, the capability-owned files, and the tests;
- or the error that stops resolution.

A catalog change that alters a resolution must update the affected golden
files in the same commit. The C resolver must produce the same results for
the same catalog.

## Running it

`tests/reference/run` runs the reference tool's `verify`
([tools/eclogite-mjs](../../tools/eclogite-mjs/README.md)) over every machine
× software profile: the resolution against `golden/`, the compiled lock
against `schemas/lock.schema.json`, relocking for byte-identical output, and
the lock's SHA-256 against [`lock-hashes.json`](lock-hashes.json). Nothing is
rewritten unless `tests/reference/run --update` is given, which lists each file
it changes; review that diff like any other.

The golden files are a projection of the resolution, not of the lock: `override`
stands for a system or a software override, `config` lists the required options
only, with sources as text, and `tests` lists package tests without the built-in
`boot-shell` and `shutdown`. `lock-hashes.json` covers the full lock of every
pair that resolves, built for host `aarch64`, the default `SOURCE_DATE_EPOCH`
and `--allow-unpinned` (the catalog still has a `pending` fetch hash and an
`unreleased` toolchain). The invalid and error cases are in
[tools/eclogite-mjs/tests/fixtures](../../tools/eclogite-mjs/tests/fixtures/);
the C tool runs the same files.
