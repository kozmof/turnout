#!/bin/sh
set -eu

# Regenerates the shared bound constants and fails if either generated file
# moved. Replaces the regex-based drift check this used to be: the constants are
# now generated from spec/limits.json rather than hand-written and compared, so
# the two languages cannot be edited into disagreement in the first place.
#
# Same shape as check-fn-map.sh and check-unicode-case.sh, for the same reason.

node --experimental-strip-types scripts/gen-limits.ts

if [ -x /usr/bin/git ]; then
  git_bin=/usr/bin/git
else
  git_bin=git
fi

git_home="$PWD/.git-home"
mkdir -p "$git_home"
HOME="$git_home" XDG_CONFIG_HOME="$git_home/.config" "$git_bin" diff --exit-code -- \
  packages/go/converter/internal/limits/limits.go \
  packages/zig/runtime/src/generated/limits.zig
