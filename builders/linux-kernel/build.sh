#!/bin/sh
# linux-kernel builder: the base configuration (ARG_DEFCONFIG, default the
# architecture's defconfig), then the package's
# config fragments in order, then the resolved options (KCONFIG, one
# CONFIG_X=value per line, n for off); olddefconfig; every required option
# (KCONFIG_REQUIRED, one name per line) must have survived. Builds ARG_IMAGE and installs it with .config and
# System.map in /boot. Called once per step: build.sh STEP.
set -eu
step=$1
k() {
	make -C "$WORK" O="$BUILD" ARCH="$KERNEL_ARCH" CROSS_COMPILE="$TARGET_TRIPLET-" \
		KBUILD_BUILD_USER=eclogite KBUILD_BUILD_HOST=eclogite-builder \
		KBUILD_BUILD_TIMESTAMP="@$SOURCE_DATE_EPOCH" "$@"
}
case $step in
configure)
	mkdir -p "$BUILD"
	k "${ARG_DEFCONFIG:-defconfig}"
	if [ -n "${ARG_FRAGMENTS:-}" ]; then
		set -f; IFS='
'
		# merge_config.sh writes its temporary files into the current
		# directory, and WORK may be the read-only source tree
		for f in ${ARG_FRAGMENTS:-}; do
			(cd "$BUILD" && "$WORK/scripts/kconfig/merge_config.sh" -m -O "$BUILD" "$BUILD/.config" "$PACKAGE/config/$f")
		done
		unset IFS; set +f
	fi
	printf '%s\n' "$KCONFIG" | while IFS== read -r name value; do
		[ -n "$name" ] || continue
		case $value in
		y) "$WORK/scripts/config" --file "$BUILD/.config" --enable "$name" ;;
		m) "$WORK/scripts/config" --file "$BUILD/.config" --module "$name" ;;
		n) "$WORK/scripts/config" --file "$BUILD/.config" --disable "$name" ;;
		*) "$WORK/scripts/config" --file "$BUILD/.config" --set-val "$name" "$value" ;;
		esac
	done
	k olddefconfig
	# verify: Kconfig silently drops an option whose dependencies are off, and
	# a select or a choice can force one on. A required option (KCONFIG_REQUIRED)
	# that did not survive fails the build; an option nobody requires keeps its
	# catalog default only where the architecture's defconfig allows it, so a
	# difference there is a warning. (Every test ends in `|| :`: /bin/sh may be
	# bash, whose POSIX mode keeps set -e inside the command substitution.)
	report=$(printf '%s\n' "$KCONFIG" | while IFS== read -r name value; do
		[ -n "$name" ] || continue
		got=$(grep "^$name=" "$BUILD/.config" | cut -d= -f2 || :)
		[ -n "$got" ] || got=n
		[ "$got" = "$value" ] && continue
		if printf '%s\n' "${KCONFIG_REQUIRED:-}" | grep -qx "$name"; then
			echo "required $name: wanted $value, got $got"
		else
			echo "default $name: wanted $value, got $got"
		fi
	done || :)
	if [ -n "$report" ]; then
		printf '%s\n' "$report" | sed -n 's/^default /linux-kernel builder: warning: the defconfig overrides the default of /p' >&2
	fi
	bad=$(printf '%s\n' "$report" | sed -n 's/^required //p')
	if [ -n "$bad" ]; then
		echo "linux-kernel builder: required options did not survive in the effective .config:" >&2
		printf '%s\n' "$bad" >&2
		exit 1
	fi
	;;
build) k -j"$JOBS" "${ARG_IMAGE:-}" ;;
install)
	install -D -m 0644 "$BUILD/arch/$KERNEL_ARCH/boot/${ARG_IMAGE:-}" "$DESTDIR/boot/${ARG_IMAGE:-}"
	install -m 0644 "$BUILD/.config" "$DESTDIR/boot/config"
	install -m 0644 "$BUILD/System.map" "$DESTDIR/boot/System.map"
	;;
*) echo "linux-kernel builder: unknown step $step" >&2; exit 2 ;;
esac
