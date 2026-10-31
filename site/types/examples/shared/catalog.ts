// Shared catalog for the examples: the generated catalog (catalog/ as typed
// constants) plus what the examples need that catalog/ does not have yet.
// An example system file defines only what is its own and adds these to its
// configuration.

import type { Package } from "../../generated/schema/input";
import * as catalog from "../../generated/catalog/index";

// ===========================================================================
// From catalog/, unchanged

export const { facts, devices, defaults } = catalog;
export const utmVirtArm64 = catalog.machines.utmVirtArm64;
export const arm64 = catalog.platforms.arm64;
export const linuxGnu = catalog.abis.linuxGnu;
export const linuxLibreVm = catalog.toolchains.linuxLibreVm;
export const { dhcpcd, hostShare } = catalog.packages;

// ===========================================================================
// Packages from catalog/, changed for the examples

/** base-files with the root account: the console login runs a root shell without a password. */
export const baseFiles = {
  ...catalog.packages.baseFiles,
  users: [{ name: "root", uid: 0, group: "root", home: "/root", shell: "/bin/sh" }],
  groups: [{ name: "root", gid: 0 }],
} satisfies Package;

const theiaService = catalog.packages.theia.services.theia;

/** Theia with its port as a start-time parameter that a profile may make a setting. */
export const theia = {
  ...catalog.packages.theia,
  parameters: { PORT: { setting: "THEIA_PORT", default: 3000 } },
  services: {
    // all interfaces: http://<guest address>:${PORT}
    theia: { ...theiaService, run: theiaService.run.map((a) => (a === "--port=3000" ? "--port=${PORT}" : a)) },
  },
  tests: {
    // the backend loads 100 plugins before it answers
    http: catalog.packages.theia.tests["http-3000"],
  },
} satisfies Package;

// ===========================================================================
// Packages not in catalog/ yet: system tools

/**
 * OpenSSH server and client programs. No service: the read-only root has no
 * place for host keys, so a system that runs sshd declares the service with
 * a writable key directory of its own, such as a state volume.
 */
export const openssh = {
  schema: "eclogite.package/v0.1",
  name: "openssh",
  version: "10.2p1",
  source: { type: "git", url: "https://github.com/openssh/openssh-portable.git", revision: "d01efaa1c9ed84fd9011201dbc3c7cb0a82bcee3" }, // V_10_2_P1
  builder: "configure",
  dependencies: {
    link: ["libc", "zlib"],
    run: ["libc", "zlib"],
  },
  // sshd's privilege separation runs its pre-authentication child as this user
  users: [{ name: "sshd", home: "/run/sshd", description: "sshd privilege separation" }],
  arguments: {
    bootstrap: "autoreconf",
    configure: [
      "--prefix=/usr",
      "--sysconfdir=/etc/ssh",
      // Ed25519 and ChaCha20-Poly1305 are built in; there is no OpenSSL package
      "--without-openssl",
      "--with-privsep-path=/run/sshd",
      "--disable-strip",
    ],
  },
} satisfies Package;

/** Git, with HTTPS remotes through libcurl. */
export const git = {
  schema: "eclogite.package/v0.1",
  name: "git",
  version: "2.51.0",
  source: { type: "git", url: "https://github.com/git/git.git", revision: "c44beea485f0f2feaf460e2ac87fdd5608d63cf0" }, // v2.51.0
  builder: "make",
  dependencies: {
    link: ["libc", "zlib", "curl"],
    run: ["libc", "zlib", "curl"],
  },
  arguments: {
    variables: {
      prefix: "/usr",
      gitexecdir: "/usr/libexec/git-core",
      // git-remote-https; the dumb-HTTP push that needs expat is left out
      CURL_CONFIG: "${DEP_curl}/usr/bin/curl-config",
      NO_EXPAT: "1",
      NO_PERL: "1",
      NO_PYTHON: "1",
      NO_TCLTK: "1",
      NO_GETTEXT: "1",
    },
    make_targets: ["all"],
    install_targets: ["install"],
    remove: ["/usr/share/git-gui", "/usr/share/gitk", "/usr/share/gitweb"],
  },
} satisfies Package;

/** libcurl for git's HTTPS remotes, verifying against the CA bundle. */
export const curl = {
  schema: "eclogite.package/v0.1",
  name: "curl",
  version: "8.16.0",
  source: { type: "git", url: "https://github.com/curl/curl.git", revision: "11b991232fbcaa88e2b1faecac224416b0001e35" }, // curl-8_16_0
  builder: "configure",
  dependencies: {
    link: ["libc", "openssl", "zlib"],
    run: ["libc", "openssl", "zlib", "ca-certificates"],
  },
  arguments: {
    bootstrap: "autoreconf",
    configure: [
      "--prefix=/usr",
      "--with-openssl",
      "--with-zlib",
      "--with-ca-bundle=/etc/ssl/certs/ca-certificates.crt",
      "--without-libpsl",
      "--without-brotli",
      "--without-zstd",
      "--without-nghttp2",
      "--disable-ldap",
      "--disable-manual",
    ],
    remove: ["/usr/include", "/usr/share/man", "**/*.a", "**/*.la"],
  },
} satisfies Package;

/** TLS for curl. */
export const openssl = {
  schema: "eclogite.package/v0.1",
  name: "openssl",
  version: "3.5.4",
  source: { type: "git", url: "https://github.com/openssl/openssl.git", revision: "c1eeb9406b6142148f267594197d853403d10208" }, // openssl-3.5.4
  // Configure is a Perl script, not autoconf: hooks/configure.sh runs
  // ./Configure linux-aarch64 (or the target's name) with these options
  builder: "make",
  dependencies: {
    build: ["builder:perl"],
    link: ["libc", "zlib"],
    run: ["libc", "zlib"],
  },
  arguments: {
    hooks: { configure: ["configure"] },
    environment: {
      OPENSSL_OPTIONS: "--prefix=/usr --openssldir=/etc/ssl --libdir=lib shared zlib no-tests no-docs",
    },
    install_targets: ["install_sw", "install_ssldirs"],
    remove: ["/usr/include", "**/*.a", "/etc/ssl/misc"],
  },
} satisfies Package;

/** The pager git starts. */
export const less = {
  schema: "eclogite.package/v0.1",
  name: "less",
  version: "679",
  source: { type: "git", url: "https://github.com/gwsw/less.git", revision: "70f0ca12511098674d937436e70bff9672398daf" }, // v679
  builder: "configure",
  dependencies: {
    link: ["libc", "ncurses"],
    run: ["libc", "ncurses"],
  },
  arguments: {
    // a git checkout has no configure: Makefile.aut generates it
    hooks: { "pre-configure": ["distfiles"] },
    configure: ["--prefix=/usr", "--with-regex=posix"],
  },
} satisfies Package;

/** Terminal library and terminfo database for less. */
export const ncurses = {
  schema: "eclogite.package/v0.1",
  name: "ncurses",
  version: "6.5",
  source: { type: "git", url: "https://github.com/ThomasDickey/ncurses-snapshots.git", revision: "e12a453fc23c5ac586d72af46465e8ba92adb707" }, // v6_5
  builder: "configure",
  dependencies: {
    link: ["libc"],
    run: ["libc"],
  },
  arguments: {
    configure: [
      "--prefix=/usr", "--with-shared", "--without-debug", "--without-ada",
      "--without-cxx-binding", "--without-manpages", "--enable-widec",
    ],
    remove: ["/usr/include", "**/*.a"],
  },
} satisfies Package;

/** Compression library for git and OpenSSH. */
export const zlib = {
  schema: "eclogite.package/v0.1",
  name: "zlib",
  version: "1.3.1",
  source: { type: "git", url: "https://github.com/madler/zlib.git", revision: "51b7f2abdade71cd9bb0e7a373ef2610ec6f9daf" }, // v1.3.1
  // its configure is a hand-written script
  builder: "configure",
  dependencies: {
    link: ["libc"],
    run: ["libc"],
  },
  arguments: {
    configure: ["--prefix=/usr", "--shared"],
    remove: ["/usr/include", "**/*.a"],
  },
} satisfies Package;

/** Mozilla's CA bundle at /etc/ssl/certs/ca-certificates.crt. */
export const caCertificates = {
  schema: "eclogite.package/v0.1",
  name: "ca-certificates",
  version: "3.117",
  // certdata.txt from NSS; hooks/certdata-to-pem.sh writes the trusted
  // server certificates as one PEM bundle
  source: { type: "git", url: "https://github.com/nss-dev/nss.git", revision: "11dc5f9349ad12af08b792a3f705166056547950" }, // NSS_3_117_RTM
  builder: "files",
  dependencies: {
    build: ["builder:python3"],
  },
  arguments: {
    hooks: { build: ["certdata-to-pem"] },
  },
} satisfies Package;


// ===========================================================================
// Everything, for a configuration's lists

const changed: Package[] = [baseFiles, theia];

export const machines = catalog.machines.all;
export const platforms = catalog.platforms.all;
export const abis = catalog.abis.all;
export const toolchains = catalog.toolchains.all;

export const packages: Package[] = [
  ...catalog.packages.all.map((p) => changed.find((c) => c.name === p.name) ?? p),
  openssh, git, curl, openssl, less, ncurses, zlib, caCertificates,
];
