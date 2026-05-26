#!/usr/bin/env bash
# =============================================================================
# Local Infrastructure Teardown — dispatch namespace
# =============================================================================
set -euo pipefail

NAMESPACE="dispatch"

echo "▸ Killing port-forwards..."
pkill -f "kubectl port-forward.*-n $NAMESPACE" 2>/dev/null || true

echo "▸ Deleting namespace '$NAMESPACE' (all resources)..."
kubectl delete namespace "$NAMESPACE" --ignore-not-found --timeout=120s

echo "✅ Local dispatch infrastructure torn down."
