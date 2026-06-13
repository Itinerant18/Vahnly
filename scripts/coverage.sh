#!/usr/bin/env bash
# Backend test-coverage gate (Linux/CI mirror of coverage.ps1).
#   scripts/coverage.sh           # gate + report
#   scripts/coverage.sh --html    # also emit coverage.html
#
# GATED packages are pure/algorithmic and run with NO external infra; their coverage is
# a hard floor (exit 1 on a drop). REPORTED packages hold money/auth logic but many
# suites SKIP without a live Postgres/Redis, so they are printed, not enforced. See
# DOC/TEST_COVERAGE.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# package=min_percent
GATES=(
  "internal/dispatch/matcher=75"
  "internal/pricing/surge=90"
)
REPORTED=(
  "internal/rider/service"
  "internal/pricing/service"
  "internal/rider/repository"
  "internal/gateway/delivery/http"
)

PROFILE="coverage.out"
PKGS=()
for g in "${GATES[@]}"; do PKGS+=("./${g%%=*}"); done
for r in "${REPORTED[@]}"; do PKGS+=("./$r"); done

echo "==> go test (coverage) over ${#PKGS[@]} package(s)..."
OUT="$(go test "${PKGS[@]}" -coverprofile="$PROFILE" -covermode=set 2>&1)"
echo "$OUT"

pct_for() { # $1 = internal/... package path
  echo "$OUT" | grep -oE "driver-delivery/$1[^\n]*coverage: [0-9.]+%" \
    | grep -oE "coverage: [0-9.]+%" | grep -oE "[0-9.]+" | head -1
}

echo
echo "==> Coverage gate"
fail=0
for g in "${GATES[@]}"; do
  pkg="${g%%=*}"; min="${g##*=}"
  have="$(pct_for "$pkg" || true)"
  if [[ -z "$have" ]]; then
    printf "FAIL   %-36s (no result)\n" "$pkg"; fail=1; continue
  fi
  if awk "BEGIN{exit !($have >= $min)}"; then
    printf "PASS   %-36s %6s%%  (min %s%%)\n" "$pkg" "$have" "$min"
  else
    printf "FAIL   %-36s %6s%%  (min %s%%)\n" "$pkg" "$have" "$min"; fail=1
  fi
done

echo
echo "==> Reported (infra-gated, not enforced)"
for r in "${REPORTED[@]}"; do
  have="$(pct_for "$r" || true)"
  printf "       %-36s %7s\n" "$r" "${have:-n/a}${have:+%}"
done

if [[ "${1:-}" == "--html" ]]; then
  go tool cover -html="$PROFILE" -o coverage.html
  echo; echo "Wrote coverage.html"
fi

if [[ "$fail" -ne 0 ]]; then
  echo; echo "Coverage gate FAILED"; exit 1
fi
echo; echo "Coverage gate passed"
