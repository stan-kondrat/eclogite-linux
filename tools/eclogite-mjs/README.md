# eclogite-mjs

The reference implementation of Eclogite's parser, validator, resolver,
compiler and verifier, in Node ES modules (no build step, one dependency:
`ajv`, used only by a test). The C tool in `tools/eclogite/` must give the
same results byte for byte; this tool is how format changes get tried while
the formats are in development. Clarity beats speed here.

```sh
cd tools/eclogite-mjs && npm ci              # once (installs ajv for the test)
node bin/eclogite-mjs.mjs validate catalog   # parse, schemas, catalog checks
node bin/eclogite-mjs.mjs verify             # conformance run over the catalog
node --test tests/*.test.mjs                 # fixtures and the commands above
```

## Commands

| Command | Does |
|---|---|
| `validate [PATH...]` | Parse and check documents. A catalog root (a directory with `defaults.jsonc` and `packages/`...) is checked as a whole; a file is checked inside the catalog above it and only its diagnostics are shown. Default: `catalog/` of the project. |
| `resolve (-c SYSTEM \| --machine M --software S)` | Print the resolution in the format of `tests/reference/golden/`, or the error that stops it (exit 11). |
| `lock ... [-o FILE] [--allow-unpinned]` | Write the lock `state/<system>/system.lock.json` atomically (`-o -` for stdout). Validated against `schemas/lock.schema.json` before it is written. |
| `plan ... [--lock FILE] [--locked]` | Compare a fresh compile with the lock: its status and the rebuild set with the changed parts. `--locked`: a missing or stale lock is exit 11. |
| `explain ...` | `plan` with the old and new value of every changed part. |
| `graph ... [--kind packages\|full] [--format tree\|dot\|json]` | The package graph: run, build and link edges. |
| `why ... NODE [--all]` | Why a package is in the closure (the visit-order chain from `software`), or with `--all` every path; for a capability, its provider and reason. |
| `verify [--update]` | Golden files, lock validity, byte-identical relocking, key recomputation, `tests/reference/lock-hashes.json`. Rewrites reference files only with `--update`, listing each. |
| `canonical FILE` | Print a document in canonical JSON (what hashes are computed over). |

Options: `--catalog DIR` (repeatable; added to the project's `catalog/`, a
duplicate name is an error), `--project DIR`, `--host ARCH` (build host,
default the running machine's), `--source-date-epoch N`, `--allow-unpinned`.
Exit codes follow `docs/cli.md`: 0, 2 usage, 10 invalid input, 11 resolution
or stale lock, 22 `verify` mismatch, 30 internal.

## Layout

| File | |
|---|---|
| `src/jsonc.mjs` | strict JSONC parser with positions |
| `src/validator.mjs` | the small JSON Schema validator and its error selection |
| `src/catalog.mjs`, `src/index.mjs`, `src/checks.mjs` | loading, the name index, catalog checks |
| `src/facts.mjs` | facts and predicates |
| `src/resolve.mjs` | `docs/resolution.md`, one section per step |
| `src/lock.mjs` | the lock, keys and hashes |
| `src/canonical.mjs` | canonical JSON, SHA-256, pretty printing |
| `src/golden.mjs` | the golden projection |
| `tests/fixtures/invalid/` | one directory per invalid input with the expected diagnostics |
| `tests/fixtures/resolve/` | one directory per resolution error (and an override) with the expected output |
| `tests/fixtures/devbox/` | the devbox as a second catalog root, and its expected lock |

The fixtures are the conformance corpus the C tool runs too: a case is a
`catalog/` root laid next to the repository's, the command in the test file,
and `expected.txt`. `tests/reference/golden/` and `tests/reference/lock-hashes.json`
are the valid half of the corpus.

## Rules the schemas cannot say

### Documents and diagnostics

- A diagnostic is `file:line:column: message (field path)`; the path is a
  JSON Pointer and is omitted for the document root. Line and column are
  1-based; the column counts UTF-8 **bytes** from the line start. Diagnostics
  are printed to stderr sorted by file (path order), line, column, message,
  then `N problem(s)`.
- Strict JSONC: `//` and `/* */` comments in `.jsonc` only; **trailing commas
  are errors** (`docs/configuration.md`); duplicate keys, `null`, numbers with
  a fraction or exponent, leading zeros, integers beyond +-(2^53-1) (exactly
  representable in a double and in C `int64_t`), malformed escapes (`\q`,
  `\u12G4`), unpaired surrogates, control characters in strings, invalid
  UTF-8, a byte order mark and text after the value are errors.
- Object member order of a source document is never significant. A
  duplicate key is an error even if both values are equal.
- The `schema` string selects the schema file (`eclogite.package/v0.1` ->
  `package.schema.json`); an unknown version is an error, there is no
  fallback. A document in a catalog directory must have that directory's kind.
- Validator error selection (`src/validator.mjs`): one error per failed
  keyword; unknown properties are reported at the key; when no alternative of
  a `oneOf`/`anyOf` matches, only the best alternative's errors are shown:
  alternatives failing the value's `type` or a `const`/`enum` on a direct
  property (such as `builder`) lose, then the fewest errors, then the first.
  The keywords the validator supports are listed at the top of the file; an
  unsupported keyword in a schema is a hard error, so a schema change cannot
  silently weaken validation. `tests/ajv-oracle.test.mjs` checks that it
  agrees with Ajv (strict mode) on valid versus invalid.

### Catalog checks (`src/checks.mjs`)

Names match their file (`packages/<name>/package.jsonc`, `<kind>/<name>.jsonc`);
names and aliases are unique per kind; capability names are not package names;
every reference (dependency, `first` alternative, software `packages`,
`providers`, `extends`, `platform`, `abi`, `toolchain`, system `machine` and
`software`, volume packages, `needs`) exists; a provider override provides the
capability; `builder:<tool>` and `matches_builder_tool` name a tool of some
toolchain, and a package's revision equals that tool's revision;
`hooks/<name>.sh`, `tests/<name>.sh`, `patches` and `files` sources exist; a
git revision is not all zeros; `fetch.output_sha256` keys are platforms; fact
names exist, operators suit the fact's type (`docs/build-model.md` table) and
literals are in the fact's `values`; each machine device's model is in
`devices.jsonc` with the same kind; `extends` has no cycle; configurable
options' `requires` and defaults are declared values.

### Resolution (`src/resolve.mjs`)

Follows `docs/resolution.md`. Where it leaves room:

- **Order.** Everything is visited in document order. The closure is the
  preorder of the depth-first walk (a package is listed when first reached,
  before its dependencies). `choices`, `compilers`, `config` and
  `owned_files` are keyed by name and printed in byte order.
- **Step order.** Step 8 (a provider for every capability the closure
  provides) runs before step 7 (config), because a device's requirement is
  applied to the chosen provider of `linux`.
- **Chosen once.** The first reason wins and later references get the same
  provider. `already chosen` names the capability it was chosen for first
  (`via`): the first choice, in the order the choices were made, whose
  provider also provides this capability. Kernel and init are chosen first.
- **Alternatives** (`first`): the first name that is a package of the
  selected set; else the first name that resolves and whose `target` and
  `machine` constraints hold.
- **Constraints.** `compatible.target` is evaluated over target facts and
  `compatible.machine` over machine facts; `when` and `variants[].when` over
  both. A fact the scope does not provide is an error naming it. Machine
  `ge` constraints on additive facts (`aggregate.machine: sum`) are summed
  over the closure and compared with the machine; block devices are checked
  against root, volumes, state and the config disk.
- **`compatible.build`** is checked when a build is planned, except for the
  compiler: at lock time it is evaluated three-valued with only the target
  facts and `compiler` known (builder memory and the build host are
  unknown, never false), and a compiler is allowed unless the result is
  false. The system compiler is tried first, then the others in the
  toolchain's `compilers` order; a compiler whose tools are `planned` is an
  error, and `files` and `source-tree` packages get no compiler.
- **Failure text.** `<package> fails its <target|machine> <predicate as
  compact JSON> (<chain>)`, where the chain is the selection chain without
  the package. Other messages are free text but deterministic.
- **Variants** apply in order: lists are appended, objects merged, scalars
  replaced; two variants setting one scalar to different values is an error.
  The indexes that held are `variants_applied`.
- **Config.** Sources are applied in this order: dependency entries (closure
  order), the software's `packages` entries, device models (machine order);
  the first source of an option is kept, later equal ones are ignored, a
  different value is an error naming both; an option other than `n` implies
  its `requires`, recursively.
- **Parameters.** A pointer or `scale` of a pointer is build-time and is
  expanded (`${NAME}`) in the package's arguments, services and mounts;
  `setting`, `host`, `crypt_sha512` and anything derived from them is
  start-time and stays `${NAME}`, is listed in `runtime.values`, and may not
  appear in a package's build arguments. `scale` is
  `floor(value * multiply / divide)`. Pointers are rooted at
  `/machine` (merged), `/software`, `/platform`, `/abi`.
- **Accounts.** An account without an id gets the next free id from 100 in
  name order, users first, then groups; a user's default group has the
  user's name and uid. `accounts.files` is `start` if any account field uses a
  start-time parameter.
- **Secrets.** `default` of a `secret` setting is removed from
  `software.settings` and `runtime.settings`: the runner takes it from the
  software file, not the lock.
- **Mounts and disks.** Root device from the machine's `root=` kernel
  argument; volumes, state volumes and the config disk follow in that order
  (`/dev/vdb`, ...). The config disk exists if there are settings or
  start-time values.

### The lock (`src/lock.mjs`, `schemas/lock.schema.json`)

- **Form.** Pretty JSON, 2-space indent, final newline, **every object's keys
  in byte order**, arrays in the order the schema describes. Hashes are
  computed over the canonical form: no whitespace, keys in byte order of
  their UTF-8, integers in decimal, strings escaped only for `"`, `\` and
  control characters (`\b \f \n \r \t`, else `\u00xx` lower case).
- **Pinning.** The lock refuses what it cannot pin: a `pending` fetch hash
  or an `unreleased` toolchain exits 11 and lists them. `--allow-unpinned`
  writes a development lock instead: the fetch hash is 64 zeros and the
  toolchain release is `dev-<12 hex of the toolchain document's hash>`.
  `verify` always uses it.
- **Build host and date.** `--host` (default: the architecture of the machine running the tool, `aarch64` or `x86_64`) and `SOURCE_DATE_EPOCH`
  (`--source-date-epoch`, the environment, else 1793059200 =
  2026-10-27T00:00:00Z) are inputs and enter the keys. `verify` fixes both.
- **Origins.** `defined_in` is `catalog:<root directory name>`;
  `document_sha256` is the hash of the parsed document.
- **Toolchain identity.** Until linux-libre-vm publishes artifacts,
  `builder_image_sha256` is the hash of the toolchain's name, release, host,
  `builder` and `tools`; `target_sha256` the hash of the target's entry,
  triplet and compilers.
- **Package key** = `hashOf({format: "eclogite.key/v0.1", ...parts})` with
  the parts of `keyParts()`: name, version, builder; source and
  `source_tree_sha256`; patch, hook and file hashes and the builder hash;
  compiler name; merged arguments; build-time parameter values; fetch hash;
  the package's effective config; hashes of the platform document and the
  build environment; the toolchain identity; the keys of its build and link
  dependencies (builder tools by name, version, revision). Run dependencies,
  services, accounts, mounts and tests do not enter it. `verify` recomputes
  every key from the lock alone.
- **Stand-ins.** `source_tree_sha256` is the hash of `{revision, patch
  hashes}`, because this tool does not fetch; the builder hash is the hash of
  `builders/<name>/` if it exists, else of the name. `output_sha256` fields
  are absent until a build records them.
- **`build_order`**: Kahn's algorithm over build and link dependencies,
  always taking the smallest name among the ready packages.
- **`input_sha256`** covers the system, machine chain, software, platform,
  ABI, toolchain, defaults, facts and devices documents, the document and
  file hashes of every package in the closure and `build_only`, the
  capability index of the whole catalog (so a new provider makes a lock
  stale) and the host and date.
- **Images.** The filesystem UUID and the ext4 hash seed are the first 16
  bytes of the hash of the image's inputs (role, settings, package keys,
  owned files, services, accounts, mounts), as a version-5 UUID.
- **`tests`**: `boot-shell`, then the package tests in closure order, then
  `shutdown`. The golden file lists only the package tests.
- **Golden projection** (`src/golden.mjs`): `override` stands for both
  override reasons; config lists required options only, sources as text
  (`host-share`, `device pl031`, `implied by CONFIG_9P_FS`).

## Format disagreements found

Where a schema, document or golden file disagreed, this list says which
reading the tool takes. They are to be settled when the formats are frozen.

1. **Trailing commas.** The task text says "trailing commas ok";
   `docs/configuration.md` says they are rejected. The tool rejects them.
2. **`needs` of a test** names a capability (`ip`) in `dhcpcd`, but the
   schema and `docs/configuration.md` say packages. Fixed in the catalog
   (`iproute2`); the resolver would accept a capability, the catalog check
   does not.
3. **The lock cannot be complete for Theia.** `lock.schema.json` forbids
   `unreleased` and a `pending` fetch hash, while the catalog has both and the
   golden files expect Theia to resolve. Resolution succeeds; `lock` needs
   `--allow-unpinned` until the toolchain has a release and
   `lock --update-fetch` exists.
4. **Secret defaults.** The lock schema says a secret is never written to
   the lock, but the devbox example gives `DEVBOX_PASSWORD` a default and the
   lock embeds software settings as written. The default is removed, so the
   runner cannot learn it from the lock.
5. **Golden versus lock detail.** The golden `config` has no effective
   values and `tests` no built-in checks; the lock has both. Golden files are a
   projection of the resolution, not of the lock.
6. **Profile-only machines** (Raspberry Pi, `qemu-raspi1ap`) resolve and
   lock; `docs/configuration.md` says only `create` rejects them.
7. **`compatible.build`** mixes facts known at lock time with builder facts
   known at plan time; see the three-valued rule above.
8. **Step order.** `docs/resolution.md` numbers config (7) before choosing
   providers of all capabilities (8); the golden files need 8 first.
9. **`machine` aggregation** is specified for `memory_mib` only by example;
   only `ge` with a literal inside `all` is summed.
