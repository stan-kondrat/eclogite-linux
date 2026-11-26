#!/bin/sh
# Copy GCC's target runtime libraries from the pinned cross toolchain into
# /lib: libgcc_s.so.1, libstdc++.so.6 and libatomic.so.1 with the files their
# links name. No headers, static libraries or Python pretty-printers.
# Builder variables: TOOLCHAIN, TARGET_TRIPLET, DESTDIR
set -eu
from=$TOOLCHAIN/$TARGET_TRIPLET/lib64
[ -d "$from" ] || from=$TOOLCHAIN/$TARGET_TRIPLET/lib
mkdir -p "$DESTDIR/lib"
for name in libgcc_s.so.1 libstdc++.so.6 libatomic.so.1; do
	[ -e "$from/$name" ] || { echo "gcc-runtime: no $name in $from" >&2; exit 1; }
	cp -P "$from/$name" "$DESTDIR/lib/"
	# the file a versioned link names, such as libstdc++.so.6.0.34
	if [ -L "$from/$name" ]; then
		target=$(readlink "$from/$name")
		cp "$from/$target" "$DESTDIR/lib/$target"
	fi
done
chmod 0755 "$DESTDIR/lib/"*
