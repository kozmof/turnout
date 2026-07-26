#!/bin/sh
set -eu

node --experimental-strip-types scripts/gen-fn-map.ts

if [ -x /usr/bin/git ]; then
  git_bin=/usr/bin/git
else
  git_bin=git
fi

git_home="$PWD/.git-home"
mkdir -p "$git_home"
HOME="$git_home" XDG_CONFIG_HOME="$git_home/.config" "$git_bin" diff --exit-code -- \
  packages/ts/scene-runner/src/executor/fn-map.generated.ts
