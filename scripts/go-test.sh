#!/bin/sh
set -eu

if [ -n "${GO:-}" ]; then
  go_bin=$GO
elif [ -x /usr/local/go/bin/go ]; then
  go_bin=/usr/local/go/bin/go
else
  go_bin=go
fi

# When invoking the raw go binary directly (not via the /usr/local/bin/go shim),
# GOCACHE is not injected by island(1). Set it explicitly so builds and tests
# always use the writable workspace cache instead of ~/.cache/go-build, which
# is Landlock-restricted in the sandbox.
# /workspace is present and writable in the local sandbox but does not exist
# in CI (GitHub Actions), so fall back to the standard user cache there.
if [ -z "${GOCACHE:-}" ]; then
  if [ -w /workspace ]; then
    GOCACHE=/workspace/.go-cache
  else
    GOCACHE="${HOME}/.cache/go-build"
  fi
  export GOCACHE
fi

cd packages/go/converter

case "${1:-test}" in
  test)
    "$go_bin" test ./...
    ;;
  coverage)
    packages=$(GOFLAGS=-buildvcs=false "$go_bin" list ./... | grep -Ev '/internal/emit/turnoutpb$|/internal/names$|/internal/overview$')
    profile=${GO_COVERAGE_PROFILE:-/tmp/turnout-converter.coverage.out}
    threshold=${GO_COVERAGE_THRESHOLD:-79.0}

    GOFLAGS=-buildvcs=false "$go_bin" test -coverprofile="$profile" $packages
    "$go_bin" tool cover -func="$profile"

    total=$("$go_bin" tool cover -func="$profile" | awk '/^total:/ { sub(/%/, "", $3); print $3 }')
    awk -v total="$total" -v threshold="$threshold" 'BEGIN {
      if (total + 0 < threshold + 0) {
        printf "Go coverage %.1f%% is below threshold %.1f%%\n", total, threshold > "/dev/stderr"
        exit 1
      }
    }'
    ;;
  *)
    echo "usage: sh scripts/go-test.sh [test|coverage]" >&2
    exit 2
    ;;
esac
