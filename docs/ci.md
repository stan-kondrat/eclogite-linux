# GitHub CI, website, and release plan

This document defines the intended GitHub automation. The initial static-site
workflow is implemented in `.github/workflows/pages.yml`; build, layer, and
release workflows remain part of the implementation plan.

## Pull requests and pushes

The main CI workflow will run the repository's single validation entry point on
both Ubuntu and macOS. It will build the standalone C17 `eclogite` tool from
scratch, run its unit and fixture tests, validate JSONC/JSON schemas and examples,
exercise generated build plans without fetching sources, test the `vm.sh`
bundle contract with a mock runtime driver, and check the static-site staging
output.

The minimum required checks should be:

- Linux `x86_64`: compiler build, tests, schemas, plans, shell checks, website;
- macOS `arm64`: compiler build, tests, schemas, and plans;
- formatting/lint checks that do not rewrite files in CI.

Architecture-specific VM boot tests are a later job because they need QEMU,
large cached artifacts, and a longer timeout. They should run on main and on
explicitly requested pull requests rather than on every documentation change.

The generated UTM driver is syntax- and contract-tested in normal CI with a
mock lifecycle backend. A real UTM smoke test requires an Apple Silicon macOS
runner with UTM 5 installed and Automation permission, so it is a separate
environment-gated job rather than a prerequisite for ordinary pull requests.

## Layer builds and publication

GitHub Actions is the primary builder of package, kernel and image layers. For
each published system, a workflow locks the system, computes the input keys,
checks which keys already exist in the remote layer store (GHCR first), builds
only the missing ones, and publishes them with their key documents and
manifests (see [storage](storage.md#remote-layer-store)).

- Builds run in the same build runtime as local builds: a VM booted from the
  `linux-libre-vm` dev image for the runner's architecture, with the pinned
  cross toolchain mounted read-only. The runner's own compiler is never used.
  Official layer jobs use dedicated self-hosted Linux builders labelled
  `eclogite`, `kvm`, and `x86_64` or `arm64`; a preflight checks `/dev/kvm` and
  hardware acceleration before any build starts. Standard GitHub-hosted
  runners validate schemas, documentation, the website, and host-tool builds,
  but do not publish VM-built layers because nested virtualization is not a
  supported hosted-runner guarantee.
- The main branch and release tags may execute and publish layers. Pull
  requests resolve and validate the same plan on GitHub-hosted runners but
  never execute package hooks on the self-hosted builders. A maintainer may run
  a reviewed commit through an explicitly protected manual workflow; fork code
  and `pull_request_target` jobs never receive a self-hosted runner label or
  publication credentials.
- A rebuild of an existing key on main compares output hashes with the
  published layer and reports non-reproducibility instead of overwriting it.
- Publication records the immutable OCI digest and emits a GitHub OIDC-backed
  provenance attestation binding the digest, input key, commit, and protected
  workflow identity. `eclogite fetch` verifies that identity before accepting a
  layer into the local cache.

**Decision — CI uses the same runtime as local builds.** Because keys include
the dev image and toolchain identities, CI and local builds share keys only if
both run in the `linux-libre-vm` VM. They do, so local builds on the same host
architecture pull what CI published.

**Decision — host-specific layer keys in version 1.** A target built on an
`x86_64` host and on an `arm64` host uses two different cross-compiler binaries,
even when they were built from the same sources and configuration. Each key
therefore includes the exact toolchain artifact hash and build-host
architecture. CI builds the published target matrix on both builder
architectures so matching local hosts can pull. A scheduled
`eclogite reproduce`/`compare` job compares corresponding outputs across host
architectures, but equality does not merge their cache identities.

## Static website

The current Pages workflow validates the checked-in dependency-free site on
relevant pull requests. On pushes to `main` and manual dispatches, it stages
`site/` as a disposable `_site/` tree, uploads the Pages artifact, and deploys
it through the protected `github-pages` environment. The deploy job has only
the `pages: write` and OIDC permissions required by GitHub Pages; pull requests
never enter that job.

This is an intentional first step. It publishes the reviewed website that
exists today without claiming that the catalog generator already exists.
After `eclogite site` is implemented, the staging job will combine three
sources:

1. maintained pages and presentation from `site/`;
2. canonical engineering documents from `docs/`;
3. generated catalog pages, graph/search JSON, and indexes emitted from
   schema-validated JSONC or strict JSON.

`eclogite site` will perform that complete static build; GitHub Pages only
uploads and deploys `_site/`. No Jekyll, Node-based site framework, or
third-party browser library is required; Node on the hosted runner is currently
used only to syntax-check the plain browser JavaScript. The generated catalog
is an output, never a second hand-maintained source of package data.

At that point, path filtering will expand to include `catalog/`, `docs/`, the
site generator, and its schemas. Until then, it intentionally includes only
`site/` and the Pages workflow itself, because changes elsewhere cannot yet
regenerate the checked-in website snapshot.

## Tagged releases

A release workflow will build the standalone host command for:

- Linux `x86_64` and `arm64`;
- macOS `x86_64` and `arm64`.

Each platform release asset is a directly downloadable executable, named with
its operating system and architecture, plus a SHA-256 checksum. Users do not
need to unpack a runtime directory. Version and license information are embedded
and available through the executable. The workflow must test the exact binary
it uploads. The portable `vm.sh` template is not a separately installed product;
it ships in VM directories created by `eclogite`.

## Cache policy

CI dependency caches and Eclogite build layers are different. GitHub's Actions
cache may accelerate CI (for example source downloads), but it is not the layer
store: it is evicted, scoped to workflows, and not reachable from local
machines. Layers live in the remote layer store. Correctness must depend only on
locked inputs and verified Eclogite layer manifests; a cold build, with an empty
local cache and an unreachable remote store, remains a required supported
path.
