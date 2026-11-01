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
