# Package recipe formats and system-image build frameworks (inspiration for a JSON recipe format)

Sources were read on 2026-10-03. Most claims come from the current upstream source trees (Buildroot master on GitLab, openembedded-core master, void-packages master, Alpine aports/abuild master, Arch packaging GitLab, homebrew-core main) and from the documentation stored in those repos (Buildroot `docs/manual/*.adoc`, yocto-docs `*.rst`, void `Manual.md`, abuild `APKBUILD.5.scd`, pacman `PKGBUILD.5.asciidoc`). The Alpine wiki and Arch wiki returned 403 or a bot-wall, so I used their man-page sources instead.

Abbreviations: BR = Buildroot, OE = OpenEmbedded/Yocto, BB = BitBake.

---

## 1. Buildroot: package infrastructures, variables, Kconfig, kernel fragments, BR2_EXTERNAL, patches, hashes, rootfs

### Takeaway
A Buildroot package is a `.mk` file that defines prefixed variables (`FOO_VERSION`, `FOO_SITE`, `FOO_CONF_OPTS`, `FOO_DEPENDENCIES`...) and ends with one `$(eval $(<infra>-package))` line. The infrastructure (generic/autotools/cmake/meson/kernel-module) supplies every build step. A separate Kconfig `Config.in` handles selection and optional features. This is the closest existing model to "generic builder plus per-package data". Its weak spot is optional features: they are open-coded `ifeq` blocks that switch configure flags and dependencies. A data format can replace that with a declarative feature table.

### Cited Findings
**Infrastructures and the minimal recipe**
- The infrastructures are generic-package, autotools-package, cmake-package, meson-package and kernel-module, among others. A package selects one with a final `$(eval $(xxx-package))` — [Buildroot manual](https://buildroot.org/downloads/manual/manual.html)
- Real example: `package/dhcpcd/dhcpcd.mk` (dhcpcd 10.5.2) uses **generic-package**. The file explains why: "Even though this package has a configure script, it is not generated using the autotools, so we have to use the generic package infrastructure." It therefore hand-writes `DHCPCD_CONFIGURE_CMDS`, `DHCPCD_BUILD_CMDS` and `DHCPCD_INSTALL_TARGET_CMDS`, which call `$(TARGET_CONFIGURE_OPTS) ./configure $(DHCPCD_CONFIG_OPTS)` and `$(MAKE) ... install DESTDIR=$(TARGET_DIR)` — [dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk)
- `package/iproute2/iproute2.mk` (7.1.0) is also generic-package. Its build step passes `CBUILD_CFLAGS="$(HOST_CFLAGS)"`, `SHARED_LIBS=...` and `DBM_INCLUDE="$(STAGING_DIR)/usr/include"`, and it appends `TC_CONFIG_XT:=n` to `config.mk` to switch off iptables support. Dependencies are `host-bison host-flex host-pkgconf` plus conditional libs — [iproute2.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/iproute2/iproute2.mk)
- `package/coreutils/coreutils.mk` (9.10) is autotools-package. It sets `COREUTILS_CONF_OPTS` (`--disable-rpath --disable-year2038 --enable-install-program=kill,uptime`) and a long `COREUTILS_CONF_ENV` list of cached autoconf/gnulib results for cross-compiling (`gl_cv_func_getcwd_null=yes`, `ac_cv_func_chown_works=yes`, `gl_cv_func_working_mkstemp=yes`, ... `PERL=missing MAKEINFO=true`). It also adds `COREUTILS_POST_INSTALL_TARGET_HOOKS += COREUTILS_FIX_BIN_LOCATION` to move binaries into /bin — [coreutils.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/coreutils/coreutils.mk)
- `package/util-linux/util-linux.mk` (2.41.5) sets `UTIL_LINUX_AUTORECONF = YES` because one of its own patches touches autotools files (the comment names `0002-autotools-optionally-add-libpthread-to-uuid.pc.patch`). It also sets `UTIL_LINUX_INSTALL_STAGING = YES` and separate `HOST_UTIL_LINUX_CONF_OPTS` for the host build. Flags such as `--with-udev`/`--without-udev` and `--with-systemd`/`--without-systemd` are switched by `ifeq ($(BR2_PACKAGE_...),y)` blocks — [util-linux.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/util-linux/util-linux.mk)

**Variable conventions (generic infra)**
- Mandatory: `LIBFOO_VERSION`. It may be a release version, "a sha1 for a git tree: `LIBFOO_VERSION = cb9d6aa9...`" or a tag. The manual says "Using a branch name as FOO_VERSION is not supported": local caching means it would never be re-fetched, and builds would not be reproducible — [adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)
- `LIBFOO_SITE_METHOD` is usually guessed from the `LIBFOO_SITE` URL scheme. Values include wget, scp, sftp, svn, git and others. `HOST_LIBFOO_*` variables default to the target ones. Git-specific options: `LIBFOO_GIT_SUBMODULES = YES` and `LIBFOO_GIT_LFS` — [adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)
- The full generic variable list in the manual: `_SOURCE`, `_PATCH`, `_SITE`, `_DL_OPTS`, `_EXTRA_DOWNLOADS`, `_SITE_METHOD`, `_GIT_SUBMODULES`, `_GIT_LFS`, `_STRIP_COMPONENTS`, `_EXCLUDES`, `_DEPENDENCIES`, `_EXTRACT_DEPENDENCIES`, `_PATCH_DEPENDENCIES`, `_PROVIDES`, `_INSTALL_STAGING` (default NO), `_INSTALL_TARGET` (default YES), `_INSTALL_IMAGES`, `_CONFIG_SCRIPTS`, `_DEVICES`, `_PERMISSIONS`, `_USERS`, `_LICENSE`, `_LICENSE_FILES`, `_REDISTRIBUTE`, `_IGNORE_CVES`. The command hooks are `_EXTRACT_CMDS`, `_CONFIGURE_CMDS`, `_BUILD_CMDS`, `_INSTALL_TARGET_CMDS`, `_INSTALL_STAGING_CMDS`, `_INSTALL_IMAGES_CMDS`, `_INSTALL_INIT_SYSV`/`_OPENRC`/`_SYSTEMD`, `_LINUX_CONFIG_FIXUPS` and `_BUSYBOX_CONFIG_FIXUPS` — [adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)
- `LIBFOO_DEPENDENCIES` are "guaranteed to be compiled and installed before the configuration of the current package starts". However, "modifications to configuration of these dependencies will not force a rebuild of the current package". `HOST_LIBFOO_DEPENDENCIES` is the equivalent for host packages. Host tools are named `host-<pkg>` in dependency lists (e.g. `host-pkgconf`) — [adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc); [iproute2.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/iproute2/iproute2.mk)
- Extra variables in the autotools infra: `_SUBDIR`, `_CONF_ENV`, `_CONF_OPTS`, `_MAKE`, `_MAKE_ENV`, `_MAKE_OPTS`, `_AUTORECONF`, `_AUTORECONF_ENV`, `_AUTORECONF_OPTS`, `_AUTOPOINT`, `_LIBTOOL_PATCH`, `_INSTALL_STAGING_OPTS`, `_INSTALL_TARGET_OPTS` — [adding-packages-autotools.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-autotools.adoc)
- Packages declare users inline with a makedev-like syntax. Example: `define DHCPCD_USERS` / `dhcpcd -1 dhcpcd -1 * - - - dhcpcd user` — [dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk)
- Init integration is per package. `DHCPCD_INSTALL_INIT_SYSV` installs `S41dhcpcd` and `DHCPCD_INSTALL_INIT_SYSTEMD` installs `dhcpcd.service`. Buildroot runs whichever one matches the configured init system. There is no runit hook — [dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk)

**Kconfig selection**
- Each package has a `Config.in` with `config BR2_PACKAGE_DHCPCD` / `bool "dhcpcd"` / `depends on BR2_TOOLCHAIN_HEADERS_AT_LEAST_3_1`. Sub-options sit inside `if BR2_PACKAGE_DHCPCD` (e.g. `BR2_PACKAGE_DHCPCD_ENABLE_PRIVSEP`, `default y`, `depends on BR2_USE_MMU`). The `.mk` reads these as `ifeq ($(BR2_PACKAGE_DHCPCD_ENABLE_PRIVSEP),y) DHCPCD_CONFIG_OPTS += --enable-privsep else ... --disable-privsep` — [dhcpcd Config.in](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/Config.in); [dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk)
- `select` forces a dependency on. `depends on` controls whether the option is visible — [Buildroot manual](https://buildroot.org/downloads/manual/manual.html)

**Linux kernel and config fragments**
- `BR2_LINUX_KERNEL_CUSTOM_GIT` ("get the Linux kernel source code from a Git repository") and `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` ("A space-separated list of kernel configuration fragment files, that will be merged to the main kernel configuration file") — [linux/Config.in](https://gitlab.com/buildroot.org/buildroot/-/raw/master/linux/Config.in)
- A package can force kernel options with `LIBFOO_LINUX_CONFIG_FIXUPS`, using `KCONFIG_ENABLE_OPT`, `KCONFIG_DISABLE_OPT` or `KCONFIG_SET_OPT`. The manual says to use it only for options "without which the package is fundamentally broken" and notes it "is seldom used". `_BUSYBOX_CONFIG_FIXUPS` works the same way for busybox — [adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)

**Patches tied to versions**
- In-tree patches live in `package/<pkg>/` or in a version subdirectory `package/<pkg>/<packageversion>/`. They are applied alphabetically and named `NNNN-description.patch` (git format-patch style). Patch filenames "should not contain any package version reference". A quilt `series` file is deprecated — [patch-policy.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/patch-policy.adoc)
- Patch order: `_PRE_PATCH_HOOKS`, then `<pkg>_PATCH` downloads (full URL, or relative to `_SITE`, hashed in the .hash file), then the package dir or `<version>` subdir, then `BR2_GLOBAL_PATCH_DIR`, then `_POST_PATCH_HOOKS` — [patch-policy.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/patch-policy.adoc)
- `BR2_GLOBAL_PATCH_DIR` lookup: use `<dir>/<pkg>/<version>/` if it exists, otherwise `<dir>/<pkg>/`. This is the preferred way to add project patches — [customize-patches.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/customize-patches.adoc)

**Hash files**
- The `.hash` format is `sha256  <hash>  <file>`, one line per file. It covers tarballs and also LICENSE files ("Locally calculated"), e.g. dhcpcd.hash — [dhcpcd.hash](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.hash)
- Hashes are checked for http/ftp, **Git** and Subversion downloads, scp and local files, but not for CVS or Mercurial, "because Buildroot currently does not generate reproducible tarballs" for those. For git sources the hash covers a reproducible tarball that Buildroot builds from the checkout — [adding-packages-directory.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-directory.adoc)

**BR2_EXTERNAL, per-package dirs, rootfs**
- A `BR2_EXTERNAL` tree holds `external.desc`, `external.mk`, `Config.in`, `configs/` (defconfigs) and `package/`. Buildroot exposes its location as `BR2_EXTERNAL_<NAME>_PATH` — [Buildroot manual](https://buildroot.org/downloads/manual/manual.html)
- `BR2_PER_PACKAGE_DIRECTORIES` gives every package its own `per-package/<pkg>/{host,target}` directories. This isolates builds so top-level `make -jN` works — [Buildroot manual](https://buildroot.org/downloads/manual/manual.html)
- Image customisation options: `BR2_ROOTFS_OVERLAY` (directory copied verbatim), `BR2_ROOTFS_POST_BUILD_SCRIPT` (runs before images are made), `BR2_ROOTFS_POST_IMAGE_SCRIPT`, `BR2_ROOTFS_USERS_TABLES`, `BR2_ROOTFS_DEVICE_TABLE`, plus per-package `_PERMISSIONS`, `_DEVICES` and `_USERS` — [Buildroot manual](https://buildroot.org/downloads/manual/manual.html)

### Inferences
- Most of a typical Buildroot `.mk` is conditional feature wiring: `ifeq` → add a flag plus a dependency, `else` → add the negative flag. A JSON `features: {name: {on: [...], off: [...], deps: [...]}}` table covers this almost completely, and it is what OE's PACKAGECONFIG already does (section 2).
- The `COREUTILS_CONF_ENV` autoconf cache list shows that cross-building GNU packages needs per-package `env` overrides. The schema needs a first-class `env` or `configure_env` field. Buildroot also relies on its infra exporting `PKG_CONFIG_SYSROOT_DIR`/`PKG_CONFIG_LIBDIR` into the environment. That centralised handling is exactly what fixes the user's "PKG_CONFIG leak" problem, so the builder should own it and recipes should not.
- Buildroot's two-level patch lookup (`<pkg>/<version>/` first, then `<pkg>/`) is a cheap way to tie patches to a version. With git commits as versions, the key could be the commit or the tag.
- Buildroot keeps "what is built" (Kconfig) apart from "how it is built" (.mk). For a small personal system a plain list of packages in an image JSON is enough; Kconfig-style solving is overkill.

### Gaps
- I did not fetch the meson-package or kernel-module infra docs verbatim. Their variable names follow the same pattern (`FOO_CONF_OPTS`, `FOO_MESON_EXTRA_BINARIES`, ...) but I did not verify them line by line.
- I did not verify the full text of how `TARGET_CONFIGURE_OPTS` sets PKG_CONFIG variables. The claim above about pkg-config handling comes from general knowledge, not from a fetched source.

---

## 2. Yocto / BitBake / OpenEmbedded

### Takeaway
OE recipes are short because classes (`inherit autotools pkgconfig systemd useradd`) supply the build steps. The other main tool is **PACKAGECONFIG**: a declarative table of per-recipe features, where each feature carries its own enable flag, disable flag, build deps and runtime deps. Global `DISTRO_FEATURES` turn those features on via `bb.utils.filter`. Kernel config fragments are plain `.cfg` files listed in `SRC_URI`, and images are lists of packages and packagegroups. The cost is complexity: layers, overrides, `.bbappend`, inline Python and a large variable glossary.

### Cited Findings
- Real recipe `dhcpcd_10.5.2.bb`:
  - Source is pinned by git: `SRC_URI = "git://github.com/NetworkConfiguration/dhcpcd;protocol=https;branch=master;tag=v${PV} file://0001-...patch ... file://dhcpcd.service"` with `SRCREV = "7c50b51a142ca5e8cbbf8f65cd8111d6f200608a"`.
  - Build steps come from `inherit pkgconfig autotools-brokensep systemd useradd`, with `do_configure() { oe_runconf }` overridden because "This isn't autoconf but is instead a configure script that tries to look like autoconf".
  - Features: `PACKAGECONFIG ?= "udev ${@bb.utils.filter('DISTRO_FEATURES', 'ipv6 seccomp', d)}"`, with entries such as `PACKAGECONFIG[udev] = "--with-udev,--without-udev,udev,udev"`.
  - Users come from `USERADD_PARAM:${PN} = "--system -d ${DBDIR} -M -s /bin/false -U dhcpcd"`.
  - — [dhcpcd_10.5.2.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-connectivity/dhcpcd/dhcpcd_10.5.2.bb)
- PACKAGECONFIG has up to six positional, comma-separated fields per feature: (1) args added to `PACKAGECONFIG_CONFARGS` when enabled, (2) args when disabled, (3) extra `DEPENDS` (build), (4) extra `RDEPENDS`, (5) extra `RRECOMMENDS`, (6) conflicting PACKAGECONFIG features. "You can omit any argument you like but must retain the separating commas." — [yocto-docs variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)
- `coreutils_9.11.bb`: `DEPENDS = "gmp libcap"`, `DEPENDS:class-native = ""`, `inherit autotools gettext texinfo`. The source is a tarball plus `file://` patches named after CVEs, verified by `SRC_URI[sha256sum]`. `EXTRA_OECONF:class-target = "--enable-install-program=arch,hostname ..."`. `PACKAGECONFIG[acl] = "--enable-acl,--disable-acl,acl,"`. Package splitting uses `FILES:coreutils-stdbuf`. The per-variant `:class-target`, `:class-native` and `:class-nativesdk` overrides let one recipe build both host and target — [coreutils_9.11.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-core/coreutils/coreutils_9.11.bb)
- `DISTRO_FEATURES` alone does not enable anything: "Just enabling DISTRO_FEATURES alone doesn't enable feature support for packages. Mechanisms such as making PACKAGECONFIG track DISTRO_FEATURES are used." — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)
- With `inherit features_check`, `REQUIRED_DISTRO_FEATURES` skips the recipe (or errors if something needs it) when a listed feature is absent. `REQUIRED_IMAGE_FEATURES` does the same for image features — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)
- `SRCREV` should be a full SHA, not a tag, "if you want to build a fixed revision and you want to avoid performing a query on the remote repository every time BitBake parses your recipe" — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)
- Patches and files are looked up through `FILESPATH = "${FILE_DIRNAME}/${BP}", "${FILE_DIRNAME}/${BPN}", "${FILE_DIRNAME}/files"` (BP = name-version, BPN = name), extended by `FILESOVERRIDES` (e.g. per-MACHINE subdirectories such as `files/MACHINEA/defconfig`). `.bbappend` files in other layers must add `FILESEXTRAPATHS:prepend := "${THISDIR}/${PN}:"` — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst); [kernel-dev/common.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/kernel-dev/common.rst)
- Kernel config fragments "are simply kernel options" in `.config` syntax. They are applied after the `defconfig` and added through `SRC_URI += "file://myconfig.cfg file://eth.cfg file://gfx.cfg"`, usually in a kernel `.bbappend` — [kernel-dev/common.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/kernel-dev/common.rst)
- `KERNEL_FEATURES` adds kernel metadata (`.scc` feature descriptions, which bundle fragments and patches) and can be overridden per machine. Example: `KERNEL_FEATURES:append = " features/netfilter/netfilter.scc"`, `KERNEL_FEATURES:append:qemuall = " cfg/virtio.scc"` — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)
- Images: `core-image-minimal.bb` is `IMAGE_INSTALL = "packagegroup-core-boot ${CORE_IMAGE_EXTRA_INSTALL}"` plus `inherit core-image` and `IMAGE_ROOTFS_SIZE ?= "8192"` — [core-image-minimal.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-core/images/core-image-minimal.bb)
- Packagegroups are empty recipes (`inherit packagegroup`) whose `RDEPENDS:${PN}` lists members. `packagegroup-core-boot` includes `base-files base-passwd ${VIRTUAL-RUNTIME_base-utils} netbase ${VIRTUAL-RUNTIME_init_manager} ${VIRTUAL-RUNTIME_dev_manager} ...`, with members gated on `DISTRO_FEATURES`/`MACHINE_FEATURES` through `bb.utils.contains` — [packagegroup-core-boot.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-core/packagegroups/packagegroup-core-boot.bb)
- Image-level users: `EXTRA_USERS_PARAMS` (with the extrausers class) runs `useradd`/`groupadd`/`usermod` commands. The docs call this "a more global method" than recipe-level `useradd`. `ROOTFS_POSTPROCESS_COMMAND += "function"` runs functions against `${IMAGE_ROOTFS}` after the rootfs is assembled — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)
- The docs themselves warn that `IMAGE_INSTALL +=` in local.conf "can cause ordering issues" and recommend `:append` instead. Small operator semantics trip up users — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)

### Inferences
- PACKAGECONFIG is the best existing model for a JSON "features" table. Mapped to JSON: `"features": {"udev": {"enable": ["--with-udev"], "disable": ["--without-udev"], "deps": ["udev"]}}` plus `"default_features": [...]`. Its positional comma syntax is the main readability problem, and JSON fixes that.
- `VIRTUAL-RUNTIME_init_manager` (a virtual provider) is how OE swaps init systems. In the user's system runit is fixed, so a simple `services` field (runit service dirs) is enough.
- OE's `:class-native` overrides show how one recipe can describe both host and target builds. A small system may only need `host_deps` vs `deps`, plus an optional `"host": {...}` override block for packages built for the host.
- Fragments-as-`.cfg` files that a feature can pull in maps well to "kernel config fragments per feature": an image or feature lists fragments, and the kernel builder merges them (scripts/kconfig/merge_config.sh). This is the same mechanism Buildroot uses.

### Gaps
- I did not fetch a published primary critique of Yocto's complexity. Readers widely regard layers, override syntax, inline Python and sstate as a steep learning curve, but I have no citable source in these notes.
- I did not fetch the current linux-yocto recipe because the file name changed and returned 404.

---

## 3. Alpine APKBUILD, Arch PKGBUILD, Void xbps-src, Homebrew: short recipes, helpers, host vs target deps

### Takeaway
Void's `build_style=` is the purest form of "generic builder plus data". `dhcpcd` and `iproute2` are under 40 lines with no build functions, because the style script and a central `configure_args` default file (prefix, sbindir, `--host`/`--build` triplets, autoconf cache for musl) handle the boilerplate. Void and Alpine both split host-run tools from target libraries (`hostmakedepends` vs `makedepends`; `makedepends_build` vs `makedepends_host`) to support cross builds. Arch and Alpine leave `build()` as an explicit shell function. Homebrew relies on `std_configure_args` / `std_cmake_args` / `std_meson_args` helpers and bans build options in core.

### Cited Findings
**Void (xbps-src)**
- `srcpkgs/dhcpcd/template`:
  - Header fields: `build_style=configure`, `configure_args="--prefix=/usr --sbindir=/usr/bin ... $(vopt_if privsep --privsepuser=_dhcpcd) $(vopt_enable privsep)"`, `hostmakedepends="ntp pkg-config"`, `makedepends="eudev-libudev-devel"`.
  - Source: `distfiles=...v${version}.tar.gz` and `checksum=...`.
  - Accounts: `system_accounts="_dhcpcd"`. Options: `build_options="privsep"`.
  - `post_install() { vsv dhcpcd; vsv dhcpcd-eth0; ... }` installs the runit services.
  - — [void dhcpcd template](https://raw.githubusercontent.com/void-linux/void-packages/master/srcpkgs/dhcpcd/template)
- `srcpkgs/iproute2/template` has `build_style=configure`, `make_install_args="SBINDIR=/usr/bin"`, `hostmakedepends="pkg-config perl flex"`, `makedepends="libfl-devel libmnl-devel db-devel iptables-devel elfutils-devel libbpf-devel"`, `conf_files=...` and a small `post_install` — [void iproute2 template](https://raw.githubusercontent.com/void-linux/void-packages/master/srcpkgs/iproute2/template)
- `srcpkgs/coreutils/template` uses no build_style (custom phases). In `pre_configure`, when `$CROSS_BUILD` is set, it first builds a native coreutils with `CC=cc` so help2man can generate manpages. Under musl it exports autoconf cache overrides (`ac_cv_lib_error_at_line=no`). Field `bootstrap=yes` — [void coreutils template](https://raw.githubusercontent.com/void-linux/void-packages/master/srcpkgs/coreutils/template)
- Dependency semantics:
  - `hostmakedepends` = "host dependencies required to build the package".
  - `makedepends` = "target dependencies required to build the package".
  - `depends` = runtime dependencies, which may carry version constraints (`foo>=1.0`).
  - `checkdepends` = test-time dependencies.
  - Build-time deps take no version because "the current version in srcpkgs will always be required".
  - Programs that must *run* during the build (yacc, the compiler) go in hostmakedepends. Libraries and headers go in makedepends and "will match the target architecture".
  - — [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)
- Available `build_style` values: cargo, cmake, configure, fetch, gnu-configure, gnu-makefile, go, gemspec, gem, ruby-module, perl-module, raku-dist, waf3, slashpackage, qmake, meson, void-cross, zig-build, python3-module, python3-pep517, texmf, tree-sitter. With no build_style, the template must define at least `do_install()`. `build_helper="rust"` sources extra helper files — [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)
- The gnu-configure style is about 40 lines of shell: `do_configure() { ${configure_script:=./configure} ${configure_args}; }` and `do_build() { ${make_cmd:=make} ${makejobs} ... ${make_build_args} ${make_build_target}; }`, plus check/install — [gnu-configure.sh](https://raw.githubusercontent.com/void-linux/void-packages/master/common/build-style/gnu-configure.sh)
- Cross is centralised. `common/environment/configure/gnu-configure-args.sh` prepends `--prefix=/usr --sysconfdir=/etc --sbindir=/usr/bin --bindir=/usr/bin --mandir=... --localstatedir=/var`, then adds `--host=$XBPS_TRIPLET --build=$XBPS_TRIPLET`, a wordsize libdir and musl autoconf cache files. Template `configure_args` are appended last "so they can be included last and override our defaults" — [gnu-configure-args.sh](https://raw.githubusercontent.com/void-linux/void-packages/master/common/environment/configure/gnu-configure-args.sh)
- `nocross="reason"` marks a package as not cross-buildable. `metapackage=yes` marks a package that "only depends on other packages" — [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)
- Options: `build_options`, `build_options_default` and `desc_option_<opt>`, used in templates through `vopt_if`/`vopt_enable` — [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)

**Alpine (abuild)**
- `main/dhcpcd/APKBUILD` (10.5.2):
  - Metadata: `pkgname/pkgver/pkgrel/pkgdesc/url/arch="all"/license`, `makedepends="linux-headers bsd-compat-headers"`, `subpackages="$pkgname-doc $pkgname-openrc"`.
  - `source=` lists the tarball URL followed by local `*.patch` files and `dhcpcd.initd`.
  - `build()` runs `./configure --build=$CBUILD --host=$CHOST --sysconfdir=/etc ...` then `make`. `package()` runs `make DESTDIR="$pkgdir" install`.
  - `sha512sums=` sits at the end, along with a `# secfixes:` comment block mapping versions to CVEs.
  - — [Alpine dhcpcd APKBUILD](https://gitlab.alpinelinux.org/alpine/aports/-/raw/master/main/dhcpcd/APKBUILD)
- Cross split: `makedepends_build` = deps "for the CBUILD machine, installed without --root". `makedepends_host` = deps "for the CHOST machine, installed into CBUILDROOT". The machine triplets are `CBUILD`, `CHOST` and `CTARGET` — [APKBUILD.5](https://gitlab.alpinelinux.org/alpine/abuild/-/raw/master/APKBUILD.5.scd)
- `source` "must not vary depending on the environment (eg. CHOST)". The default `prepare()` is `default_prepare`, which applies the `*.patch` files listed in `source`; a custom `prepare` "must call default_prepare". `sha512sums` is generated by `abuild checksum`, "should not be manually written" and must be at the end of the file. Git is not a normal source type: `giturl`/`reporev` exist only for `abuild snapshot`, which builds a tarball, and "should typically not be used" — [APKBUILD.5](https://gitlab.alpinelinux.org/alpine/abuild/-/raw/master/APKBUILD.5.scd)

**Arch (makepkg)**
- `dhcpcd` PKGBUILD: arrays for `depends`, `provides`, `backup` and `source` (tarball plus `.asc` signature and service/sysusers/tmpfiles files), `sha256sums`/`b2sums` with `'SKIP'` for the signature, and `validpgpkeys`. `prepare()` edits the config. `build()` has an explicit `./configure "${configure_options[@]}"` and `make`. There is no cross support (`arch=(x86_64)`) — [Arch dhcpcd PKGBUILD](https://gitlab.archlinux.org/archlinux/packaging/packages/dhcpcd/-/raw/main/PKGBUILD)
- VCS sources have the form `source=('directory::url#fragment?query')`. Git fragments can be `branch`, `commit` or `tag`. "Some VCS Sources like Git support pinning the checkout by a checksum of its content using deterministic export functionality like git archive." `?signed` verifies signed git tags/commits — [PKGBUILD.5](https://gitlab.archlinux.org/pacman/pacman/-/raw/master/doc/PKGBUILD.5.asciidoc)
- `groups` is "an array of symbolic names that represent groups of packages, allowing you to install multiple packages by requesting a single target". `makedepends_<arch>` allows per-architecture build deps — [PKGBUILD.5](https://gitlab.archlinux.org/pacman/pacman/-/raw/master/doc/PKGBUILD.5.asciidoc)

**Homebrew**
- The minimal formula is `desc`, `homepage`, `url`, `sha256`, `license`, `depends_on "x"`, `depends_on "y" => :build`, `def install; system "./configure", *std_configure_args; system "make", "install"; end` and a `test do` block. Other helpers are `std_cmake_args` and `std_meson_args` — [Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- Git sources pin both: `url "https://github.com/some/package.git", tag: "v1.6.2", revision: "344cd2ee..."` — [Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- "options are not allowed in Homebrew/homebrew-core as they are not tested by CI" — [Formula Cookbook](https://docs.brew.sh/Formula-Cookbook)
- Real `coreutils.rb`: platform-conditional deps (`on_linux do depends_on "acl" ... end`), a `head do url ..., branch: "master"; depends_on "autoconf" => :build ...` block (a git HEAD build needs extra bootstrap tools), and a `patch do url ...commit/782a1e5...patch; sha256 ...; type :backport` with a comment explaining why the patch exists — [coreutils.rb](https://raw.githubusercontent.com/Homebrew/homebrew-core/main/Formula/c/coreutils.rb)

### Inferences
- The Homebrew coreutils `head` block shows the user's gnulib-bootstrap problem in one place. Building GNU packages from a git commit (not a release tarball) needs extra host tools (autoconf, automake, bison, gettext, texinfo/makeinfo) and a `./bootstrap` step. Tarball builds need none of that. The autotools builder should take a `bootstrap` option (e.g. `"bootstrap": "./bootstrap --skip-po --gnulib-srcdir=..."` or `"autoreconf": true`). OE uses `autotools` (always autoreconf) and Buildroot uses `FOO_AUTORECONF=YES`; both are precedents.
- Void's split is the one to copy: defaults set by the builder, recipe args appended last, and cross triplets injected centrally. Recipes then never mention `--host`, and leaks like PKG_CONFIG are fixed once in the builder environment.
- Every system has a "custom function" escape hatch: Void `do_*`/`post_install`, BR `_CMDS`/hooks, OE `do_x:append`, Arch/Alpine plain functions. A JSON format needs one too, ideally as phase hooks (`pre_configure`, `post_install` shell snippets or script files) that sit on top of a builder, not instead of it.

### Gaps
- I could not reach the Alpine and Arch wikis (HTTP 403 / Anubis bot wall), so I used the abuild and pacman man-page sources instead.
- I did not verify how makepkg checksums git sources in pacman 7.x (the man page says pinning by content checksum is supported, but I did not confirm whether `SKIP` is still the norm in current Arch git PKGBUILDs).

---

## 4. Patches across version bumps; pinning by git commit

### Takeaway
Every system stores patches as files next to the recipe and lists them explicitly or by glob. Version coupling is either implicit (Buildroot and OE look in version-named subdirectories first; others rely on the recipe being bumped together with its patch list) or social (Homebrew and Buildroot require a justification or "Upstream:" note so stale patches can be dropped). For git pinning, everyone converges on "a full commit SHA, optionally with the tag for humans", and they reject branch names.

### Cited Findings
- Buildroot: `package/<pkg>/<version>/*.patch` overrides `package/<pkg>/*.patch`. `BR2_GLOBAL_PATCH_DIR/<pkg>/<version>/` is preferred over `<pkg>/`. Patches are numbered `0001-...` and carry no version in their names — [patch-policy.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/patch-policy.adoc); [customize-patches.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/customize-patches.adoc)
- Buildroot: `FOO_VERSION` may be a sha1 or a tag, never a branch (for reproducibility and caching) — [adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)
- OE: `FILESPATH` searches `${BP}` (name-version) before `${BPN}` before `files/`, so a patch dir can be version-specific. Patches are listed explicitly as `file://` entries in `SRC_URI`. `SRCREV` should be a full SHA. The dhcpcd recipe sets both `tag=v${PV}` in `SRC_URI` and `SRCREV=<sha>` — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst); [dhcpcd_10.5.2.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-connectivity/dhcpcd/dhcpcd_10.5.2.bb)
- Void: all `srcpkgs/<pkg>/patches/*.{diff,patch}` are applied with `patch -Np1`. An optional `series` file sets the order, and a per-patch `foo.patch.args` file overrides patch arguments — [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)
- Alpine: patches are listed in `source=` and applied by `default_prepare`. Their sha512 sums are recorded like any other source — [APKBUILD.5](https://gitlab.alpinelinux.org/alpine/abuild/-/raw/master/APKBUILD.5.scd); [Alpine dhcpcd APKBUILD](https://gitlab.alpinelinux.org/alpine/aports/-/raw/master/main/dhcpcd/APKBUILD)
- Arch: git sources use `#commit=`/`#tag=`/`#branch=` fragments — [PKGBUILD.5](https://gitlab.archlinux.org/pacman/pacman/-/raw/master/doc/PKGBUILD.5.asciidoc)
- Homebrew: git `url` with `tag:` plus `revision:`. Remote patches use `patch do url/sha256`, may carry `type :backport`, and need a justifying comment: "Otherwise, nobody will know when it is safe to remove the patch." — [Formula Cookbook](https://docs.brew.sh/Formula-Cookbook); [coreutils.rb](https://raw.githubusercontent.com/Homebrew/homebrew-core/main/Formula/c/coreutils.rb)
- Hash verification of git sources: Buildroot hashes a tarball generated from the checkout. Arch can checksum a `git archive` export. OE and Homebrew rely on the commit SHA itself — [adding-packages-directory.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-directory.adoc); [PKGBUILD.5](https://gitlab.archlinux.org/pacman/pacman/-/raw/master/doc/PKGBUILD.5.asciidoc)

### Inferences
- Suggested JSON: `"source": {"git": "https://...", "commit": "<40-hex>", "tag": "v1.2" (informational)}`. A full commit SHA already gives content integrity for git, so a separate hash is optional unless tarball sources are also supported.
- Patch handling: the simplest robust scheme is an explicit `"patches": ["0001-x.patch", ...]` list, resolved relative to `patches/<pkg>/`. Each entry can be a string or `{file, reason/upstream}`. Making the reason mandatory follows Buildroot's "Upstream:" tag and Homebrew's comment rule. On a commit bump, `git am`/`git apply --check` failing is the signal to drop or refresh a patch. Version subdirectories are not needed in a rolling-release model where recipe and patches change in the same commit.

### Gaps
- None of the primary sources describe automated stale-patch detection beyond "the build fails when a patch does not apply" (Buildroot: "If something goes wrong in the steps 3 or 4, then the build fails").

---

## 5. Package groups / metapackages and image composition

### Takeaway
Grouping is always just "a package with no content that depends on others": OE packagegroup recipes, Void `metapackage=yes`, Arch `groups=`. Image assembly is a list of packages plus a few declarative knobs (overlay dir, users table, size) plus imperative post-processing hooks. Users and service enablement come either from the package (BR `FOO_USERS`, OE `useradd`, Void `system_accounts`/`vsv`) or from the image level (BR users tables, OE `EXTRA_USERS_PARAMS`).

### Cited Findings
- OE: `core-image-minimal` = `IMAGE_INSTALL = "packagegroup-core-boot ${CORE_IMAGE_EXTRA_INSTALL}"`. `packagegroup-core-boot` holds `RDEPENDS` on base-files, base-passwd, netbase, init/dev/login managers via `VIRTUAL-RUNTIME_*`, with members switched on/off by `DISTRO_FEATURES`/`MACHINE_FEATURES` — [core-image-minimal.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-core/images/core-image-minimal.bb); [packagegroup-core-boot.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-core/packagegroups/packagegroup-core-boot.bb)
- OE image post-processing: `ROOTFS_POSTPROCESS_COMMAND` functions run on `${IMAGE_ROOTFS}`. `EXTRA_USERS_PARAMS` adds and modifies users and groups for the image — [variables.rst](https://git.yoctoproject.org/yocto-docs/plain/documentation/ref-manual/variables.rst)
- Buildroot image: `BR2_ROOTFS_OVERLAY`, `BR2_ROOTFS_POST_BUILD_SCRIPT`, `BR2_ROOTFS_POST_IMAGE_SCRIPT`, `BR2_ROOTFS_USERS_TABLES`, `BR2_ROOTFS_DEVICE_TABLE`, and per-package `_USERS`/`_PERMISSIONS`/`_DEVICES` — [Buildroot manual](https://buildroot.org/downloads/manual/manual.html)
- Void: `metapackage=yes`. `system_accounts="_dhcpcd"` with `_dhcpcd_homedir=...` creates accounts. `vsv <name>` in `post_install` installs a runit service directory from the package's files. `conf_files` marks config files the package owns — [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md); [void dhcpcd template](https://raw.githubusercontent.com/void-linux/void-packages/master/srcpkgs/dhcpcd/template)
- Arch: `groups=(...)` is a symbolic multi-package install target — [PKGBUILD.5](https://gitlab.archlinux.org/pacman/pacman/-/raw/master/doc/PKGBUILD.5.asciidoc)

### Inferences
- Suggested image JSON: `{"name": "vm-base", "packages": ["glibc","bash","coreutils",...], "groups": ["base","net"], "kernel": {"recipe": "linux-libre", "fragments": ["virtio.cfg","9p.cfg"]}, "overlay": "rootfs/", "users": [...], "services": ["dhcpcd","agetty-ttyS0"], "post_build": "scripts/post.sh", "format": {"type":"ext4","size":"1G"}}`. A "group" can be a JSON file with `packages` plus optional `kernel_fragments`. That covers the "kernel config fragments per feature" goal: enabling a feature group (e.g. "9p-share") pulls in both userland packages and kernel fragments. This is roughly Buildroot's `_LINUX_CONFIG_FIXUPS` and OE's `KERNEL_FEATURES` combined into one unit.
- Users: copy Void's `system_accounts`/Buildroot's `FOO_USERS` (recipe-level, so a package such as dhcpcd brings its own privsep user) and add an image-level users list for login users. Generate /etc/passwd/group at assembly time, not from package installs.
- runit services: give each recipe a `"services": {"dhcpcd": "services/dhcpcd/"}` field (like Void's `vsv`). The image decides which ones to enable (symlink into /etc/runit/runsvdir/default).

### Gaps
- I did not fetch the Buildroot users-table line format (makeusers syntax) in full; the dhcpcd example line is the only verified sample.

---

## 6. Minimum viable schema vs rarely used fields

### Takeaway
Across all six formats, the fields that are always present are name, version/source pin, source integrity, build style/class, configure args, build-time deps split host vs target, and an install step into DESTDIR. Everything else is occasional: features/options, patches, users, services, conf files, env overrides, hooks, subpackages and licence metadata.

### Cited Findings
- Present in every sampled recipe (dhcpcd in BR/OE/Void/Alpine/Arch; coreutils in BR/OE/Void/Homebrew): name, version, source URL, checksum or commit, deps, configure args, install — [dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk); [dhcpcd_10.5.2.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-connectivity/dhcpcd/dhcpcd_10.5.2.bb); [void dhcpcd](https://raw.githubusercontent.com/void-linux/void-packages/master/srcpkgs/dhcpcd/template); [Alpine dhcpcd](https://gitlab.alpinelinux.org/alpine/aports/-/raw/master/main/dhcpcd/APKBUILD); [Arch dhcpcd](https://gitlab.archlinux.org/archlinux/packaging/packages/dhcpcd/-/raw/main/PKGBUILD)
- Even dhcpcd, a simple package, needed in every distro: a privsep user (BR `_USERS`, OE `USERADD_PARAM`, Void `system_accounts`, Arch `.sysusers`), a service file (BR sysv/systemd, OE systemd, Void runit `vsv`, Alpine openrc) and at least one custom configure flag (`--privsepuser`, `--dbdir`, `--rundir`) — same sources as above.
- Optional and rare in practice: Buildroot itself says `_LINUX_CONFIG_FIXUPS` "is seldom used" and `_PATCH_DEPENDENCIES` "is seldom used" — [adding-packages-generic.adoc](https://gitlab.com/buildroot.org/buildroot/-/raw/master/docs/manual/adding-packages-generic.adoc)
- dhcpcd uses a non-autoconf `configure` script, which breaks the autotools assumptions of two systems: BR falls back to generic-package and OE uses `autotools-brokensep` plus a custom `do_configure`. Void has separate `configure` and `gnu-configure` styles for exactly this case (dhcpcd and iproute2 both use `build_style=configure`) — [dhcpcd.mk](https://gitlab.com/buildroot.org/buildroot/-/raw/master/package/dhcpcd/dhcpcd.mk); [dhcpcd_10.5.2.bb](https://raw.githubusercontent.com/openembedded/openembedded-core/master/meta/recipes-connectivity/dhcpcd/dhcpcd_10.5.2.bb); [void Manual.md](https://raw.githubusercontent.com/void-linux/void-packages/master/Manual.md)

### Inferences
- **Proposed minimum JSON recipe** (from the comparisons above):
  ```json
  {
    "name": "dhcpcd",
    "source": {"git": "https://github.com/NetworkConfiguration/dhcpcd", "commit": "7c50b51a...", "tag": "v10.5.2"},
    "builder": "configure",          // autotools | configure | make | meson | cmake | kernel | script
    "deps": ["glibc"],              // target libs/headers (makedepends / DEPENDS / _DEPENDENCIES)
    "host_deps": ["pkgconf"],       // tools run during build (hostmakedepends / makedepends_build / host-foo)
    "configure_args": ["--privsepuser=dhcpcd", "--dbdir=/var/lib/dhcpcd"],
    "make_args": [], "install_args": [],
    "env": {},                      // e.g. gl_cv_* cache vars, like COREUTILS_CONF_ENV
    "patches": [{"file": "0001-foo.patch", "upstream": "submitted ..."}],
    "features": {"udev": {"enable": ["--with-udev"], "disable": ["--without-udev"], "deps": ["eudev"]}},
    "default_features": [],
    "users": [{"name": "dhcpcd", "system": true, "home": "/var/lib/dhcpcd"}],
    "services": {"dhcpcd": "services/dhcpcd"},
    "kernel_fragments": [],         // like BR _LINUX_CONFIG_FIXUPS; rarely used
    "hooks": {"pre_configure": "...", "post_install": "..."}
  }
  ```
  - Required fields: `name`, `source`, `builder`.
  - Common fields: `deps`, `host_deps`, `configure_args`, `patches`.
  - Occasional fields: `features`, `env`, `users`, `services`, `hooks`.
  - Rare fields: `kernel_fragments`, `bootstrap`/`autoreconf`, `subdir`/`build_dir`, `nocross` (with a reason, as in Void).
- **Kernel as a recipe:** `{"name":"linux-libre","source":{git,commit},"builder":"kernel","defconfig":"x86_64_defconfig" | "config":"base.config","fragments":["fragments/virtio.cfg"],"make_args":["LOCALVERSION="]}`. The kernel builder runs `make <defconfig>`, `scripts/kconfig/merge_config.sh` for the fragments and `make olddefconfig`, then builds. Images or groups can append fragments. This mirrors Buildroot's `BR2_LINUX_KERNEL_CONFIG_FRAGMENT_FILES` and OE's `SRC_URI += file://*.cfg`.
- **Lessons to apply:**
  1. Put defaults and cross flags in the builder and append recipe args last (Void).
  2. Use a declarative features table instead of conditionals (OE PACKAGECONFIG).
  3. Pin to a commit SHA and never a branch (BR, OE).
  4. Keep patches as numbered files with a stated upstream status (BR, Homebrew).
  5. Keep host and target deps separate from day one, even if everything currently builds natively (Void, Alpine).
  6. Avoid an override/append mini-language (OE `.bbappend`, `:append:machine`). It is the main source of Yocto's complexity, and a single-user repo can simply edit the recipe.
  7. Keep a script escape hatch, but scope it to phase hooks so the builder still provides the other phases.

### Gaps
- I did not survey Gentoo ebuilds, NixOS derivations, or newer JSON/TOML/YAML recipe formats (e.g. Chimera cports in Python, Melange/Wolfi YAML, mkosi for image assembly). These may be covered by other researchers, and Melange YAML especially would be directly relevant as a data-only recipe format.
