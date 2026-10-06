# Build variants, feature flags and dependency solving (inspiration for a JSON build-description language)

Scope: how Spack, Gentoo, Cargo, Conan, pkgsrc, Debian, conda-build and Homebrew model build variants; how variants move across the dependency graph; how conflicts are handled; how each system keeps the variant space manageable; and what solver theory says about a one-version-per-package (rolling release) system. Research date: 2026-10-03. Docs fetched were the "latest" versions at that date (Spack docs label themselves 1.3.0.dev0).

---

## Q1. Spack: variant declarations, spec syntax, conditional deps, conflicts/requires, propagation, the clingo concretizer, DAG hash, environments + spack.lock

### Takeaway
Spack has the richest variant model of the systems surveyed: typed variants (boolean, single-valued, multi-valued, value sets with validators), variants that only exist under a condition (`when=`), conditional dependencies, `conflicts`/`requires`, and opt-in propagation (`++`/`==`). The cost is that choosing a configuration becomes a real optimization problem. Spack solves it with an ASP (clingo) solver that ranks candidate answers by lexicographic criteria: reuse first, then newest versions, then default variant values. Each result is identified by a hash over the whole DAG.

### Cited Findings
**Variant declarations (package.py directives)**
- Boolean: `variant("shared", default=True, description="Builds a shared version of the library")`. The user then writes `+shared` / `~shared` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Single-valued: `variant("threads", default="none", values=("pthreads","openmp","none"), multi=False, ...)` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Multi-valued: `variant("languages", default="c,c++,fortran", values=("ada","brig","c","c++","fortran","objc"), multi=True, ...)`. The user writes `languages=c,c++` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Value-set validators: `values=any_combination_of("flexpath","dataspaces")` allows any subset, including none. `disjoint_sets(("auto",),("slurm",),("hydra","gforker","remshell")).prohibit_empty_set().with_error(...).with_default("auto").with_non_feature_values("auto")` makes the groups mutually exclusive and gives a custom error message — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Values tied to versions: `conditional("17", when="@1.63.0:")` inside `values=` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Conditional variants: `variant("bar", default=False, when="@2.0:")` and `variant("baz", default=True, when="platform=darwin")`. The variant only exists when its condition holds. Multiple `when` clauses are ORed. When a variant is redefined, the last definition's attributes win but the `when` clauses accumulate — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Sticky variants: `variant("bar", default=False, sticky=True)`. The value is always either what the user gave or the default; the solver may not flip it to resolve a conflict — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)

**Dependencies, conflicts, virtuals**
- Conditional deps: `depends_on("mpi", when="+mpi")`, `depends_on("trilinos@12.6: +mpi", when="@3: +trilinos +mpi")`, or a context manager `with when("@3: +trilinos"): ...` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Dependency types: `type="build" | "link" | "run" | "test"`, and tuples of these. "link" deps are injected through the compiler wrappers. "test" deps apply only with `--test` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- A dependency can require variants of the dependency: `depends_on("libelf@0.8 +parser +pic")` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Conflicts: `conflicts("^foo@1.2.3:", when="@:4.5")` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Virtual packages: `provides("mpi")`, `provides("blas", "lapack")`, `provides("mpi@:3", when="@3:")` — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)
- Dependents can apply patches to a dependency: `depends_on("binutils", patches=patch("x.patch", level=3, when="@:1.3"), when="@2.0:")`. A patch changes the dependency's identity — [Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)

**Spec syntax (CLI / config)**
- `+v` enables a variant. `~v` or `-v` disables it. `name=value` sets a value. `fabrics=verbs,ofi` adds those values to a multi-valued variant; `fabrics:=verbs,ofi` sets *exactly* those values — [Spack spec syntax](https://spack.readthedocs.io/en/latest/spec_syntax.html)
- Propagation: `++v` / `--v` (boolean) and `name==value` (non-boolean) push the setting to dependencies — [Spack spec syntax](https://spack.readthedocs.io/en/latest/spec_syntax.html)
- `%compiler@ver` selects the compiler. In current Spack, `%dep` constrains a **direct** dependency and `^dep` a transitive one. `%%` propagates compiler choices "as strong preferences, to the runtime sub-DAG". `^[when=+cond] pkg` applies a dependency constraint conditionally — [Spack spec syntax](https://spack.readthedocs.io/en/latest/spec_syntax.html)
- `target=icelake` selects a microarchitecture. `@=3.2` is an exact version; `@3` is shorthand for `@3:3`. `/hash` refers to an existing concrete spec — [Spack spec syntax](https://spack.readthedocs.io/en/latest/spec_syntax.html)

**Concretizer (clingo/ASP)**
- Rationale: "finding compatible dependency versions is NP-complete". ASP lets Spack "concisely express the compatibility rules of HPC software stacks and provide strong quality-of-solution guarantees". It can mix new builds with prebuilt binaries at acceptable solve times, on a repository of tens of thousands of packages. Paper: Gamblin, Culpo, Becker, Shudler, "Using Answer Set Programming for HPC Dependency Solving" (arXiv 2210.08404, 2022; LLNL-CONF-839332) — [arXiv](https://arxiv.org/abs/2210.08404); [OSTI](https://www.osti.gov/servlets/purl/1899435)
- Optimization is lexicographic over prioritized criteria. These include: number of input specs not concretized; number of packages to build vs. reuse ("the highest optimization objective ... is to reuse as many specs as possible"); deprecated versions; version weight (newest preferred); number of non-default variants (separately for roots and non-roots); preferred virtual providers; compiler, OS and target mismatches/preferences — search summary of [OSTI paper](https://www.osti.gov/servlets/purl/1899435). (Secondary summary; I could not verify the exact ordering table verbatim.)
- Reuse modes (`concretizer:reuse`): `true` reuses installed specs and build caches; `dependencies` reuses only for non-roots; `false` reuses nothing. Sources can be filtered, e.g. `from: [{type: local, include: ['%gcc']}]` — [concretizer.yaml docs](https://spack.readthedocs.io/en/latest/build_settings.html)
- Target granularity: `microarchitectures` (any archspec-known target, e.g. haswell) or `generic` (e.g. `x86_64_v3`). `host_compatible: true` restricts targets to ones the host can run — [concretizer.yaml docs](https://spack.readthedocs.io/en/latest/build_settings.html)
- `duplicates:strategy`: `none` allows a single configuration per package ("faster but fewer solvable specs"). `minimal` allows duplicate nodes only for build tools (default since v0.21) — [concretizer.yaml docs](https://spack.readthedocs.io/en/latest/build_settings.html)
- Splicing (SC'25, Gouwar, Becker, Dahlgren, Hanford, Guha, Gamblin): extends the packaging language and solver to model binary/ABI compatibility. The solver can then swap in a different ABI-compatible dependency (e.g. MPI) under existing binaries without rebuilding dependents — [arXiv 2509.07728](https://arxiv.org/abs/2509.07728)

**Hashing, environments, lock**
- Spack hashes now cover link, run **and build** dependencies plus a canonical hash of the package recipe. Older DAG hashes excluded build deps. Test deps are part of the DAG hash, so a build with tests enabled hashes differently — [Spack CHANGELOG](https://github.com/spack/spack/blob/develop/CHANGELOG.md) (via search summary)
- `spack.yaml` holds the abstract root specs (user intent). `spack.lock` holds "the fully configured and concretized specs", keyed by hash. On the same or a compatible machine, a recreated environment "is guaranteed to initially have the same concrete specs" — [Spack environments](https://spack.readthedocs.io/en/latest/environments.html)
- `concretizer:unify`: `true` (default) means one concrete spec per package in an environment. `when_possible` and `false` relax that — [Spack environments](https://spack.readthedocs.io/en/latest/environments.html); [concretizer.yaml docs](https://spack.readthedocs.io/en/latest/build_settings.html)

### Inferences
- These Spack features carry over to a one-version JSON system as-is: typed variants (bool / enum / set), `when` conditions on variants and deps, `conflicts`, `requires`, sticky, and the split between a manifest (abstract) and a lock (concrete, hashed).
- These exist mainly because Spack has many versions and binary reuse: version ranges, `conditional(... when="@...")`, reuse optimization, and splicing.
- `unify: true` combined with `duplicates: none` is the same as "one configuration per package per VM". Spack documents this as the fast, less-flexible mode, which fits a single-user VM system.
- "Propagation is opt-in per setting" (`++` vs `+`) is a useful design point. Global settings such as target or optimization level propagate; package features do not.

### Gaps
- I could not fetch the verbatim priority table from the ASP paper (PDF timed out / not parseable) or quantitative solve-time numbers. Treat the criteria list above as a summary.
- I did not verify which exact Spack release introduced `%`-means-direct-dependency and `%%` semantics (believed to be the 1.0 release, 2025). Unconfirmed.

---

## Q2. Gentoo: USE flags, IUSE defaults, REQUIRED_USE, USE deps, profiles, slots/subslots, binhost

### Takeaway
Gentoo flags are global booleans set by layered config (profile → make.conf → package.use), declared per package in IUSE with `+`/`-` defaults. Constraints between flags are expressed in REQUIRED_USE (`||`, `^^`, `??`, `flag? ( )`). Dependencies can require flags on a dependency, including "same value as mine" (`[foo=]`, `[foo?]`). Gentoo does not solve for flags: the user must satisfy REQUIRED_USE, so the devmanual recommends using it sparingly. ABI rebuilds are driven by subslots with `:=`. Binary packages only cover the default-profile USE set; any mismatch falls back to a source build.

### Cited Findings
- Purpose: "USE flags are to control optional dependencies and settings which the user may reasonably want to select." Defaults are set with `+`/`-` in IUSE — [devmanual: USE flags](https://devmanual.gentoo.org/general-concepts/use-flags/index.html)
- When **not** to use USE flags: runtime-only deps the package doesn't link to; small files (bash completions, init scripts, service files), which "must be installed unconditionally"; compiler flags (-O3, -flto), where packages should "let users set them directly" — [devmanual: USE flags](https://devmanual.gentoo.org/general-concepts/use-flags/index.html)
- Conflicting flags: prefer picking one flag to win and telling the user, rather than rejecting the combination. "In order to avoid forcing users to micro-manage flags too much, REQUIRED_USE should be used sparingly." — [devmanual: USE flags](https://devmanual.gentoo.org/general-concepts/use-flags/index.html)
- USE_EXPAND variables (VIDEO_CARDS, INPUT_DEVICES, L10N) are enum/set-like namespaces that expand into USE flags. The architecture also becomes a USE flag automatically — [devmanual: USE flags](https://devmanual.gentoo.org/general-concepts/use-flags/index.html)
- IUSE is cumulative across eclasses. Arch flags must not be in IUSE — [devmanual: variables](https://devmanual.gentoo.org/ebuild-writing/variables/index.html)
- REQUIRED_USE operators — [devmanual: variables](https://devmanual.gentoo.org/ebuild-writing/variables/index.html):
  - `foo? ( !bar )`: implication
  - `foo? ( || ( bar baz quux ) )`: at least one
  - `^^ ( foo bar baz )`: exactly one
  - `?? ( foo bar baz )`: at most one
- USE-conditional deps: `DEPEND="perl? ( dev-lang/perl )"` and negated `!crypt? ( ... )`; these can be nested — [devmanual: dependencies](https://devmanual.gentoo.org/general-concepts/dependencies/index.html)
- Built-with USE deps — [devmanual: dependencies](https://devmanual.gentoo.org/general-concepts/dependencies/index.html):
  - `foo[bar]`, `foo[-bar,baz]` require fixed flag values on the dep.
  - `foo[bar?]` means `bar? ( foo[bar] ) !bar? ( foo )`.
  - `foo[!bar?]` means `bar? ( foo ) !bar? ( foo[-bar] )`.
  - `foo[bar=]` means the dep's flag equals mine.
  - `foo[!bar=]` is the inverse.
  - `(+)`/`(-)` give a default for deps that lack the flag: `>=dev-libs/boost-1.48[threads(+)]`.
- Slots: `dev-qt/qtcore:5`, `:SLOT/SUBSLOT`. Slot operators (EAPI 5+) — [devmanual: dependencies](https://devmanual.gentoo.org/general-concepts/dependencies/index.html):
  - `:=` "records the slot/sub-slot of the best matching installed version" and triggers a rebuild of the dependent when that changes (typically on a soname change).
  - `:*` ignores slot/subslot changes.
  - `:SLOT=` restricts to one slot and tracks its subslot.
- Binhost (official since Dec 2023; x86-64-v3 builds since Feb 2024): packages are built "with preset compiler options" and default USE. "Portage will accept binary packages only if use flags match the precise requirements and compile the package from source otherwise." `binpkg-respect-use=n` ignores mismatches ("Dangerous"). x86-64-v3 is "strongly recommended if your CPU supports that microarchitecture level" — [Gentoo Binary Host Quickstart](https://wiki.gentoo.org/wiki/Gentoo_Binary_Host_Quickstart)

### Inferences
- Why combinations explode: every package has n independent booleans, so 2^n configurations. Flags are global and inherited from profiles, so each package's effective configuration depends on user overrides everywhere. `[foo=]` deps couple flags across packages. Upstream can't test the product of these, which is why the binhost only serves the default-profile point in the space.
- Gentoo's model is "validate, don't solve". REQUIRED_USE plus USE deps are checked, and Portage only *suggests* changes (autounmask). For a small AI-maintained system this is a reasonable default: constraints are assertions over a config that a simple propagation pass computes.
- `[foo=]` / `[foo?]` are a compact way to express "pass my feature through to my dependency" without global propagation. This is worth copying as a JSON form like `{"dep": "foo", "features": {"bar": "$bar"}}`.
- Subslot `:=` is Gentoo's manual stand-in for what content hashing gives for free: if a dependency's hash changes, the dependent's hash changes, so it is rebuilt. A hash-keyed cache makes `:=` unnecessary but rebuilds more often. An optional "ABI key" (like a subslot) could limit rebuild cascades if build time matters.

### Gaps
- I did not fetch primary docs for profile stacking / package.use / make.defaults order, or for `binpkg-multi-instance`. These are omitted rather than asserted.

---

## Q3. Cargo features: additive unification, resolver v2, default-features, optional deps

### Takeaway
Cargo features are pure booleans that only add things. Each crate is built with the **union** of all features any dependent requests. This is the simplest way to propagate variants (a monotone fixpoint with no solver), but it only works because features must be additive. Resolver v2 limits unification by context (build-deps/proc-macros, dev-deps, other-target deps), at the cost of building some crates twice.

### Cited Findings
- Unification: "When a dependency is used by multiple packages, Cargo builds it using the union of all features enabled across all dependents." Example: foo enables winapi's `fileapi,handleapi` and bar enables `std,winnt`, so winapi is built with all four — [Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)
- Consequence: features must be additive. Use a positive `std` feature, not `no_std`. Mutually exclusive features should be avoided. If unavoidable, use `compile_error!` on `cfg(all(feature="foo", feature="bar"))`. Better alternatives are separate packages, runtime configuration, or precedence via `cfg-if` — [Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)
- Defaults: `default = ["ico","webp"]`, disabled with `default-features = false` or `--no-default-features`. Removing a default feature is SemVer-incompatible. A dependency gets its defaults unless *every* dependent disables them — [Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)
- Features can enable other features: `ico = ["bmp","png"]` — [Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)
- Optional deps create implicit features. `dep:` syntax (`avif = ["dep:ravif","dep:rgb"]`) suppresses that. Weak features `"rgb?/serde"` turn on rgb's serde only if rgb is enabled by something else — [Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)
- Resolver v2 does not unify: features of target-specific deps for non-target platforms; build-deps/proc-macros with normal deps; dev-deps unless needed. This fixes the case where "a build-dep enables `std`" and breaks a `no_std` normal dep. The drawback is that deps "may build multiple times with different features" — [Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)

### Inferences
- For a one-version-per-package system, Cargo-style feature resolution is: start from roots and requested features, walk edges, OR in requested features, repeat until nothing changes. Because the operation is monotone, this terminates in O(edges × features) and needs no solver.
- The known pain point carries over directly: unification makes a dep's configuration depend on *who else* is in the graph. A distro has the same issue, so the per-VM lock file should record the unified result.
- Resolver v2's main lesson for a distro is to separate the **build/host context** (tools that run during the build) from the **target context**. Tools like cmake or python should not inherit runtime feature or CPU-level settings. That costs at most two configurations of a package (host vs target), which is Spack's `duplicates: minimal`.
- Non-additive choices (TLS backend, init system, libc variant) should be **enums with a single owner** (the VM config), not features any dependent can turn on.

### Gaps
- I did not fetch docs for Cargo resolver "3" (MSRV-aware resolution, tied to Rust 2024 edition). It concerns version selection, not features, so it is not relevant here; not verified.

---

## Q4. Conan 2: settings vs options, package_id, modes, lockfiles

### Takeaway
Conan separates **settings** (global environment: os, arch, compiler, build_type) from **options** (per-recipe choices like `shared`). Both, plus a *filtered view* of the dependencies, are hashed into `package_id`. The key idea is that how much of a dependency's identity leaks into a consumer's binary ID depends on the linkage relationship.

### Cited Findings
- "The `package_id` is the sha1 checksum of the `conaninfo.txt` file inside the package". The file contains settings, options and a `requires` section for dependencies — [Conan 2: package_id](https://docs.conan.io/2/reference/binary_model/package_id.html)
- Settings describe the build environment. Options are recipe-specific choices affecting output, e.g. `shared` — [Conan 2: package_id](https://docs.conan.io/2/reference/binary_model/package_id.html)
- Default dependency modes — [Conan 2: dependencies & package_id](https://docs.conan.io/2/reference/binary_model/dependencies.html):
  - **embed** (shared lib/app consuming a static lib; anything consuming header-only): `full_mode`, meaning "any change (version, recipe, or binary) forces a consumer rebuild".
  - **non-embed** (static→static, app/shared→shared): `minor_mode`, meaning "patch-version changes are ignored".
  - **header-only** packages: their own ID is not affected by dependency versions.
  - **tool_requires**: none ("tools do not change the binary they help to produce").
  - **unknown package type**: `semver_mode`.
  - Configurable via `core.package_id:default_embed_mode`, `default_non_embed_mode`, `default_unknown_mode`.

### Inferences
- With one version per package and content-addressed caching, the conservative choice is Conan's `full_mode` for everything, which equals a Nix/Spack-style full DAG hash. Conan's non-embed / tool_requires modes show where that could be relaxed: dependents of shared libs and users of build tools. Relaxing it there is unsafe unless the ABI is tracked, which is Gentoo's subslot / Spack's splicing problem.
- "Build tools do not affect the binary ID" is a policy a personal system might adopt (e.g. a new cmake commit doesn't rebuild the world), but it trades away reproducibility guarantees.
- The settings/options split maps cleanly to JSON: `settings` = VM-global (target CPU level, cflags profile, libc), `options` = per-package variants.

### Gaps
- Conan 2 lockfile format details were not fetched. Known only from background: lockfiles pin versions and recipe revisions, not package_ids. Unverified here.

---

## Q5. Brief survey: pkgsrc options, Debian build profiles, conda variants, Homebrew options removal

### Takeaway
The smaller systems each show one way to limit variant explosion:
- **pkgsrc**: typed groups of options (exactly-one, at-most-one, at-least-one).
- **Debian**: profiles may change *how* something is built but must not change *what* gets built.
- **conda**: build matrices pruned with `zip_keys`, and hashes taken only over the variant keys a recipe actually uses.
- **Homebrew**: removed options entirely and enabled all non-exclusive functionality.

### Cited Findings
- pkgsrc: `PKG_SUPPORTED_OPTIONS` (the list), `PKG_SUGGESTED_OPTIONS` (defaults), `PKG_OPTIONS_OPTIONAL_GROUPS` (mutually exclusive, may be empty), `PKG_OPTIONS_REQUIRED_GROUPS` ("building the packages will fail if no option from the group is selected"), `PKG_OPTIONS_NONEMPTY_SETS` (at least one of each set), `PKG_DEFAULT_OPTIONS` (user-global in mk.conf; packages must not touch it), per-package `PKG_OPTIONS.<pkg>`. Naming guidance: reuse common names, and prefix package-specific options (`wibble-foo`). Example: `.if !empty(PKG_OPTIONS:Mwibble-foo)` → `CONFIGURE_ARGS+= --enable-foo` — [pkgsrc guide: options](https://www.netbsd.org/docs/pkgsrc/options.html)
- Debian build profiles: syntax in Build-Depends is `foo (>= 1.0) [i386 arm] <!nocheck> <!cross>`. Terms inside one `<>` are ANDed and multiple `<>` groups are ORed. Registered profiles include nocheck, nodoc, cross, stage1/stage2, nobiarch, nopython/nojava/noperl/.... Activated by `DEB_BUILD_PROFILES`. Rule: "A binary package must contain the exact same content for all profiles with which it builds including no activated profile at all". The exception is nodoc/stage1, which may differ in non-functional content — [Debian BuildProfileSpec](https://wiki.debian.org/BuildProfileSpec)
- conda-build:
  - `conda_build_config.yaml` lists variant values and builds the **Cartesian product**. `python: [2.7,3.5]` × `numpy: [1.10,1.11]` gives 4 builds.
  - `zip_keys: [[python, vc]]` pairs lists element-wise, giving 2 builds instead of 4.
  - `pin_run_as_build` (e.g. `max_pin: x.x`) and `run_exports` propagate build-time choices into runtime constraints.
  - The build-string hash covers only variant variables the recipe actually uses (explicit pinned deps, or the `{{ compiler() }}` jinja function), shown as 7 hex chars.
  - Source: [conda-build variants](https://docs.conda.io/projects/conda-build/en/latest/resources/variants.html)
- Homebrew: since 2.0.0 (2019), homebrew-core formulae have no options. Formulae with options "have to be built from source, we don't test them in CI and each combination of options provides a new chance for new failures to occur". The policy is to enable "as much non-exclusive functionality as possible" by default, with options left to third-party taps — [homebrew-core #31510](https://github.com/Homebrew/homebrew-core/issues/31510); [Homebrew discourse](https://discourse.brew.sh/t/explanation-of-option-removals/3714)

### Inferences
- pkgsrc's group types are the same thing as Gentoo's `^^`/`??`/`||`, but declared as *structure* rather than as constraint formulas. In JSON they are cleaner as enum (exactly one), optional-enum (at most one) and non-empty set (at least one). Most constraints disappear once exclusive choices are modelled as enums instead of booleans plus REQUIRED_USE.
- Debian's rule gives a useful classification for flags. Some only affect *process*, such as `nocheck` or `jobs`, and should be excluded from the content hash. Others affect *output* and must be hashed. Hash-relevant should be an explicit property.
- conda's "hash only the variant keys the recipe uses" is how a global setting like `target=x86-64-v3` can avoid needlessly re-keying packages that ignore it (e.g. data-only or noarch packages).
- Homebrew's lesson applies to a single-user system as well. Every exposed variant is an untested configuration, so the default should be "feature on unless it's genuinely exclusive or heavy".

### Gaps
- I did not verify current conda-build vs. rattler-build/`recipe.yaml` (v1 recipe format) variant semantics. rattler-build is reported to keep `zip_keys` and variant config, but that is unverified here.

---

## Q6. Solver theory: NP-completeness, libsolv/PubGrub/ASP, and what changes with one version per package

### Takeaway
Dependency solving is NP-complete because of version choice and declared conflicts. Remove version choice (one version per package) and use only additive features and enums owned by one config, and variant resolution becomes a monotone fixpoint over a DAG that a topological walk solves. NP-hardness comes back only if you allow disjunctive constraints that the system must *choose* to satisfy (e.g. "`||`, pick one for me", or alternative providers). Keeping a "validate, don't search" rule for those is the main lever against complexity.

### Cited Findings
- "Dependency solving is a hard (NP-complete) problem in all non-trivial component models due to either mutually incompatible versions of the same packages or explicitly declared package conflicts." The paper reviews SAT, PBO and MILP approaches, flags *incompleteness* (failing to find existing solutions) as a persistent pitfall, and argues for specialized solvers. Abate, Di Cosmo, Gousios, Zacchiroli, SANER 2020 — [arXiv 2011.07851](https://arxiv.org/abs/2011.07851)
- Spack chose ASP because the problem is NP-complete and because ASP gives optimization (quality-of-solution guarantees), not only satisfiability — [arXiv 2210.08404](https://arxiv.org/abs/2210.08404)
- PubGrub (Dart pub) works over *terms* (package + version range) and *incompatibilities* (sets of terms that can't all hold). It does unit propagation and CDCL-style conflict resolution that learns new incompatibilities, then builds human-readable error explanations from the derivation graph. When deciding, it picks "the latest matching version of the package with the fewest versions that match" — [pub solver.md](https://github.com/dart-lang/pub/blob/master/doc/solver.md)

### Inferences
These are my reasoning from the cited sources, not additional sources.

- **What disappears with one version per package.** No version ranges, no backtracking over versions, no "newest vs reuse" optimization, no version-weight criteria. With one version per name, a *dependency* graph has no choice points (a pure topological sort), as long as there are no virtual/alternative providers. If there are (e.g. `provides: ["libc"]` from glibc), fix them in the VM config instead of solving.
- **Is variant selection still a constraint problem?** Only if the language allows it. Variant selection with arbitrary boolean constraints (REQUIRED_USE `||`, `^^`, conditional deps on flags, conflicts) can encode SAT, so with "solver picks flags" semantics it is NP-hard in general, even with one version each. It stays polynomial if:
  - (a) features are additive and dependents can only *require* (never forbid) features of dependencies, which is a monotone closure (Horn-like);
  - (b) exclusive choices are enums that only the VM config or a package default may set, so no inference is needed;
  - (c) `conflicts` / `^^` / `requires` are **checked after** propagation and reported as errors, never searched.
  This is Cargo's model plus Gentoo's validation, and Spack's `sticky` variants express the same intent.
- **A sufficient algorithm for the proposed system:**
  1. Load the VM config (roots, global settings such as target level, cflags profile, libc, plus per-package overrides).
  2. Seed each package's variant values: config override, else package default.
  3. Fixpoint loop: evaluate `when`-conditional deps and feature-implied features. For each edge, union the requested features into the dep (`dep[feat]`), and for pass-through (`dep[feat=]`) copy the dependent's value. Repeat until nothing changes. This terminates because the feature lattice is finite and updates only add.
  4. Detect enum collisions: two dependents requiring different values of one enum is an error that names both dependents (PubGrub-style explanation), not a search.
  5. Validate `conflicts` / `requires` / REQUIRED_USE-like assertions.
  6. Topo-sort and compute content hashes bottom-up over (source commit, recipe, hash-relevant variants, settings actually consumed, dep hashes; build tools in a separate host context).
  7. Write the lock.

  A small caveat: if a `when` can depend on a feature *being off*, step 3 is no longer monotone and can oscillate. Forbid negative conditions on propagated features, or evaluate them only against config-fixed values.
- **When you'd need a solver:** "enable any one of X/Y and pick for me", alternative providers chosen automatically, or wanting the "minimum features" solution. Each of these can instead be replaced with an explicit default plus a validation error.

### Gaps
- No primary libsolv documentation was fetched (it is a SAT-based solver used by openSUSE zypper, dnf and conda/mamba, per background knowledge). Unverified here.
- No formal paper was found proving that additive-feature unification is polynomial. The claim follows from standard monotone-fixpoint reasoning and is my inference.
