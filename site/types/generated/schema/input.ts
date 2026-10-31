// Eclogite input formats: the documents a person writes and the CLI reads.
//
// Conventions of the strict JSONC profile (docs/configuration.md):
// - every document is one object with a versioned `schema` string;
// - unknown keys, duplicate keys, `null` and floating-point numbers are
//   rejected, so no field is `| null` and every number is an integer;
// - an optional field (`?`) that is absent means the documented default.
//
// `OPEN(n)` marks a field that depends on open decision n in docs/formats.md.
//
// Generated from schemas/ by site/types/generate.mjs. Do not edit: change
// the schema and run `npm run types` in site/types.

/** Catalog object name: lower case, digits, '.', '+', '_' and '-', at most 64 characters. */
export type Name = string;

/** Name of a package or a meta-package. */
export type PackageName = Name;

/**
 * Capability name such as `kernel`, `linux`, `init`, `libc`, `sh`, `vi`.
 * Capabilities share the package namespace.
 */
export type Capability = Name;

/** Full 40-hex Git commit hash. */
export type GitRevision = string;

/** 64-hex SHA-256 digest. */
export type Sha256 = string;

/** Relative to the defining document's directory; no leading `/`, no `..`. */
export type RelativePath = string;

/** Absolute path inside the guest. */
export type GuestPath = `/${string}`;

/**
 * Absolute guest path, or a glob starting with two stars and a slash, matching anywhere in the output.
 */
export type GuestPathPattern = GuestPath | `**/${string}`;

/** JSON Pointer such as `/machine/boot/console`. */
export type JsonPointer = `/${string}`;

/** `^[A-Za-z_][A-Za-z0-9_]*$` */
export type VariableName = string;

/** A whole string that is one parameter, such as `${UID}`. */
export type ParameterReference = `\${${string}}`;

/** Integer, at least 1. */
export type Mebibytes = number;

/** Integer, at least 1. */
export type PositiveInteger = number;

/** Values may use `${NAME}` for builder variables and package parameters. */
export type Environment = {
  [key: string]: string;
};

/**
 * Where a parameter comes from, and when it is known.
 *
 * A build-time value is known when the system is compiled. It enters the
 * keys of the packages that read it.
 *
 * A start-time value is known only when the runner starts the machine. It
 * never enters a key, an image or the compiled system, and it may be used
 * only in services, accounts, the hostname, endpoints and commands. A value
 * computed from a start-time value is itself start-time.
 *
 * A plain JSON Pointer string is short for `{ "pointer": ... }`.
 */
export type Value = 
  /** Build time: from the resolved system, such as `/machine/resources/memory_mib`. */
  | JsonPointer
  | {
    pointer: JsonPointer;
  }
  /**
   * Start time: a setting of the software profile. `default` applies when
   * the profile declares no setting of that name. The value stays start-time
   * either way, so a package's key never depends on which profile uses it.
   */
  | {
    setting: VariableName;
    default?: Scalar;
  }
  /** Start time: the account that runs the runner on the host. */
  | {
    host: "uid" | "gid" | "user";
  }
  /** `value * multiply / divide`, rounded down, for integers. */
  | {
    scale: Value;
    multiply: PositiveInteger;
    divide: PositiveInteger;
  }
  /** A crypt(3) SHA-512 hash of the value, with a fresh salt at each start. */
  | {
    crypt_sha512: Value;
  };

/** OPEN(12): a closed v0.1 set here, and also listed by the toolchain. */
export type Compiler = "gcc" | "clang";

export interface Resources {
  vcpus: PositiveInteger;
  memory_mib: Mebibytes;
}

/**
 * Image size: without `size_mib`, sized from the package outputs plus
 * `free_mib` (default 64). Setting both fields is an error.
 */
export type ImageSize = 
  | {
    size_mib?: never;
    free_mib?: number;
  }
  | {
    size_mib: Mebibytes;
    free_mib?: never;
  };

/** A fact value. */
export type Scalar = string | number | boolean;

/** A literal, or the value of another fact in the same scope. */
export type FactOperand = 
  | Scalar
  | {
    fact: Name;
  };

/** Exactly one comparison. */
export type FactTest = 
  | {
    eq: FactOperand;
  }
  | {
    ne: FactOperand;
  }
  | {
    ge: FactOperand;
  }
  | {
    gt: FactOperand;
  }
  | {
    le: FactOperand;
  }
  | {
    lt: FactOperand;
  }
  | {
    in: Scalar[];
  }
  | {
    has: Scalar;
  }
  | {
    has_any: Scalar[];
  };

/**
 * Boolean expression over facts: exactly one of `all`, `any`, `not`, or a
 * fact name mapped to a test.
 *
 * @example { "arch": { "in": ["aarch64", "x86_64"] } }
 * @example { "all": [{ "memory_mib": { "ge": 6144 } }, { "host_arch": { "eq": { "fact": "arch" } } }] }
 */
export type Predicate = 
  | {
    all: Predicate[];
  }
  | {
    any: Predicate[];
  }
  | {
    not: Predicate;
  }
  | {
    [key: string]: FactTest;
  };

/**
 * Ordered alternatives: the first one in the selected set, else the first
 * whose constraints hold. At least two entries.
 */
export interface Alternatives {
  first: Name[];
}

/** A package, a capability, or ordered alternatives. */
export type Reference = Name | Alternatives;

/**
 * Settings required of a configurable provider. For `linux`, Kconfig options
 * such as `{ "CONFIG_9P_FS": "y" }`.
 */
export type Config = {
  [key: string]: string;
};

/**
 * A dependency that requires config of its provider.
 * OPEN(10): `package` also holds capabilities, as in `{ "package": "linux" }`.
 */
export interface ConfiguredReference {
  package: Name;
  config: Config;
}

/**
 * A run dependency that applies only where `when` holds, requires `config`,
 * or both. At least one of the two is present.
 */
export interface ConditionalReference {
  package: Name;
  when?: Predicate;
  config?: Config;
}

/** A program from the builder image's tool manifest, such as `builder:python3`. */
export type BuilderTool = `builder:${string}`;

/**
 * One package graph node, in one of two forms. A buildable package has a source, a builder and optional dependencies, services, tests and builder arguments. A meta-package has only run dependencies: selecting it selects them. Resources such as patches, hooks and files are relative to the package's directory.
 */
export type Package = BuildablePackage | MetaPackage;

/** A named selection: only run dependencies, no source, builder or output. */
export interface MetaPackage {
  schema: "eclogite.package/v0.1";
  name: PackageName;
  /** Capabilities provided as a whole, such as `utils` for gnu-utils. */
  provides?: Capability[];
  dependencies: {
    run: (Reference | ConditionalReference)[];
  };
}

/**
 * The builder fixes the shape of `arguments` and of every variant's
 * arguments (schemas/builders/<builder>.schema.json).
 */
export type BuildablePackage = {
  schema: "eclogite.package/v0.1";
  name: PackageName;
  /** Upstream version label for people; identity comes from the source revision. */
  version: string;
  source: Source;
  /** Fixed-output phase with network access, run before the offline build. */
  fetch?: Fetch;
  /** Builder tool that must have been built from this package's source revision. */
  matches_builder_tool?: Name;
  /** Absent: no restriction. */
  compatible?: Compatible;
  provides?: Provides;
  configurable?: Configurable;
  /** Applied in order, relative to the package directory. */
  patches?: RelativePath[];
  /**
   * Values exposed as `${NAME}` in this package's strings, keyed by
   * upper-case names such as `CONSOLE`. Build-time values are exposed to the
   * builder, hooks and services and enter the package key. Start-time values
   * are exposed only to services and accounts and never enter the key.
   */
  parameters?: {
    [key: string]: Value;
  };
  dependencies?: Dependencies;
  /** Generated for the system's init system. */
  services?: {
    [key: string]: Service;
  };
  /** Accounts the package needs, such as a privilege-separation user. */
  users?: User[];
  groups?: Group[];
  /** Written to /etc/fstab, keyed by guest mount point. */
  mounts?: {
    [key: `/${string}`]: Mount;
  };
  /** `tests/<name>.sh`, run in the booted guest over the serial console. */
  tests?: {
    [key: string]: Test;
  };
} & BuilderSelection;

/** The builder, with the arguments it accepts. */
export type BuilderSelection = 
  | {
    builder: "configure";
    arguments?: ConfigureArguments;
    /**
     * Merged into `arguments` when `when` holds on the target facts: lists
     * appended, maps merged, scalars replaced.
     */
    variants?: {
      when: Predicate;
      arguments: ConfigureArguments;
    }[];
  }
  | {
    builder: "make";
    arguments?: MakeArguments;
    /**
     * Merged into `arguments` when `when` holds on the target facts: lists
     * appended, maps merged, scalars replaced.
     */
    variants?: {
      when: Predicate;
      arguments: MakeArguments;
    }[];
  }
  | {
    builder: "cmake";
    arguments?: CmakeArguments;
    /**
     * Merged into `arguments` when `when` holds on the target facts: lists
     * appended, maps merged, scalars replaced.
     */
    variants?: {
      when: Predicate;
      arguments: CmakeArguments;
    }[];
  }
  | {
    builder: "linux-kernel";
    arguments?: LinuxKernelArguments;
    /**
     * Merged into `arguments` when `when` holds on the target facts: lists
     * appended, maps merged, scalars replaced.
     */
    variants?: {
      when: Predicate;
      arguments: LinuxKernelArguments;
    }[];
  }
  | {
    builder: "files";
    arguments?: FilesArguments;
    /**
     * Merged into `arguments` when `when` holds on the target facts: lists
     * appended, maps merged, scalars replaced.
     */
    variants?: {
      when: Predicate;
      arguments: FilesArguments;
    }[];
  }
  | {
    builder: "source-tree";
    arguments?: SourceTreeArguments;
    /**
     * Merged into `arguments` when `when` holds on the target facts: lists
     * appended, maps merged, scalars replaced.
     */
    variants?: {
      when: Predicate;
      arguments: SourceTreeArguments;
    }[];
  }
  | {
    builder: "npm-workspace";
    arguments?: NpmWorkspaceArguments;
    /**
     * Merged into `arguments` when `when` holds on the target facts: lists
     * appended, maps merged, scalars replaced.
     */
    variants?: {
      when: Predicate;
      arguments: NpmWorkspaceArguments;
    }[];
  };

export type BuilderName = "configure" | "make" | "cmake" | "linux-kernel" | "files" | "source-tree" | "npm-workspace";

/** OPEN(14): only git and none in v0.1. `url` matches `^(https|git)://`. */
export type Source = 
  | {
    type: "git";
    url: string;
    revision: GitRevision;
  }
  | {
    type: "none";
  };

export interface Fetch {
  /** Parts of the source that decide what is downloaded: paths, optionally `path#key`. */
  inputs: string[];
  /** `hooks/<hook>.sh` */
  hook: Name;
  /**
   * Hash of the normalized output: one value, or one per platform name.
   * OPEN(13): `"pending"` until the first `eclogite lock --update-fetch`.
   * OPEN(15): keyed by platform name.
   */
  output_sha256: 
    | Sha256 | "pending"
    | {
      [key: string]: Sha256 | "pending";
    };
}

/** Predicates per scope (build host, target, machine). */
export interface Compatible {
  build?: Predicate;
  target?: Predicate;
  machine?: Predicate;
}

/**
 * Either a plain list of capabilities, or a map from capability to the files
 * the package owns for it. Owned files are installed only when this package
 * is the system's chosen provider of that capability.
 */
export type Provides = 
  | Capability[]
  | {
    [key: string]: OwnedFiles;
  };

export interface OwnedFiles {
  /** Link path → target. */
  symlinks?: {
    [key: `/${string}`]: string;
  };
  /** Package file → guest path. */
  files?: {
    [key: string]: GuestPath;
  };
  services?: {
    [key: string]: Service;
  };
}

/** The closed set of settings dependents and devices may require. */
export interface Configurable {
  /** `kconfig`: options are `CONFIG_*` names. */
  format: "kconfig";
  options: {
    [key: string]: ConfigOption;
  };
}

export interface ConfigOption {
  description?: string;
  /** Such as `["y", "n"]` for a bool or `["y", "m", "n"]` for a tristate. */
  values: string[];
  /** Used when no dependent, device or software profile requires a value. */
  default: string;
  /**
   * Implied whenever this option is not `n`.
   * OPEN(16): that rule is Kconfig semantics.
   */
  requires?: Config;
}

export interface Dependencies {
  /** Needed while building; never installed. Builder tools are allowed only here. */
  build?: (Reference | BuilderTool | ConfiguredReference)[];
  /** Linked against; never installed. */
  link?: (Reference | ConfiguredReference)[];
  /**
   * Installed with the package. Only here may an entry be conditional, and
   * these dependencies may form cycles.
   */
  run?: (Reference | ConditionalReference)[];
}

export interface Service {
  /** Program and arguments, executed with PATH=/bin. */
  run: string[];
  directory?: GuestPath;
  environment?: Environment;
  /** Such as a console device. */
  stdin?: GuestPath;
  /** Until these are mounted the service exits and is retried. */
  requires_mounts?: GuestPath[];
  /** Created before each start, after the required mounts, as root. */
  create_directories?: (GuestPath | Directory)[];
  /** The account the program runs as, such as `${USER}`. Default: root. */
  user?: string;
  /** Default: the user's primary group. */
  group?: string;
  /** Default: true. */
  log?: boolean;
  restart_delay_seconds?: PositiveInteger;
}

/** A directory with its owner and mode. */
export interface Directory {
  path: GuestPath;
  /** A user name, such as `${USER}`. Default: root. */
  owner?: string;
  /** Default: the owner's primary group. */
  group?: string;
  /** Octal, such as `0700`. Default: `0755`. */
  mode?: string;
}

/**
 * An account in /etc/passwd and /etc/shadow. When every field is known at
 * build time, the image step writes the account files. When a field is a
 * start-time value, those files are links into /run, completed at each start
 * before any service runs.
 */
export interface User {
  /** Such as `sshd`, or `${USER}`. */
  name: string;
  /**
   * A number, or a parameter such as `${UID}`. Absent: allocated in the
   * range 100 to 999, in name order, so the same accounts get the same ids.
   */
  uid?: number | ParameterReference;
  /** Primary group name. Default: a group with the user's name and uid. */
  group?: string;
  /** Required when `group` names a group that no package declares. */
  gid?: number | ParameterReference;
  /** Supplementary groups. */
  groups?: string[];
  /** Default: `/`. Created with the user as owner if it does not exist. */
  home?: GuestPath;
  /** Default: `/bin/false`, no login. */
  shell?: GuestPath;
  /** A crypt(3) hash such as `${PASSWORD_HASH}`, or `locked` (the default). */
  password?: "locked" | ParameterReference;
  description?: string;
}

export interface Group {
  name: string;
  /** Absent: allocated like a user's uid. */
  gid?: number | ParameterReference;
}

export interface Mount {
  /** As for `mount -t`. */
  type: string;
  /** Device, tag or `none`. */
  source: string;
  /** No commas or whitespace inside an option. */
  options?: string[];
  /** fstab `nofail`. Default: false. */
  optional?: boolean;
}

export interface Test {
  /** Run only where this predicate over target and machine facts holds. */
  when?: Predicate;
  /** Packages the script uses; they must be in the closure. */
  needs?: PackageName[];
  timeout_seconds?: PositiveInteger;
}

export interface CommonArguments {
  /**
   * `hooks/<name>.sh` per step. `<step>` replaces the builder's step, and
   * `pre-<step>` and `post-<step>` run around it. An empty list skips the step.
   */
  hooks?: {
    "pre-configure"?: Name[];
    configure?: Name[];
    "post-configure"?: Name[];
    "pre-build"?: Name[];
    build?: Name[];
    "post-build"?: Name[];
    "pre-install"?: Name[];
    install?: Name[];
    "post-install"?: Name[];
  };
  environment?: Environment;
  /** Package file → guest path, copied into the output. */
  files?: {
    [key: string]: GuestPath;
  };
  /** Link path → target. */
  symlinks?: {
    [key: `/${string}`]: string;
  };
  /** Removed after install. */
  remove?: GuestPathPattern[];
  strip?: boolean;
}

/**
 * A ./configure script (autoconf or hand-written), then make and make install with DESTDIR. The builder sets CC, CXX, LD and AR for the compiler chosen for the package.
 */
export type ConfigureArguments = {
  /** Default: none. */
  bootstrap?: "none" | "autoreconf" | "gnulib";
  /** The builder adds --host, --build and the toolchain. */
  configure?: string[];
  out_of_tree?: boolean;
  make_targets?: string[];
  /** Default: install. */
  install_targets?: string[];
} & CommonArguments;

/**
 * make and make install with DESTDIR, without a configure step. The builder sets CC, CXX, LD and AR for the compiler chosen for the package.
 */
export type MakeArguments = {
  directory?: RelativePath;
  /** Passed on the make command line. */
  variables?: {
    [key: string]: string;
  };
  make_targets?: string[];
  install_targets?: string[];
} & CommonArguments;

/**
 * A CMake project configured for the target, built with Ninja and installed with DESTDIR.
 * OPEN(6): named `targets` here and `make_targets` elsewhere; no install_targets.
 */
export type CmakeArguments = {
  /** Contains CMakeLists.txt. */
  directory?: RelativePath;
  /** The builder adds the toolchain file and the generator. */
  cmake?: string[];
  targets?: string[];
} & CommonArguments;

/**
 * A Linux-family kernel: applies its config fragments, then the config that dependents, the software profile and the machine's devices require, runs olddefconfig, verifies every required option and builds the image.
 */
export type LinuxKernelArguments = {
  /** Files in the package's config/ directory, applied in order. */
  fragments?: Name[];
  /** Such as bzImage or Image.gz, usually set per architecture by a variant. */
  image?: string;
} & CommonArguments;

/** No compilation: the output is the package's files, symlinks and generated services. */
export type FilesArguments = CommonArguments;

/**
 * The prepared source itself is the output: a read-only build input for other packages, never installed in a guest.
 */
export type SourceTreeArguments = CommonArguments;

/** An npm workspace built offline from the package's fetch output. */
export type NpmWorkspaceArguments = {
  /** The workspace member that is the application. */
  application?: RelativePath;
  install_prefix?: GuestPath;
  /** Per npm package that has a native addon. */
  native_addons?: {
    [key: string]: "build" | "stub" | "skip";
  };
} & CommonArguments;

/**
 * Hardware profile: CPU, memory, boot, devices and runtime backend (QEMU, UTM or a physical board). Never declares guest software. A machine may instead extend another and override a few fields.
 */
export type Machine = CompleteMachine | DerivedMachine;

export interface CompleteMachine {
  schema: "eclogite.machine/v0.1";
  name: Name;
  /** Catalog-wide unique CLI names; never inherited. */
  aliases?: Name[];
  /** Absent: supported. `profile-only`: described, not buildable. */
  status?: "profile-only";
  platform: Name;
  resources: MachineResources;
  runtime: Runtime;
  boot: Boot;
  /** OPEN(20): physical boards only. */
  gpio?: {
    header_pins: PositiveInteger;
  };
  devices: Device[];
  limitations?: string[];
  /** `https://` links. */
  references?: string[];
}

/**
 * Based on another machine. `resources` merges field by field, and the other
 * fields replace the base's. The runtime and boot contract cannot change.
 */
export interface DerivedMachine {
  schema: "eclogite.machine/v0.1";
  name: Name;
  /** Catalog-wide unique CLI names; never inherited. */
  aliases?: Name[];
  /** Absent: supported. `profile-only`: described, not buildable. */
  status?: "profile-only";
  extends: Name;
  resources?: {
    vcpus?: PositiveInteger;
    memory_mib?: Mebibytes;
  };
  devices?: Device[];
  limitations?: string[];
  /** `https://` links. */
  references?: string[];
}

/** Virtual machines declare `vcpus`; physical boards declare `cpu`. */
export type MachineResources = 
  | {
    memory_mib: Mebibytes;
    vcpus: PositiveInteger;
    cpu?: never;
  }
  | {
    memory_mib: Mebibytes;
    cpu: PhysicalCpu;
    vcpus?: never;
  };

export interface PhysicalCpu {
  soc?: string;
  /** Such as `ARM1176JZF-S`. */
  model: string;
  cores: PositiveInteger;
}

export type Runtime = QemuRuntime | UtmRuntime | PhysicalRuntime;

export interface QemuRuntime {
  backend: "qemu";
  /** `qemu-system-*` */
  executable?: string;
  /** QEMU `-machine`, such as `virt` or `q35`. */
  machine: string;
  machine_options: string[];
  acceleration: "auto" | "tcg" | "kvm" | "hvf";
}

export interface UtmRuntime {
  backend: "utm";
  application: "UTM";
  /** Such as `5`. */
  minimum_version: string;
  host: {
    os: "macos";
    architecture: "arm64" | "x86_64";
  };
  virtualization_backend: "qemu" | "apple";
  machine: string;
  machine_options: string[];
  acceleration: "hvf" | "tcg";
  bundle_format: "utm";
  disk_import: "copy";
}

/** OPEN(20) */
export interface PhysicalRuntime {
  backend: "physical";
  board: Name;
}

export type Boot = DirectKernelBoot | SdCardBoot;

export interface DirectKernelBoot {
  method: "direct-kernel";
  /** `tty*`, such as `ttyAMA0`. */
  console: string;
  kernel_arguments: string[];
}

/** OPEN(13, 20): `firmware_policy` is a placeholder. */
export interface SdCardBoot {
  method: "sd-card-firmware";
  boot_media: "sd-card";
  console: string;
  firmware_policy: "unresolved";
}

/** The vocabulary of the `devices` fact. */
export type DeviceKind = "audio" | "block" | "camera" | "display" | "gpio" | "i2c" | "network" | "power" | "rtc" | "serial" | "shared-directory" | "spi" | "usb" | "video";

export interface Device {
  /** Must equal the model's kind in the devices document. */
  kind: DeviceKind;
  /** A model from the devices document. */
  model: Name;
  optional?: boolean;
  /** Physical boards only; a virtual block device gets one disk per image. */
  count?: PositiveInteger;
  mode?: "shared" | "bridged" | "host-only" | "user";
  speed_mbps?: PositiveInteger;
}

/** Everything inside the guest. Never declares hardware. */
export interface Software {
  schema: "eclogite.software/v0.1";
  name: Name;
  aliases?: Name[];
  /** Default: the defaults document's. */
  abi?: Name;
  /** Default: the defaults document's. */
  compiler?: Compiler;
  /**
   * The roots of the closure. A provider named here is the system's choice
   * for its capabilities. At least one entry.
   */
  packages: (Reference | ConfiguredReference)[];
  /** Capability → provider. Overrides the defaults. */
  providers?: {
    [key: string]: PackageName;
  };
  /**
   * What the person running the machine may change without a rebuild, such
   * as a user name, a password or a port. Packages read them with
   * `{ "setting": NAME }`.
   */
  settings?: {
    [key: string]: Setting;
  };
  /** Values exposed as `${NAME}` in this profile's strings, like a package's. */
  parameters?: {
    [key: string]: Value;
  };
  root: {
    /** Such as `devbox`, or `${HOSTNAME}` from a start-time parameter. */
    hostname: string;
    readonly: boolean;
    tmpfs: GuestPath[];
  };
  image: RootImage;
  volumes?: Volume[];
  /** Writable disks that survive restarts and image replacements. */
  state?: StateVolume[];
  /** People's accounts; packages declare their own service accounts. */
  users?: User[];
  groups?: Group[];
  /**
   * Policy over a package's service, keyed by service name: the fields given
   * here replace the package's, and `environment` is merged into it.
   */
  service_overrides?: {
    [key: string]: ServiceOverride;
  };
  /** Network services the runner reports and connects to. */
  endpoints?: {
    [key: string]: Endpoint;
  };
  /** Commands the bundle's runner offers beyond its fixed set, as `vm.sh <name>`. */
  commands?: {
    [key: string]: RunnerCommand;
  };
  /** OPEN(4): the evidence store comes after v0.1. */
  evidence?: {
    default: "warn-untested" | "require-passed" | "ignore";
    "require-passed"?: PackageName[];
  };
}

export type Filesystem = "ext4";

/**
 * `strip` and `exclude` are applied while the image is composed, so package
 * keys do not change.
 */
export type RootImage = {
  format: Filesystem;
  /** Default: false. */
  strip?: boolean;
  exclude?: GuestPathPattern[];
} & ImageSize;

/**
 * A separate image mounted at `mount`. The listed packages' files below
 * `mount` go to the volume, and their other files to the root image.
 */
export type Volume = {
  name: Name;
  mount: GuestPath;
  packages: PackageName[];
  format: Filesystem;
  readonly: boolean;
} & ImageSize;

/** A setting the person running the machine may change. */
export interface Setting {
  description: string;
  type: "string" | "integer" | "boolean";
  /** Absent: the runner asks for a value at the first start. */
  default?: Scalar;
  /**
   * Kept only in the bundle's settings file, mode 0600. Never written to the
   * compiled system, an image, a log or command output.
   */
  secret?: boolean;
  /** For strings. */
  pattern?: string;
  /** For integers. */
  minimum?: number;
  maximum?: number;
}

/**
 * A writable disk the runner creates empty at the first start and keeps until
 * the machine is deleted, also across image replacements. It is not built,
 * so nothing in it enters a key.
 */
export interface StateVolume {
  name: Name;
  mount: GuestPath;
  size_mib: Mebibytes;
  format: Filesystem;
}

/** The service fields a software profile may override. */
export interface ServiceOverride {
  user?: string;
  group?: string;
  environment?: Environment;
  create_directories?: (GuestPath | Directory)[];
}

/** A network service in the guest, reported by `vm.sh status`. */
export interface Endpoint {
  description: string;
  protocol: "http" | "https" | "ssh" | "tcp";
  /** A number, or a parameter such as `${PORT}`. */
  port: PositiveInteger | ParameterReference;
  /** For http and https. Default: `/`. */
  path?: string;
  /** For ssh: the login user, such as `${USER}`. */
  user?: string;
}

/** A runner command; `description` is its line in `vm.sh help`. */
export type RunnerCommand = {
  description: string;
} & (
  /** Connect to an ssh endpoint; extra arguments are passed to ssh. */
  | {
    ssh: Name;
  }
  /** Open an http or https endpoint in the host's browser. */
  | {
    open: Name;
  }
  /** Run a program in the guest as root over the serial console. */
  | {
    guest: string[];
  }
  /** Follow guest files, such as service logs, over the serial console. */
  | {
    follow: GuestPath[];
  });

/** The graph root and the CLI's preferred single input. OPEN(19): no aliases. */
export interface System {
  schema: "eclogite.system/v0.1";
  name: Name;
  machine: ObjectReference;
  software: ObjectReference;
  /** Overrides the software profile's. */
  abi?: Name;
  /** Overrides the software profile's. */
  compiler?: Compiler;
  /** Overrides the software profile's entries and the defaults. */
  providers?: {
    [key: string]: PackageName;
  };
}

/**
 * A catalog name or alias, or a file path starting with `./` or `../`,
 * relative to this file and ending in `.json` or `.jsonc`. Absolute paths
 * and URLs are rejected.
 */
export type ObjectReference = Name | `./${string}` | `../${string}`;

/** Hardware only: the architecture and what the CPU guarantees. */
export interface Platform {
  schema: "eclogite.platform/v0.1";
  name: Name;
  /** Fact `arch`, such as `aarch64`. */
  architecture: string;
  /** CPU part of the target triplet, such as `armv6`. */
  triplet_cpu: string;
  cpu: {
    /** Fact `isa`: a value in the `isa` fact's order for this architecture. */
    isa: string;
    bits: 32 | 64;
    endian: "little" | "big";
    /** Fact `cpu_features`, beyond the ISA level. */
    features: string[];
    mmu: boolean;
  };
  /** Linux `ARCH=`. OPEN(17): this makes the platform Linux-specific. */
  kernel_architecture: string;
}

/** Operating system and C library, fixed at compile time. */
export interface Abi {
  schema: "eclogite.abi/v0.1";
  name: Name;
  /** Fact `os`, such as `linux`. */
  os: string;
  /** Fact `libc`, such as `glibc` or `musl`. */
  libc: string;
  /**
   * Triplet suffix per architecture. The triplet is
   * `<platform.triplet_cpu>-<suffix>`.
   * @example { "aarch64": "linux-gnu", "arm": "linux-gnueabihf" }
   */
  triplet: {
    [key: string]: string;
  };
  /** Must list every triplet this ABI produces. */
  toolchain: Name;
}

/** The builder image. Eclogite never builds a toolchain. */
export interface Toolchain {
  schema: "eclogite.toolchain/v0.1";
  name: Name;
  /** OPEN(13): a constant. */
  provider: "linux-libre-vm";
  /** Release of the builder image. OPEN(13): or `"unreleased"`. */
  release: string;
  builder: {
    /** Build host architectures the builder image exists for. */
    hosts: string[];
    /** Default builder VM size; `compatible.build` may raise it. */
    resources: Resources;
  };
  /** Target triplet → its cross toolchain and sysroot. OPEN(9) */
  targets: {
    [key: string]: Planned;
  };
  /**
   * In fallback order, each mapped to the manifest tools it needs.
   * OPEN(11): the order is the order of the keys in the object.
   */
  compilers: {
    gcc?: string[];
    clang?: string[];
  };
  /** The tool manifest snapshot: what packages may name as `builder:<tool>`. */
  tools: {
    [key: string]: Tool;
  };
}

/** Something the builder image does not ship yet; a system that needs it fails. */
export interface Planned {
  status?: "planned";
}

export interface Tool {
  status?: "planned";
  version?: string;
  /** A Git URL. OPEN(13): or `"tarball"`. */
  source: string;
  revision?: GitRevision;
}

export interface Facts {
  schema: "eclogite.facts/v0.1";
  facts: {
    [key: string]: FactDefinition;
  };
}

/**
 * The scope a fact is read in: the target (the platform merged with the
 * ABI), the merged machine, or the builder.
 */
export type FactScope = "target" | "machine" | "builder";

/**
 * A JSON Pointer, `@detected` (measured at plan time) or `@selected` (chosen
 * by resolution, such as the compiler).
 */
export type FactSource = JsonPointer | "@detected" | "@selected";

export type FactDefinition = {
  description: string;
  /** Closed vocabulary for string and set facts. */
  values?: string[];
  /** Per scope, the sources tried in order. */
  from: {
    target?: FactSource[];
    machine?: FactSource[];
    builder?: FactSource[];
  };
  /** How an array read by `from` becomes the value. Exactly one key. */
  derive?: 
    | {
      collect: string;
    }
    | {
      sum: {
        where: {
          [key: string]: Scalar;
        };
        field: string;
        /** `unbounded` makes the whole sum unbounded. */
        missing: number | "unbounded";
      };
    };
  /** How constraints across a closure combine. */
  aggregate?: {
    machine?: "sum" | "max";
    builder?: "sum" | "max";
  };
} & (
  | {
    type: "string" | "integer" | "boolean" | "set";
  }
  | {
    type: "ordered";
    /** The fact whose value selects the ordering, such as `arch`. */
    order_by: Name;
    /** Lowest to highest, per value of `order_by`. */
    order: {
      [key: string]: string[];
    };
  });

export interface Devices {
  schema: "eclogite.devices/v0.1";
  /** Model names are unique across kinds. */
  devices: {
    [key: string]: DeviceModel;
  };
}

export interface DeviceModel {
  kind: DeviceKind;
  description?: string;
  /**
   * Config the driver needs, keyed by capability. It applies only when the
   * system has that capability; a device never adds a package.
   * @example { "linux": { "CONFIG_RTC_DRV_PL031": "y" } }
   */
  requires?: {
    [key: string]: Config;
  };
}

/** The distribution's choices, used only where a system selects nothing. */
export interface Defaults {
  schema: "eclogite.defaults/v0.1";
  abi: Name;
  compiler: Compiler;
  /** `kernel` and `init` are required. Entries may be ordered alternatives. */
  providers: {
    kernel: Reference;
    init: Reference;
    [key: string]: Reference;
  };
}

/**
 * One complete input: a system and every catalog object it may refer to.
 * Each array entry is exactly what a catalog file holds on its own.
 */
export interface Configuration {
  schema: "eclogite.config/v0.1";
  system: System;
  machines: Machine[];
  software: Software[];
  platforms: Platform[];
  abis: Abi[];
  toolchains: Toolchain[];
  /** Buildable packages and meta-packages, in one namespace. */
  packages: Package[];
  facts: Facts;
  devices: Devices;
  defaults: Defaults;
}

/** Any document the CLI accepts, selected by its `schema` field. */
export type InputDocument = 
  | Configuration
  | System
  | Machine
  | Software
  | Platform
  | Abi
  | Toolchain
  | Package
  | Facts
  | Devices
  | Defaults;
