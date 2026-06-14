#!/bin/sh
set -eu

if [ -n "${GO:-}" ]; then
  go_bin=$GO
elif [ -x /usr/local/go/bin/go ]; then
  go_bin=/usr/local/go/bin/go
else
  go_bin=go
fi

cd packages/go/converter

case "${1:-test}" in
  test)
    "$go_bin" test ./...
    ;;
  coverage)
    "$go_bin" test ./...
    "$go_bin" test -coverprofile=/tmp/turnout-converter.coverage.out ./internal/lexer ./internal/state
    "$go_bin" tool cover -func=/tmp/turnout-converter.coverage.out
    ;;
  *)
    echo "usage: sh scripts/go-test.sh [test|coverage]" >&2
    exit 2
    ;;
esac
