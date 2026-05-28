# run_e2e_test.ps1
#
# Unified PowerShell E2E Smoke Integration Test (Pure ASCII version to avoid encoding issues)
# ====================================================

$kubectl = "C:\Program Files\Docker\Docker\Resources\bin\kubectl.exe"
$go = "C:\Users\itine\scoop\shims\go.exe"

Write-Host "======================================================"
Write-Host "  Starting Local E2E Smoke Integration Test"
Write-Host "======================================================"

# 1. Clean up old kubectl port-forward processes and background jobs
Write-Host "Clean up existing kubectl connections..."
Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 2. Query Redis pods from K8s to obtain their current Pod IPs
Write-Host "Fetching Redis Cluster Pod configurations..."
$podsJson = & $kubectl get pods -n dispatch -l app=redis-cluster -o json
if ($LASTEXITCODE -ne 0 -or -not $podsJson) {
    Write-Error "Failed to fetch Redis pods from Kubernetes. Is Kubernetes running?"
    exit 1
}
$pods = $podsJson | ConvertFrom-Json

# 3. Establish 6-shard Redis port forwards + dynamic IP mapping
$ipMapList = @()
$port = 6379
foreach ($item in $pods.items) {
    $name = $item.metadata.name
    $ip = $item.status.podIP
    if ($ip) {
        $ipMapList += "${ip}:6379=127.0.0.1:${port}"
        Write-Host "  Forwarding $name ($ip) to localhost:$port..."
        Start-Process -FilePath $kubectl -ArgumentList "port-forward pod/$name ${port}:6379 -n dispatch" -WindowStyle Hidden
        $port++
    }
}
$env:REDIS_IP_MAP = $ipMapList -join ","
Write-Host "  Generated REDIS_IP_MAP: $env:REDIS_IP_MAP"
$env:DATABASE_URL = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
$env:REDIS_CLUSTER_NODES = "127.0.0.1:6379"
$env:KAFKA_BROKERS = "localhost:19092"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "1"

# 4. Port forward PostgreSQL (5432) and Kafka (19092)
Write-Host "Establishing data tier port forwards..."
Start-Process -FilePath $kubectl -ArgumentList "port-forward svc/postgresql-service 5432:5432 -n dispatch" -WindowStyle Hidden
Write-Host "  PostgreSQL port-forward -> localhost:5432 started"
Start-Process -FilePath $kubectl -ArgumentList "port-forward svc/kafka-service 19092:19092 -n dispatch" -WindowStyle Hidden
Write-Host "  Kafka port-forward -> localhost:19092 started"

Start-Sleep -Seconds 5

# 5. Verify all necessary TCP ports are open
Write-Host "Verifying port connectivity..."
$portsToTest = @(5432, 19092)
for ($p = 6379; $p -lt $port; $p++) {
    $portsToTest += $p
}

$allConnected = $true
foreach ($p in $portsToTest) {
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $tcp.Connect("127.0.0.1", $p)
        Write-Host "  [OPEN] localhost:$p"
    } catch {
        Write-Host "  [CLOSED] localhost:$p"
        $allConnected = $false
    } finally { $tcp.Dispose() }
}

if (-not $allConnected) {
    Write-Error "One or more infrastructural ports failed to bind. Aborting."
    Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 1
}

# 6. Seed PostgreSQL database state
Write-Host "Running programmatic migrations..."
& $go run cmd/migrate/main.go
if ($LASTEXITCODE -ne 0) {
    Write-Error "Programmatic migration bootstrap failed."
    Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Seeding PostgreSQL state..."
$sql = @'
DELETE FROM dispatch_match_logs WHERE order_id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
DELETE FROM orders WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
DELETE FROM drivers WHERE city_prefix = 'KOL';
DELETE FROM regional_cities WHERE city_prefix = 'KOL';

INSERT INTO regional_cities (city_prefix, city_name, timezone, is_active, geofence)
VALUES (
    'KOL',
    'Kolkata',
    'Asia/Kolkata',
    true,
    ST_GeomFromText('MULTIPOLYGON(((88.3 22.5, 88.4 22.5, 88.4 22.6, 88.3 22.6, 88.3 22.5)))', 4326)::geography
);

INSERT INTO drivers (id, city_prefix, name, phone, dl_number, current_state, is_verified, acceptance_rate, cancellation_rate)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'KOL',
    'Subir Das',
    '+919876543210',
    'DL-12345-KOL',
    'ONLINE_AVAILABLE',
    true,
    0.950,
    0.010
);

INSERT INTO orders (id, city_prefix, customer_id, status, pickup_location, dropoff_location, pickup_h3_cell, surge_multiplier, base_fare_paise)
VALUES (
    'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    'KOL',
    'c81d4e2e-bcf2-11e6-869b-7df243852131',
    'CREATED',
    ST_GeomFromText('POINT(88.3639 22.5726)', 4326)::geography,
    ST_GeomFromText('POINT(88.3700 22.5800)', 4326)::geography,
    '88754cb247fffff',
    1.00,
    35000
);
'@

$sql | & $kubectl exec -i -n dispatch postgresql-0 -- psql -U postgres -d delivery_platform
if ($LASTEXITCODE -ne 0) {
    Write-Error "PostgreSQL seeding failed."
    Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 1
}
Write-Host "  Database seeded successfully"

# 7. Start Telemetry Ingestion and Dispatch Matcher services
Write-Host "Booting services..."

$ingestionWrapper = @"
`$env:DATABASE_URL        = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
`$env:REDIS_CLUSTER_NODES = "127.0.0.1:6379"
`$env:KAFKA_BROKERS       = "localhost:19092"
`$env:GRPC_PORT           = "50051"
`$env:REDIS_IP_MAP        = "$($env:REDIS_IP_MAP)"
& "C:\workspace\Driver\bin\ingestion.exe"
"@
$ingestionWrapper | Out-File -FilePath "C:\workspace\Driver\bin\run-ingestion.ps1" -Encoding UTF8 -Force

$dispatchWrapper = @"
`$env:DATABASE_URL        = "postgres://postgres:password@localhost:5432/delivery_platform?sslmode=disable"
`$env:REDIS_CLUSTER_NODES = "127.0.0.1:6379"
`$env:KAFKA_BROKERS       = "localhost:19092"
`$env:ALGORITHM_STRATEGY  = "GREEDY"
`$env:TRITON_SERVER_ADDR  = "127.0.0.1:8001"
`$env:TRITON_SERVER_URL   = "127.0.0.1:8001"
`$env:REDIS_IP_MAP        = "$($env:REDIS_IP_MAP)"
`$env:OSM_NODES_DATA_PATH  = "nonexistent_nodes.csv"
`$env:OSM_EDGES_DATA_PATH  = "nonexistent_edges.csv"
& "C:\workspace\Driver\bin\dispatch.exe"
"@
$dispatchWrapper | Out-File -FilePath "C:\workspace\Driver\bin\run-dispatch.ps1" -Encoding UTF8 -Force

# Start processes
$ingestionProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File C:\workspace\Driver\bin\run-ingestion.ps1" `
    -WindowStyle Hidden `
    -RedirectStandardOutput "C:\workspace\Driver\bin\ingestion.log" `
    -RedirectStandardError "C:\workspace\Driver\bin\ingestion-err.log" `
    -PassThru

$dispatchProc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File C:\workspace\Driver\bin\run-dispatch.ps1" `
    -WindowStyle Hidden `
    -RedirectStandardOutput "C:\workspace\Driver\bin\dispatch.log" `
    -RedirectStandardError "C:\workspace\Driver\bin\dispatch-err.log" `
    -PassThru

Write-Host "  Waiting 8s for services to initialize..."
Start-Sleep -Seconds 8

# Verify ingestion service gRPC port is listening
$tcp = New-Object System.Net.Sockets.TcpClient
$gRPCOpen = $false
try {
    $tcp.Connect("127.0.0.1", 50051)
    Write-Host "  Telemetry Ingestion gRPC Port 50051: OPEN"
    $gRPCOpen = $true
} catch {
    Write-Host "  Telemetry Ingestion gRPC Port 50051: CLOSED"
} finally { $tcp.Dispose() }

if (-not $gRPCOpen) {
    Write-Host "=== Ingestion Log Output (Error) ==="
    Get-Content "C:\workspace\Driver\bin\ingestion.log" -ErrorAction SilentlyContinue | Select-Object -Last 15
    Get-Content "C:\workspace\Driver\bin\ingestion-err.log" -ErrorAction SilentlyContinue | Select-Object -Last 15
    
    Write-Host "=== Dispatch Log Output (Error) ==="
    Get-Content "C:\workspace\Driver\bin\dispatch.log" -ErrorAction SilentlyContinue | Select-Object -Last 15
    Get-Content "C:\workspace\Driver\bin\dispatch-err.log" -ErrorAction SilentlyContinue | Select-Object -Last 15

    Write-Host "Stopping and cleanup..."
    if ($ingestionProc) { Stop-Process -Id $ingestionProc.Id -Force -ErrorAction SilentlyContinue }
    if ($dispatchProc) { Stop-Process -Id $dispatchProc.Id -Force -ErrorAction SilentlyContinue }
    Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 1
}

# 8. Run the simulator to drive gRPC telemetry stream and push order.created to Kafka
Write-Host "Running E2E Simulator..."
& $go run cmd/simulator/main.go
$simCode = $LASTEXITCODE

Write-Host "Waiting 5s for batch matching window (300ms) + DB commit..."
Start-Sleep -Seconds 5

# 9. Verify PostgreSQL Database State
Write-Host "=== PostgreSQL Verification ==="
& $kubectl exec -n dispatch postgresql-0 -- psql -U postgres -d delivery_platform -c "SELECT id, status, assigned_driver_id, assigned_at FROM orders WHERE id = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';"
& $kubectl exec -n dispatch postgresql-0 -- psql -U postgres -d delivery_platform -c "SELECT order_id, algorithm_used, chosen_driver_id, computed_eta_seconds, assignment_score FROM dispatch_match_logs ORDER BY id DESC LIMIT 1;"

# 10. Clean up background tasks
Write-Host "Terminating background service instances..."
if ($ingestionProc) { Stop-Process -Id $ingestionProc.Id -Force -ErrorAction SilentlyContinue }
if ($dispatchProc) { Stop-Process -Id $dispatchProc.Id -Force -ErrorAction SilentlyContinue }

# 11. Run Go E2E Integration Test Suite (Ports 50051, 5432, 19092 are open, background apps are down)
Write-Host "Running Go E2E Integration Test Suite..."
& $go test -v -tags=integration ./test/integration/...
$testCode = $LASTEXITCODE

Write-Host "Running Phase 2 E2E Validation Runner..."
& $go test -v ./internal/test/...
$test2Code = $LASTEXITCODE

# 12. Clean up port forwards
Write-Host "Terminating port forwards..."
Get-Process | Where-Object { $_.Name -eq "kubectl" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "======================================================"
if ($simCode -eq 0 -and $testCode -eq 0 -and $test2Code -eq 0) {
    Write-Host "  Smoke Integration Test, Go Integration, & E2E Validation Suite Finalized: SUCCESS"
} else {
    Write-Host "  E2E Validation Failed: (Simulator: $simCode, GoTest: $testCode, E2ETest: $test2Code)"
    exit 1
}
Write-Host "======================================================"
