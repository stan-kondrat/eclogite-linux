# Resolution

Resolution turns a system file, its machine and software profiles, and the
catalog into everything a build needs: the target, the package closure, every
choice and its reason, each package's compiler, and the config required of
configurable packages. It runs before anything is built and has no search: each
choice depends only on the system's facts and explicit selections, never on
another open choice, so the result is deterministic and a conflict is
reported, not solved.

This document is the specification. The
[golden files](../tests/reference/golden/) record the result for every machine
and software profile in the catalog. The object kinds and fields are described
in [configuration](configuration.md).

## Inputs

| Input | From |
|---|---|
| machine | the system's `machine`, with `extends` merged: `resources` field by field, `devices`, `limitations`, `references` and `status` replaced |
| software | the system's `software` |
| overrides | the system file's `abi`, `compiler` and `providers`, which take precedence over the software profile's |
| catalog | packages, platforms, ABIs, toolchains, `devices.jsonc`, `defaults.jsonc` |

## Step 1: target

1. **Platform**: the machine's `platform`.
2. **ABI**: the system's `abi`, else the software's, else `defaults.abi`.
3. **Triplet**: `<platform triplet_cpu>-<ABI triplet[platform architecture]>`,
   for example `aarch64-linux-gnu` or `armv6-linux-musleabihf`.
4. **Toolchain**: the ABI's `toolchain`. It must list the triplet in
   `targets`, and the target must not be `planned`.
5. **Facts**: target facts are the platform merged with the ABI (`arch`,
   `os`, `libc`, `abi`, CPU facts); machine facts come from the merged
   machine (`devices`, `memory_mib`, …). See [facts](configuration.md#facts).

Errors: unknown ABI; the ABI has no triplet for the architecture; the
toolchain lacks the triplet; the target is planned.

## Step 2: selected set

The **selected set** is every name in the software's `packages` and,
recursively, the run dependencies of the meta-packages among them. A
conditional entry (`when`) of a meta-package is expanded only if its predicate
holds. Only package names enter the selected set; a capability name in
`packages` or in a meta-package is resolved in step 3, not selected.

The selected set is what the system explicitly asked for. It decides
providers (step 3) and alternatives; it is not the closure.

## Step 3: references

A dependency, a software `packages` entry or a default names one of:

- **a package**: resolves to itself;
- **a capability**: resolves to a provider, chosen in this order:
  1. the system's `providers` entry, then the software's;
  2. the one package in the selected set that provides it; two are an error
     that asks for a `providers` entry;
  3. a package already chosen for another capability that also provides it
     (the kernel chosen for `kernel` is also the `linux`);
  4. the `defaults.providers` entry, itself a reference;
- **ordered alternatives** `{ "first": [a, b, …] }`: the first alternative in
  the selected set, else the first that resolves and whose constraints hold.

Every chosen provider must satisfy its `compatible.target` and
`compatible.machine` constraints. A capability is chosen once per system: all
later references to it get the same provider.

Errors: an override that does not provide the capability; several selected
providers; no provider and no default; a provider whose constraints fail
(the error names the failing scope and predicate); no alternative fits.

## Step 4: kernel and init

Every bootable system has exactly one `kernel` and one `init`. Both are
resolved first, before any dependency is followed, so capabilities that
follow them (`linux`) resolve to the same package.

## Step 5: closure

Starting from each entry of the software's `packages`, follow **run**
dependencies depth-first, in document order; each package enters the closure
once. For every package visited:

- its constraints must hold;
- its **build** and **link** references are resolved (step 3), so a missing
  provider is an error, but they do not join the closure: they are built, not
  installed;
- a run entry with `when` is followed only if the predicate holds;
- an entry with `config` adds that config to its target's provider (step 7).

Run dependencies may form cycles (`glibc` runs `cc-runtime`, which links
`libc`); build and link dependencies must not.

## Step 6: bootable

The closure must contain exactly one package providing `kernel` and one
providing `init`. If it has none, the provider chosen in step 4 is added. Two
are an error.

## Step 7: config

A configurable package receives config from:

1. `config` on dependency entries of packages in the closure (step 5);
2. `config` on the software's `packages` entries;
3. the machine's device models: each model's `requires` entry for a
   capability that some package in the closure provides. A device never adds
   a package.

Each requirement is checked against the provider's own `configurable.options`:

- the option must be declared;
- the value must be one of its `values`;
- a value other than `n` implies the option's `requires`, recursively, with
  the source "implied by" the option;
- two sources requiring different values for one option is an error naming
  both.

The **effective config** is every declared option's `default`, overridden by
the requirements.

Errors: config on a package that is not configurable; an undeclared option;
a value not allowed; conflicting values.

## Step 8: chosen providers

Every capability provided by some package in the closure gets a chosen
provider (step 3), even if nothing referenced it. This decides who owns the
capability's files in step 10: with BusyBox and bash both in the closure,
`sh` has exactly one owner.

## Step 9: compilers and builder tools

1. **System compiler**: the system's `compiler`, else the software's, else
   `defaults.compiler`. The toolchain must list it in `compilers`.
2. **Builder tools**: every `builder:<tool>` of every package in the closure
   must be in the toolchain's `tools` and not `planned`.
3. **Per package**, for packages built with a compiling builder (not `files`
   or `source-tree`): the system compiler if the package's
   `compatible.build` allows it, else the first other compiler in the
   toolchain's `compilers` order that it allows. The chosen compiler's tools
   must not be `planned`.

Errors: unknown compiler; missing or planned builder tool; no compiler
satisfies a package; the chosen compiler is planned.

## Step 10: owned files

For every chosen provider, the symlinks, files and services it lists under
`provides.<capability>` are installed. Owned files of providers that were not
chosen are not. Two chosen providers owning the same path is an error.

## Step 11: tests

The system's tests are the built-in `boot-shell` and `shutdown` checks plus
every test of every package in the closure whose `when` holds.

## Result

| Field | Contents |
|---|---|
| target | ABI, triplet, toolchain |
| closure | packages in visit order |
| choices | provider and reason per capability: `override`, `selected`, `already chosen`, `default` |
| compilers | per package, with the reason for a fallback |
| config | per configurable package, each required option with its value and source; the effective config |
| owned files | path → provider and capability |
| tests | `package:test` |

The lock records all of it ([configuration](configuration.md#lock-file)).
Resolution does not compute build keys, order builds, or compose images; those
use the result.
