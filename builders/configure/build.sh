#!/bin/sh
# configure builder: optional bootstrap, ./configure for the target, make,
# make install. Called once per step: build.sh STEP.
# ARG_OUT_OF_TREE=true builds in BUILD (a directory next to WORK).
set -eu
step=$1
nl='
'
dir=$WORK
[ "${ARG_OUT_OF_TREE:-false}" = true ] && dir=$BUILD
mkdir -p "$dir"
cd "$dir"
set -f
IFS=$nl
case $step in
configure)
	case ${ARG_BOOTSTRAP:-none} in
	none) ;;
	autoreconf) (cd "$WORK" && autoreconf -fi) ;;
	*) (cd "$WORK" && ./bootstrap --skip-po) ;;
	esac
	"$WORK/configure" --build="$BUILD_TRIPLET" --host="$TARGET_TRIPLET" \
		CC="$CC" CXX="$CXX" AR="$AR" RANLIB="$RANLIB" STRIP="$STRIP" NM="$NM" \
		CFLAGS="$CFLAGS" CXXFLAGS="$CXXFLAGS" LDFLAGS="$LDFLAGS" \
		${ARG_CONFIGURE:-}
	;;
build) make -j"$JOBS" ${ARG_MAKE_TARGETS:-} ;;
install) make DESTDIR="$DESTDIR" ${ARG_INSTALL_TARGETS:-install} ;;
*) echo "configure builder: unknown step $step" >&2; exit 2 ;;
esac
