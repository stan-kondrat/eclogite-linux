# Build VMs from dumb JSON and Merkle keys

> **Context.** Written on 2026-10-03 for `linux-libre-vm`, before Eclogite.
> Where it says "the runner", "Python standard library" or "per-VM intent file",
> Eclogite decided differently (C17 + GNU Make, JSONC, machine/software/system
> composition). The analysis of the surveyed systems, the hashing and
> feature-resolution reasoning, and the sources remain the reference. What
> Eclogite adopted, changed, or left open is summarized in [README](README.md);
> the underlying notes are in [notes/](notes/).

The design that fits this project has five parts. Plain JSON recipes each name one typed builder. Graph resolution is a topological sort, because one version per package removes every choice point. Features are typed and additive: they propagate by union, they are checked rather than solved, and they are tied to a small set of VM-level "system features". Every package gets a Merkle cache key computed over its fully resolved recipe, its source commit, a closed-enum platform record and its dependencies' keys. Finally, a per-VM intent file is expanded by a deterministic `lock` command into a `vm.lock.json` that is the only thing builds read. None of the surveyed systems does all of this, but each piece has a mature precedent. Void's `build_style` and Buildroot's package infrastructures show that roughly 40-line data recipes cover dhcpcd and iproute2. Yocto's PACKAGECONFIG is already a feature table in all but syntax. Cargo shows that additive features resolve without a solver. Nix's modulo hash and Bazel's AC/CAS split show how to key a cache. flake.lock and spack.lock show how to separate intent from a concrete plan. The expensive parts of those systems all come from features this project has already given up: a Turing-complete language (Nix, Guix, Jsonnet), version ranges that need a SAT/ASP solver (Spack, Portage), override chains (Yocto `.bbappend`, NixOS priorities) and global flag inheritance (Gentoo profiles). The recommendation is therefore mostly subtraction. It keeps about six recipe fields that every system has, adds two that the user's goals require (features with kernel-config effects, and tests), and makes the runner, not the data, own every default, every flag derived from the platform, and every hash.

## Every mature recipe format converges on "builder plus data"

The six recipe formats studied agree to a striking degree. A Buildroot package is a `.mk` file of prefixed variables ending in one `$(eval $(autotools-package))` line, and the infrastructure supplies every step ([Buildroot manual](https://buildroot.org/downloads/manual/manual.html)). Void goes further: the `dhcpcd` and `iproute2` templates are short and contain no build functions at all. They just set `build_style=configure`, `configure_args`, `hostmakedepends` and `makedepends` ([void dhcpcd template](https://raw.githubusercontent.com/void-linux/void-packages/master/srcpkgs/dhcpcd/template)). Its gnu-configure style is about 40 lines of shell ([gnu-configure.sh](https://raw.githubusercontent.com/void-linux/void-packages/master/common/build-style/gnu-configure.sh)). OpenEmbedded gets the same effect with `inherit autotools pkgconfig`, and Guix with `(build-system gnu-build-system)` plus keyword `arguments` ([Guix manual: package Reference](https://guix.gnu.org/manual/en/html_node/package-Reference.html)). Across dhcpcd and coreutils in Buildroot, OE, Void, Alpine, Arch and Homebrew, **the fields that are always present are name, source pin, integrity, build style, configure args, host-vs-target build deps and a DESTDIR install** ([dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk); [dhcpcd_10.5.2.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-connectivity/dhcpcd/dhcpcd_10.5.2.bb); [Arch dhcpcd PKGBUILD](https://gitlab.archlinux.org/archlinux/packaging/packages/dhcpcd/-/raw/main/PKGBUILD)). Everything else (features, users, services, env overrides, hooks) appears only occasionally.

Three details from these systems matter for the builders. First, **defaults belong to the builder and recipe args go last**. Void's `gnu-configure-args.sh` prepends `--prefix=/usr --sysconfdir=/etc ...`, injects `--host`/`--build` triplets centrally, and appends template `configure_args` "so they can … override our defaults" ([gnu-configure-args.sh](https://raw.githubusercontent.com/void-linux/void-packages/master/common/environment/configure/gnu-configure-args.sh)). That is also where a PKG_CONFIG leak gets fixed once for every package. Second, **"configure" is not "autotools"**. dhcpcd ships a hand-written configure script, so Buildroot falls back to generic-package, OE overrides `do_configure`, and Void keeps separate `configure` and `gnu-configure` styles for exactly this case ([dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk); [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)). Third, **building GNU packages from a git commit rather than a release tarball adds a bootstrap step and extra host tools**. Homebrew's coreutils `head` block adds autoconf and related tools for that reason ([coreutils.rb](https://raw.githubusercontent.com/Homebrew/homebrew-core/main/Formula/c/coreutils.rb)), and Buildroot's util-linux sets `AUTORECONF = YES` because one of its patches touches autotools files ([util-linux.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/util-linux/util-linux.mk)). Cross-building GNU code also needs per-package autoconf cache variables, such as Buildroot's long `COREUTILS_CONF_ENV` list ([coreutils.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/coreutils/coreutils.mk)), so `env` has to be a first-class field.

Every system also keeps an escape hatch: Void `do_*`/`post_install`, Buildroot `_CMDS` and hooks, OE task appends, plain shell functions in Arch and Alpine. The lesson is to scope that hatch to phase hooks on top of a builder, not to let it replace the builder. On patches, the systems agree on full commit SHAs and never branches. Buildroot says branch names are "not supported" because caching would never re-fetch them ([adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)), and Yocto wants a full `SRCREV` SHA rather than a tag ([variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)). Buildroot and OE tie patches to versions through version-named directories, and Homebrew requires a comment on each patch because "nobody will know when it is safe to remove the patch" otherwise ([Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)). The user's fork-branch approach is stronger than any of these. When patches are commits on a fork, the pinned commit *is* the patched tree, so patch/version coupling is enforced by git itself. Loose patches remain for small fixes and are checked at plan time with `git apply --check` or `patch --dry-run`. No primary source describes automated stale-patch detection beyond "the build fails" ([patch-policy.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/patch-policy.adoc)), so the plan-time dry run is an improvement over existing practice.

The table below sums up what to take from each system and what to leave.

| System | Unit of description | Variant model | Cache identity | Borrow | Avoid |
|---|---|---|---|---|---|
| Nix / nixpkgs / flakes | Derivation from a lazy functional language | Function args `withX ? false`, `.override`, overlays | Input-addressed modulo hash; experimental CA | Canonical record as key; dep *keys* not recipes; fixed-output sources; flake.lock `original`/`locked` | Three override APIs, lazy fixpoint, IFD, global `gcc.arch` world rebuilds |
| Guix | Scheme `package` record | Inheritance, input rewriting, CLI transformations | Same derivation model | `inputs`/`native-inputs`/`propagated-inputs`; transformations as data; selective `tunable?` | Grafts; deep rewrites that silently rebuild everything |
| Gentoo | Bash ebuild | Global USE booleans, REQUIRED_USE, `dep[flag=]` | Binpkg matched on exact USE | "Validate, don't solve"; `[flag=]` pass-through | Global profile inheritance; 2^n spaces |
| Spack | Python `package.py` | Typed variants, `when=`, conflicts, opt-in `++` propagation | Full DAG hash incl. build deps | Typed bool/enum variants, `when`, `sticky`; manifest vs lock; `unify: true` | ASP solver, version ranges, reuse optimization |
| Cargo | TOML manifest | Additive features, union across dependents | Lock pins revisions | Union propagation; `default-features`; host/target context split | Non-additive features |
| Conan | Python recipe | Settings (global) vs options (per recipe) | `package_id` = sha1 of settings+options+filtered deps | Settings/options split | Relaxed dep modes without ABI tracking |
| Bazel / Buck2 | Starlark rules | Constraint-based platforms, transitions | Action key = command + input Merkle root + platform + salt | AC/CAS split; closed-enum platforms; `salt`; target vs exec platform | Config-in-path explosion; ambient host tools |
| BuildKit | Dockerfile to LLB DAG | Build args, `--platform` | Op digest + input keys | Two-tier keying (definition first, content later) | RUN keyed on command text that fetches mutable state |
| Yocto / BitBake | `.bb` + classes + Python | PACKAGECONFIG, DISTRO_FEATURES | Task basehash + dep taskhashes; hash equivalence | PACKAGECONFIG feature table; packagegroups; `.cfg` kernel fragments; diffsigs | Layers, `.bbappend`, override syntax, inline Python |
| Buildroot | Make variables + Kconfig | `ifeq` blocks in `.mk` | None by content | Package infrastructures; fragment files; per-package dirs | Kconfig solving for a small system |
| Void / Alpine / Arch | Shell templates | `build_options` / none | None by content | `build_style`; `hostmakedepends` vs `makedepends`; `system_accounts`, `vsv` runit services | Free-form shell `build()` as the default |

## One version per package turns resolution into a topological sort

Dependency solving is NP-complete "due to either mutually incompatible versions of the same packages or explicitly declared package conflicts" ([Abate et al., arXiv 2011.07851](https://arxiv.org/abs/2011.07851)). Spack accepted that and adopted an ASP solver that ranks answers by reuse, version recency and how many variants are left at their defaults ([arXiv 2210.08404](https://arxiv.org/abs/2210.08404)). This project removes both sources of hardness. With **exactly one pinned commit per package name and no virtual providers chosen by the tool, the dependency graph has no choice points**. Expanding `["@base", "vim", "curl"]` means taking the transitive closure over named edges and then running a Kahn/tsort pass. Spack itself documents the equivalent mode, `unify: true` with `duplicates: none` (one configuration per package), as "faster but fewer solvable specs" ([concretizer.yaml docs](https://spack.readthedocs.io/en/latest/build_settings.html)). For a single-user catalog the "fewer solvable specs" cost does not apply. When two packages need incompatible things, the answer is to edit the catalog, not to search.

The one structural distinction worth adding now is the edge type. Void separates `hostmakedepends` ("programs that must run during the build") from `makedepends` (libraries and headers that "will match the target architecture") ([void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)). Guix splits `native-inputs`, `inputs` and `propagated-inputs` ([Guix manual: package Reference](https://guix.gnu.org/manual/en/html_node/package-Reference.html)), and Spack has `build`/`link`/`run`/`test` types ([Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)). Three edge kinds are enough here. `build` covers tools that run during the build: bison, pkgconf, perl, the toolchain. `link` covers headers and libraries in the sysroot. `run` covers things that must be in the image whenever this package is. The split pays off three ways even while every build is native. **The image closure is computed only over `link`+`run`**, so bison never lands on the read-only rootfs. **Build tools are keyed in a host context** that does not inherit the VM's features or CPU level. This is Cargo resolver v2's lesson: a build-dependency once enabled `std` and broke a `no_std` normal dependency ([Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)). And cross builds become possible later without changing the schema.

Groups need no new concept. OE packagegroups are empty recipes whose `RDEPENDS` list members ([packagegroup-core-boot.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-core/packagegroups/packagegroup-core-boot.bb)), Void has `metapackage=yes`, and Arch `groups` are "symbolic names that represent groups of packages" ([PKGBUILD.5](https://gitlab.archlinux.org/pacman/pacman/-/raw/master/doc/PKGBUILD.5.asciidoc)). A group here is a JSON file with `packages`, optional `includes` of other groups, and the system features it turns on. That is how the user's "layers" (X11 vs headless) become composable DAG nodes rather than a Docker-style chain. The two failure modes that need deterministic errors are a dependency cycle, which tsort reports by listing the remaining nodes, and a name missing from the catalog. JSON Schema cannot check either one, because it validates one instance in isolation and cannot express "this name exists in the catalog" ([Understanding JSON Schema: conditionals](https://json-schema.org/understanding-json-schema/reference/conditionals)). Both are a few lines of Python in the runner's `check` command.

## Typed, additive features beat USE flags without a solver

Gentoo's USE flags fail in a specific way. They are global booleans inherited through profiles, so every package's effective configuration depends on overrides made elsewhere. REQUIRED_USE (`^^`, `??`, `||`) forces the user to satisfy constraints by hand, which is why the devmanual says it "should be used sparingly" ([devmanual: USE flags](https://devmanual.gentoo.org/general-concepts/use-flags/index.html)). The binary host only covers the default point of the space: Portage takes binary packages "only if use flags match the precise requirements" ([Gentoo Binary Host Quickstart](https://wiki.gentoo.org/wiki/Gentoo_Binary_Host_Quickstart)). Homebrew drew the opposite conclusion and removed options from homebrew-core because "each combination of options provides a new chance for new failures", choosing to enable "as much non-exclusive functionality as possible" ([homebrew-core #31510](https://github.com/Homebrew/homebrew-core/issues/31510)). Spack sits at the far end, with booleans, single- and multi-valued variants, value-set validators, `when=` conditions and opt-in propagation via `++` ([Spack spec syntax](https://spack.readthedocs.io/en/latest/spec_syntax.html)), and it pays for that with a solver.

The design that is smarter than USE flags but still needs no solver combines four borrowed rules. **Rule one, types instead of constraint formulas.** A feature is either `bool` or `enum`. pkgsrc's exactly-one and at-most-one option groups ([pkgsrc guide: options](https://www.netbsd.org/docs/pkgsrc/options.html)) and Gentoo's `^^`/`??` become an enum with an optional `"none"` value. Once mutually exclusive choices are enums, most REQUIRED_USE constraints disappear. **Rule two, effects declared as data.** OE's PACKAGECONFIG already gives each feature an enable flag, a disable flag, build deps, runtime deps and conflicts, but packs them into a positional comma string: `PACKAGECONFIG[udev] = "--with-udev,--without-udev,udev,udev"` ([yocto-docs variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)). In JSON the same thing becomes named `on`/`off` effects that can add configure args, `deps`, and kernel config symbols. This covers most of what Buildroot hand-writes as `ifeq` blocks ([util-linux.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/util-linux/util-linux.mk)). **Rule three, propagation by union, with opt-in tracking of system features.** Cargo builds every dependency "using the union of all features enabled across all dependents" ([Cargo Book: Features](https://doc.rust-lang.org/cargo/reference/features.html)). A dependent can therefore only *require* a bool feature on a dependency, never forbid one. Gentoo's `dep[flag=]` ("same value as mine") becomes `"same"` ([devmanual: dependencies](https://devmanual.gentoo.org/general-concepts/dependencies/index.html)). The VM declares a short list of system features (`x11`, `ipv6`, `9p`), and a recipe feature opts into following one with `"follows": "x11"`. That is OE's "PACKAGECONFIG tracks DISTRO_FEATURES" pattern, and OE notes that enabling a DISTRO_FEATURE alone enables nothing unless recipes track it ([variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)). Global intent therefore exists, but it reaches only the packages that explicitly opt in. **Rule four, validate after propagating, never search.** `requires` and `conflicts` assertions run after the fixpoint and fail with a message naming both dependents. Enum collisions are errors, and the VM config owns every enum. This matches Spack's `sticky` variants, which the solver may not flip ([Spack packaging guide](https://spack.readthedocs.io/en/latest/packaging_guide_creation.html)).

The resolution algorithm then works like this. Seed each package's features with the precedence VM per-package value, then followed system feature, then recipe default. Next, iterate: OR in the features each dependent requires, add the deps that enabled features pull in, and repeat until nothing changes. Last, check enums and assertions. Because updates only add and the lattice is finite, **this terminates in O(edges × features) with no backtracking**. It is no longer monotone only if a condition can depend on a propagated feature being *off*. That has to be forbidden: negative conditions may test only config-fixed values. This complexity argument is the notes' own reasoning from standard fixpoint theory, not a published proof. Two more rules keep the variant space small. Gentoo's devmanual says init scripts, service files and compiler flags must *not* be USE flags ([devmanual: USE flags](https://devmanual.gentoo.org/general-concepts/use-flags/index.html)). Debian distinguishes profiles that change *how* something is built from ones that change *what* is built, requiring identical package content across profiles ([Debian BuildProfileSpec](https://wiki.debian.org/BuildProfileSpec)). Process-only knobs such as `tests` or `jobs` are therefore marked non-hashed. As for combinatorial explosion: each VM resolves exactly one configuration per package, so the reachable space is bounded by the number of VMs, not 2^n. The shared cache gets hits wherever two VMs resolve a package identically, which is why the key must cover the *resolved* feature values, not the request that produced them.

Kernel features take the same path. A feature effect or a group may contribute kernel config symbols. The kernel recipe's builder runs the base defconfig, `scripts/kconfig/merge_config.sh` and `olddefconfig`, which is the same mechanism as Buildroot's `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` ([linux/Config.in](https://gitlab.com/buildroot.org/buildroot/-/raw/master/linux/Config.in)) and OE's `.cfg` entries in `SRC_URI` ([kernel-dev/common.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/kernel-dev/common.rst)). The builder then verifies that every requested symbol survived. NixOS's `common-config.nix` adds a useful refinement: an `option` marker meaning "set if the symbol exists, don't fail otherwise" ([nixpkgs common-config.nix](https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/os-specific/linux/kernel/common-config.nix)). Representing fragments as structured maps (`{"VIRTIO_NET": "y"}`) instead of opaque files lets the runner merge them deterministically, detect two groups asking for different values of one symbol, and run the post-`olddefconfig` check without parsing text written by someone else. Buildroot's per-package `_LINUX_CONFIG_FIXUPS` is "seldom used" ([adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)), so per-recipe kernel effects should stay rare and most kernel symbols should come from groups.

## Hash the resolved recipe, platform enums and dependency keys

The cache key has to be total: every input that can change the output goes in. The canonical precedent is Nix. A derivation's identity is a content hash of its serialized record, and the recursive `hashDerivationModulo` replaces each input derivation with *that input's own hash*, so `system`, the builder, every env var and the whole transitive graph reach the output path ([NixOS/nix derivations.cc @2.24.0](https://raw.githubusercontent.com/NixOS/nix/2.24.0/src/libstore/derivations.cc)). Source fetches are fixed-output and keyed only by their content hash, so "changing a URL does not cause a mass rebuild" ([Nix manual: Content-addressing derivation outputs](https://nix.dev/manual/nix/2.28/store/derivation/outputs/content-address)). Bazel's remote-execution API makes the same structure explicit. An action digest covers the command (argv, env sorted by name, outputs), the input Merkle root, platform properties ("even tiny changes … like changing case" create new entries) and a `salt` that places the action "into a separate cache namespace" ([remote_execution.proto](https://github.com/bazelbuild/remote-apis/blob/main/build/bazel/remote/execution/v2/remote_execution.proto)). Bazel also documents the failure that totality prevents: "two users with different compilers installed will wrongly share cache hits", because tools outside the workspace are not tracked ([Bazel: Remote Caching](https://bazel.build/remote/caching)). Docker shows the opposite failure. `RUN apt-get update` is keyed on the command string alone, so it never re-runs when upstream changes ([Docker: Build cache invalidation](https://docs.docker.com/build/cache/invalidation/)).

For this project, the key is `sha256("pkgkey/v1\0" + canonical_json(keydoc))`. The keydoc contains the fully resolved package entry from the lock: builder name plus the hash of the builder's own script files, args, env, resolved features, source git URL and commit, ordered loose-patch content hashes, the platform record, and a map of dependency name to dependency key. `description` fields are removed. Hashing the *resolved* entry follows BitBake, whose basehash covers whatever a task actually references after expansion ([Yocto Overview & Concepts](https://docs.yoctoproject.org/overview-manual/concepts.html)). An edit to an unrelated recipe field elsewhere then causes no miss, and every field that reaches the build is covered. Canonical JSON does not need an RFC 8785 library. `json.dumps(sort_keys=True, separators=(',',':'), ensure_ascii=False, allow_nan=False)` matches JCS as long as configs avoid floats, duplicate keys and non-ASCII keys ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785); [Python json docs](https://docs.python.org/3/library/json.html)). Duplicate keys must be rejected with an `object_pairs_hook`, since by default Python "ignores all but the last name-value pair". Some volatile values are deliberately excluded: build directory, `-j`, hostname, timestamps. Yocto's `BB_BASEHASH_IGNORE_VARS` does the same for `TMPDIR`, `WORKDIR` and `DL_DIR` so that different build dirs can share sstate ([Yocto Overview & Concepts](https://docs.yoctoproject.org/overview-manual/concepts.html)).

The platform needs closed enums, and compiler flags must be derived from it. nixpkgs shows the cost of getting this wrong. Its cc-wrapper bakes `-march=${gcc.arch}` into the compiler ([cc-wrapper/default.nix](https://raw.githubusercontent.com/NixOS/nixpkgs/master/pkgs/build-support/cc-wrapper/default.nix)), so setting `gcc.arch = "x86-64-v3"` rebuilds the whole system, and users report `system-features` errors along the way ([NixOS Discourse #62591](https://discourse.nixos.org/t/nixos-rebuild-system-features-error-when-recompiling-everything-with-gcc-arch-set/62591)). That is the *correct* outcome for this project, since the user wants different CPU levels to produce different cache entries. The lesson is to make it explicit. `platform = {arch: x86_64|aarch64, isa_level: v1|v2|v3|v4, libc: glibc}` is a top-level hashed field, the builder alone emits `-march=x86-64-v3`, and the validator rejects any raw `-march`, `-mtune=native` or `-mcpu=native` in recipe data. Bazel models platforms as sets of constraint values in the same way ([Bazel: Platforms](https://bazel.build/extending/platforms)), and Gentoo's binhost publishes separate x86-64-v3 builds ([Gentoo Binary Host Quickstart](https://wiki.gentoo.org/wiki/Gentoo_Binary_Host_Quickstart)). Two refinements reduce rebuilds. Arch-independent outputs (scripts, firmware, data) declare `"platform": "any"` and drop the platform from their key, as Yocto's `allarch` packages share sstate across machines ([Yocto Overview & Concepts (dev)](https://docs.yoctoproject.org/dev/overview-manual/concepts.html)). Build-context dependencies are keyed with the *build host* platform, not the target ISA level, so bison is not rebuilt for v3. Guix's selective `--tune`, which applies `-march` only to packages marked `tunable?` and grafts the result onto dependents ([Guix manual: Package Transformation Options](https://guix.gnu.org/manual/en/html_node/Package-Transformation-Options.html)), is the right model if whole-system rebuilds per ISA level ever become too expensive. It should be deferred, because without a store-path model the "dependents keep their key" shortcut depends on unverified ABI stability.

The remaining design question is input addressing versus output addressing. Input addressing is "pessimistic": "any minor change (even a comment!) to any of the dependencies causes the _whole graph of descendants to rebuild_" ([Zakaria 2025](https://fzakaria.com/2025/03/08/demystifying-nix-s-intensional-model)). Content addressing gives early cutoff but requires bit-reproducible builds, and Nix's CA derivations are still experimental years after shipping in Nix 2.4, with an open stabilisation milestone ([NixOS/nix milestone 35](https://github.com/NixOS/nix/milestone/35)). Yocto's hash-equivalence server does the same with outhash-to-unihash mapping, and it "needs to be maintained together with the Shared State cache" ([Yocto: Hash Equivalence Server](https://docs.yoctoproject.org/dev/dev-manual/hashequivserver.html)). The recommendation is to **ship input-addressed keys first, and also store each artifact's output hash**, mirroring Bazel's Action Cache (`key → result`) and CAS (`hash → bytes`). That makes early cutoff a later, per-package opt-in once reproducibility is proven, and lets the runner flag a recipe as non-reproducible if a rebuild yields a different output hash. For the kernel specifically, hashing the resolved `.config` after `olddefconfig` instead of the fragment list gives configuration-level early cutoff right away: two VMs whose fragments differ but resolve to the same config share one kernel. Reproducibility inputs are fixed by the builder: `SOURCE_DATE_EPOCH` from the pinned commit's timestamp (Docker notes that dynamic values break the cache on every build) ([Docker: Build cache invalidation](https://docs.docker.com/build/cache/invalidation/)), `-ffile-prefix-map`, which aliases both debug and macro prefix maps ([reproducible-builds.org: Build path](https://reproducible-builds.org/docs/build-path/)), plus `TZ=UTC`, `LC_ALL=C` and sorted tars. Finally, every cache entry should store its full keydoc next to the artifact, so `runner explain <pkg>` can diff the current keydoc against the nearest cached one. That is BitBake's `-S printdiff` ([BitBake manual: Execution](https://docs.yoctoproject.org/bitbake/dev/bitbake-user-manual/bitbake-user-manual-execution.html)) in about 30 lines, and it is the most valuable debugging tool an AI maintainer can have.

## Intent file, lock file, and the schemas that connect them

Every mature tool separates intent from a concrete plan. Spack's `spack.yaml` holds abstract roots and `spack.lock` "the fully configured and concretized specs" ([Spack environments](https://spack.readthedocs.io/en/latest/environments.html)). flake.lock pairs each input's `original` with a `locked` record holding `rev` and `narHash` ([Nix manual: nix flake](https://nix.dev/manual/nix/2.28/command-ref/new-cli/nix3-flake)). Cargo.lock is regenerated only by `cargo update [pkg]` ([Cargo book](https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html)). Here the per-VM `vm.json` is the intent, `vm.lock.json` is the user's "big config", and **builds read only the lock**. The lock stores an `inputs_hash` over the VM config plus every recipe and group it used, and the runner refuses to build on a mismatch unless told to re-lock, the same guarantee as Poetry's out-of-sync warning ([Poetry basic usage](https://python-poetry.org/docs/basic-usage/)). Because commits are pinned in recipes, the lock also records the catalog repo commit, which plays the role of Guix's pinned channels and `time-machine` ([Guix manual: Replicating Guix](https://guix.gnu.org/manual/en/html_node/Replicating-Guix.html)). Every package entry carries `why` provenance (which group or root pulled it in), restoring the traceability that override systems lose.

Merging needs one rule, and it comes from CUE and Nickel. CUE rejects override chains so that "an observed field value holds for the final result" ([The logic of CUE](https://cuelang.org/docs/concept/the-logic-of-cue/)). Nickel allows explicit priorities (`default` < normal < `force`) and fails when equal-priority values disagree ([Nickel manual: merging](https://nickel-lang.org/user-manual/merging)). Applied here, there are three fixed layers: recipe defaults, then group settings, then the VM's per-package `override`. Disagreement outside `override` is an error, never "last wins". `override` is an RFC 7396 Merge Patch: objects merge recursively, scalars and arrays are replaced, `null` deletes ([RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)). To make that work cleanly, sets (deps, features, kernel symbols) are objects keyed by name, ordered lists (configure args, patches) are replaced whole, and `null` is banned as data. Unknown keys are rejected, the way Pkl forbids new properties on typed objects ([Pkl language reference](https://pkl-lang.org/main/current/language-reference/index.html)), which catches the most common AI and human typo. A JSON Schema file serves as documentation and editor completion, but the runner enforces it with a roughly 200-line stdlib subset validator plus semantic checks. The stdlib has no `jsonschema`, and JSON Schema's `default` is only an annotation that never fills values in ([JSON Schema 2020-12 core](https://json-schema.org/draft/2020-12/json-schema-core)). Comments are `description` fields, stripped before hashing. Hadlow's "configuration complexity clock" warns about the endpoint of adding expressions to config ([Configuration Complexity Clock](https://mikehadlow.blogspot.com/2012/05/configuration-complexity-clock.html)). When a conditional seems necessary, the answer is a named feature that the builder interprets.

The sketches below are the recommended shapes. They are abbreviated, and the field names are a proposal.

**Recipe** (`catalog/pkgs/dhcpcd.json`):

```json
{
  "schema": "recipe/1",
  "name": "dhcpcd",
  "description": "DHCP client; runit service included",
  "source": {
    "git": "https://git.example/me/dhcpcd.git",
    "commit": "<40-hex: tip of my branch 'vm/v10.5.2'>",
    "upstream": {"git": "https://github.com/NetworkConfiguration/dhcpcd", "commit": "<40-hex base>", "tag": "v10.5.2"}
  },
  "patches": [
    {"file": "0001-small-fix.patch", "reason": "upstream PR #123, drop after bump"}
  ],
  "builder": "configure",
  "args": {
    "configure": ["--privsepuser=dhcpcd", "--dbdir=/var/lib/dhcpcd", "--rundir=/run/dhcpcd"],
    "make": [], "install": []
  },
  "env": {},
  "deps": {
    "build": {"pkgconf": {}},
    "link":  {"glibc": {}},
    "run":   {}
  },
  "features": {
    "privsep": {"type": "bool", "default": true,
                "on": {"args": {"configure": ["--enable-privsep"]}},
                "off": {"args": {"configure": ["--disable-privsep"]}}},
    "ipv6":    {"type": "bool", "follows": "ipv6", "default": true,
                "off": {"args": {"configure": ["--disable-ipv6"]}},
                "on":  {"kernel": {"IPV6": "y"}}}
  },
  "users":    {"dhcpcd": {"system": true, "home": "/var/lib/dhcpcd"}},
  "services": {"dhcpcd": "services/dhcpcd"},
  "hooks":    {"post_install": "hooks/dhcpcd-post-install.sh"},
  "platform": "target"
}
```

Required fields are `name`, `source` and `builder`. `args`, `deps` and `patches` are common, `features`, `env`, `users`, `services` and `hooks` are occasional, and `bootstrap` (an autotools option for git-sourced GNU packages, e.g. `"./bootstrap --skip-po"`) is rare. `builder` is one of `autotools | configure | make | meson | kernel | script`. Only `script` may define all phases (`fetch` is never a phase: sources come from the lock). A dependency entry may request features on the dependency, e.g. `"libcurl": {"features": {"tls": true, "ipv6": "same"}}`.

**Kernel recipe** (`catalog/pkgs/linux-libre.json`). The kernel is built the same way as any other package, with the kernel builder:

```json
{
  "schema": "recipe/1",
  "name": "linux-libre",
  "source": {"git": "https://git.example/me/linux-libre.git", "commit": "<40-hex>"},
  "builder": "kernel",
  "args": {"defconfig": "x86_64_defconfig", "make": ["LOCALVERSION="], "image": "arch/x86/boot/bzImage"},
  "kernel": {
    "VIRTIO_PCI": "y", "VIRTIO_BLK": "y", "VIRTIO_NET": "y",
    "SERIAL_8250_CONSOLE": "y",
    "DEBUG_INFO_BTF": {"value": "n", "optional": true}
  },
  "deps": {"build": {"bison": {}, "flex": {}, "bc": {}, "elfutils": {}}}
}
```

The kernel builder merges `kernel` maps from the recipe, enabled feature effects and groups. It writes a fragment, runs `merge_config.sh` then `olddefconfig`, and fails if any non-optional symbol lacks its requested value. The cache key uses the resolved `.config` hash.

**Group** (`catalog/groups/x11.json`):

```json
{
  "schema": "group/1",
  "name": "x11",
  "includes": ["@base"],
  "packages": {"xorg-server": {}, "xinit": {}, "xterm": {}},
  "system_features": {"x11": true},
  "kernel": {"DRM_VIRTIO_GPU": "y", "INPUT_EVDEV": "y"},
  "services": {}
}
```

**VM intent** (`vm_tmp/<name>/vm.json`, copied from a template; the folder name is the VM name):

```json
{
  "schema": "vm/1",
  "platform": {"arch": "x86_64", "isa_level": "v3", "libc": "glibc"},
  "packages": {"@base": {}, "@x11": {}, "vim": {}, "curl": {}},
  "system_features": {"ipv6": true, "x11": true},
  "configure": {
    "curl": {"features": {"http2": false}},
    "dhcpcd": {"override": {"args": {"configure": ["--privsepuser=dhcpcd", "--dbdir=/var/lib/dhcpcd"]}}}
  },
  "kernel": {"NET_9P_VIRTIO": "y", "9P_FS": "y"},
  "image": {
    "format": "ext4", "size": "2G", "readonly": true,
    "users": {"stan": {"uid": 1000, "groups": ["wheel"]}},
    "services": ["dhcpcd", "agetty-ttyS0"],
    "overlay": "overlay/",
    "shares": {"home": {"tag": "home9p", "mount": "/home"}}
  },
  "tests": {
    "image": {"no_missing_libs": true, "files": ["/sbin/runit-init", "/usr/bin/vim"]},
    "boot":  {"timeout_s": 60, "expect": ["login:"], "run": [{"cmd": "ip -br addr", "expect": "UP"}]}
  }
}
```

**Lock** (`vm_tmp/<name>/vm.lock.json`, generated only by `runner lock [--update pkg]`, pretty-printed with sorted keys):

```json
{
  "lock_version": 1,
  "inputs_hash": "sha256:…",
  "catalog_commit": "<40-hex>",
  "platform": {"arch": "x86_64", "isa_level": "v3", "libc": "glibc", "build_host": "x86_64-v1"},
  "toolchain": {"name": "gcc", "key": "sha256:…"},
  "order": ["glibc", "pkgconf", "dhcpcd", "…", "linux-libre", "image"],
  "packages": {
    "dhcpcd": {
      "why": ["@base"],
      "source": {"git": "…", "commit": "<40-hex>", "epoch": 1759400000},
      "patches": [{"file": "0001-small-fix.patch", "sha256": "…"}],
      "builder": {"name": "configure", "hash": "sha256:…"},
      "args": {"configure": ["--prefix=/usr", "…", "--privsepuser=dhcpcd", "--enable-privsep"]},
      "env": {},
      "features": {"ipv6": true, "privsep": true},
      "deps": {"build": {"pkgconf": "sha256:…"}, "link": {"glibc": "sha256:…"}, "run": {}},
      "context": "target",
      "key": "sha256:…",
      "output": "sha256:… (filled after build)"
    },
    "linux-libre": {"…": "…", "kernel_requested": {"VIRTIO_NET": "y", "9P_FS": "y"}, "config_hash": "sha256:…"}
  },
  "image": {"closure": ["glibc", "bash", "…"], "key": "sha256:…"}
}
```

The runner's pipeline follows directly from these shapes. `check` runs strict parsing with duplicate-key rejection, the subset schema and semantic checks, and reports JSON-Pointer error paths so an AI can fix them mechanically. `lock` expands groups, takes the closure over `build`/`link`/`run`, runs the feature fixpoint and validation, merges kernel maps, runs `patch --dry-run` for loose patches, tsorts, computes keys bottom-up and writes the lock. `plan` diffs the new lock against the old one in flake style ("dhcpcd: abc123 → def456; 14 packages rebuild"), applying the rule that the rebuild scope should be visible in the lock diff rather than hidden, as Guix's `--with-patch=glibc` rebuilds hide it ([Guix manual: Package Transformation Options](https://guix.gnu.org/manual/en/html_node/Package-Transformation-Options.html)). `build` fetches each key from the shared cache or builds it in a per-package sysroot. Buildroot's `BR2_PER_PACKAGE_DIRECTORIES` provides that isolation ([Buildroot manual](https://buildroot.org/downloads/manual/manual.html)), and it is also what keeps one package's pkg-config from seeing another's leftovers. `image` assembles the `link`+`run` closure, generates `/etc/passwd` from recipe and VM `users` (Void `system_accounts` and Buildroot `_USERS` precedents), symlinks the selected runit services (Void's `vsv` pattern), and applies the overlay. `test` runs the image checks (unresolved `DT_NEEDED`, required files) and the serial-console boot script. Every one of these steps is plain Python with `hashlib`, `json`, `subprocess` and `graphlib.TopologicalSorter`, plus POSIX shell builders, and none of them requires evaluating user code.

## Conclusion

Nix, Spack and Yocto pay most of their complexity for flexibility this project has explicitly declined: many versions, binary reuse across arbitrary configurations, and a programmable configuration language. Once those are gone, three problems that look hard in the literature become easy. Solving becomes a tsort, feature resolution becomes a monotone union, and cache identity becomes a Merkle hash over a JSON document the runner already has. What remains hard is *totality*: making sure nothing reaches a build that is not in its keydoc. The tools for that are discipline in the builders (derived `-march`, centrally set `SOURCE_DATE_EPOCH`, per-package sysroots, no network after fetch), not expressiveness in the data. The design's success will depend more on the 200 lines of builder environment setup than on any schema field.

Some questions stay open, and they should be settled with measurements rather than adopted up front. Whether output-hash early cutoff pays off depends on how reproducible glibc and the GNU userland builds are in this environment. Nix's years-long experimental CA status is a warning that it is not free. Whether per-ISA-level whole-system rebuilds are tolerable depends on build times, and a Guix-style `tunable` subset is the fallback. Whether "system features" stays a short list or drifts toward Gentoo's global USE set depends on catalog discipline. A useful guardrail: a system feature exists only if at least two recipes follow it and at least one VM template disables it. Otherwise it is either a default or a per-package setting.
