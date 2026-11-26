# Minimal BusyBox system (M1)

The first system Eclogite builds and boots: linux-libre, glibc, runit and BusyBox, booted from
an initramfs in QEMU `virt` arm64. It needs no disk and no `mkfs.ext4`, which the v0.4.0 dev
image does not have. The ext4 root of `minimal-busybox` follows once the dev image ships
e2fsprogs.

## The configuration

Three catalog files; everything else (packages, kernel, toolchain) is already in the catalog.

`catalog/systems/qemu-arm64-minimal-busybox.jsonc` — what to build:

```jsonc
{
  "schema": "eclogite.system/v0.1",
  "name": "qemu-arm64-minimal-busybox",
  "machine": "qemu-virt-arm64",
  "software": "minimal-busybox-initramfs"
}
```

`catalog/software/minimal-busybox-initramfs.jsonc` — what goes in it:

```jsonc
{
  "schema": "eclogite.software/v0.1",
  "name": "minimal-busybox-initramfs",
  "packages": ["base", "busybox"],
  "root": { "hostname": "eclogite", "readonly": false, "tmpfs": ["/run", "/tmp"] },
  "image": { "format": "initramfs", "strip": true, "exclude": ["/usr/include", "..."] }
}
```

- `"packages": ["base", "busybox"]`: selecting `busybox` makes it the provider of `sh`,
  `core-utils` and `system-utils`, so bash, coreutils and util-linux stay out.
- `"format": "initramfs"`: the root is a gzip-compressed cpio (newc) archive that the kernel
  unpacks into RAM; it is writable, so `readonly` must be `false`, and `size_mib`/`free_mib` do
  not apply (`validate` rejects both). The lock has no `/` fstab entry for it.

`catalog/machines/qemu-virt-arm64.jsonc` (existing) — the hardware: 1 vCPU, 256 MiB,
direct kernel boot, console `ttyAMA0`.

The resolved closure (`./eclogite resolve -c qemu-arm64-minimal-busybox`): `base`,
`base-files`, `linux-libre`, `glibc`, `gcc-runtime`, `runit`, `busybox`, `console-login` — 7
buildable packages.

## The commands

Run inside the pinned builder: the linux-libre-vm dev VM, or the
`ghcr.io/stan-kondrat/linux-libre-vm-dev:<release>` container. `-c` takes a system file or the
name of a catalog system.

```sh
./eclogite validate                                # catalog, schemas, checks
./eclogite lock  -c qemu-arm64-minimal-busybox     # state/qemu-arm64-minimal-busybox/system.lock.json
./eclogite fetch -c qemu-arm64-minimal-busybox     # git sources -> ~/.cache/eclogite (network)
./eclogite build -c qemu-arm64-minimal-busybox     # the 7 packages, offline
./eclogite image -c qemu-arm64-minimal-busybox     # not yet: kernel + initramfs
```

| Command | State | Does |
|---|---|---|
| `validate` | works | parse, schemas, catalog checks |
| `lock` | works | the lock, fully pinned for this system (no `--allow-unpinned`) |
| `plan` | works | lock status and the rebuild set |
| `fetch` | works | each locked commit into `git/mirrors/`, then a read-only tree in `sources/<key>/`; a second run is offline. Three sources: linux-libre (276 MB of git objects, most of the first run's time here), busybox and runit; glibc and gcc-runtime are copied from the cross toolchain |
| `build` | works | prepare sources (revision + patches), run each package's builder in `build_order` with a constructed environment, write read-only layers `layers/<key>/`; a second run builds nothing. In a dev VM whose cache is on a 9p share, add `--work-dir` on a local disk; in a VM that predates the release identity files, `--no-builder-check` |
| `image` | next | compose the package outputs into one root, add `/init` (→ `/bin/runit-init`), write `out/qemu-arm64-minimal-busybox/Image` and `initramfs.cpio.gz` |

Measured in the 1-CPU dev VM (2026-11-27): busybox 7 minutes, the kernel 63 minutes
(`allnoconfig` + `config/base.config` + the required options: a 3.2 MB `Image.gz`), the rest
seconds; glibc and gcc-runtime are copied from the cross toolchain. A second `build` finds all
7 layers cached in under a second.

The initramfs is written by Eclogite itself (cpio newc in the mjs tool, gzip from Node), so
the image step needs no `cpio` either.

## Booting

QEMU is not in the dev image yet; run it on the CI runner (`apt install qemu-system-arm`) or a
Mac (`brew install qemu`):

```sh
cd out/qemu-arm64-minimal-busybox
qemu-system-aarch64 -M virt,gic-version=3 -cpu cortex-a72 -m 256 -nographic \
  -kernel Image -initrd initramfs.cpio.gz -append "console=ttyAMA0"
```

The kernel finds `/init` in the initramfs and runs it, so `root=` is not needed (the machine's
`root=/dev/vda` is ignored). M1 is done when this reaches a serial login and `poweroff` exits
QEMU, in CI too.
