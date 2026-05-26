# Local Docker development environment variables.
# Run `docker-compose up -d` from the project root first, then dot-source this
# script in each terminal before starting services or running tests:
#
#   . .\bin\run-local-env.ps1

# ── Core connectivity ──────────────────────────────────────────────────────────
$env:DATABASE_URL        = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
$env:KAFKA_BROKERS       = "localhost:19092"
$env:GRPC_PORT           = "50051"
$env:TRITON_SERVER_URL   = "127.0.0.1:8001"
$env:ALGORITHM_STRATEGY  = "HUNGARIAN"

# ── Redis cluster ──────────────────────────────────────────────────────────────
# Seed all 6 nodes so the client can discover the full topology on startup.
$env:REDIS_CLUSTER_NODES = "127.0.0.1:6379,127.0.0.1:6380,127.0.0.1:6381,127.0.0.1:6382,127.0.0.1:6383,127.0.0.1:6384"

# Map container-internal announce IPs (172.28.1.x) to localhost ports.
# The cluster returns these internal IPs on MOVED/ASK redirects; the custom
# Dialer in redis_repo.go and cmd/**/main.go rewrites them to reachable addresses.
$env:REDIS_IP_MAP        = "172.28.1.1:6379=127.0.0.1:6379,172.28.1.2:6379=127.0.0.1:6380,172.28.1.3:6379=127.0.0.1:6381,172.28.1.4:6379=127.0.0.1:6382,172.28.1.5:6379=127.0.0.1:6383,172.28.1.6:6379=127.0.0.1:6384"

Write-Host "Local Docker env loaded. Services expected at:"
Write-Host "  PostgreSQL  -> localhost:5432"
Write-Host "  Kafka       -> localhost:19092"
Write-Host "  Triton gRPC -> localhost:8001"
Write-Host "  Redis nodes -> localhost:6379..6384"
