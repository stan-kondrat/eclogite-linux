# Command-line design

## Command name

The installed command is `eclogite`.

Short names were checked both on the development Mac's current `PATH` and
against existing tools. None was installed locally, but that is not enough for a
portable command name:

| Candidate | Decision | Collision or problem |
|---|---|---|
| `e` | reject | too generic, difficult to search, likely to collide with aliases/editors |
| `ec` | reject | used by other current command-line tools; too generic to own |
| `eco` | reject | existing template compiler and other installed CLIs |
| `ecl` | reject | official executable of [Embeddable Common Lisp](https://ecl.common-lisp.dev/static/files/manual/ecl-23.9.9/Invoking-ECL.html) |
| `ecli` | reject | existing terminal editor CLI |
| `epkg` | reject | name of multiple existing package managers |
| `eclogite` | use | descriptive, memorable, and no notable command collision found |

The project should not install a second short binary or symlink. Users who want
one can define a personal shell alias such as `alias ecg=eclogite` without
claiming a global command name.

## Scope

`eclogite` is the host-side configuration compiler, catalog resolver, and image
builder. It is not installed in the guest and is not a runtime package manager.
Eclogite outputs are reproducibly composed, read-only images. Changing their
contents means changing JSONC intent, locking, rebuilding, testing, and
replacing the image. There is deliberately no `install`, `remove`, or `upgrade`
command for a running guest.

## Responsibilities

`eclogite` is the single host-side control plane. It is a configuration compiler
and build orchestrator, with these responsibilities:

- discover the project and selected system configuration;
- parse human-authored JSONC while preserving precise source locations;
- validate schemas, names, paths, source revisions, and semantic constraints;
- resolve machine and software profiles and reject incompatible platform or
  device contracts;
- expand meta-packages and resolve package, stage, build-host, target, kernel,
  rootfs, and image edges;
- write the deterministic strict-JSON lock containing every resolved input;
- calculate input keys and explain why a node was selected or must rebuild;
- emit the resolved Make dependency graph and invoke Make for execution;
- explicitly fetch locked sources before an offline build;
- drive image composition and declared tests through generated Make targets;
- export versioned machine-readable metadata and static website catalog pages.

The responsibility boundary is equally important. `eclogite` does not compile
package sources itself, embed package-specific shell commands, replace Make's
parallel scheduler, mutate a running guest, select arbitrary package versions,
or allow build steps to access the network. Builders execute the resolved plan;
the CLI defines and audits that plan.

## Invocation shape

```text
eclogite [GLOBAL_OPTION...] COMMAND [COMMAND_ARGUMENT...]
```

Global options must precede the command:

| Option | Meaning |
|---|---|
| `--project DIR` | project root; defaults to the nearest ancestor of the selected config containing `catalog/`, then searches from the current directory |
| `--catalog DIR` | add a catalog root; repeatable, with duplicate object names treated as errors rather than overrides |
| `--catalog-source NAME` | add a registered remote catalog snapshot by name; repeatable |
| `--state-dir DIR` | locks, plans, and explanations; defaults to `PROJECT/state` |
| `--cache-dir DIR` | Git mirrors, catalog snapshots, package sources, and immutable build layers; defaults to `$XDG_CACHE_HOME/eclogite`, falling back to `~/.cache/eclogite` |
| `--layer-store NAME\|none` | named remote layer store from the host configuration; `none` disables remote layers |
| `-j N`, `--jobs N` | maximum concurrent Make jobs; `0` means host default |
| `--message-format human\|json` | diagnostics and progress format; JSON is versioned JSON Lines for stream processing |
| `--color auto\|always\|never` | diagnostic color policy |
| `-v`, `--verbose` | increase diagnostic detail; repeatable |
| `-q`, `--quiet` | suppress progress while retaining errors and requested output |
| `-h`, `--help` | show global help |
| `--version` | print the executable and supported schema versions |

`--catalog` and `--catalog-source` affect discovery, not precedence. If two
catalog roots define the same typed name, resolution fails and reports both
locations. This prevents an accidental local or downloaded directory from
silently replacing a locked package.

`--layer-store` resolves a name from
`$XDG_CONFIG_HOME/eclogite/config.jsonc` (fallback:
`~/.config/eclogite/config.jsonc`). A store entry fixes its backend, repository,
and trust policy. It is host policy rather than system intent, so credentials
and registry endpoints never enter a portable system file; the selected layer's
immutable digest and verified provenance do enter the lock and local cache
record. See [storage](storage.md#remote-layer-store).

Commands that operate on a system use one consistent selector:

```text
-c FILE, --config FILE       system JSONC, inside or outside a catalog
--lock FILE                  explicit strict-JSON lock file
--locked                     require the default lock to exist and be current
```

`--config` is the primary interface. One portable system file contains the
machine and software references. Each reference accepts an exact catalog name,
declared alias, or a `./`/`../` path resolved relative to that system file.
Absolute paths and network URLs are rejected in persisted intent. Resolution
records canonical names, origins, hashes, and alias provenance in the lock.

For quick interactive use, `plan`, `graph`, and `create` also accept an explicit
composition shorthand instead of `--config`:

```text
--machine NAME|FILE          machine profile name, declared alias, or JSONC path
--software NAME|FILE         base software profile name or JSONC path
--with NAME                  add a package or meta-package; repeatable
--kernel NAME                select a compatible kernel package
```

`--config` and `--machine` are mutually exclusive, and shorthand requires both
`--machine` and `--software`. Names are exact catalog names or declared aliases,
never fuzzy prefix matches. Before resolution, Eclogite writes the expanded
strict-JSON request into state and later into output provenance. The canonical
machine/software names, added selections, kernel, and their source hashes enter
the lock. These options are therefore concise input syntax, not invisible
overrides. A reproducible project should persist the resulting selection as a
system file and use `--config` in scripts and CI.

Without `--catalog`, catalog names referenced by the system are resolved from
the discovered project `catalog/`. Paths inside JSONC remain relative to the
JSONC file that contains them. Arbitrary `--set key=value` overrides are not
supported because an invisible command-line override would weaken provenance.

## Version-one command set

### General and host inspection

```text
eclogite help [COMMAND]
eclogite version
eclogite doctor --config SYSTEM.jsonc [--runtime]
```

- `help` prints command-specific help and examples.
- `version` prints the tool version, lock format, and supported schema versions.
- `doctor` resolves enough intent to check the build runtime (the
  `linux-libre-vm` dev image and toolchain artifacts for this host's
  architecture, and the UTM or QEMU backend that starts it) without fetching or
  building.
  `--runtime` additionally checks QEMU or UTM requirements for running the
  resulting system.

### Validation and resolution

```text
eclogite validate [PATH...]
eclogite resolve --config SYSTEM.jsonc [--output FILE]
eclogite lock --config SYSTEM.jsonc [--output FILE]
eclogite plan --config SYSTEM.jsonc [NODE...]
eclogite graph --config SYSTEM.jsonc [--kind full|packages|stages]
               [--format tree|dot|json] [--root NODE] [--reverse]
               [--output FILE]
eclogite why --config SYSTEM.jsonc NODE [--all]
```

- `validate` parses JSONC and checks schemas, paths, names, references, source
  identities, machine/software compatibility, cycles, and semantic constraints.
  With no path it checks the discovered catalog. It writes nothing.
- `resolve` composes the selected machine and software profiles, then expands
  meta-packages, features, stages, toolchain contexts, kernel, rootfs, and image
  nodes. It writes the resolved strict JSON to stdout or `--output`, but does
  not update the lock.
- `lock` is the explicit operation for creating or replacing a deterministic
  lock. Its default output is `state/SYSTEM/system.lock.json`.
- `plan` compares resolved intent, the current lock, and available cache layers.
  Optional nodes restrict the report to those nodes and their dependencies.
- `graph` renders the complete graph, package graph, or stage graph. Tree output
  is for people, DOT is for Graphviz, and JSON is the stable machine interface.
- `why` prints provenance paths from the system root to one package, stage, or
  output. `--all` prints every path instead of the shortest path.

`NODE` uses an explicit namespace when ambiguity is possible:
`package:coreutils`, `stage:image`, `output:linux-libre:kernel`, or
`system:qemu-arm64-reference`. An unqualified unique name is accepted interactively.

### Sources and build execution

```text
eclogite fetch --config SYSTEM.jsonc [--force] [--source NAME]...
               [--no-layers]
eclogite build --config SYSTEM.jsonc [NODE...] [--no-cache] [--keep-going]
eclogite image --config SYSTEM.jsonc [--output DIR]
eclogite test --config SYSTEM.jsonc [TEST...] [--keep-vm]
```

- `fetch` downloads only sources present in the current lock and verifies their
  identity. It also pulls every prebuilt layer the remote layer store has for
  the lock's keys and verifies it, so the following `build` only builds what is
  missing; `--no-layers` skips that. `--source` limits the source download;
  `--force` replaces a corrupt or incomplete cache entry, never a valid
  immutable entry.
- `build` emits the intermediate units and Make plan, invokes Make, validates
  declared outputs, and publishes successful immutable layers. Optional nodes
  build only their dependency closures. `--no-cache` ignores build-layer hits
  but still uses verified source downloads. `--keep-going` asks Make to continue
  independent nodes after a failure.
- `image` composes locked package outputs and the kernel into image artifacts.
  It never installs packages into a running guest.
- `test` runs named declared tests or all system tests. `--keep-vm` retains a
  failed test instance for diagnosis.

`fetch`, `cache push`, `catalog source add`, `catalog source sync`, and
explicit `create --fetch` are the only normal network operations. `build`,
`image`, and `test` never use the network and fail with a list of missing
locked sources; layers missing from the local cache are built locally.

### Complete image or VM-bundle creation

```text
eclogite create --config SYSTEM.jsonc [--output DIR]
                [--lock FILE | --locked]
                [--fetch] [--keep-work]

eclogite create --machine NAME|FILE --software NAME|FILE
                [--with NAME]... [--kernel NAME]
                [--output DIR] [--fetch] [--keep-work]
```

`create` is the simple end-to-end workflow. It validates, resolves, obtains a
lock, optionally fetches missing sources, builds, creates the image, runs all
declared tests, and publishes a self-contained deployment directory. Virtual
profiles contain a VM bundle; physical profiles contain boot artifacts and
media images.

The common form is one option plus optional execution policy:

```sh
eclogite create --config systems/workstation.json --fetch
```

The referenced machine and software may live in the repository catalog, a
pinned registered catalog, or relative files beside the system file.

The lock rules are intentionally conservative:

- an explicitly supplied `--lock` is consumed exactly;
- `--locked` requires the default lock and rejects missing or stale state;
- if no lock exists, `create` may create the first lock and records it inside
  the VM provenance directory;
- if an existing lock is stale, `create` stops and asks for `plan` followed by
  an explicit `lock`; it never silently updates an existing lock.

`--fetch` explicitly allows the fetch phase to use the network. Without it,
`create` is offline and reports missing sources. `--keep-work` preserves the
temporary build directory after failure.

Without `--output`, the VM bundle is published directly into the current
directory. That directory must already exist and contain no entries—not even
hidden files such as `.DS_Store`. Eclogite performs the complete build and
validation in a temporary sibling before moving the finished bundle contents
into the empty directory. `vm.json` is published last as the completion
manifest, so `vm.sh validate` rejects an interrupted publication.

With `--output DIR`, the named directory must not exist. Eclogite can then
publish it atomically by renaming a validated temporary sibling. There is no
version-one `--replace`; existing output is never merged or overwritten.

Every created directory contains a manifest, provenance, images, and logs. A
virtual profile additionally contains `vm.sh`, runtime support, and a host/guest
`share/` directory. A physical profile instead contains its boot-media image and
board-specific boot artifacts; it does not contain `vm.sh`. Backend and image
settings come from locked intent.

### Reproducibility and result comparison

```text
eclogite reproduce --config SYSTEM.jsonc [NODE...] [--runs N]
eclogite compare LEFT RIGHT [--scope manifests|files|all]
                              [--format summary|json]
```

- `reproduce` performs at least two isolated builds of the selected closure and
  compares output manifests and hashes. Source cache entries may be reused;
  build-layer hits for compared nodes may not.
- `compare` accepts two store layers, result manifests, image directories, or VM
  bundles. It reports identity, metadata, file-set, mode, ownership, and content
  differences according to `--scope`.

Functional correctness belongs to `test`; deterministic output belongs to
`reproduce`; comparing two already-produced results belongs to `compare`.

### Catalog and cache inspection

```text
eclogite catalog list package|metapackage|platform|toolchain|stage|system
                         [--names-only]
eclogite catalog show TYPE NAME
eclogite catalog path TYPE NAME
eclogite catalog source list
eclogite catalog source add NAME GIT_URL [--ref REF | --revision COMMIT]
eclogite catalog source sync [NAME...]
eclogite catalog source remove NAME

eclogite cache path
eclogite cache list [--package NAME] [--unused]
eclogite cache show KEY
eclogite cache verify [KEY...]
eclogite cache push --config SYSTEM.jsonc [KEY...]
eclogite cache prune [--older-than DAYS] [--max-size SIZE] [--apply]
```

- `catalog list`, `show`, and `path` inspect discovered source objects; JSON
  output is selected with global `--message-format json`.
- `catalog source add` registers and downloads a Git catalog into the shared
  per-user cache. A tracking `--ref` is resolved to an exact commit; an explicit
  `--revision` is immutable from the beginning.
- `catalog source sync` fetches registered tracking refs and materializes new
  immutable snapshots. It does not update project locks. `source remove`
  removes registration only; cached objects remain eligible for normal pruning.
- `cache verify` checks keys, manifests, and recorded output hashes without
  rebuilding.
- `cache push` publishes locally built layers to the remote layer store. It
  requires explicitly configured credentials plus a signing identity accepted
  by that store's trust policy and is normally used only by CI; a layer whose
  key already exists is compared, never overwritten.
- `cache prune` is a dry run unless `--apply` is present. Locked or referenced
  layers are protected. The command prints the exact keys and recoverable space
  before deletion.

There are no `install`, `remove`, or `upgrade` package commands. Cache commands
manage host build artifacts, not guest contents.

Remote catalog registration is stored below `$XDG_CONFIG_HOME/eclogite`, with
`~/.config/eclogite` as the fallback. Git mirrors, immutable catalog snapshots,
and package sources are shared across projects under the cache root. See
[Installation, remote catalogs, and shared storage](storage.md).

### Static website generation

```text
eclogite site [--output DIR] [--clean]
```

`site` validates the catalog and writes static package, meta-package, platform,
toolchain, stage, and system pages. It also emits strict `catalog.json`,
`graph.json`, `search-index.json`, and a build manifest consumed by the
dependency-free browser interface. The default output is `_site/`.

Before generating anything, `site` parses every selected `.jsonc` and `.json`
input, validates it against the versioned JSON Schema in `catalog/schemas/`, and
resolves the same graph used by `lock` and `build`. A schema or graph error stops
the site build, so invalid catalog data is never published. `--clean` removes
stale generated files inside `_site/` only; it does not remove maintained files
from `site/`.

## Typical workflows

Inspect a system before building:

```sh
eclogite validate catalog
eclogite graph --config catalog/systems/qemu-arm64-reference.jsonc --format tree
eclogite why --config catalog/systems/qemu-arm64-reference.jsonc package:coreutils
eclogite plan --config catalog/systems/qemu-arm64-reference.jsonc
```

Use explicit phases in development or CI:

```sh
eclogite lock --config catalog/systems/qemu-arm64-reference.jsonc
eclogite fetch --config catalog/systems/qemu-arm64-reference.jsonc
eclogite build --config catalog/systems/qemu-arm64-reference.jsonc
eclogite image --config catalog/systems/qemu-arm64-reference.jsonc
eclogite test --config catalog/systems/qemu-arm64-reference.jsonc
```

Create and run a complete VM in a new empty directory using short catalog
names:

```sh
mkdir arm64-dev
cd arm64-dev
eclogite create \
  --machine qemu-arm64 \
  --software minimal \
  --with openssh \
  --fetch
./vm.sh validate
./vm.sh run
```

Create the equivalent UTM bundle on an Apple Silicon Mac:

```sh
mkdir arm64-utm
cd arm64-utm
eclogite create \
  --machine utm-arm64 \
  --software minimal \
  --with openssh \
  --fetch
./vm.sh validate
./vm.sh run
```

The selected machine profile fixes UTM as the runtime. Eclogite does not
silently switch a QEMU bundle to UTM based on the current host; that would make
the deployment output differ from its lock.

Create an image set for physical hardware:

```sh
eclogite create \
  --machine raspberrypi \
  --software minimal \
  --with openssh \
  --kernel linux-libre \
  --output machines/raspberry-pi-b \
  --fetch
```

To create a directory from its parent instead, name it explicitly:

```sh
eclogite create \
  --config catalog/systems/qemu-arm64-reference.jsonc \
  --output machines/qemu-arm64-reference \
  --fetch
```

`eclogite` is the fleet/image construction tool. For virtual profiles, the
generated `vm.sh` controls only the bundle beside it. It never resolves
packages, changes the root image, or needs to be installed globally. Physical
profiles produce images without `vm.sh`. See [Generated VM bundle](vm-bundle.md).

## Output and exit contract

Requested data goes to standard output. Progress and diagnostics go to standard
error, allowing graph or JSON output to be redirected safely. Human diagnostics
include source file, line, column, object name, and field path. JSON diagnostics
use versioned JSON Lines so long-running builds can stream events.

Planned stable exit classes are:

| Exit | Meaning |
|---:|---|
| `0` | success; no differences when the command compares results |
| `2` | invalid command or arguments |
| `10` | JSONC, schema, or semantic validation failure |
| `11` | graph resolution, cycle, or stale-lock failure |
| `12` | locked source missing or source verification failure |
| `20` | builder or declared-output failure |
| `21` | image creation or functional test failure |
| `22` | reproducibility or comparison mismatch |
| `30` | cache, filesystem, or internal failure |

## Make interface

GNU Make remains a repository convenience layer, not a second CLI grammar:

```text
make validate
make CONFIG=catalog/systems/qemu-arm64-reference.jsonc lock
make CONFIG=catalog/systems/qemu-arm64-reference.jsonc plan
make CONFIG=catalog/systems/qemu-arm64-reference.jsonc build
make CONFIG=catalog/systems/qemu-arm64-reference.jsonc image
make CONFIG=catalog/systems/qemu-arm64-reference.jsonc test
make site-stage
```

These targets delegate to `eclogite`; they never parse or independently resolve
catalog data. CI should use the same entry points as local development.
