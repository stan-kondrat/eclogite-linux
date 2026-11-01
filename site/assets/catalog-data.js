(function () {
  "use strict";

  // Generated from catalog/ by a one-off script until `eclogite site` exists
  // (after version 1). Meta-packages are packages with run
  // dependencies only; they are listed separately here for the graph's colors.
  window.ECLOGITE_CATALOG = {
    generatedAt: "2026-10-15",
    packages: [
      {
        name: "base-files",
        version: "1",
        builder: "files",
        source: "local",
        description: "Filesystem skeleton, users and /bin/sh that every system needs.",
        dependencies: {
          build: [],
          link: [],
          runtime: [
            "linux"
          ]
        }
      },
      {
        name: "bash",
        version: "5.3",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/bash.git",
        revision: "b8c60bc9ca365f8261fa97900b6fa939f6ebc303",
        description: "GNU Bourne Again Shell and the system's /bin/sh implementation.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      },
      {
        name: "busybox",
        version: "1.38.0",
        builder: "make",
        source: "https://git.busybox.net/busybox",
        revision: "fc71374dfccd46448c62947269a35f1420d7ee28",
        description: "One static binary providing the shell, core, system and text utilities, DHCP client, ip and vi.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: []
        }
      },
      {
        name: "ca-certificates",
        version: "2026.10.23",
        builder: "files",
        source: "https://github.com/certifi/python-certifi.git",
        revision: "b60466c9f2882d9cf088943c650b0faac06c080c",
        description: "Mozilla CA bundle for TLS clients, installed as a file.",
        dependencies: {
          build: [],
          link: [],
          runtime: []
        }
      },
      {
        name: "console-login",
        version: "1",
        builder: "files",
        source: "local",
        description: "Root login on the machine's serial console, whichever console the machine names.",
        dependencies: {
          build: [],
          link: [],
          runtime: [
            "system-utils",
            "sh",
            "init"
          ]
        }
      },
      {
        name: "coreutils",
        version: "9.6",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/coreutils.git",
        revision: "e2a405981ff5441dcfb217797699c94968218aca",
        description: "Essential GNU file, text, and shell utilities.",
        dependencies: {
          build: [
            "gnulib"
          ],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      },
      {
        name: "curl",
        version: "8.23.0",
        builder: "configure",
        source: "https://github.com/curl/curl.git",
        revision: "3163ec065643ba20709f190111f42c3e1fe95273",
        description: "URL transfer library and tool; git's HTTPS transport.",
        dependencies: {
          build: [],
          link: [
            "libc",
            "openssl",
            "zlib"
          ],
          runtime: [
            "libc",
            "openssl",
            "zlib",
            "ca-certificates"
          ]
        }
      },
      {
        name: "dhcpcd",
        version: "10.3.2",
        builder: "configure",
        source: "https://github.com/NetworkConfiguration/dhcpcd.git",
        revision: "243ad84ac67a87d631ff7eb83b2eed2727acebb5",
        description: "Small DHCP client used by the default network service.",
        dependencies: {
          build: [],
          link: [],
          runtime: [
            "libc",
            "init"
          ]
        }
      },
      {
        name: "diffutils",
        version: "3.10",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/diffutils.git",
        revision: "b1a657b85a7142b146b004a0db6a03dc6374b164",
        description: "GNU tools for comparing files and directories.",
        dependencies: {
          build: [
            "gnulib"
          ],
          link: [],
          runtime: []
        }
      },
      {
        name: "findutils",
        version: "4.10.0",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/findutils.git",
        revision: "c67264238d9487d5313a131674cd7a01ca299927",
        description: "GNU find, xargs, and file discovery tools.",
        dependencies: {
          build: [
            "gnulib"
          ],
          link: [],
          runtime: []
        }
      },
      {
        name: "gawk",
        version: "5.4.1",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/gawk.git",
        revision: "52af7f12758da12db0ddbdb117a84e0685cd2f72",
        description: "GNU implementation of the AWK text-processing language.",
        dependencies: {
          build: [],
          link: [],
          runtime: []
        }
      },
      {
        name: "gcc-runtime",
        version: "15.3.0",
        builder: "configure",
        source: "https://gcc.gnu.org/git/gcc.git",
        revision: "4db0e8df15bef836558857c291c323add11d035c",
        description: "GCC's target runtimes: libgcc_s, libstdc++ and libatomic; the default cc-runtime and c++-runtime.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: []
        }
      },
      {
        name: "git",
        version: "2.56.0",
        builder: "make",
        source: "https://github.com/git/git.git",
        revision: "a018953688f1b10bddf91bff8747068f5f4746a4",
        description: "Distributed version control, built with HTTPS support.",
        dependencies: {
          build: [],
          link: [
            "libc",
            "curl",
            "openssl",
            "zlib"
          ],
          runtime: [
            "libc",
            "sh",
            "curl",
            "openssl",
            "zlib"
          ]
        }
      },
      {
        name: "glibc",
        version: "2.43",
        builder: "configure",
        source: "https://sourceware.org/git/glibc.git",
        revision: "f762ccf84f122d1354f103a151cba8bde797d521",
        description: "GNU C library, built from the toolchain's own source revision; the guest's loader and shared libraries.",
        dependencies: {
          build: [],
          link: [],
          runtime: [
            "cc-runtime"
          ]
        }
      },
      {
        name: "gnulib",
        version: "snapshot-added3409",
        builder: "source-tree",
        source: "https://git.savannah.gnu.org/git/gnulib.git",
        revision: "added3409c778144f5f80e7ec1b7b7a7847272c0",
        description: "Source-only portability modules used during GNU package bootstrap; not installed in the guest.",
        dependencies: {
          build: [],
          link: [],
          runtime: []
        }
      },
      {
        name: "grep",
        version: "3.11",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/grep.git",
        revision: "f951840aa510277fe48e5f2579a98f517246ea86",
        description: "GNU regular-expression search utilities.",
        dependencies: {
          build: [
            "gnulib"
          ],
          link: [],
          runtime: []
        }
      },
      {
        name: "gzip",
        version: "1.13",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/gzip.git",
        revision: "0ff67062bc123d07dfb1f05c78231107aa9d1869",
        description: "GNU gzip compression and decompression tools.",
        dependencies: {
          build: [
            "gnulib"
          ],
          link: [],
          runtime: []
        }
      },
      {
        name: "host-share",
        version: "1",
        builder: "files",
        source: "local",
        description: "Mounts the VM bundle's share at /mnt/shared over 9p; selected only on machines with a shared directory.",
        dependencies: {
          build: [],
          link: [],
          runtime: [
            "linux"
          ]
        }
      },
      {
        name: "iproute2",
        version: "7.1.0",
        builder: "configure",
        source: "https://git.kernel.org/pub/scm/network/iproute2/iproute2.git",
        revision: "d7d8203844bad5f9d8a6f3708c9b39141369aa51",
        description: "Linux network configuration and inspection utilities, including ip and ss.",
        dependencies: {
          build: [],
          link: [],
          runtime: []
        }
      },
      {
        name: "less",
        version: "712",
        builder: "configure",
        source: "https://github.com/gwsw/less.git",
        revision: "7f46e9ff46216f3e560cd1f41ddf3b36b11eec0e",
        description: "Terminal pager.",
        dependencies: {
          build: [],
          link: [
            "libc",
            "ncurses"
          ],
          runtime: [
            "libc",
            "ncurses"
          ]
        }
      },
      {
        name: "linux-libre",
        version: "7.1.3-gnu",
        builder: "linux-kernel",
        source: "git://linux-libre.fsfla.org/releases.git",
        revision: "3e85aed47058aaeb9916cf756f2c2cbd41e32589",
        description: "Deblobbed Linux kernel, built as an ordinary package graph node for both target platforms.",
        dependencies: {
          build: [],
          link: [],
          runtime: []
        }
      },
      {
        name: "llvm-runtime",
        version: "23.1.3",
        builder: "cmake",
        source: "https://github.com/llvm/llvm-project.git",
        revision: "0d261d1ca552c95a8f007e061c787ac7132fbcbc",
        description: "LLVM's compiler-rt, libunwind, libc++ and libc++abi: the alternative cc-runtime and c++-runtime.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      },
      {
        name: "musl",
        version: "1.2.6",
        builder: "configure",
        source: "https://git.musl-libc.org/git/musl",
        revision: "9fa28ece75d8a2191de7c5bb53bed224c5947417",
        description: "The musl C library, the libc of the linux-musl ABI.",
        dependencies: {
          build: [],
          link: [],
          runtime: []
        }
      },
      {
        name: "ncurses",
        version: "6.6",
        builder: "configure",
        source: "https://github.com/ThomasDickey/ncurses-snapshots.git",
        revision: "0096bd402c4a9c8f39bd7ed266e1b8920327e4d8",
        description: "Terminal handling library and terminfo database used by less.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      },
      {
        name: "nodejs",
        version: "26.10.0",
        builder: "configure",
        source: "https://github.com/nodejs/node.git",
        revision: "151845ab90d3926ceb36eedf1eade09619c3adc9",
        description: "Node.js runtime built from source at the same revision as the builder's node.",
        dependencies: {
          build: [],
          link: [
            "libc",
            "c++-runtime"
          ],
          runtime: [
            "libc",
            "c++-runtime"
          ]
        }
      },
      {
        name: "openssh",
        version: "10.6p1",
        builder: "configure",
        source: "https://github.com/openssh/openssh-portable.git",
        revision: "a8c72b842423f0774f542d3c2197247c3dd28d74",
        description: "OpenSSH sshd, ssh-keygen and clients, with the sshd privilege-separation account.",
        dependencies: {
          build: [],
          link: [
            "libc",
            "openssl",
            "zlib"
          ],
          runtime: [
            "libc",
            "openssl",
            "zlib"
          ]
        }
      },
      {
        name: "openssl",
        version: "3.6.5",
        builder: "make",
        source: "https://github.com/openssl/openssl.git",
        revision: "c8bd5a57108599ac650bbae77fcabe3109dab2e8",
        description: "OpenSSL 3.x TLS and crypto library linked by curl, git and OpenSSH.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      },
      {
        name: "procps-ng",
        version: "4.0.5",
        builder: "configure",
        source: "https://gitlab.com/procps-ng/procps.git",
        revision: "f46b2f7929cdfe2913ed0a7f585b09d6adbf994e",
        description: "Process inspection tools such as ps, top, free, and uptime.",
        dependencies: {
          build: [],
          link: [],
          runtime: []
        }
      },
      {
        name: "runit",
        version: "2.3.1",
        builder: "make",
        source: "https://github.com/g-pape/runit.git",
        revision: "0e52a89654d375a8d634c5d9d18ab29fdb666976",
        description: "Init and service supervisor: stage scripts and the supervision of every package's services.",
        dependencies: {
          build: [],
          link: [],
          runtime: [
            "libc",
            "sh",
            "core-utils",
            "system-utils",
            "linux"
          ]
        }
      },
      {
        name: "sed",
        version: "4.9",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/sed.git",
        revision: "7e2e575a36bc88c0f3f3d6d8083c5f5b0ed44009",
        description: "GNU stream editor.",
        dependencies: {
          build: [
            "gnulib"
          ],
          link: [],
          runtime: []
        }
      },
      {
        name: "tar",
        version: "1.35",
        builder: "configure",
        source: "https://git.savannah.gnu.org/git/tar.git",
        revision: "e545d446dfe6564265cdf4186641ee76f4acc7fa",
        description: "GNU archive creation and extraction utility.",
        dependencies: {
          build: [
            "gnulib"
          ],
          link: [],
          runtime: []
        }
      },
      {
        name: "theia",
        version: "1.76.0",
        builder: "npm-workspace",
        source: "https://github.com/eclipse-theia/theia.git",
        revision: "3980769cc0ccf74ccac5a5a995f41dce3773d759",
        description: "Eclipse Theia browser IDE: offline npm build, plugins, and a service on port 3000.",
        dependencies: {
          build: [],
          link: [
            "libc",
            "c++-runtime"
          ],
          runtime: [
            "nodejs",
            "libc",
            "c++-runtime",
            "init",
            "host-share",
            "linux"
          ]
        }
      },
      {
        name: "util-linux",
        version: "2.40.4",
        builder: "configure",
        source: "https://git.kernel.org/pub/scm/utils/util-linux/util-linux.git",
        revision: "dbcc687f6ab1568982cdf3fe391c0beb818b7e28",
        description: "Core Linux system utilities, terminals, mounts, and disk tools.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      },
      {
        name: "vim",
        version: "9.2.0725",
        builder: "configure",
        source: "https://github.com/vim/vim.git",
        revision: "d22ff1c955ff87e8273210eae125aab0e85b6c30",
        description: "Tiny-feature Vim build for console editing.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      },
      {
        name: "zlib",
        version: "1.3.2",
        builder: "configure",
        source: "https://github.com/madler/zlib.git",
        revision: "da607da739fa6047df13e66a2af6b8bec7c2a498",
        description: "Compression library that curl, git and OpenSSH link.",
        dependencies: {
          build: [],
          link: [
            "libc"
          ],
          runtime: [
            "libc"
          ]
        }
      }
    ],
    metapackages: [
      {
        name: "base",
        description: "What boot itself uses: init, console login, shell, coreutils and util-linux.",
        members: [
          "base-files",
          "libc",
          "init",
          "sh",
          "core-utils",
          "system-utils",
          "console-login"
        ]
      },
      {
        name: "editor",
        description: "Interactive console editor.",
        members: [
          "vi"
        ]
      },
      {
        name: "gnu-utils",
        description: "The GNU text, file, archive and process tools: the default provider of utils.",
        members: [
          "grep",
          "sed",
          "gawk",
          "findutils",
          "diffutils",
          "gzip",
          "tar",
          "procps-ng"
        ]
      },
      {
        name: "ide",
        description: "Browser IDE served from the guest.",
        members: [
          "theia"
        ]
      },
      {
        name: "network",
        description: "Network configuration and DHCP client.",
        members: [
          "ip",
          "dhcp-client"
        ]
      },
      {
        name: "reference-system",
        description: "Complete userland matching the linux-libre-vm reference build.",
        members: [
          "base",
          "utils",
          "network",
          "editor",
          "host-share"
        ]
      }
    ],
    platforms: [
      {
        name: "arm64",
        architecture: "aarch64",
        abi: "linux-gnu",
        kernelArchitecture: "arm64",
        toolchain: "linux-libre-vm",
        description: "ARMv8-A baseline software target with the GNU ABI and glibc."
      },
      {
        name: "armv6-bcm2835",
        architecture: "arm",
        abi: "linux-gnu",
        kernelArchitecture: "arm",
        toolchain: "linux-libre-vm",
        description: "ARMv6ZK/VFP software target for BCM2835 and ARM1176JZF-S machines."
      },
      {
        name: "x86_64",
        architecture: "x86_64",
        abi: "linux-gnu",
        kernelArchitecture: "x86_64",
        toolchain: "linux-libre-vm",
        description: "x86-64 baseline software target with the GNU ABI and glibc."
      }
    ],
    machines: [
      {
        name: "qemu-virt-arm64",
        aliases: [
          "qemu-arm64",
          "arm64-vm"
        ],
        description: "QEMU virt ARM64 machine with direct kernel boot and virtio devices.",
        platform: "arm64",
        resources: {
          vcpus: 1,
          memoryMiB: 256
        },
        runtime: {
          backend: "qemu",
          machine: "virt",
          acceleration: "auto"
        },
        boot: {
          method: "direct-kernel",
          console: "ttyAMA0"
        },
        devices: [
          "pl011",
          "pl031",
          "virtio-blk-device",
          "virtio-net-device",
          "virtio-9p-device"
        ]
      },
      {
        name: "qemu-q35-x86_64",
        aliases: [
          "qemu-x86_64",
          "x86_64-vm"
        ],
        description: "QEMU q35 x86-64 machine with direct kernel boot and virtio PCI devices.",
        platform: "x86_64",
        resources: {
          vcpus: 1,
          memoryMiB: 256
        },
        runtime: {
          backend: "qemu",
          machine: "q35",
          acceleration: "auto"
        },
        boot: {
          method: "direct-kernel",
          console: "ttyS0"
        },
        devices: [
          "16550a",
          "cmos-rtc",
          "virtio-blk-pci",
          "virtio-net-pci",
          "virtio-9p-pci"
        ]
      },
      {
        name: "utm-virt-arm64",
        aliases: [
          "utm-arm64",
          "arm64-utm"
        ],
        description: "UTM 5 ARM64 virtual machine for Apple Silicon, using the QEMU backend with HVF, direct kernel boot, and an imported disk copy.",
        platform: "arm64",
        resources: {
          vcpus: 1,
          memoryMiB: 256
        },
        runtime: {
          backend: "utm",
          application: "UTM",
          minimumVersion: "5",
          host: {
            os: "macos",
            architecture: "arm64"
          },
          virtualizationBackend: "qemu",
          machine: "virt",
          acceleration: "hvf",
          bundleFormat: "utm",
          diskImport: "copy"
        },
        boot: {
          method: "direct-kernel",
          console: "ttyAMA0"
        },
        devices: [
          "pl011",
          "pl031",
          "virtio-blk-device",
          "virtio-net-device",
          "virtio-9p-device"
        ]
      },
      {
        name: "utm-virt-arm64-8g",
        aliases: [
          "utm-arm64-8g"
        ],
        description: "The UTM ARM64 machine with 2 vCPUs and 8 GiB of memory, for an IDE server.",
        platform: "arm64",
        extends: "utm-virt-arm64",
        resources: {
          vcpus: 2,
          memoryMiB: 8192
        },
        runtime: {
          backend: "utm",
          application: "UTM",
          minimumVersion: "5",
          host: {
            os: "macos",
            architecture: "arm64"
          },
          virtualizationBackend: "qemu",
          machine: "virt",
          acceleration: "hvf",
          bundleFormat: "utm",
          diskImport: "copy"
        },
        boot: {
          method: "direct-kernel",
          console: "ttyAMA0"
        },
        devices: [
          "pl011",
          "pl031",
          "virtio-blk-device",
          "virtio-net-device",
          "virtio-9p-device"
        ]
      },
      {
        name: "raspberry-pi-model-b-256mb",
        aliases: [
          "raspberrypi-b-256",
          "rpi-b-256"
        ],
        description: "Physical Raspberry Pi Model B with BCM2835, 256 MiB of memory, 26-pin GPIO, and SD-card boot.",
        platform: "armv6-bcm2835",
        status: "profile-only",
        extends: "raspberry-pi-model-b-512mb",
        resources: {
          cpu: "ARM1176JZF-S",
          soc: "BCM2835",
          cores: 1,
          memoryMiB: 256
        },
        runtime: {
          backend: "physical",
          machine: "raspberry-pi-model-b"
        },
        boot: {
          method: "sd-card-firmware",
          console: "ttyAMA0",
          media: "sd-card",
          firmwarePolicy: "unresolved"
        },
        devices: [
          "pl011",
          "hdmi",
          "usb-2.0-x2",
          "csi",
          "dsi",
          "3.5mm-analog",
          "rca-composite",
          "ethernet",
          "sd-card",
          "micro-usb"
        ]
      },
      {
        name: "raspberry-pi-model-b-512mb",
        aliases: [
          "raspberrypi",
          "raspberrypi-b",
          "rpi-b-512"
        ],
        description: "Physical Raspberry Pi Model B with BCM2835, 512 MiB of memory, 26-pin GPIO, and SD-card boot.",
        platform: "armv6-bcm2835",
        status: "profile-only",
        resources: {
          cpu: "ARM1176JZF-S",
          soc: "BCM2835",
          cores: 1,
          memoryMiB: 512
        },
        runtime: {
          backend: "physical",
          machine: "raspberry-pi-model-b"
        },
        boot: {
          method: "sd-card-firmware",
          console: "ttyAMA0",
          media: "sd-card",
          firmwarePolicy: "unresolved"
        },
        devices: [
          "pl011",
          "hdmi",
          "usb-2.0-x2",
          "csi",
          "dsi",
          "3.5mm-analog",
          "rca-composite",
          "ethernet",
          "sd-card",
          "micro-usb"
        ]
      },
      {
        name: "qemu-raspi1ap-armv6",
        aliases: [
          "qemu-rpi-armv6",
          "rpi-armv6-vm"
        ],
        description: "QEMU ARMv6 BCM2835 target using raspi1ap; it models Raspberry Pi 1 Model A+, not Model B.",
        platform: "armv6-bcm2835",
        status: "profile-only",
        resources: {
          cpu: "ARM1176JZF-S",
          soc: "BCM2835",
          cores: 1,
          memoryMiB: 512
        },
        runtime: {
          backend: "qemu",
          executable: "qemu-system-arm",
          machine: "raspi1ap",
          acceleration: "tcg"
        },
        boot: {
          method: "direct-kernel",
          console: "ttyAMA0"
        },
        devices: [
          "bcm2835-gpio",
          "pl011",
          "bcm2835-aux",
          "framebuffer",
          "usb-host",
          "sd-mmc",
          "bcm2835-spi",
          "bcm2835-i2c"
        ]
      }
    ],
    software: [
      {
        name: "minimal-busybox",
        aliases: [],
        description: "The minimal system with BusyBox as the shell and utilities.",
        packages: [
          "base",
          "busybox"
        ],
        image: {
          format: "ext4"
        }
      },
      {
        name: "minimal",
        aliases: [],
        description: "The smallest bootable system: base only, a root shell on the serial console, stripped.",
        packages: [
          "base"
        ],
        image: {
          format: "ext4"
        }
      },
      {
        name: "reference",
        aliases: [],
        description: "The complete linux-libre-vm reference userland, for any compatible machine's platform.",
        packages: [
          "reference-system"
        ],
        image: {
          format: "ext4"
        }
      },
      {
        name: "theia",
        aliases: [
          "ide"
        ],
        description: "The reference system plus the Theia browser IDE, with /opt/theia on its own volume.",
        packages: [
          "reference-system",
          "ide"
        ],
        image: {
          format: "ext4"
        },
        volumes: [
          {
            name: "theia",
            mount: "/opt/theia",
            packages: [
              "theia"
            ]
          }
        ]
      }
    ],
    toolchains: [
      {
        name: "linux-libre-vm",
        description: "The builder image: cross toolchains by triplet, gcc (clang planned), and the tool manifest.",
        targets: [
          "x86_64-linux-gnu",
          "aarch64-linux-gnu",
          "armv6-linux-gnueabihf",
          "x86_64-linux-musl",
          "aarch64-linux-musl",
          "armv6-linux-musleabihf"
        ]
      }
    ],
    systems: [
      {
        name: "qemu-arm64-reference",
        description: "Reference composition of the QEMU virt ARM64 machine and the reference software.",
        machine: "qemu-virt-arm64",
        software: "reference",
        kernel: "linux-libre"
      },
      {
        name: "qemu-x86_64-reference",
        description: "Reference composition of the QEMU q35 x86-64 machine and the reference software.",
        machine: "qemu-q35-x86_64",
        software: "reference",
        kernel: "linux-libre"
      },
      {
        name: "utm-arm64-reference",
        description: "Reference composition of the UTM ARM64 machine and the reference software for Apple Silicon hosts.",
        machine: "utm-virt-arm64",
        software: "reference",
        kernel: "linux-libre"
      },
      {
        name: "utm-arm64-theia",
        description: "The Theia IDE on an 8-GiB UTM ARM64 machine, with the workspace on the bundle share.",
        machine: "utm-virt-arm64-8g",
        software: "theia",
        kernel: "linux-libre"
      }
    ],
    capabilities: {
      sh: [
        "bash",
        "busybox"
      ],
      "core-utils": [
        "coreutils",
        "busybox"
      ],
      "system-utils": [
        "util-linux",
        "busybox"
      ],
      utils: [
        "gnu-utils",
        "busybox"
      ],
      ip: [
        "iproute2",
        "busybox"
      ],
      vi: [
        "vim",
        "busybox"
      ],
      "dhcp-client": [
        "dhcpcd",
        "busybox"
      ],
      "cc-runtime": [
        "gcc-runtime",
        "llvm-runtime"
      ],
      "c++-runtime": [
        "gcc-runtime",
        "llvm-runtime"
      ],
      libc: [
        "glibc",
        "musl"
      ],
      kernel: [
        "linux-libre"
      ],
      linux: [
        "linux-libre"
      ],
      init: [
        "runit"
      ]
    }
  };
}());
