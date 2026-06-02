#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-$ROOT/bin}"
mkdir -p "$OUT_DIR"

export GOOS="${GOOS:-linux}"
export GOARCH="${GOARCH:-amd64}"
export CGO_ENABLED=1

services=(
  dispatch ingestion gateway reconciler pruner expiry
  rebalancer surge pricing notification analytics
  simulator migrate osm-preprocessor
)

ext=""
[[ "$GOOS" == "windows" ]] && ext=".exe"

for svc in "${services[@]}"; do
    out="$OUT_DIR/${svc}${ext}"
    echo "  [BUILD] $svc -> $out"
    go build -o "$out" "./cmd/$svc"
done

echo "==> All 14 binaries built into $OUT_DIR"
