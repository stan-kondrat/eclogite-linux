# Generated VM bundle

`eclogite create --config SYSTEM.jsonc` produces a complete VM bundle in the
current empty directory. `--output VM_DIR` may instead name a new destination
directory. Building and running are intentionally separate: `eclogite`
constructs the machine; the generated `vm.sh` operates it.

## Layout

```text
VM_DIR/
  vm.sh                  bundle-local lifecycle command
  vm.json                strict-JSON runtime manifest
  artifacts/
    kernel               selected kernel output
    root.img             immutable root filesystem image
    initrd               optional early userspace image
  runtime/
    driver.sh            generated QEMU/UTM-specific implementation
    state/               runtime state such as PID and monitor socket
                         or a generated NAME.utm bundle
  logs/                   console and runtime logs
  share/                  explicit host/guest shared directory
```

The exact artifact names are recorded in `vm.json`; optional files are not
created merely to preserve this example. The manifest also records the fully
resolved machine resources, boot method, devices, console, and runtime backend,
alongside identities for the resolved software profile, kernel, root image, and
lock. The build is first assembled in a
temporary sibling and validated there. An explicit new `--output` directory is
published atomically. When publishing into the current empty directory, bundle
contents are moved only after validation and `vm.json` is written last as the
completion manifest. Existing non-empty directories are never merged with
generated output.

`artifacts/`, `vm.json`, `runtime/driver.sh`, and `vm.sh` are build outputs.
Normal VM operation writes only beneath `runtime/state/`, `logs/`, and `share/`.
The base root image is attached read-only. `/run` and `/tmp` are tmpfs in the
guest; explicitly declared persistent data uses a separate image or host path.

## Runner commands

```text
./vm.sh run [-- runtime arguments]
./vm.sh start [-- runtime arguments]
./vm.sh console
./vm.sh exec COMMAND [ARG...]
./vm.sh stop
./vm.sh status
./vm.sh serial-path
./vm.sh recreate
./vm.sh delete
./vm.sh validate
./vm.sh version
./vm.sh help
```

`run` stays attached to the VM. `start` launches it in the background.
`console`, `exec`, `stop`, `status`, and `serial-path` address the same bundle's
runtime state. `validate` performs structural checks without starting a VM.
`run` and `start` prepare a missing backend instance before booting it. For UTM,
that means configuring and registering a `.utm` bundle beneath
`runtime/state/`, importing the immutable root image as its private disk copy,
and registering the optional `share/` directory. `recreate` replaces only that
generated runtime instance from the bundle artifacts; `delete` removes the
instance while preserving artifacts, logs, and `share/`.

`vm.sh` is a small POSIX shell dispatcher and has no dependency on `jq`,
Python, or an installed `eclogite`. Runtime-specific flags and JSON parsing are
resolved while the bundle is built and encoded in `runtime/driver.sh`. This
keeps runtime behavior portable while retaining `vm.json` as the canonical,
machine-readable manifest.

## Responsibility split

| Concern | `eclogite` | generated `vm.sh` |
|---|---|---|
| parse and validate JSONC | yes | no |
| compose a machine profile with a software profile | yes | no |
| check platform and device compatibility | yes | no |
| resolve packages and graph | yes | no |
| generate lock and build plan | yes | no |
| run builders and cache layers | yes | no |
| assemble and test images | yes | no |
| create the VM directory | yes | no |
| validate bundle structure | before publish | before runtime dispatch |
| start, inspect, and stop this VM | no | yes |
| prepare or recreate the QEMU/UTM runtime instance | no | yes |
| mutate the guest root | no | no |

This separation lets one `eclogite` installation produce many independent VM
directories. Each directory remains runnable after the source repository and
host build tool are removed.
