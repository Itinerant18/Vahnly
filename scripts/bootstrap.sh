#!/usr/bin/env bash
# =============================================================================
# Drivers-for-u — one-shot local bootstrap (Linux / macOS)
# =============================================================================
# Brings up the full Docker Compose stack. Idempotent. Mirrors
# scripts/bootstrap.ps1 for cross-platform parity.
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GRN}  [OK]${NC}  %s\n" "$1"; }
warn() { printf "${YLW}[WARN]${NC}  %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC}  %s\n" "$1"; exit 1; }

# ── 1. Prereq checks ─────────────────────────────────────────────────────────
echo "==> Verifying prerequisites..."
command -v go         >/dev/null || fail "go not found (need 1.25+)"
command -v docker     >/dev/null || fail "docker not found (need 24+)"
command -v node       >/dev/null || fail "node not found (need 20+)"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not found"
ok   "go         $(go version | awk '{print $3}')"
ok   "docker     $(docker --version | awk '{print $3}')"
ok   "node       $(node --version)"

# ── 2. .env file ─────────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
    if [[ -f .env.example ]]; then
        cp .env.example .env
        ok "Created .env from .env.example"
    else
        fail ".env.example missing. Re-clone the repo."
    fi
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

# ── 3. Tear down any prior state ─────────────────────────────────────────────
echo "==> Tearing down any prior stack..."
docker compose down -v >/dev/null 2>&1 || true

# ── 4. Bring up ──────────────────────────────────────────────────────────────
COMPOSE_ARGS=(up -d)
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
    COMPOSE_ARGS+=(--build)
fi
echo "==> docker compose ${COMPOSE_ARGS[*]}"
docker compose "${COMPOSE_ARGS[@]}"

# ── 5. Wait for db-migrator ──────────────────────────────────────────────────
WAIT_SECONDS="${WAIT_SECONDS:-120}"
echo "==> Waiting up to ${WAIT_SECONDS}s for db-migrator..."
deadline=$((SECONDS + WAIT_SECONDS))
done=0
while (( SECONDS < deadline )); do
    state=$(docker compose ps -a db-migrator --format json 2>/dev/null | head -1 || true)
    if echo "$state" | grep -q '"State":"exited"' && echo "$state" | grep -q '"ExitCode":0'; then
        done=1
        break
    fi
    sleep 2
done
(( done == 1 )) && ok "db-migrator completed" \
                || warn "db-migrator did not finish in ${WAIT_SECONDS}s"

# ── 6. Generate REDIS_IP_MAP if absent ───────────────────────────────────────
if [[ -z "${REDIS_IP_MAP:-}" ]]; then
    echo "==> Generating REDIS_IP_MAP from running Redis containers..."
    ipmap=()
    port=6379
    for i in 1 2 3 4 5 6; do
        cname="driver-redis-node-$i"
        ip=$(docker inspect -f '{{.NetworkSettings.Networks.dispatch_network.IPAddress}}' "$cname" 2>/dev/null || true)
        if [[ -n "$ip" ]]; then
            ipmap+=("${ip}:6379=127.0.0.1:${port}")
            port=$((port + 1))
        fi
    done
    if (( ${#ipmap[@]} == 6 )); then
        REDIS_IP_MAP=$(IFS=,; echo "${ipmap[*]}")
        sed -i.bak "s|^REDIS_IP_MAP=.*|REDIS_IP_MAP=${REDIS_IP_MAP}|" .env && rm -f .env.bak
        export REDIS_IP_MAP
        ok "REDIS_IP_MAP written to .env"
    else
        warn "Could not auto-detect all 6 Redis IPs (cluster still bootstrapping?)."
    fi
fi

# ── 7. Optional seed ─────────────────────────────────────────────────────────
if [[ "${SKIP_SEED:-0}" != "1" ]]; then
    echo "==> Applying bin/seed.sql (idempotent)..."
    if command -v psql >/dev/null 2>&1; then
        PGPASSWORD="${POSTGRES_PASSWORD:-password}" \
            psql -h localhost -p 5432 -U "${POSTGRES_USER:-postgres}" \
                 -d "${POSTGRES_DB:-delivery_platform}" -f bin/seed.sql >/dev/null 2>&1 \
            && ok "Seed applied (via host psql)" \
            || warn "psql seed returned non-zero (likely already seeded)"
    else
        echo "  psql not on host PATH. Trying to seed via Docker container..."
        if docker compose exec -T spatial-db psql -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-delivery_platform}" < bin/seed.sql >/dev/null 2>&1; then
            ok "Seed applied (via docker compose exec)"
        else
            warn "Docker-based psql seed returned non-zero (likely already seeded)"
        fi
    fi
fi

# ── 8. Print connection map ──────────────────────────────────────────────────
cat <<EOF

==========================================================================
 Drivers-for-u stack is up.
==========================================================================
  PostgreSQL     -> localhost:5432  (user=postgres db=delivery_platform)
  Kafka EXTERNAL -> localhost:19092 (use INTERNAL 9092 from inside compose)
  Redis cluster  -> 127.0.0.1:6379..6384 (3P+3R)
  Triton gRPC    -> 127.0.0.1:8001  (HTTP 8000, metrics 8002)
  Gateway HTTP   -> localhost:8080  (/health /ready /metrics)
  Ingestion gRPC -> localhost:50051 (ClientStreamPositions)
  Analytics SSE  -> localhost:8089  (/api/v1/analytics/heatmap/stream)

 Smoke test:
   curl http://localhost:8080/health
   go run ./cmd/simulator
   go test -v -tags=integration ./test/integration/...

 Tear down:
   ./scripts/teardown.sh
==========================================================================
EOF
