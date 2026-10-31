#!/bin/sh
# Every applet (defconfig), linked statically, installed without /usr, and
# built with the target cross compiler.
# Builder variables (provisional until the builder contract lands):
#   WORK  writable copy of the source;  TOOLCHAIN, TARGET_TRIPLET
set -eu
cd "$WORK"
make defconfig
set_option() {
	sed -i "s|^# $1 is not set\$|$1=$2|; s|^$1=.*\$|$1=$2|" .config
}
set_option CONFIG_STATIC y
set_option CONFIG_INSTALL_NO_USR y
set_option CONFIG_CROSS_COMPILER_PREFIX "\"$TOOLCHAIN/bin/$TARGET_TRIPLET-\""
make oldconfig </dev/null
