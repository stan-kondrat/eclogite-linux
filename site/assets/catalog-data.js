(function () {
  "use strict";

  window.ECLOGITE_CATALOG = {
    generatedAt: "2026-10-04",
    packages: [
      {
        name: "base-files",
        version: "1",
        builder: "files",
        source: "local",
        description: "Owns the root filesystem skeleton, hostname, runit services, and immutable machine defaults.",
        dependencies: { build: [], link: [], runtime: ["bash", "coreutils", "dhcpcd", "runit"] }
      },
      {
        name: "bash",
        version: "5.3",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/bash.git",
        revision: "b8c60bc9ca365f8261fa97900b6fa939f6ebc303",
        description: "GNU Bourne Again Shell and the system's /bin/sh implementation.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "coreutils",
        version: "9.6",
        builder: "gnulib-autotools",
        source: "https://git.savannah.gnu.org/git/coreutils.git",
        revision: "e2a405981ff5441dcfb217797699c94968218aca",
        description: "Essential GNU file, text, and shell utilities.",
        dependencies: { build: ["gnulib"], link: [], runtime: [] }
      },
      {
        name: "dhcpcd",
        version: "10.3.2",
        builder: "dhcpcd",
        source: "https://github.com/NetworkConfiguration/dhcpcd.git",
        revision: "243ad84ac67a87d631ff7eb83b2eed2727acebb5",
        description: "Small DHCP client used by the default network service.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "diffutils",
        version: "3.10",
        builder: "gnulib-autotools",
        source: "https://git.savannah.gnu.org/git/diffutils.git",
        revision: "b1a657b85a7142b146b004a0db6a03dc6374b164",
        description: "GNU tools for comparing files and directories.",
        dependencies: { build: ["gnulib"], link: [], runtime: [] }
      },
      {
        name: "findutils",
        version: "4.10.0",
        builder: "gnulib-autotools",
        source: "https://git.savannah.gnu.org/git/findutils.git",
        revision: "c67264238d9487d5313a131674cd7a01ca299927",
        description: "GNU find, xargs, and file discovery tools.",
        dependencies: { build: ["gnulib"], link: [], runtime: [] }
      },
      {
        name: "gawk",
        version: "5.4.1",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/gawk.git",
        revision: "52af7f12758da12db0ddbdb117a84e0685cd2f72",
        description: "GNU implementation of the AWK text-processing language.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "gnulib",
        version: "snapshot-added3409",
        builder: "source-tree",
        source: "https://git.savannah.gnu.org/git/gnulib.git",
        revision: "added3409c778144f5f80e7ec1b7b7a7847272c0",
        description: "Source-only portability modules used during GNU package bootstrap; not installed in the guest.",
        buildOnly: true,
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "grep",
        version: "3.11",
        builder: "gnulib-autotools",
        source: "https://git.savannah.gnu.org/git/grep.git",
        revision: "f951840aa510277fe48e5f2579a98f517246ea86",
        description: "GNU regular-expression search utilities.",
        dependencies: { build: ["gnulib"], link: [], runtime: [] }
      },
      {
        name: "gzip",
        version: "1.13",
        builder: "gnulib-autotools",
        source: "https://git.savannah.gnu.org/git/gzip.git",
        revision: "0ff67062bc123d07dfb1f05c78231107aa9d1869",
        description: "GNU gzip compression and decompression tools.",
        dependencies: { build: ["gnulib"], link: [], runtime: [] }
      },
      {
        name: "iproute2",
        version: "7.1.0",
        builder: "iproute2",
        source: "https://git.kernel.org/pub/scm/network/iproute2/iproute2.git",
        revision: "d7d8203844bad5f9d8a6f3708c9b39141369aa51",
        description: "Linux network configuration and inspection utilities, including ip and ss.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "linux-libre",
        version: "7.1.3-gnu",
        builder: "kernel",
        source: "git://linux-libre.fsfla.org/releases.git",
        revision: "3e85aed47058aaeb9916cf756f2c2cbd41e32589",
        description: "Deblobbed Linux kernel, built as an ordinary package graph node for both target platforms.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "procps-ng",
        version: "4.0.5",
        builder: "autoreconf",
        source: "https://gitlab.com/procps-ng/procps.git",
        revision: "f46b2f7929cdfe2913ed0a7f585b09d6adbf994e",
        description: "Process inspection tools such as ps, top, free, and uptime.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "runit",
        version: "2.3.1",
        builder: "runit",
        source: "https://github.com/g-pape/runit.git",
        revision: "0e52a89654d375a8d634c5d9d18ab29fdb666976",
        description: "Small init system and service supervisor used as PID 1.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "sed",
        version: "4.9",
        builder: "gnulib-autotools",
        source: "https://git.savannah.gnu.org/git/sed.git",
        revision: "7e2e575a36bc88c0f3f3d6d8083c5f5b0ed44009",
        description: "GNU stream editor.",
        dependencies: { build: ["gnulib"], link: [], runtime: [] }
      },
      {
        name: "tar",
        version: "1.35",
        builder: "tar-gnulib-autotools",
        source: "https://git.savannah.gnu.org/git/tar.git",
        revision: "e545d446dfe6564265cdf4186641ee76f4acc7fa",
        description: "GNU archive creation and extraction utility.",
        dependencies: { build: ["gnulib"], link: [], runtime: [] }
      },
      {
        name: "util-linux",
        version: "2.40.4",
        builder: "autoreconf",
        source: "https://git.kernel.org/pub/scm/utils/util-linux/util-linux.git",
        revision: "dbcc687f6ab1568982cdf3fe391c0beb818b7e28",
        description: "Core Linux system utilities, terminals, mounts, and disk tools.",
        dependencies: { build: [], link: [], runtime: [] }
      },
      {
        name: "vim",
        version: "9.2.0725",
        builder: "vim",
        source: "https://github.com/vim/vim.git",
        revision: "d22ff1c955ff87e8273210eae125aab0e85b6c30",
        description: "Tiny-feature Vim build for console editing.",
        dependencies: { build: [], link: [], runtime: [] }
      }
    ],

    metapackages: [
      { name: "base", description: "Core shell, utilities, process tools, init, and filesystem policy.", members: ["base-files", "bash", "coreutils", "grep", "sed", "gawk", "findutils", "diffutils", "gzip", "tar", "procps-ng", "util-linux", "runit"] },
      { name: "network", description: "Network configuration and DHCP client.", members: ["iproute2", "dhcpcd"] },
      { name: "editor", description: "Interactive console editor.", members: ["vim"] },
      { name: "reference-system", description: "Complete userland matching the linux-libre-vm reference build.", members: ["@base", "@network", "@editor"] }
    ],

    platforms: [
      { name: "x86_64", architecture: "x86_64", abi: "linux-gnu", kernelArchitecture: "x86_64", description: "x86-64 baseline software target with the GNU ABI and glibc." },
      { name: "arm64", architecture: "aarch64", abi: "linux-gnu", kernelArchitecture: "arm64", description: "ARMv8-A baseline software target with the GNU ABI and glibc." },
      { name: "armv6-bcm2835", architecture: "arm", abi: "linux-gnueabihf", kernelArchitecture: "arm", description: "ARMv6ZK/VFP software target for BCM2835 and ARM1176JZF-S machines." }
    ],

    machines: [
      {
        name: "qemu-virt-arm64",
        aliases: ["qemu-arm64", "arm64-vm"],
        description: "QEMU virt ARM64 machine with direct kernel boot and virtio devices.",
        platform: "arm64",
        resources: { vcpus: 1, memoryMiB: 256 },
        runtime: { backend: "qemu", machine: "virt", acceleration: "auto" },
        boot: { method: "direct-kernel", console: "ttyAMA0" },
        devices: ["virtio-blk-device", "virtio-net-device", "virtio-9p-device"]
      },
      {
        name: "qemu-q35-x86_64",
        aliases: ["qemu-x86_64", "x86_64-vm"],
        description: "QEMU q35 x86-64 machine with direct kernel boot and virtio PCI devices.",
        platform: "x86_64",
        resources: { vcpus: 1, memoryMiB: 256 },
        runtime: { backend: "qemu", machine: "q35", acceleration: "auto" },
        boot: { method: "direct-kernel", console: "ttyS0" },
        devices: ["virtio-blk-pci", "virtio-net-pci", "virtio-9p-pci"]
      },
      {
        name: "utm-virt-arm64",
        aliases: ["utm-arm64", "arm64-utm"],
        description: "UTM 5 ARM64 virtual machine for Apple Silicon, using the QEMU backend with HVF, direct kernel boot, and an imported disk copy.",
        platform: "arm64",
        resources: { vcpus: 1, memoryMiB: 256 },
        runtime: { backend: "utm", application: "UTM", minimumVersion: "5", host: { os: "macos", architecture: "arm64" }, virtualizationBackend: "qemu", machine: "virt", acceleration: "hvf", bundleFormat: "utm", diskImport: "copy" },
        boot: { method: "direct-kernel", console: "ttyAMA0" },
        devices: ["virtio-blk-device", "virtio-net-device", "virtio-9p-device"]
      },
      {
        name: "raspberry-pi-model-b-256mb",
        aliases: ["raspberrypi-b-256", "rpi-b-256"],
        description: "Physical Raspberry Pi Model B with BCM2835, 256 MiB of memory, 26-pin GPIO, and SD-card boot.",
        platform: "armv6-bcm2835",
        status: "profile-only",
        resources: { cpu: "ARM1176JZF-S", soc: "BCM2835", cores: 1, memoryMiB: 256 },
        runtime: { backend: "physical", machine: "raspberry-pi-model-b" },
        boot: { method: "sd-card-firmware", media: "sd-card", firmwarePolicy: "unresolved" },
        devices: ["26-pin-gpio", "hdmi", "usb-2.0-x2", "csi", "dsi", "analog-audio", "composite-video", "ethernet-100mbps", "sd-card"]
      },
      {
        name: "raspberry-pi-model-b-512mb",
        aliases: ["raspberrypi", "raspberrypi-b", "rpi-b-512"],
        description: "Physical Raspberry Pi Model B with BCM2835, 512 MiB of memory, 26-pin GPIO, and SD-card boot.",
        platform: "armv6-bcm2835",
        status: "profile-only",
        resources: { cpu: "ARM1176JZF-S", soc: "BCM2835", cores: 1, memoryMiB: 512 },
        runtime: { backend: "physical", machine: "raspberry-pi-model-b" },
        boot: { method: "sd-card-firmware", media: "sd-card", firmwarePolicy: "unresolved" },
        devices: ["26-pin-gpio", "hdmi", "usb-2.0-x2", "csi", "dsi", "analog-audio", "composite-video", "ethernet-100mbps", "sd-card"]
      },
      {
        name: "qemu-raspi1ap-armv6",
        aliases: ["qemu-rpi-armv6", "rpi-armv6-vm"],
        description: "QEMU ARMv6 BCM2835 target using raspi1ap; it models Raspberry Pi 1 Model A+, not Model B.",
        platform: "armv6-bcm2835",
        status: "profile-only",
        resources: { cpu: "ARM1176JZF-S", soc: "BCM2835", cores: 1, memoryMiB: 512 },
        runtime: { backend: "qemu", executable: "qemu-system-arm", machine: "raspi1ap", acceleration: "tcg" },
        boot: { method: "direct-kernel", console: "ttyAMA0" },
        devices: ["bcm2835-gpio", "pl011", "bcm2835-aux", "framebuffer", "usb-host", "sd-mmc", "spi", "i2c"]
      }
    ],

    software: [
      {
        name: "reference-arm64",
        aliases: ["minimal-arm64"],
        description: "Linux-libre and the reference userland resolved for the ARM64 target.",
        platform: "arm64",
        stages: ["target-userland", "target-kernel", "image"],
        kernel: "linux-libre",
        image: { format: "ext4", sizeMiB: 256 },
        tests: ["boot-shell", "dhcp", "shutdown"]
      },
      {
        name: "reference-x86_64",
        aliases: ["minimal-x86_64"],
        description: "Linux-libre and the reference userland resolved for the x86-64 target.",
        platform: "x86_64",
        stages: ["target-userland", "target-kernel", "image"],
        kernel: "linux-libre",
        image: { format: "ext4", sizeMiB: 256 },
        tests: ["boot-shell", "dhcp", "shutdown"]
      }
    ],

    toolchains: [
      { name: "reference-system-gcc", description: "Native GNU compiler for a matching host; distro-provided cross compiler and sysroot otherwise.", targets: ["x86_64", "arm64"] }
    ],

    stages: [
      { name: "target-userland", description: "Build the selected target package closure.", context: "target", toolchain: "reference-system-gcc", after: [], selections: ["@reference-system"] },
      { name: "target-kernel", description: "Build Linux-libre for the selected target platform.", context: "target", toolchain: "reference-system-gcc", after: [], selections: ["linux-libre"] },
      { name: "image", description: "Compose the root filesystem and kernel into VM or hardware artifacts.", context: "image", toolchain: "reference-system-gcc", after: ["target-userland", "target-kernel"], selections: [] }
    ],

    systems: [
      {
        name: "qemu-arm64-reference",
        description: "Reference composition of the QEMU virt ARM64 machine and ARM64 software.",
        machine: "qemu-virt-arm64",
        software: "reference-arm64"
      },
      {
        name: "qemu-x86_64-reference",
        description: "Reference composition of the QEMU q35 x86-64 machine and x86-64 software.",
        machine: "qemu-q35-x86_64",
        software: "reference-x86_64"
      },
      {
        name: "utm-arm64-reference",
        description: "Reference composition of the UTM ARM64 machine and ARM64 software for Apple Silicon hosts.",
        machine: "utm-virt-arm64",
        software: "reference-arm64"
      }
    ]
  };
}());
