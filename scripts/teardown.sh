#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

KEEP_VOL="${KEEP_VOLUMES:-0}"

echo "==> Stopping Docker Compose stack..."
if [[ "$KEEP_VOL" == "1" ]]; then
    docker compose down
else
    docker compose down -v
fi

echo "==> Killing any leftover port-forward processes..."
pkill -f "kubectl port-forward" 2>/dev/null || true

echo "  [OK] Teardown complete."
