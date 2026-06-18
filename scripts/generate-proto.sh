#!/bin/sh
set -eu

if [ -n "${GO:-}" ]; then
  go_bin=$GO
elif [ -x /usr/local/go/bin/go ]; then
  go_bin=/usr/local/go/bin/go
else
  go_bin=go
fi

gopath=$("$go_bin" env GOPATH)
tools_bin="$PWD/.tools/bin"
mkdir -p "$tools_bin"

if [ ! -x "$tools_bin/protoc-gen-go" ]; then
  GOBIN="$tools_bin" "$go_bin" install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
fi

PATH="$tools_bin:$gopath/bin:$HOME/go/bin:$PATH:./node_modules/.bin"
BUF_CACHE_DIR="${BUF_CACHE_DIR:-$PWD/.buf-cache}"
XDG_CACHE_HOME="${XDG_CACHE_HOME:-$PWD/.buf-cache/xdg}"
NODE_OPTIONS="--localstorage-file=$tools_bin/node-localstorage"
export PATH BUF_CACHE_DIR XDG_CACHE_HOME NODE_OPTIONS

buf generate
