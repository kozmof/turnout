#!/bin/sh
set -eu

node --experimental-strip-types scripts/gen-unicode-case.ts

if [ -x /usr/bin/git ]; then
  git_bin=/usr/bin/git
else
  git_bin=git
fi

git_home="$PWD/.git-home"
mkdir -p "$git_home"
HOME="$git_home" XDG_CONFIG_HOME="$git_home/.config" "$git_bin" diff --exit-code -- \
  packages/zig/src/generated/unicode_case.zig
