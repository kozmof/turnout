#!/bin/sh
set -eu

sh scripts/generate-proto.sh

if [ -x /usr/bin/git ]; then
  git_bin=/usr/bin/git
else
  git_bin=git
fi

git_home="$PWD/.git-home"
mkdir -p "$git_home"
HOME="$git_home" XDG_CONFIG_HOME="$git_home/.config" "$git_bin" diff --exit-code -- \
  packages/go/converter/internal/emit/turnoutpb \
  packages/ts/scene-runner/src/types/turnout-model_pb.ts
