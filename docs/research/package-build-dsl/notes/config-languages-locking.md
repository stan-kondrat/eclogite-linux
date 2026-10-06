# Typed/mergeable configuration languages and lock-file designs (for a plain-JSON VM/build description)

Scope: how CUE, Nickel, Dhall, Jsonnet, KCL, Pkl, JSON Schema, JSON Merge Patch / JSON Patch, and the main lock-file formats handle composition, defaults, overrides, validation and locking. The aim is to decide which ideas a "dumb JSON data + smart Python-stdlib builder" design should copy. Researched 2026-10. Primary docs and specs only. Where something comes from my own knowledge and was not checked against a source, it is listed under Inferences or Gaps.

## CUE: unification, constraints, defaults, disjunctions, order independence, comparison with JSON Schema

### Takeaway
CUE merges configs by *unification* in a value lattice. Types, constraints and concrete values are all values, and merging is commutative. Once you see a concrete value, it is final: nothing elsewhere can override it. Defaults (`*`) are just a preferred element of a disjunction. Two conflicting defaults cancel each other out; CUE does not pick one by order. The design idea worth copying is "merging must be order-independent, and conflicts are errors, not silent overrides."

### Cited Findings
- CUE is built on graph unification of typed feature structures. Every value, including types, sits in one lattice, so two configurations "could always unambiguously merge … independently of order". — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)
- "Types *are* values": `true`, `bool` and `>=0.5` are all comparable members of the same hierarchy. — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)
- One operator, `|`, covers sum types (`int | string`), enums (`1 | 2 | 3`) and defaults (`*"dog" | "cat"`). — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)
- CUE deliberately rejects override/inheritance (the GCL/Jsonnet/HCL style), so "an observed field value holds for the final result". This avoids the time-consuming hunt for hidden overrides. — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)
- Defaults must stay order-independent. Conflicting defaults (`*1` vs `*2`) cancel each other and are not resolved arbitrarily. — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)
- "A default value is an element in a disjunction that has been prefixed with the preference marker `*`." CUE "will select and use the default when a value is required but none has been explicitly specified". Example: `#def: string | int | *1`, where `#def & 42` yields 42. — [CUE tour: defaults](https://cuelang.org/docs/tour/types/defaults/)
- Order independence "simplifies reasoning about values for both humans and machines"; files need not import each other. — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)
- CUE's own framing compared with JSON Schema: JSON Schema keeps validation in separate vocabularies, while CUE puts schema, data and policy in one language. — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)

### Inferences
- The useful CUE ideas for plain JSON:
  - a field set in two layers must be *equal*, or be explicitly marked as overridable; otherwise it is an error;
  - defaults live in the schema and are not copied into instances;
  - an enum or disjunction is a list of allowed values.
- The builder can implement all of this in ~100 lines of Python as a "unify(a, b)" function: dict→recurse, equal scalars→ok, else→error.
- A full CUE-style lattice (bounds like `>=1`, regex constraints as values) is overkill. A few JSON Schema-like keywords (`enum`, `pattern`, `minimum`) checked by a small validator cover the same needs.
- Downside for this project: CUE needs a Go binary, which is not "available everywhere". Its error messages and the disjunction/default behaviour have a learning curve.

### Gaps
- I did not fetch CUE's official "CUE vs JSON Schema" page or its current (2025-26) release status. The comparison above is CUE's own description.

## Dhall, Jsonnet, Nickel, KCL, Pkl: imports, overrides, typed records, defaults, downsides

### Takeaway
These languages fall into two camps:
- **Override/inheritance:** Jsonnet (late-bound `self`/`super`, `+:`), Pkl (`amends`/`extends`), KCL (`=` override, `+=` append).
- **Merge-must-agree:** CUE (unification), Nickel (commutative `&` merge with explicit priorities), KCL's `:` union. Dhall sits apart: a total, typed functional language with hash-pinned imports.

Each solves "JSON has no reuse, no types, no defaults", but each costs a new toolchain and a learning curve. Jsonnet is openly Turing-complete.

### Cited Findings
- **Nickel**
  - `&` merge is commutative and recursive on records. Non-record values merge only if they are identical (equal primitives, equal arrays, same enum tag, both null); otherwise merging fails. — [Nickel manual: merging](https://nickel-lang.org/user-manual/merging)
  - Priorities: `default` (lowest) < numeric `priority N` < `force` (highest). Example: `{foo | default = 1} & {foo = 2}` → `{foo = 2}`. At equal priority the values merge recursively and may fail. — [Nickel manual: merging](https://nickel-lang.org/user-manual/merging)
  - Arrays merge only if they are equal; Nickel does not concatenate them. — [Nickel manual: merging](https://nickel-lang.org/user-manual/merging)
  - Contracts attached to a field accumulate across merges and apply lazily to the *final* value: "the final value for `foo` has to respect the contract". — [Nickel manual: merging](https://nickel-lang.org/user-manual/merging)
- **Jsonnet**
  - Hermetic: "The same JSON should be generated regardless of the environment." — [Jsonnet design rationale](https://jsonnet.org/articles/design.html)
  - Jsonnet *accepts* Turing-completeness, because "Restricting termination would create more problems than it would solve". — [Jsonnet design rationale](https://jsonnet.org/articles/design.html)
  - Prototype-based mixin inheritance with late binding, so fields can be overridden in variants. Lazy evaluation, dynamic typing. — [Jsonnet design rationale](https://jsonnet.org/articles/design.html)
- **Dhall**
  - Not Turing-complete: "If an expression type-checks then evaluating that expression always succeeds in a finite amount of time". — [Dhall safety guarantees](https://docs.dhall-lang.org/discussions/Safety-guarantees.html)
  - Imports can be pinned with a *semantic* sha256 of the normalized expression, so "any change to an expression (even via transitive dependencies) will be detected and rejected by the integrity check". — [Dhall safety guarantees](https://docs.dhall-lang.org/discussions/Safety-guarantees.html)
  - Downsides: no general recursion, restricted expressiveness, network latency for first-time remote imports. — [Dhall safety guarantees](https://docs.dhall-lang.org/discussions/Safety-guarantees.html)
- **KCL**
  - Schemas with static types plus `check` blocks (regex, ranges, uniqueness). — [KCL tour](https://www.kcl-lang.io/docs/reference/lang/tour)
  - Attribute operators: `:` is an idempotent union that errors on conflict, `=` overrides, `+=` appends to lists. KCL "prefers immutability and recommend to add up incremental updates through the union." — [KCL tour](https://www.kcl-lang.io/docs/reference/lang/tour)
- **Pkl**
  - `amends` keeps the module's type and lets you override or amend properties. `extends` defines a new subclass. — [Pkl language reference](https://pkl-lang.org/main/current/language-reference/index.html)
  - "When a typed object is amended, its properties can be overridden or amended, but new properties cannot be added". In other words, typos become errors. — [Pkl language reference](https://pkl-lang.org/main/current/language-reference/index.html)
  - Constraints are written as type predicates, e.g. `Int(isBetween(0, 1023))`. — [Pkl language reference](https://pkl-lang.org/main/current/language-reference/index.html)
  - Built-in renderers to JSON/YAML/PCF. — [Pkl language reference](https://pkl-lang.org/main/current/language-reference/index.html)
- **General caution:** Hadlow's "configuration complexity clock" describes teams moving from config files to rules engines to DSLs, ending up with "hard-coding" again in a worse language: "At a certain level of complexity, hard-coding a solution may be the least evil option." — [Configuration Complexity Clock](https://mikehadlow.blogspot.com/2012/05/configuration-complexity-clock.html)

### Inferences
- Ideas to copy into plain JSON + Python:
  - Nickel's explicit *priorities*: a recipe's value is the "default", and a VM config value wins only when it is a deliberate override. Simplest version: only an `overrides` block may change a recipe field; everything else must agree or be new.
  - Pkl's "typed object cannot gain new properties": reject unknown keys (`additionalProperties: false`). This catches AI and human typos.
  - KCL's distinct operators for replace vs append-to-list. Arrays need an explicit operation, because none of the merge standards concatenate.
  - Dhall's hash-pinned imports: the lock file plays this role.
- Ideas to reject:
  - Late-bound inheritance (Jsonnet `self`/`super`, Pkl `amends` chains). You cannot find a value's origin without evaluating, which hurts both humans and an AI editor.
  - Any embedded expression language. That way lies the complexity clock.
- All five tools need a non-stdlib binary (Go, Rust, Haskell, JVM/native), so none meets the "Python 3 stdlib + POSIX sh everywhere" constraint. They would be at best an optional authoring layer that emits JSON.

### Gaps
- I did not verify current (2025-26) project health or release cadence for Nickel, KCL, Pkl or Dhall. I also did not verify the Jsonnet details for `+:` and hidden `::` fields from primary docs; the design page only covers inheritance and late binding in general terms.
- I found no neutral, primary-source side-by-side comparison of these languages. Community blog comparisons exist but were not fetched.

## JSON Schema (draft 2020-12): what it can and cannot validate; stdlib-only feasibility

### Takeaway
JSON Schema handles the structural checks well:
- types, `enum`, `required`, `pattern`, numeric bounds;
- `additionalProperties`/`unevaluatedProperties`;
- conditionals (`if`/`then`/`else`, `dependentRequired`, `dependentSchemas`);
- reuse via `$defs`/`$ref`.

It validates one instance in isolation. It cannot check "this dependency name exists in the catalog" or "no dependency cycles". `default` is only an annotation and never fills values in. Python's stdlib has no JSON Schema validator, so either write a small subset validator or skip the schema and validate in code.

### Cited Findings
- `dependentRequired` "conditionally requires that certain properties must be present if a given property is present"; it works in one direction only. `dependentSchemas` "conditionally applies a subschema when a given property is present". `if`/`then`/`else` (since draft 7) "allow the application of a subschema based on the outcome of another schema". Put `required` inside `if` to avoid vacuous matches. — [Understanding JSON Schema: conditionals](https://json-schema.org/understanding-json-schema/reference/conditionals)
- `$defs` is a reserved location for reusable schemas and "does not directly affect the validation result". `$ref` applies the referenced schema; other keywords may sit alongside it in 2020-12. — [JSON Schema 2020-12 core](https://json-schema.org/draft/2020-12/json-schema-core)
- `$comment` is reserved for comments from schema authors to maintainers. It must not affect validation. — [JSON Schema 2020-12 core](https://json-schema.org/draft/2020-12/json-schema-core)
- Annotations (including `default`) "attach information to an instance for application use" and do not modify the instance. — [JSON Schema 2020-12 core](https://json-schema.org/draft/2020-12/json-schema-core)
- `unevaluatedProperties` covers properties not evaluated by other keywords, even through `$ref`/`allOf`. Use it to forbid unknown keys in composed schemas. — [JSON Schema 2020-12 core](https://json-schema.org/draft/2020-12/json-schema-core)

### Inferences
- **Referential integrity is out of reach.** Checks like "dependency name ∈ catalog keys", "group members exist", "no cycles", "hash format matches the declared algorithm across files" cannot be expressed. Each schema evaluation sees one instance. An `enum` generated from the catalog is the only workaround, and it must be regenerated whenever the catalog changes. These checks belong in the Python builder.
- **Python stdlib feasibility.**
  - There is no `jsonschema` in the stdlib (the popular `jsonschema` package is third-party).
  - A subset validator is realistic in roughly 150–300 lines. It would support `type`, `enum`, `const`, `required`, `properties`, `additionalProperties`, `items`, `pattern` (`re`), `minimum`/`maximum`, `$ref` to local `$defs`, and possibly `if`/`then`.
  - Full 2020-12 compliance (dynamic refs, `unevaluated*` annotation tracking, formats) is much larger and not worth it.
- **Suggested split:**
  - Keep a JSON Schema file as *documentation* and editor/AI hinting. Editors such as VS Code use `$schema` for completion.
  - Enforce it with a stdlib subset validator plus hand-written semantic checks.
  - Apply defaults in the builder, never by expecting the validator to fill them in.

### Gaps
- I did not verify which exact keyword subset popular editors honour. I did not benchmark or survey existing single-file, stdlib-only validators.

## JSON Merge Patch (RFC 7396) and JSON Patch (RFC 6902) as override mechanisms

### Takeaway
Merge Patch is the natural "override block" format: the patch has the same shape as the target, objects merge recursively, scalars and arrays are replaced wholesale, and `null` deletes a key. Its two pitfalls are that you cannot append to or remove from a list, and you cannot set a value to `null`. JSON Patch (an op list with JSON Pointer paths, `test` and atomic application) is precise but path- and index-based, so it is brittle against reordered arrays and awkward for humans and AI to edit.

### Cited Findings
- RFC 7396 algorithm, as pseudocode:
  - if the patch is an object, coerce the target to an object;
  - for each member, a `null` value removes that name, otherwise `Target[Name] = MergePatch(Target[Name], Value)`;
  - if the patch is not an object, return the patch itself.

  [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)
- "it is not possible to patch part of a target that is not an object, such as to replace just some of the values in an array." — [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)
- `null` means removal, so the format "is not appropriate for all JSON syntaxes" where explicit nulls are data. — [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)
- RFC 6902 operations: `add`, `remove`, `replace`, `move`, `copy`, `test`. The `-` index appends to an array. If any operation fails, "application of the entire patch document SHALL NOT be deemed successful", which makes patches atomic. `test` compares values logically by JSON type. — [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)

### Inferences
- Recommended override semantics for recipes:
  - RFC 7396 Merge Patch for objects and scalars.
  - Ban `null` as data in recipes, so `null` can unambiguously mean "remove/unset".
  - For lists, avoid needing to patch at all: model sets as objects keyed by name, e.g. `"deps": {"zlib": {}, "openssl": {}}`, or `"configure_flags"` as a map of flag→value/true. Merge Patch then works naturally, and `"zlib": null` removes a dep.
  - Where ordered lists are unavoidable (patch files, configure args), document that an override replaces the whole list. Alternatively offer two explicit keys, e.g. `"append": {"patches": [...]}`, in the KCL `+=` style.
- Stdlib implementation of Merge Patch is about 10 lines of Python. JSON Patch with JSON Pointer is about 80 lines but is not recommended as the human/AI-facing format.
- Combine with the CUE/Nickel lesson: record *where* each final value came from (recipe, group, VM override) in the lock file or a `--explain` output. That restores the traceability that override systems lose.

### Gaps
- None material. Both RFCs are stable and short.

## Lock files: Cargo.lock, flake.lock, package-lock.json, poetry.lock, spack.lock

### Takeaway
All of these follow the "manifest + lock" model. The human-edited manifest states intent (ranges, branch names, abstract specs). The tool-generated lock records the fully resolved graph:
- exact version or revision;
- source URL;
- a content/integrity hash;
- dependency edges.

You update the lock only through an explicit command, which can be scoped to one input. flake.lock is the closest analogue to this project: JSON, with a node graph and `original` vs `locked` per input. Spack's model (abstract specs → concretized specs) matches "recipes + groups → fully expanded build plan".

### Cited Findings
- **Cargo**
  - Cargo.lock holds "exact information about your dependencies", including "the exact revision you used to build", e.g. `source = "git+https://github.com/rust-lang/regex.git#9f9f69…"`. — [Cargo book: Cargo.toml vs Cargo.lock](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html)
  - It is maintained by Cargo and should not be edited by hand. `cargo update` updates everything; `cargo update regex` updates one package. — [Cargo book](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html)
- **Nix (flake.lock)**
  - "a UTF-8 JSON file" with a `version`, a `root` node label, and `nodes`. — [Nix manual: nix flake](https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake.html)
  - Each node has:
    - `inputs`: name → node label, i.e. dependency edges;
    - `original`: the spec as written in flake.nix;
    - `locked`: the exact spec, including `narHash`, the expected content hash of the tree, plus `lastModified` and `revCount`;
    - `flake`: a boolean.

    [Nix manual: nix flake](https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake.html)
  - The lock graph is "isomorphic to the graph of dependencies of the root flake". — [Nix manual: nix flake](https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake.html)
  - `nix flake update` updates all inputs by default or a single named input, and prints human-readable diffs such as: "Updated input 'nixpkgs': 'github:NixOS/nixpkgs/3d2d8f…' (2023-06-30) → 'github:NixOS/nixpkgs/a3a3dd…' (2023-07-05)". — [Nix manual: nix flake update](https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake-update.html)
- **npm (package-lock.json)**
  - Generated whenever npm modifies `node_modules` or `package.json`. — [npm docs: package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json)
  - Stated purposes: identical installs for teammates and CI, "time-travel" to earlier trees, readable diffs, faster installs. — [npm docs: package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json)
  - `lockfileVersion` is 1/2/3 (npm 5–6 / 7–8 / 9+). — [npm docs: package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json)
  - `packages` is keyed by install path, with `""` as the root. Each entry has `version`, `resolved`, `integrity` (SRI sha512/sha1) and dependency maps. — [npm docs: package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json)
- **Poetry (poetry.lock)**
  - Poetry "writes all the packages and their exact versions that it downloaded to the `poetry.lock` file". — [Poetry basic usage](https://python-poetry.org/docs/basic-usage/)
  - It warns when `poetry.lock` and `pyproject.toml` "are not synchronized". — [Poetry basic usage](https://python-poetry.org/docs/basic-usage/)
- **Spack**
  - `spack.yaml` is the manifest, containing abstract specs. `spack.lock` "contains the fully configured and concretized specs". — [Spack environments](https://spack.readthedocs.io/en/latest/environments.html)
  - `spack concretize` produces the lock. Spack describes this as a "'manifest and lock' model similar to Bundler gemfiles". — [Spack environments](https://spack.readthedocs.io/en/latest/environments.html)

### Inferences
- Proposed `vm.lock.json`, modelled on flake.lock + spack.lock:
  - `lock_version`.
  - `inputs_hash`: canonical-JSON sha256 of the VM config plus every recipe and group it used. This is a staleness check like Poetry's sync warning; I recall Poetry uses a `content-hash` for this, but did not verify it.
  - `root`.
  - `packages`: name → `{version, source: {url, sha256 | git rev}, recipe_hash, deps: [names], from: [group/vm provenance], build_options: {...fully expanded...}}`.
  - Optionally a per-package `build_id` = hash(canonical JSON of the expanded package entry + deps' build_ids), like Spack's DAG hash or a Nix store hash. This is the cache key for built artifacts.
- Keep both `original` (what was asked, e.g. "version": "latest" or a branch) and `locked` (exact tarball hash or commit), as flake.lock does. This makes a rolling release reproducible: "latest" is resolved once and recorded.
- Updates: `lock update` (all) and `lock update <pkg>` (one), printing flake-style lines such as `pkg: 1.2.3 (sha256:ab12…) → 1.2.4 (sha256:cd34…)`. Pretty-print the lock (indent=2, sorted keys, one package per object) so git diffs stay readable. npm cites readable diffs as a design goal.
- The builder should refuse to build when `inputs_hash` mismatches, unless told to re-lock. This is the Poetry/Cargo `--locked` style guarantee.
- Reproducibility guarantee level: the lock pins *inputs* (source hashes, recipes, options). Bit-for-bit identical outputs additionally require hermetic and deterministic builds, which no lock file provides alone.

### Gaps
- I did not fetch the Cargo.lock format reference for the `checksum` field, the `version = 4` format or `[[package]] dependencies` entries. I believe Cargo.lock records a sha256 `checksum` per registry package and a dependencies list, but this is unverified here.
- I did not fetch poetry.lock internals (`[metadata] content-hash`, per-file hashes) or Spack's spack.lock JSON structure (`_meta.lockfile-version`, `roots`, `concrete_specs` keyed by DAG hash). These are my recollection only; check before relying on them.

## Canonical JSON for hashing: RFC 8785 JCS vs the Python json.dumps approach

### Takeaway
JCS defines canonical JSON as:
- no whitespace;
- properties sorted by UTF-16 code units;
- ECMAScript number serialization;
- minimal string escaping;
- I-JSON input (no duplicate keys, IEEE doubles).

`json.dumps(obj, sort_keys=True, separators=(',',':'), ensure_ascii=False, allow_nan=False)` matches JCS for a restricted data model: string keys, integers, strings, bools, null, nested objects and arrays, and no floats. Banning floats and duplicate keys in configs makes this approach safe and simple.

### Cited Findings
- JCS sorts property names as arrays of UTF-16 code units, comparing them as unsigned integers, independent of locale. — [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
- Numbers "MUST be serialized according to Section 7.1.12.1 of ECMA-262", i.e. IEEE-754 double formatting as in JavaScript. — [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
- Control characters U+0000–U+001F use lowercase `\uhhhh` unless they have a short escape. `\\` and `\"` are escaped; nothing else is. "Whitespace between JSON tokens MUST NOT be emitted." — [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
- Input must be I-JSON: no duplicate names, IEEE-754 double numbers. — [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
- Python's `sort_keys=True` sorts dict keys, and `separators=(',', ':')` gives the most compact form. — [Python json docs](https://docs.python.org/3/library/json.html)
- With `ensure_ascii=False`, Python outputs characters as-is except the quotation mark, reverse solidus and U+0000–U+001F. — [Python json docs](https://docs.python.org/3/library/json.html)
- `allow_nan=True` is the default and emits `NaN`/`Infinity`, which is not valid JSON. Set `allow_nan=False` for strict output. — [Python json docs](https://docs.python.org/3/library/json.html)
- On duplicate keys, Python "ignores all but the last name-value pair" by default. `object_pairs_hook` can change this. — [Python json docs](https://docs.python.org/3/library/json.html)
- `parse_float` can parse floats as `decimal.Decimal`. — [Python json docs](https://docs.python.org/3/library/json.html)

### Inferences
- Caveats of the Python one-liner versus JCS:
  1. **Key order.** Python sorts by Unicode code point and JCS by UTF-16 code unit. They differ only for keys containing characters above U+FFFF (astral plane) mixed with U+E000–U+FFFF. Irrelevant if keys are ASCII; enforce `^[a-z0-9_.+-]+$` key names.
  2. **Floats.** Python `repr(float)` and ECMAScript formatting differ in some cases (e.g. exponent style, `1e+21` vs `1e21`, `-0.0`). Avoid floats entirely; use integers or strings for sizes and versions.
  3. **Large integers.** Python ints are unbounded, but JCS/I-JSON requires values representable as doubles, i.e. up to 2^53. Keep integers small, or store sizes as strings like "20G".
  4. **Escaping.** With `ensure_ascii=False`, Python emits U+007F and U+2028/2029 raw; I believe JCS does too, but I have not checked this against the RFC text. Python escapes control characters as `\uXXXX` lowercase plus `\n` etc., which should match JCS. Edge cases are worth a test vector from RFC 8785 Appendix B.
  5. **Duplicate keys.** Load with an `object_pairs_hook` that raises on duplicates, both for hashing safety and to catch AI and human edit mistakes.
- Hash the canonical bytes (UTF-8) with `hashlib.sha256`, and prefix the algorithm, e.g. `"sha256:…"`. Use canonical form for *hashing only*. Store files pretty-printed (`indent=2, sort_keys=True` for generated files; keep human key order for hand-edited ones) so diffs stay readable.

### Gaps
- I did not run RFC 8785 Appendix B test vectors against Python. The exact divergences in escaping and float formatting are reasoned, not tested.

## Comments in JSON: JSONC/JSON5 vs description fields; impact on AI editing and tooling

### Takeaway
JSON5 adds comments, trailing commas, unquoted keys and more, but it is explicitly meant for hand-written config and has no stdlib parser. JSONC (JSON with comments, VS Code's dialect) is similar. With Python stdlib only, the robust choices are:
- strict JSON with documentation fields (`"description"`, `"_comment"`, or `$comment`, which JSON Schema itself reserves); or
- a tiny comment-stripping pre-pass for `//` full-line comments, at the cost of round-trip loss when tools rewrite the file.

### Cited Findings
- JSON5 aims to be "easier to write and maintain by hand (e.g. for config files)" and is "not intended to be used for machine-to-machine communication". — [json5.org](https://json5.org/)
- JSON5 features: single- and multi-line comments, trailing commas, unquoted keys, single-quoted strings, hex numbers, `Infinity`/`NaN`. It is a superset of JSON and a subset of ES5.1. — [json5.org](https://json5.org/)
- JSON Schema reserves `$comment` for author-to-maintainer notes that never affect validation. — [JSON Schema 2020-12 core](https://json-schema.org/draft/2020-12/json-schema-core)
- Python's `json` module accepts some non-standard input (NaN/Infinity) but has no comment support. — [Python json docs](https://docs.python.org/3/library/json.html)

### Inferences
- **Recommendation: strict JSON plus explicit documentation keys.**
  - Allow a `"description"` (or `"//"`) string field in any object that the schema permits. The builder ignores it and does not hash it; strip `description` before computing hashes, so doc edits don't trigger rebuilds.
  - Benefits: every tool parses the file (`python3 -m json.tool`, editors, `jq` where available); comments survive programmatic rewrites, since the builder may rewrite the VM config or recipes; and the AI sees the documentation as structured data tied to the right object.
- **If real comments are wanted:** support JSONC-style full-line `//` comments only, via a ~10-line stripper that ignores lines whose first non-space chars are `//`. Never write such files back programmatically. Treat templates as JSONC and the lock file as strict JSON.
- **AI editing:** LLMs edit strict JSON reliably. The usual failure modes are trailing commas, duplicate keys and lost comments when re-emitting a whole file. Mitigate with a `check`/`fmt` command: parse strictly, reject duplicates, validate, then re-emit with stable formatting. Run it after every edit.

### Gaps
- I did not fetch a primary JSONC specification. VS Code's JSONC is documented by Microsoft, and there is a jsonc.org effort, but neither was verified here.
- I found no empirical studies on LLM edit accuracy for JSON vs JSONC/JSON5/YAML.

## Recommendation: the subset of ideas to adopt while staying plain JSON

### Takeaway
Use "dumb JSON + smart stdlib builder":
- per-VM JSON copied from a template;
- catalog of recipe JSON files;
- groups as plain lists of names;
- overrides via RFC 7396 Merge Patch, with set-like data modelled as objects and `null` meaning delete;
- conflicts outside the override block are errors (CUE/Nickel order-independence);
- unknown keys rejected (Pkl/`additionalProperties:false`);
- a JSON Schema kept for documentation and editors, enforced by a small stdlib validator plus semantic cross-reference checks in Python;
- a flake.lock/spack.lock-style lock with `original`/`locked`, source hashes, edges, provenance and an `inputs_hash`, hashed with JCS-compatible canonical JSON.

### Cited Findings
- Order-independent unification, where a seen value is final — [The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/).
- Explicit merge priorities (default < normal < force) — [Nickel merging](https://nickel-lang.org/user-manual/merging).
- Merge Patch semantics and limits — [RFC 7396](https://www.rfc-editor.org/rfc/rfc7396).
- Lock-file structure (`original`/`locked`/`narHash`/`inputs` graph) — [Nix flake](https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake.html).
- Manifest/concretized-lock model — [Spack environments](https://spack.readthedocs.io/en/latest/environments.html).
- Canonicalization — [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785).

### Inferences
Concrete rules to adopt:
1. **Layers and order.** Use three fixed layers:
   1. recipe defaults (catalog);
   2. group-level settings, if any;
   3. VM config `packages.<name>.override` (Merge Patch).

   Outside `override`, two sources setting the same field to different values is an error, never "last wins". This gives CUE-like order independence for everything except explicit overrides, which are Nickel-like higher priority.
2. **No arrays for sets.** Write `deps`, `groups`, `features`, `kernel_config` as objects keyed by name. Keep ordered arrays only where order matters (patch list, configure args), and document that overrides replace them wholesale.
3. **No nulls as data, no floats, ASCII keys, no duplicate keys.** This makes Merge Patch unambiguous and `json.dumps(sort_keys=True, separators=(',',':'), ensure_ascii=False, allow_nan=False)` effectively JCS-conformant.
4. **Defaults live in the builder or schema, not copied into instances.** The lock file records the *fully expanded* values, so the expansion is auditable, as with Spack's concretized specs.
5. **Validation, two tiers:**
   1. structural, using a JSON Schema subset validator in stdlib;
   2. semantic, in Python: references exist, no cycles, version/hash formats, groups resolve, no conflicting settings.

   Expose this as `tool check` with precise JSON-Pointer-style error paths, so an AI can fix errors mechanically.
6. **Lock file.** Generated only by `tool lock` or `tool lock --update <pkg>`, and never hand-edited. Contents:
   - `lock_version`, `inputs_hash`, `root`;
   - per package: `original` (as requested, e.g. `"version": "latest"`, `git` branch), `locked` (exact version, URL, `sha256` or git rev), `recipe_hash`, `deps`, `provenance` (which group/VM brought it in), the fully expanded `build` options, and `build_id` (Merkle hash over the entry and deps' build_ids).

   Pretty-print with sorted keys. Print flake-style "old → new" update lines.
7. **Comments.** Use `description` fields, excluded from hashes. Optionally allow full-line `//` in hand-edited templates only.
8. **Avoid** Jsonnet/Pkl-style inheritance chains, templating, string interpolation and conditionals in data. If conditionals are ever needed, express them as a named feature flag that the builder interprets ("smart builder"), not as expressions in JSON.
9. **Optional escape hatch:** CUE or Nickel could later serve as an *authoring* front-end that exports this JSON, since both export JSON. The builder's contract stays plain JSON either way.

### Gaps
- None of these recommendations were tested against real-world scale, e.g. hundreds of recipes. Performance of a pure-Python validator and lock generation is assumed to be trivial at that size but not measured.
