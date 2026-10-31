// The devbox of linux-devbox-vm.sh as Eclogite input.
//
// linux-devbox-vm.sh turns an empty folder into a UTM VM: a linux-libre arm64
// guest that serves Eclipse Theia on port 3000 and OpenSSH with password
// login. This file holds only what is the devbox's own: the system, its
// machine, its software profile and the devbox package. Everything else
// (the base machine, the userland, Theia, the system tools, the platform,
// ABI and toolchain) comes from the shared catalog.
//
// The script and Eclogite get there in different ways:
//
// | linux-devbox-vm.sh                                  | Eclogite                                               |
// |-----------------------------------------------------|--------------------------------------------------------|
// | boots a released linux-libre-vm image, changes it   | builds an immutable image; the root is read-only       |
// | at every start over the serial console (boot.sh)    |                                                        |
// | settings in devbox.env, applied by `vm.sh start`    | `settings`, delivered on a config disk at each start   |
// | adds the user to /etc/passwd with the Mac's uid/gid | `users` with start-time uid, gid and password hash     |
// | runs Theia as the user with chpst -u                | a `service_overrides` entry with `user`                |
// | creates /run/user/<uid> as root in runtime.sh       | a `create_directories` entry with owner and mode       |
// | keeps SSH host keys on the share                    | a `state` volume that survives image replacements      |
// | git, less, CA certificates from Debian .debs        | git with curl and OpenSSL, less, ncurses, zlib,        |
// |                                                     | ca-certificates, built from source                     |
// | builds Theia inside the VM on first start (~70 min) | the `theia` package, built once in the builder VM      |
// | vm.sh ssh, logs, restart-theia, status addresses    | `commands` and `endpoints`                             |
// | NODE_HEAP=$((MEM * 3 / 4))                          | a `scale` parameter of the machine's memory            |

import type { Configuration, DerivedMachine, Package, Software, System } from "../generated/schema/input";
import * as catalog from "./shared/catalog";

export const system = {
  schema: "eclogite.system/v0.1",
  name: "utm-arm64-devbox",
  machine: "utm-virt-arm64-devbox",
  software: "devbox",
} satisfies System;

/**
 * The script's MEM=8192 and CPUS=1: Theia's build needs several GiB, and the
 * kernel has no SMP. Resources are build inputs, so a change means a
 * different machine, not a setting.
 */
export const machine = {
  schema: "eclogite.machine/v0.1",
  name: "utm-virt-arm64-devbox",
  aliases: ["devbox-vm"],
  extends: "utm-virt-arm64",
  resources: { vcpus: 1, memory_mib: 8192 },
  // `limitations` replaces the base's list, so the base's entries are repeated
  limitations: [
    ...catalog.utmVirtArm64.limitations,
    "One vCPU: linux-libre's arm64 configuration has no SMP.",
  ],
} satisfies DerivedMachine;

export const software = {
  schema: "eclogite.software/v0.1",
  name: "devbox",
  packages: ["reference-system", "ide", "devbox"],

  // the bundle's settings file (devbox.env in the script), applied at the next start
  settings: {
    HOSTNAME: {
      description: "Guest hostname.",
      type: "string",
      default: "devbox",
      pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$",
    },
    DEVBOX_USER: {
      description: "Login user for Theia's terminal and SSH; not root.",
      type: "string",
      default: "dev",
      pattern: "^(?!root$)[a-z_][a-z0-9_-]*$",
    },
    DEVBOX_PASSWORD: {
      description: "Password of the login user, for SSH.",
      type: "string",
      default: "dev",
      secret: true,
    },
    THEIA_PORT: {
      description: "Port Theia listens on.",
      type: "integer",
      default: 3000,
      minimum: 1,
      maximum: 65535,
    },
  },
  parameters: {
    HOSTNAME: { setting: "HOSTNAME" },
    USER: { setting: "DEVBOX_USER" },
    // the Mac user's ids, so files on the share have one owner on both sides
    UID: { host: "uid" },
    GID: { host: "gid" },
    PASSWORD_HASH: { crypt_sha512: { setting: "DEVBOX_PASSWORD" } },
    PORT: { setting: "THEIA_PORT" },
    // three quarters of the guest's memory for Node's heap (build time)
    NODE_HEAP: { scale: "/machine/resources/memory_mib", multiply: 3, divide: 4 },
  },

  root: {
    hostname: "${HOSTNAME}",
    readonly: true,
    tmpfs: ["/run", "/tmp"],
  },
  image: {
    format: "ext4",
    strip: true,
    exclude: ["/usr/share/man", "/usr/share/info", "/usr/share/doc", "/usr/share/locale"],
  },
  volumes: [{ name: "theia", mount: "/opt/theia", packages: ["theia"], format: "ext4", readonly: true }],
  // SSH host keys: created at the first start, kept until the VM is deleted
  state: [{ name: "devbox-state", mount: "/var/lib/devbox", size_mib: 16, format: "ext4" }],

  // The home is on the share: the root is read-only, and tools install
  // themselves under ~ (npm -g, remote IDE servers)
  users: [
    {
      name: "${USER}",
      uid: "${UID}",
      group: "${USER}",
      gid: "${GID}",
      home: "/mnt/shared/home/${USER}",
      shell: "/bin/bash",
      password: "${PASSWORD_HASH}",
      description: "devbox",
    },
  ],

  service_overrides: {
    theia: {
      user: "${USER}",
      environment: {
        HOME: "/mnt/shared/home/${USER}",
        NODE_OPTIONS: "--max-old-space-size=${NODE_HEAP}",
        // sockets cannot live on the share
        XDG_RUNTIME_DIR: "/run/user/${UID}",
      },
      create_directories: [
        "/mnt/shared/workspace",
        { path: "/mnt/shared/home/${USER}", owner: "${USER}" },
        { path: "/run/user/${UID}", owner: "${USER}", mode: "0700" },
      ],
    },
  },

  endpoints: {
    theia: { description: "Eclipse Theia", protocol: "http", port: "${PORT}" },
    ssh: { description: "OpenSSH, password login", protocol: "ssh", port: 22, user: "${USER}" },
  },
  commands: {
    ssh: { description: "ssh to the VM as the devbox user", ssh: "ssh" },
    open: { description: "open Theia in the browser", open: "theia" },
    logs: { description: "follow the Theia and sshd logs", follow: ["/var/log/theia/current", "/var/log/sshd/current"] },
    "restart-theia": { description: "restart the Theia service", guest: ["sv", "restart", "theia"] },
  },
} satisfies Software;

/**
 * The devbox's own package: the sshd service with its host keys on the state
 * volume, the login environment and sshd settings, and the tools the script
 * installs beyond the Theia system.
 */
export const devbox = {
  schema: "eclogite.package/v0.1",
  name: "devbox",
  version: "1",
  source: { type: "none" },
  builder: "files",
  compatible: {
    // home, workspace and npm cache live on the share
    machine: { all: [{ devices: { has: "shared-directory" } }, { devices: { has: "network" } }] },
  },
  dependencies: {
    run: ["openssh", "git", "less", "ca-certificates", "host-share", "init"],
  },
  services: {
    // -D keeps sshd in the foreground for the supervisor, -e logs to stderr
    sshd: {
      run: ["sh", "-c", "ssh-keygen -A -f /var/lib/devbox && exec /bin/sshd -D -e"],
      create_directories: [{ path: "/var/lib/devbox/etc/ssh", mode: "0700" }, "/run/sshd"],
    },
  },
  tests: {
    "ssh-22": { timeout_seconds: 30 },
  },
  arguments: {
    files: {
      // PATH, npm cache and TMPDIR on the share, XDG_RUNTIME_DIR,
      // NX_DISABLE_DB (its SQLite locking fails on 9p), PUPPETEER_SKIP_DOWNLOAD
      "files/profile.sh": "/etc/profile.d/devbox.sh",
      // PasswordAuthentication yes; HostKey under /var/lib/devbox/etc/ssh;
      // SetEnv BASH_ENV for non-root users, so `ssh host CMD` gets the same
      // environment as a login shell
      "files/sshd.conf": "/etc/ssh/sshd_config.d/devbox.conf",
    },
    symlinks: {
      // programs the user installs later (npm -g) start with #!/usr/bin/env node
      "/usr/bin/env": "/bin/env",
    },
  },
} satisfies Package;

/** The input the CLI reads: the devbox's documents plus the shared catalog. */
export const configuration: Configuration = {
  schema: "eclogite.config/v0.1",
  system,
  machines: [...catalog.machines, machine],
  software: [software],
  platforms: catalog.platforms,
  abis: catalog.abis,
  toolchains: catalog.toolchains,
  packages: [...catalog.packages, devbox],
  facts: catalog.facts,
  devices: catalog.devices,
  defaults: catalog.defaults,
};
