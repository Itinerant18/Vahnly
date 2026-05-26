#!/usr/bin/env bash
# =============================================================================
# Local Infrastructure Bootstrap — dispatch namespace
# =============================================================================
# Applies local-dev-topology.yaml and sets up port-forwards for Go testing.
#
# Usage:
#   chmod +x deploy/local/start-local-infra.sh
#   ./deploy/local/start-local-infra.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/local-dev-topology.yaml"
NAMESPACE="dispatch"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  🚀 Starting local dispatch infrastructure stack    ║"
echo "╚══════════════════════════════════════════════════════╝"

# ── 1. Apply the manifest ────────────────────────────────────────────────────
echo ""
echo "▸ Applying manifest: $MANIFEST"
kubectl apply -f "$MANIFEST"

# ── 2. Wait for PostgreSQL ───────────────────────────────────────────────────
echo ""
echo "▸ Waiting for PostgreSQL to become ready..."
kubectl rollout status statefulset/postgresql -n "$NAMESPACE" --timeout=120s

# ── 3. Wait for Kafka ───────────────────────────────────────────────────────
echo ""
echo "▸ Waiting for Kafka broker to become ready..."
kubectl rollout status deployment/kafka-kraft -n "$NAMESPACE" --timeout=120s

# ── 4. Wait for Redis Cluster pods ──────────────────────────────────────────
echo ""
echo "▸ Waiting for all 6 Redis cluster pods..."
kubectl rollout status statefulset/redis-cluster -n "$NAMESPACE" --timeout=180s

# ── 5. Wait for Redis cluster initialization job ────────────────────────────
echo ""
echo "▸ Waiting for Redis cluster bootstrap job to complete..."
kubectl wait --for=condition=complete job/redis-cluster-init-job \
  -n "$NAMESPACE" --timeout=180s

# ── 6. Wait for Kafka topic initialization job ──────────────────────────────
echo ""
echo "▸ Waiting for Kafka topic seeder job to complete..."
kubectl wait --for=condition=complete job/kafka-topic-init-job \
  -n "$NAMESPACE" --timeout=120s || echo "  ⚠ Topic seeder still running — topics auto-create is enabled as fallback."

# ── 7. Kill stale port-forwards ─────────────────────────────────────────────
echo ""
echo "▸ Cleaning up any stale port-forwards..."
pkill -f "kubectl port-forward.*-n $NAMESPACE" 2>/dev/null || true
sleep 1

# ── 8. Start port-forwards ──────────────────────────────────────────────────
echo ""
echo "▸ Establishing port-forwards..."

kubectl port-forward svc/postgresql-service 5432:5432 -n "$NAMESPACE" &
PF_PG=$!
echo "  ✔ PostgreSQL → localhost:5432  (PID $PF_PG)"

kubectl port-forward svc/kafka-service 19092:19092 -n "$NAMESPACE" &
PF_KAFKA=$!
echo "  ✔ Kafka      → localhost:19092 (PID $PF_KAFKA)"

kubectl port-forward pod/redis-cluster-0 6379:6379 -n "$NAMESPACE" &
PF_REDIS=$!
echo "  ✔ Redis      → localhost:6379  (PID $PF_REDIS)"

# ── 9. Export environment variables ──────────────────────────────────────────
export DATABASE_URL="postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
export REDIS_CLUSTER_NODES="127.0.0.1:6379"
export KAFKA_BROKERS="localhost:19092"
export GRPC_PORT="50051"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Infrastructure ready — connection variables:     ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  DATABASE_URL        = $DATABASE_URL"
echo "║  REDIS_CLUSTER_NODES = $REDIS_CLUSTER_NODES"
echo "║  KAFKA_BROKERS       = $KAFKA_BROKERS"
echo "║  GRPC_PORT           = $GRPC_PORT"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Port-forward PIDs: pg=$PF_PG  kafka=$PF_KAFKA  redis=$PF_REDIS"
echo "To stop: kill $PF_PG $PF_KAFKA $PF_REDIS"
echo ""
echo "Run your Go tests now:"
echo "  go test ./internal/... -v -tags=integration"
