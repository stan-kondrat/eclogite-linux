#!/bin/sh
# Copy the target's runtime glibc from the pinned cross toolchain's sysroot:
# /lib (the loader, shared libraries, NSS modules) with the sysroot's
# lib64 link if it has one, ldconfig and getent. eclogite moves the programs
# to /bin afterwards.
# Builder variables: SYSROOT, DESTDIR
set -eu
[ -d "$SYSROOT/lib" ] || { echo "glibc: no $SYSROOT/lib" >&2; exit 1; }
mkdir -p "$DESTDIR/lib" "$DESTDIR/sbin" "$DESTDIR/usr/bin"
for f in "$SYSROOT"/lib/*.so*; do
	cp -P "$f" "$DESTDIR/lib/"
done
# 64-bit targets search /lib64; the sysroot makes it a link to lib
if [ -L "$SYSROOT/lib64" ]; then
	ln -s "$(readlink "$SYSROOT/lib64")" "$DESTDIR/lib64"
fi
cp "$SYSROOT/sbin/ldconfig" "$DESTDIR/sbin/ldconfig"
cp "$SYSROOT/usr/bin/getent" "$DESTDIR/usr/bin/getent"
