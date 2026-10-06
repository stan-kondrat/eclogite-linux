# Installation, remote catalogs, and shared storage

## Single-executable distribution

`eclogite` is distributed as one native executable. A release user downloads
the binary for the host operating system and architecture, verifies its
checksum, marks it executable, and places it on `PATH`:

```text
~/.local/bin/eclogite
```

The release matrix is Linux and macOS on `x86_64` and `arm64`. The executable
does not require Python, Node.js, a JSON library, or files from the source
repository. Linux releases should be statically linked when practical. A macOS
release remains one Mach-O file and may use stable libraries supplied by macOS.

Building the same executable from source remains supported with a C17 compiler,
Make, and a POSIX shell.

## Per-user directory layout

`~/.local/eclogite` should not contain every kind of data. Eclogite follows the
XDG directory roles so users and cleanup tools can distinguish configuration,
state, and replaceable cache data:

```text
~/.local/bin/eclogite

~/.config/eclogite/
  catalogs.jsonc              registered remote catalog sources

~/.cache/eclogite/
  git/mirrors/<url-key>.git/  shared bare Git object mirrors
  catalogs/<name>/<commit>/   immutable catalog snapshots
  sources/<source-key>/       immutable package source trees
  downloads/                  verified non-Git source archives
  layers/<input-key>/         immutable build layers, built locally or pulled
  temporary/                  interrupted/recoverable temporary work

~/.local/state/eclogite/
  logs/                       global fetch and cache-maintenance logs
```

The actual roots are:

| Purpose | Environment override | Default |
|---|---|---|
| executable | `PATH` | `~/.local/bin/eclogite` |
| configuration | `XDG_CONFIG_HOME` | `~/.config/eclogite` |
| shared cache | `XDG_CACHE_HOME` | `~/.cache/eclogite` |
| global state | `XDG_STATE_HOME` | `~/.local/state/eclogite` |

The CLI's `--cache-dir DIR` overrides the Eclogite cache root for one invocation.
Project locks, generated plans, and explanations remain under the project's
`state/` directory because they are reviewable project state rather than a
replaceable download cache.

Everything below the cache root is safe to delete while no Eclogite process is
using it. The next fetch or build can recreate it from locks. Deletion loses
time, not source configuration or VM bundles.

## Remote catalog sources

A catalog can be local or stored in a Git repository. Remote catalogs are
registered by a short local name:

```text
eclogite catalog source add upstream https://example.org/eclogite/catalog.git
eclogite catalog source sync upstream
eclogite --catalog-source upstream catalog list package
```

Registration is stored as JSONC in `catalogs.jsonc`. Git data is downloaded to
the common cache rather than copied into every project. A moving branch or tag
may be used for discovery, but every system lock records the resolved catalog
URL, exact commit, and tree identity. `catalog source sync` may discover a newer
commit; it never changes a project lock.

The Git mirror is mutable transport storage and is never a build input. Before
resolution, Eclogite materializes an immutable snapshot keyed by repository URL
and commit. Package JSONC, patches, files, kernel fragments, and hooks are all
read from that snapshot. Multiple projects using the same commit share it.

Local catalog roots use `--catalog DIR`. Registered remote sources use
`--catalog-source NAME`. Both options are repeatable. No catalog is allowed to
silently override another object with the same typed name.

## Package source cache

Package Git repositories use the same mirror principle:

1. `fetch` obtains the locked commit into `git/mirrors/<url-key>.git`;
2. it verifies that the requested commit and any declared submodule commits
   exist;
3. it materializes a read-only tree under `sources/<source-key>/`;
4. builders receive that immutable tree and a separate writable work directory.

The source key includes the canonical URL, commit, submodule identities, and
source preparation policy. Branch names and tags are useful labels but are not
source identities. Builds never run in a mutable Git checkout and never fetch
objects on demand.

## Remote layer store

Most layers are not built on the user's machine. GitHub Actions builds them
from locked inputs and publishes them to a remote layer store; local builds pull
what exists (`eclogite fetch`) and build only what is missing. Building itself
stays offline.

The first store is **GitHub Container Registry (GHCR)**. Each layer is an OCI
artifact whose human-readable tag is its input key. Locks and store indexes
refer to the immutable OCI digest, never trust the tag alone. The artifact
carries the key document, output manifest, layer contents, and a provenance
attestation as content-addressed blobs, so identical files are stored once.
Public packages can be pulled without credentials. An **S3-compatible object
store** is planned as a second backend with the same contract: input key →
immutable digest + key document + manifest + content + attestation.

Rules:

- a layer is pulled only by exact input key and immutable digest;
- before it enters the local cache, `eclogite` verifies the key document,
  manifest, content hashes, and a signed provenance attestation against the
  selected store's trust policy;
- the local cache is always consulted first; the remote store is a fallback,
  never a source of truth that overrides a verified local layer;
- publication happens from CI on the main branch and release tags; local
  builds never push unless the user explicitly configures credentials and asks
  for it (`eclogite cache push`);
- pull requests validate locks and plans but do not execute package hooks on
  the self-hosted layer builders and do not publish;
- the official GHCR store accepts only GitHub OIDC-backed attestations from the
  repository's protected publication workflow on the main branch or a release
  tag; the attestation binds the OCI digest, input key, source commit, and
  workflow identity;
- a remote outage or missing layer degrades to a local build, never to a wrong
  layer.

Registry access uses the system `curl` (with the platform's TLS), so the
single executable stays free of HTTP and TLS libraries.

Named stores are declared in the host configuration, not in a system file:

```jsonc
{
  "schema": "eclogite.host/v1",
  "default_layer_store": "official",
  "layer_stores": {
    "official": {
      "type": "oci",
      "repository": "ghcr.io/OWNER/eclogite-layers",
      "trust": {
        "issuer": "https://token.actions.githubusercontent.com",
        "repository": "OWNER/eclogite-linux",
        "workflow": ".github/workflows/layers.yml"
      }
    }
  }
}
```

The default path is `$XDG_CONFIG_HOME/eclogite/config.jsonc`, falling back to
`~/.config/eclogite/config.jsonc`. Credentials come from the platform's normal
credential mechanism or environment at the network command boundary and are
never copied into locks, plans, bundles, or the project directory.

## Trust boundary

Downloaded JSONC, repository contents, and remote layers are untrusted inputs:

- validation, graph, plan, and website commands never execute catalog hooks;
- paths and symlinks may not escape an immutable catalog or source snapshot;
- Git hooks are disabled during mirror and snapshot operations;
- a remote layer is not exposed to a builder or output assembly until its
  immutable digest, hashes, and provenance attestation verify;
- schemas reject unknown fields and unsafe paths;
- package hooks, patches, and installed files are hashed into the lock;
- executable package hooks run only during an explicit build;
- a locked build never follows a moved branch or tag.

This permits convenient shared downloads without turning catalog discovery into
implicit code execution.
