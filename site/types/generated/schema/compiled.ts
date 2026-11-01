// Eclogite compiled format: what `eclogite lock` writes after resolving a
// system against the catalog (state/<system>/system.lock.json).
//
// Compiling a system merges the machine's `extends`; picks the platform, ABI,
// triplet, toolchain and compiler; expands meta-packages and follows
// dependencies into a closure; chooses a provider for every capability, with
// a reason; applies variants and parameters; merges the config required of
// configurable packages; and collects owned files, services, accounts,
// mounts, tests and the runner's start-time contract. Nothing in the result
// is a reference to resolve any more, and builds read only this.
//
// Keys and content hashes are written by the lock and plan commands
// (docs/cli.md).
//
// Generated from schemas/ by site/types/generate.mjs. Do not edit: change
// the schema and run `npm run types` in site/types.

import type * as Input from "./input";

/**
 * The result of `eclogite lock`: a compiled system, or why it cannot be.
 *
 * A compiled system is a reproducible build recipe. Building the same
 * compiled document twice, on any host of the same build architecture,
 * produces bit-identical packages and images. So nothing in it floats: there
 * is no `latest`, no `pending` fetch hash and no `unreleased` toolchain; every
 * source is a full revision and every input is identified by its content
 * hash; every setting that can change an output is recorded. A value that
 * cannot be pinned is a compile error, not a field to fill in later.
 */
export type CompileResult = CompiledSystem | CompileFailure;

export interface CompiledSystem {
  /** OPEN(2): reserved name; generated output. */
  schema: "eclogite.lock/v0.1";
  /**
   * Hash of every input that took part, in canonical form. `build` fails
   * when the current inputs no longer match it.
   */
  input_sha256: Input.Sha256;
  /** The system file and where each referenced object came from. */
  system: {
    name: Input.Name;
    /** Where the system file itself was read from. */
    origin: Origin;
    machine: Origin;
    software: Origin;
  };
  /** The machine with `extends` merged; `aliases` and `extends` removed. */
  machine: ResolvedMachine;
  /** The software profile as written, without `aliases`. */
  software: {
    schema: "eclogite.software/v0.1";
    name: Input.Name;
    abi?: Input.Name;
    compiler?: Input.Compiler;
    packages: (Input.Reference | Input.ConfiguredReference)[];
    providers?: {
      [key: string]: Input.PackageName;
    };
    settings?: {
      [key: string]: Input.Setting;
    };
    parameters?: {
      [key: string]: Input.Value;
    };
    root: {
      /** Such as `devbox`, or `${HOSTNAME}` from a start-time parameter. */
      hostname: string;
      readonly: boolean;
      tmpfs: Input.GuestPath[];
    };
    image: Input.RootImage;
    volumes?: Input.Volume[];
    state?: Input.StateVolume[];
    users?: Input.User[];
    groups?: Input.Group[];
    service_overrides?: {
      [key: string]: Input.ServiceOverride;
    };
    endpoints?: {
      [key: string]: Input.Endpoint;
    };
    commands?: {
      [key: string]: Input.RunnerCommand;
    };
    evidence?: {
      default: "warn-untested" | "require-passed" | "ignore";
      "require-passed"?: Input.PackageName[];
    };
  };
  platform: Input.Platform;
  abi: Input.Abi;
  target: Target;
  /** Fact values that `compatible`, `variants` and `when` were evaluated with. */
  facts: {
    target: {
      [key: string]: FactValue;
    };
    machine: {
      [key: string]: FactValue;
    };
  };
  /** The system compiler and where it was set. */
  compiler: {
    name: Input.Compiler;
    from: SettingSource;
  };
  /** The same for every build of this system, whatever the host. */
  build_environment: BuildEnvironment;
  /** One provider per capability, for every capability anything in the closure provides. */
  choices: {
    [key: string]: Choice;
  };
  /**
   * Installed packages, in visit order: depth-first along run dependencies
   * from each `software.packages` entry. Meta-packages are included.
   */
  closure: CompiledPackage[];
  /**
   * Why each package of the closure and of `build_only` is there: the chain
   * from the software profile, such as
   * `["software", "reference-system", "network", "dhcpcd"]`.
   * `eclogite why` prints it.
   */
  selected_by: {
    [key: string]: string[];
  };
  /**
   * Packages that are built but not installed, because something needs them
   * only to build (such as gnulib). They are pinned like the closure.
   */
  build_only: CompiledBuildablePackage[];
  /**
   * Buildable packages in topological order of build and link dependencies,
   * including build-only packages that are not in the closure. Ties are
   * broken by name, so the order is byte-stable.
   */
  build_order: Input.PackageName[];
  /** Every conditional run dependency that was evaluated, and whether it held. */
  conditions: ConditionResult[];
  /**
   * Per configurable package: every required option with its source, and the effective config.
   */
  config: {
    [key: string]: CompiledConfig;
  };
  /** Capability-owned files installed by the image step, keyed by guest path. */
  owned_files: {
    [key: `/${string}`]: OwnedFile;
  };
  /** Every service the image step generates for the init system. */
  services: {
    [key: string]: CompiledService;
  };
  /**
   * Every account of the packages and the software profile. `files` says
   * whether the image step writes /etc/passwd, /etc/group and /etc/shadow,
   * or whether they link into /run and init completes them at each start
   * because an account has a start-time field.
   */
  accounts: {
    users: CompiledUser[];
    groups: CompiledGroup[];
    files: "image" | "start";
  };
  /** What the runner does at start time. */
  runtime: Runtime;
  /**
   * The /etc/fstab entries, keyed by mount point: the root, the software's
   * `tmpfs` entries, the volumes and every package's `mounts`.
   */
  mounts: {
    [key: `/${string}`]: CompiledMount;
  };
  /** Built-in checks and every package test whose `when` holds, in run order. */
  tests: CompiledTest[];
  images: {
    root: CompiledImage;
    volumes: CompiledVolume[];
  };
}

/** Where a referenced object was found. */
export interface Origin {
  /** The canonical name. */
  name: Input.Name;
  /** The alias the reference used, if any. Aliases are not build identity. */
  alias?: Input.Name;
  /** A catalog (`catalog:<name>`) or a file path relative to the system file. */
  defined_in: string;
  /** Hash of the document as parsed into the typed model. */
  document_sha256: Input.Sha256;
}

/** Where a setting came from. */
export type SettingSource = "system" | "software" | "defaults";

export type FactValue = Input.Scalar | Input.Scalar[] | "unbounded";

/** A complete machine with `extends` merged, as resolution uses it. */
export interface ResolvedMachine {
  schema: "eclogite.machine/v0.1";
  name: Input.Name;
  status?: "profile-only";
  platform: Input.Name;
  resources: Input.MachineResources;
  runtime: Input.Runtime;
  boot: Input.Boot;
  gpio?: {
    header_pins: Input.PositiveInteger;
  };
  devices: Input.Device[];
  limitations?: string[];
  references?: string[];
  /** The machine chain this was merged from, base last. */
  merged_from: Input.Name[];
}

export interface Target {
  platform: Input.Name;
  abi: Input.Name;
  abi_from: SettingSource;
  /** Such as `aarch64-linux-gnu`. */
  triplet: string;
  toolchain: ToolchainIdentity;
}

/**
 * Everything about a build that is not a declared input but could still
 * change its output. Builders run with exactly this and nothing from the host.
 */
export interface BuildEnvironment {
  /**
   * SOURCE_DATE_EPOCH for every build, and the time every file in the images
   * is clamped to. It is chosen once, when the system is compiled.
   */
  source_date_epoch: number;
  /**
   * The whole environment of every builder, before the package's own
   * `environment` and the builder variables (CC, DESTDIR, …) are added.
   * @example { "LC_ALL": "C.UTF-8", "TZ": "UTC", "SOURCE_DATE_EPOCH": "1793059200" }
   */
  variables: {
    [key: string]: string;
  };
  /** Such as `0022`. */
  umask: string;
  /** Every package is built in this directory, so no host path is compiled in. */
  build_directory: Input.GuestPath;
  /** The builder user, the same for every build. */
  user: {
    uid: number;
    gid: number;
  };
  hostname: string;
  /** Builds never have network access; only `fetch` phases do, and they are pinned. */
  network: "none";
  /**
   * Parallel jobs are not an input: a package whose output depends on them
   * is not reproducible.
   */
  jobs: "not an input";
}

/** The builder image and target toolchain artifact used for every build. */
export interface ToolchainIdentity {
  name: Input.Name;
  /** A published release; a toolchain without one cannot be compiled against. */
  release: string;
  /** Build host architecture, such as `aarch64`. Layers are never shared across hosts. */
  host: string;
  /** The dev image booted as the builder VM. */
  builder_image_sha256: Input.Sha256;
  /** The target toolchain mounted at /opt/eclogite/toolchains/<triplet>. */
  target_sha256: Input.Sha256;
}

export interface Choice {
  provider: Input.PackageName;
  reason: ChoiceReason;
  /** For `already chosen`: the capability the provider was chosen for first. */
  via?: Input.Capability;
  /** For `default` or an alternative: the reference that was resolved. */
  reference?: Input.Reference;
}

/**
 * Why a provider was chosen, in resolution order (docs/resolution.md, step 3).
 * The golden files write `override` for both overrides; here they are told
 * apart.
 */
export type ChoiceReason = "system override" | "software override" | "selected" | "already chosen" | "default";

export interface ConditionResult {
  /** The package whose run dependency this is, or `software`. */
  from: Input.PackageName | "software";
  /** The package or capability the entry names. */
  dependency: Input.Name;
  when: Input.Predicate;
  held: boolean;
}

export type CompiledPackage = CompiledBuildablePackage | CompiledMetaPackage;

export interface CompiledMetaPackage {
  name: Input.PackageName;
  /** Capabilities the package provides; only some may be chosen. */
  provides: Input.Capability[];
  kind: "meta";
  /** Run dependencies that applied, resolved to packages. */
  run: ResolvedDependency[];
}

/**
 * A compiled package depends only on its target, compiler and providers,
 * never on the system that selected it, so systems for the same target
 * share these entries; why a system selected a package is in its
 * `selected_by`.
 */
export interface CompiledBuildablePackage {
  name: Input.PackageName;
  /** Capabilities the package provides; only some may be chosen. */
  provides: Input.Capability[];
  kind: "buildable";
  version: string;
  /** As written; a git source always has its full revision. */
  source: Input.Source;
  /**
   * Hash of the prepared source tree: the checkout at `source.revision` with
   * `patches` applied, file times and owners normalized. It does not depend
   * on how the source was fetched. Absent for a source of type `none`.
   */
  source_tree_sha256?: Input.Sha256;
  builder: Input.BuilderName;
  /** Absent for builders that compile nothing (`files`, `source-tree`). */
  compiler?: {
    name: Input.Compiler;
    /**
     * `system`: the system compiler; `fallback`: the first one its `compatible.build` allows.
     */
    reason: "system" | "fallback";
  };
  /**
   * `arguments` with the variants that held merged in. The shape is the
   * builder's arguments type; CommonArguments is the part every builder
   * shares.
   */
  arguments: {
    [key: string]: unknown;
  } & Input.CommonArguments;
  /** Indexes into the package's `variants` that held. */
  variants_applied: number[];
  /**
   * Build-time parameters with the value they got. Start-time parameters are
   * in `runtime.values`, because they never enter the key.
   */
  parameters: {
    [key: string]: {
      from: Input.Value;
      value: Input.Scalar;
    };
  };
  dependencies: {
    build: (ResolvedDependency | ResolvedBuilderTool)[];
    link: ResolvedDependency[];
    run: ResolvedDependency[];
  };
  /** With the fetch output hash for this target, if the package has a fetch phase. */
  fetch?: {
    hook: Input.Name;
    output_sha256: Input.Sha256;
  };
  /** Content hashes of everything from the package directory that enters the key. */
  hashes: {
    patches: {
      path: string;
      sha256: Input.Sha256;
    }[];
    hooks: {
      name: Input.Name;
      sha256: Input.Sha256;
    }[];
    files: {
      path: string;
      sha256: Input.Sha256;
    }[];
    builder: Input.Sha256;
  };
  /**
   * The package's build key: recipe, source, patches, hooks, builder,
   * arguments, parameters, platform, toolchain, compiler, its own config,
   * and the keys of its build and link dependencies, and the build
   * environment.
   */
  key: Input.Sha256;
  /**
   * Hash of the normalized output, recorded by the first build of `key`
   * (locally or as a published layer). Every later build of the same key
   * must produce it; a different output is a reproducibility failure, not a
   * new version. Absent until the package has been built once.
   */
  output_sha256?: Input.Sha256;
}

/** A dependency entry and what it resolved to. */
export interface ResolvedDependency {
  /** The entry as written: a package, a capability or alternatives. */
  reference: Input.Reference;
  package: Input.PackageName;
  /** Set when the reference was a capability. */
  capability?: Input.Capability;
  /** Config this entry required of the provider. */
  config?: Input.Config;
}

/** A `builder:<tool>` entry checked against the toolchain's tool manifest. */
export interface ResolvedBuilderTool {
  tool: string;
  version?: string;
  revision?: Input.GitRevision;
}

export interface CompiledConfig {
  format: "kconfig";
  /** Every option something required or implied, with its value and source. */
  required: {
    [key: string]: {
      value: string;
      source: ConfigSource;
    };
  };
  /** Every declared option: its default, overridden by `required`. */
  effective: {
    [key: string]: string;
  };
}

/**
 * Where a config requirement came from (docs/resolution.md, step 7).
 * The golden files write these as strings: `host-share`, `device pl031`,
 * `implied by CONFIG_9P_FS`.
 */
export type ConfigSource = 
  | {
    kind: "dependency";
    package: Input.PackageName;
  }
  | {
    kind: "software";
  }
  | {
    kind: "device";
    model: Input.Name;
    device_kind: Input.DeviceKind;
  }
  | {
    kind: "implied";
    option: string;
  };

export interface OwnedFile {
  provider: Input.PackageName;
  capability: Input.Capability;
  type: "symlink" | "file";
  /** Symlink target, or the package file copied. */
  target: string;
}

/**
 * A service with its owner. Build-time parameters are expanded; start-time
 * ones stay as `${NAME}` and are listed in `runtime.values`.
 */
export interface CompiledService {
  run: string[];
  directory?: Input.GuestPath;
  environment?: Input.Environment;
  stdin?: Input.GuestPath;
  requires_mounts?: Input.GuestPath[];
  create_directories?: (Input.GuestPath | Input.Directory)[];
  user?: string;
  group?: string;
  log?: boolean;
  restart_delay_seconds?: Input.PositiveInteger;
  package: Input.PackageName;
  /** Set when the service is owned through a capability. */
  capability?: Input.Capability;
  /** The fields the software profile's `service_overrides` replaced. */
  overridden?: string[];
}

export interface CompiledMount {
  type: string;
  source: string;
  options?: string[];
  optional?: boolean;
  /** The package that declared it, or where the software profile or runner did. */
  from: 
    | Input.PackageName
    | "software.root" | "software.tmpfs" | "software.volumes" | "software.state" | "runtime.config";
}

/** An account with the package or profile that declared it. */
export interface CompiledUser {
  name: string;
  /** Allocated when the input gave none; a start-time uid stays `${NAME}`. */
  uid: number | Input.ParameterReference;
  group?: string;
  gid?: number | Input.ParameterReference;
  groups?: string[];
  home?: Input.GuestPath;
  shell?: Input.GuestPath;
  password?: "locked" | Input.ParameterReference;
  description?: string;
  /** The package or profile that declared it. */
  from: Input.PackageName | "software";
}

export interface CompiledGroup {
  name: string;
  gid: number | Input.ParameterReference;
  /** The package or profile that declared it. */
  from: Input.PackageName | "software";
}

/**
 * Everything the runner does when it starts the machine. None of it enters a
 * build, a key or an image, so changing a setting never rebuilds.
 */
export interface Runtime {
  /** The settings the person running the machine may change. */
  settings: {
    [key: string]: Input.Setting;
  };
  /**
   * Every start-time parameter, by the package or `software` that declared
   * it. The runner computes them at each start.
   */
  values: {
    [key: string]: {
      [key: string]: Input.Value;
    };
  };
  /**
   * How start-time values reach the guest: the runner writes them to a small
   * read-only disk at each start, and init mounts it here before it
   * completes the accounts and the hostname and starts any service. Secret
   * settings are written only in derived form, such as a crypt hash.
   */
  delivery: {
    device: "config-disk";
    mount: Input.GuestPath;
  };
  state: Input.StateVolume[];
  endpoints: {
    [key: string]: Input.Endpoint;
  };
  commands: {
    [key: string]: Input.RunnerCommand;
  };
}

export interface CompiledTest {
  /** `boot-shell` and `shutdown` are built in; others are `package:test`. */
  id: "boot-shell" | "shutdown" | `${string}:${string}`;
  timeout_seconds?: Input.PositiveInteger;
}

export interface CompiledImage {
  format: Input.Filesystem;
  readonly: boolean;
  /**
   * The filesystem's UUID, derived from the image's inputs rather than drawn
   * at random, so the same inputs make the same image.
   */
  filesystem_uuid: string;
  /** ext4's directory hash seed, derived the same way. */
  hash_seed: string;
  /** Absent until the outputs are composed; then the computed or fixed size. */
  size_mib?: Input.Mebibytes;
  free_mib?: number;
  strip: boolean;
  exclude: Input.GuestPathPattern[];
  /** Hash of the image file, recorded by its first build like a package's output. */
  output_sha256?: Input.Sha256;
}

export type CompiledVolume = {
  name: Input.Name;
  mount: Input.GuestPath;
  packages: Input.PackageName[];
} & {
  format: Input.Filesystem;
  readonly: boolean;
  /**
   * The filesystem's UUID, derived from the image's inputs rather than drawn
   * at random, so the same inputs make the same image.
   */
  filesystem_uuid: string;
  /** ext4's directory hash seed, derived the same way. */
  hash_seed: string;
  /** Absent until the outputs are composed; then the computed or fixed size. */
  size_mib?: Input.Mebibytes;
  free_mib?: number;
  strip: boolean;
  exclude: Input.GuestPathPattern[];
  /** Hash of the image file, recorded by its first build like a package's output. */
  output_sha256?: Input.Sha256;
};

/** Resolution stops at the first error; the golden files record it. */
export interface CompileFailure {
  schema: "eclogite.lock/v0.1";
  machine: Input.Name;
  software: Input.Name;
  error: {
    /** The step of docs/resolution.md that failed, 1 to 11. */
    step: number;
    message: string;
    /** The selection chain that pulled in the failing package. */
    chain: string[];
    /** File, line, column and JSON Pointer, when the error is in a document. */
    location?: {
      file: string;
      line: Input.PositiveInteger;
      column: Input.PositiveInteger;
      pointer: Input.JsonPointer;
    };
  };
}
