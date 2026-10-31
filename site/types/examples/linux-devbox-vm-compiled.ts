// The devbox system compiled: the configuration `utm-arm64-devbox` resolved
// into a reproducible build recipe. It runs a linux-libre arm64 guest in UTM
// with Eclipse Theia on port 3000 and OpenSSH.
//
// Every value that decides an output is fixed:
// - every source is a full Git revision;
// - every package directory file, prepared source tree, fetch output,
//   toolchain artifact and dependency is identified by its SHA-256;
// - each package has a build key, and once built, the output hash every
//   rebuild must reproduce;
// - every build runs in the same environment: SOURCE_DATE_EPOCH, locale,
//   time zone, umask, user, hostname, build directory, and no network;
// - the images have a derived filesystem UUID and hash seed, with file times
//   clamped to SOURCE_DATE_EPOCH.
// Building this document twice gives bit-identical packages and images.
//
// This file holds only what is the devbox's own: its one package and the
// system-level results. The compiled packages of the shared catalog are the
// same for every aarch64-linux-gnu system and come from the shared compiled
// file; the platform, ABI and base machine come from the shared catalog.
//
// The example is written by hand, so two kinds of value are stand-ins:
// - DIGEST stands for each SHA-256, which only eclogite can compute from
//   the actual content;
// - the toolchain release `dev-2026.10.27` stands for the first published
//   linux-libre-vm dev image, which does not exist yet.

import type { CompiledBuildablePackage, CompiledSystem } from "../generated/schema/compiled";
import * as catalog from "./shared/catalog";
import { compiledPackage, DIGEST, hashes } from "./shared/compiled";
import { devbox as devboxInput, machine, software } from "./linux-devbox-vm-input";

/** 2026-10-27T00:00:00Z, chosen when the system was compiled. */
const SOURCE_DATE_EPOCH = 1793059200;

/** Derived from each image's inputs; the zero UUID stands in like DIGEST. */
const DERIVED_UUID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// The devbox's own package

const devbox: CompiledBuildablePackage = {
  kind: "buildable",
  name: "devbox",
  provides: [],
  version: "1",
  source: { type: "none" },
  builder: "files",
  arguments: devboxInput.arguments,
  variants_applied: [],
  parameters: {},
  dependencies: {
    build: [],
    link: [],
    run: [
      { reference: "openssh", package: "openssh" },
      { reference: "git", package: "git" },
      { reference: "less", package: "less" },
      { reference: "ca-certificates", package: "ca-certificates" },
      { reference: "host-share", package: "host-share" },
      { reference: "init", package: "runit", capability: "init" },
    ],
  },
  hashes: hashes([], [], ["files/profile.sh", "files/sshd.conf"]),
  key: DIGEST,
  output_sha256: DIGEST,
};

// ---------------------------------------------------------------------------
// Closure, in visit order, and why each package is in it

const selection: [string, string[]][] = [
  ["reference-system", ["reference-system"]],
  ["base", ["reference-system", "base"]],
  ["base-files", ["reference-system", "base", "base-files"]],
  ["linux-libre", ["reference-system", "base", "base-files", "linux-libre"]],
  ["glibc", ["reference-system", "base", "glibc"]],
  ["gcc-runtime", ["reference-system", "base", "glibc", "gcc-runtime"]],
  ["runit", ["reference-system", "base", "runit"]],
  ["bash", ["reference-system", "base", "runit", "bash"]],
  ["coreutils", ["reference-system", "base", "runit", "coreutils"]],
  ["util-linux", ["reference-system", "base", "runit", "util-linux"]],
  ["console-login", ["reference-system", "base", "console-login"]],
  ["gnu-utils", ["reference-system", "gnu-utils"]],
  ["grep", ["reference-system", "gnu-utils", "grep"]],
  ["sed", ["reference-system", "gnu-utils", "sed"]],
  ["gawk", ["reference-system", "gnu-utils", "gawk"]],
  ["findutils", ["reference-system", "gnu-utils", "findutils"]],
  ["diffutils", ["reference-system", "gnu-utils", "diffutils"]],
  ["gzip", ["reference-system", "gnu-utils", "gzip"]],
  ["tar", ["reference-system", "gnu-utils", "tar"]],
  ["procps-ng", ["reference-system", "gnu-utils", "procps-ng"]],
  ["network", ["reference-system", "network"]],
  ["iproute2", ["reference-system", "network", "iproute2"]],
  ["dhcpcd", ["reference-system", "network", "dhcpcd"]],
  ["editor", ["reference-system", "editor"]],
  ["vim", ["reference-system", "editor", "vim"]],
  ["host-share", ["reference-system", "host-share"]],
  ["ide", ["ide"]],
  ["theia", ["ide", "theia"]],
  ["nodejs", ["ide", "theia", "nodejs"]],
  ["devbox", ["devbox"]],
  ["openssh", ["devbox", "openssh"]],
  ["zlib", ["devbox", "openssh", "zlib"]],
  ["git", ["devbox", "git"]],
  ["curl", ["devbox", "git", "curl"]],
  ["openssl", ["devbox", "git", "curl", "openssl"]],
  ["ca-certificates", ["devbox", "git", "curl", "ca-certificates"]],
  ["less", ["devbox", "less"]],
  ["ncurses", ["devbox", "less", "ncurses"]],
];

// ---------------------------------------------------------------------------
// The kernel's config

/** Options that something requires, or that are implied by one that is. */
const kernelRequired = {
  CONFIG_9P_FS: { value: "y", source: { kind: "dependency", package: "host-share" } },
  CONFIG_DEVTMPFS: { value: "y", source: { kind: "dependency", package: "base-files" } },
  CONFIG_INOTIFY_USER: { value: "y", source: { kind: "dependency", package: "theia" } },
  CONFIG_NET_9P: { value: "y", source: { kind: "implied", option: "CONFIG_9P_FS" } },
  CONFIG_NET_9P_VIRTIO: {
    value: "y",
    source: { kind: "device", model: "virtio-9p-device", device_kind: "shared-directory" },
  },
  CONFIG_PROC_FS: { value: "y", source: { kind: "dependency", package: "runit" } },
  CONFIG_RTC_CLASS: { value: "y", source: { kind: "device", model: "pl031", device_kind: "rtc" } },
  CONFIG_RTC_DRV_PL031: { value: "y", source: { kind: "device", model: "pl031", device_kind: "rtc" } },
  CONFIG_RTC_HCTOSYS: { value: "y", source: { kind: "device", model: "pl031", device_kind: "rtc" } },
  CONFIG_SERIAL_AMBA_PL011: { value: "y", source: { kind: "device", model: "pl011", device_kind: "serial" } },
  CONFIG_SERIAL_AMBA_PL011_CONSOLE: {
    value: "y",
    source: { kind: "device", model: "pl011", device_kind: "serial" },
  },
  CONFIG_SYSFS: { value: "y", source: { kind: "dependency", package: "runit" } },
  CONFIG_TMPFS: { value: "y", source: { kind: "dependency", package: "base-files" } },
  CONFIG_UNIX98_PTYS: { value: "y", source: { kind: "dependency", package: "runit" } },
  CONFIG_VIRTIO: { value: "y", source: { kind: "implied", option: "CONFIG_VIRTIO_MMIO" } },
  CONFIG_VIRTIO_BLK: { value: "y", source: { kind: "device", model: "virtio-blk-device", device_kind: "block" } },
  CONFIG_VIRTIO_MMIO: { value: "y", source: { kind: "device", model: "virtio-blk-device", device_kind: "block" } },
  CONFIG_VIRTIO_NET: { value: "y", source: { kind: "device", model: "virtio-net-device", device_kind: "network" } },
} as const;

/** Options linux-libre declares that nothing here requires: their default, n. */
const kernelDefaults = ["CONFIG_VIRTIO_PCI", "CONFIG_PREEMPT"];

// ---------------------------------------------------------------------------
// The compiled system

export const compiled: CompiledSystem = {
  schema: "eclogite.lock/v0.1",
  input_sha256: DIGEST,

  system: {
    name: "utm-arm64-devbox",
    origin: { name: "utm-arm64-devbox", defined_in: "config", document_sha256: DIGEST },
    machine: { name: "utm-virt-arm64-devbox", defined_in: "config", document_sha256: DIGEST },
    software: { name: "devbox", defined_in: "config", document_sha256: DIGEST },
  },

  // the base machine with the devbox's resources and limitations merged in
  machine: {
    schema: "eclogite.machine/v0.1",
    name: machine.name,
    merged_from: [machine.name, catalog.utmVirtArm64.name],
    platform: catalog.utmVirtArm64.platform,
    resources: machine.resources,
    runtime: catalog.utmVirtArm64.runtime,
    boot: catalog.utmVirtArm64.boot,
    devices: catalog.utmVirtArm64.devices,
    limitations: machine.limitations,
  },

  software,
  platform: catalog.arm64,
  abi: catalog.linuxGnu,

  target: {
    platform: "arm64",
    abi: "linux-gnu",
    abi_from: "defaults",
    triplet: "aarch64-linux-gnu",
    toolchain: {
      name: "linux-libre-vm",
      // stand-in for the first published dev image release
      release: "dev-2026.10.27",
      host: "aarch64",
      builder_image_sha256: DIGEST,
      target_sha256: DIGEST,
    },
  },

  facts: {
    target: {
      arch: "aarch64",
      os: "linux",
      abi: "linux-gnu",
      libc: "glibc",
      bits: 64,
      endian: "little",
      mmu: true,
      isa: "armv8-a",
      cpu_features: ["fp", "asimd"],
    },
    machine: {
      devices: ["block", "network", "rtc", "serial", "shared-directory"],
      // a virtual block device attaches one disk per image
      block_devices: "unbounded",
      memory_mib: 8192,
      vcpus: 1,
    },
  },

  compiler: { name: "gcc", from: "defaults" },

  build_environment: {
    source_date_epoch: SOURCE_DATE_EPOCH,
    variables: {
      HOME: "/build/home",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/opt/eclogite/toolchains/aarch64-linux-gnu/bin:/bin",
      SOURCE_DATE_EPOCH: String(SOURCE_DATE_EPOCH),
      TZ: "UTC",
    },
    umask: "0022",
    build_directory: "/build/src",
    user: { uid: 1000, gid: 1000 },
    hostname: "eclogite-builder",
    network: "none",
    jobs: "not an input",
  },

  choices: {
    "c++-runtime": { provider: "gcc-runtime", reason: "already chosen", via: "cc-runtime" },
    "cc-runtime": { provider: "gcc-runtime", reason: "default", reference: "gcc-runtime" },
    "core-utils": { provider: "coreutils", reason: "default", reference: "coreutils" },
    "dhcp-client": { provider: "dhcpcd", reason: "default", reference: "dhcpcd" },
    init: { provider: "runit", reason: "default", reference: "runit" },
    ip: { provider: "iproute2", reason: "default", reference: "iproute2" },
    kernel: { provider: "linux-libre", reason: "default", reference: "linux-libre" },
    libc: { provider: "glibc", reason: "default", reference: "glibc" },
    linux: { provider: "linux-libre", reason: "already chosen", via: "kernel" },
    sh: { provider: "bash", reason: "default", reference: "bash" },
    "system-utils": { provider: "util-linux", reason: "default", reference: "util-linux" },
    utils: { provider: "gnu-utils", reason: "default", reference: "gnu-utils" },
    vi: { provider: "vim", reason: "default", reference: "vim" },
  },

  closure: selection.map(([name]) => (name === "devbox" ? devbox : compiledPackage(name))),

  selected_by: Object.fromEntries([
    ...selection.map(([name, chain]): [string, string[]] => [name, ["software", ...chain]]),
    // gnulib is first needed to build coreutils
    ["gnulib", ["software", "reference-system", "base", "runit", "coreutils", "gnulib"]],
  ]),

  build_only: [compiledPackage("gnulib") as CompiledBuildablePackage],

  // build and link dependencies, ties broken by name; meta-packages have no build
  build_order: [
    "base-files", "ca-certificates", "console-login", "devbox", "dhcpcd", "gawk", "glibc",
    "bash", "gcc-runtime", "gnulib", "coreutils", "diffutils", "findutils", "grep", "gzip",
    "host-share", "iproute2", "linux-libre", "ncurses", "less", "nodejs", "procps-ng", "runit",
    "sed", "tar", "theia", "util-linux", "vim", "zlib", "openssh", "openssl", "curl", "git",
  ],

  conditions: [
    {
      from: "reference-system",
      dependency: "host-share",
      when: { devices: { has: "shared-directory" } },
      held: true,
    },
    { from: "base-files", dependency: "linux", when: { os: { eq: "linux" } }, held: true },
    { from: "theia", dependency: "linux", when: { os: { eq: "linux" } }, held: true },
  ],

  config: {
    "linux-libre": {
      format: "kconfig",
      required: kernelRequired,
      effective: {
        ...Object.fromEntries(Object.keys(kernelRequired).map((o) => [o, "y"])),
        ...Object.fromEntries(kernelDefaults.map((o) => [o, "n"])),
      },
    },
  },

  owned_files: {
    "/bin/getty": { provider: "util-linux", capability: "system-utils", type: "symlink", target: "agetty" },
    "/bin/sh": { provider: "bash", capability: "sh", type: "symlink", target: "bash" },
    "/bin/vi": { provider: "vim", capability: "vi", type: "symlink", target: "vim" },
  },

  services: {
    // ${CONSOLE} expanded from /machine/boot/console
    getty: {
      package: "console-login",
      run: ["setsid", "-c", "getty", "-L", "-n", "-l", "/bin/sh", "115200", "ttyAMA0", "vt100"],
      stdin: "/dev/ttyAMA0",
      log: false,
      restart_delay_seconds: 5,
    },
    dhcpcd: { package: "dhcpcd", ...catalog.dhcpcd.services.dhcpcd },
    // the package's service with the profile's overrides; ${PORT}, ${USER}
    // and ${UID} are start-time and stay, ${NODE_HEAP} is build-time
    theia: {
      package: "theia",
      ...catalog.theia.services.theia,
      user: "${USER}",
      environment: {
        HOME: "/mnt/shared/home/${USER}",
        NODE_OPTIONS: "--max-old-space-size=6144",
        XDG_RUNTIME_DIR: "/run/user/${UID}",
      },
      create_directories: software.service_overrides.theia.create_directories,
      overridden: ["create_directories", "environment", "user"],
    },
    sshd: { package: "devbox", ...devboxInput.services.sshd },
  },

  accounts: {
    users: [
      { from: "base-files", ...catalog.baseFiles.users[0] },
      // the only account without a uid: the first of the system range
      { from: "openssh", ...catalog.openssh.users[0], uid: 100, group: "sshd" },
      { from: "software", ...software.users[0] },
    ],
    groups: [
      { from: "base-files", ...catalog.baseFiles.groups[0] },
      { from: "openssh", name: "sshd", gid: 100 },
      { from: "software", name: "${USER}", gid: "${GID}" },
    ],
    // the devbox user is known only at start
    files: "start",
  },

  runtime: {
    settings: software.settings,
    values: {
      software: {
        HOSTNAME: software.parameters.HOSTNAME,
        USER: software.parameters.USER,
        UID: software.parameters.UID,
        GID: software.parameters.GID,
        PASSWORD_HASH: software.parameters.PASSWORD_HASH,
        PORT: software.parameters.PORT,
      },
      theia: { PORT: catalog.theia.parameters.PORT },
    },
    delivery: { device: "config-disk", mount: "/run/eclogite/config" },
    state: software.state,
    endpoints: software.endpoints,
    commands: software.commands,
  },

  // disks in attach order: root, volumes, state, then the runner's config disk
  mounts: {
    "/": { type: "ext4", source: "/dev/vda", options: ["ro"], from: "software.root" },
    "/run": { type: "tmpfs", source: "none", from: "software.tmpfs" },
    "/tmp": { type: "tmpfs", source: "none", from: "software.tmpfs" },
    "/opt/theia": { type: "ext4", source: "/dev/vdb", options: ["ro"], from: "software.volumes" },
    "/var/lib/devbox": { type: "ext4", source: "/dev/vdc", from: "software.state" },
    "/run/eclogite/config": { type: "ext4", source: "/dev/vdd", options: ["ro"], from: "runtime.config" },
    "/mnt/shared": { ...catalog.hostShare.mounts["/mnt/shared"], from: "host-share" },
  },

  tests: [
    { id: "boot-shell" },
    { id: "linux-libre:clock", timeout_seconds: 10 },
    { id: "dhcpcd:dhcp", timeout_seconds: 60 },
    { id: "theia:http", timeout_seconds: 180 },
    { id: "devbox:ssh-22", timeout_seconds: 30 },
    { id: "shutdown" },
  ],

  images: {
    root: {
      format: "ext4",
      readonly: true,
      filesystem_uuid: DERIVED_UUID,
      hash_seed: DERIVED_UUID,
      strip: true,
      exclude: software.image.exclude,
      output_sha256: DIGEST,
    },
    volumes: [
      {
        ...software.volumes[0],
        filesystem_uuid: DERIVED_UUID,
        hash_seed: DERIVED_UUID,
        strip: false,
        exclude: [],
        output_sha256: DIGEST,
      },
    ],
  },
};
