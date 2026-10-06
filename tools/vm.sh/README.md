# `vm.sh` runtime runner

This directory is reserved for the portable runner template that will be copied
into every VM directory produced by `eclogite create`. No runner implementation
is present during the research/layout phase. It is not a globally installed
tool and it is not a package manager.

The future script will validate the stable bundle shape and dispatch commands
to `runtime/driver.sh`. During materialization, `eclogite` will generate that
driver for the resolved backend and host platform. Keeping backend details out
of the public script gives QEMU and UTM the same lifecycle interface.

The UTM driver will be derived from the working `linux-libre-vm` runner: UTM 5
on Apple Silicon, QEMU backend with HVF, direct kernel boot, an imported disk
copy, serial console through a host pseudo-terminal, shared NAT, and VirtFS/9p.
`run` and `start` lazily prepare a missing `.utm` instance; `recreate` and
`delete` affect only generated runtime state and preserve immutable artifacts
and the bundle's `share/` directory.

See [`docs/vm-bundle.md`](../../docs/vm-bundle.md) for the bundle layout and
command contract.
