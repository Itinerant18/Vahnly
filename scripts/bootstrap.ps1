#requires -Version 5.1
<#
.SYNOPSIS
    Drivers-for-u one-shot local bootstrap. Brings up the full Docker Compose
    stack (Postgres, Kafka, 6-shard Redis, Triton, all 11 Go services) and
    prints a connection map. Idempotent: safe to re-run.

.DESCRIPTION
    1. Verifies Go 1.25+, Docker 24+ with Compose v2, Node 20+, PowerShell 5.1+
    2. Loads .env into the current shell
    3. Tears down any prior compose stack
    4. docker compose up -d --build (services start in dependency order)
    5. Waits for db-migrator to complete
    6. Generates REDIS_IP_MAP if absent
    7. Prints the connection map

.EXAMPLE
    powershell ./scripts/bootstrap.ps1
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild,           # Skip the --build flag (faster on no-code-change re-runs)
    [switch]$SkipSeed,            # Don't run bin/seed.sql afterwards
    [int]$WaitSeconds = 120       # Max seconds to wait for db-migrator
)

$ErrorActionPreference = 'Stop'
$Script:Root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $Script:Root

# ── 1. Pre-flight checks ──────────────────────────────────────────────────────
function Assert-Tool {
    param([string]$Name, [string]$MinVersion, [scriptblock]$VersionGetter)
    $ver = & $VersionGetter 2>$null
    if (-not $ver) {
        Write-Error "[FAIL] $Name not found on PATH. Install $MinVersion or newer."
        exit 1
    }
    Write-Host "  [OK]  $Name -> $ver"
}

Write-Host "==> Verifying prerequisites..."
Assert-Tool 'go'         '1.25.0'    { go version }
Assert-Tool 'docker'     '24.0'      { docker --version }
Assert-Tool 'docker'     'Compose v2' { docker compose version }
Assert-Tool 'node'       '20.0'      { node --version }
Assert-Tool 'powershell' '5.1'       { $PSVersionTable.PSVersion.ToString() }


# ── 2. .env file ─────────────────────────────────────────────────────────────
if (-not (Test-Path '.env')) {
    if (Test-Path '.env.example') {
        Copy-Item '.env.example' '.env'
        Write-Host "==> Created .env from .env.example (edit it to change secrets)."
    } else {
        Write-Error "[FAIL] .env.example missing. Re-clone the repo."
        exit 1
    }
}

# Load .env into current process. PowerShell 7+ has ConvertFrom-StringData but
# the simpler way is to set each KEY=VALUE line as an env var if not already set.
Get-Content '.env' | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $parts = $line -split '=', 2
    if ($parts.Count -ne 2) { return }
    $key = $parts[0].Trim()
    $val = $parts[1].Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($key)) {
        [Environment]::SetEnvironmentVariable($key, $val, 'Process')
    }
}

# ── 3. Tear down any prior state ─────────────────────────────────────────────
Write-Host "==> Tearing down any prior stack (this is safe)..."
try { docker compose down -v 2>&1 | Out-Null } catch { <# no prior stack — fine #> }
Get-Process | Where-Object { $_.Name -eq 'kubectl' } | Stop-Process -Force -ErrorAction SilentlyContinue
# Stop the local Windows Postgres service if it's hogging 5432.
try { Stop-Service -Name 'postgresql*' -ErrorAction SilentlyContinue } catch { }

# ── 4. Bring up ──────────────────────────────────────────────────────────────
$composeArgs = @('up', '-d')
if (-not $SkipBuild) { $composeArgs += '--build' }
Write-Host "==> docker compose $($composeArgs -join ' ')..."
docker compose @composeArgs

# ── 5. Wait for db-migrator ──────────────────────────────────────────────────
Write-Host "==> Waiting up to $WaitSeconds s for db-migrator to finish..."
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$migratorDone = $false
while ((Get-Date) -lt $deadline) {
    $stateJson = docker compose ps -a db-migrator --format json 2>$null
    if ($stateJson) {
        $state = $stateJson | ConvertFrom-Json -ErrorAction SilentlyContinue
        if ($state) {
            $targetState = if ($state -is [array]) { $state[0] } else { $state }
            if ($targetState.State -eq 'exited' -and $targetState.ExitCode -eq 0) {
                $migratorDone = $true
                break
            }
        }
    }
    Start-Sleep -Seconds 2
}
if (-not $migratorDone) {
    Write-Warning "[WARN] db-migrator did not finish in $WaitSeconds s. Check 'docker compose logs db-migrator'."
} else {
    Write-Host "  [OK]  db-migrator completed."
}

# ── 6. Generate REDIS_IP_MAP if absent ───────────────────────────────────────
if (-not $env:REDIS_IP_MAP) {
    Write-Host "==> Generating REDIS_IP_MAP from running Redis containers..."
    $ipMap = @()
    $port = 6379
    for ($i = 1; $i -le 6; $i++) {
        $name = "driver-redis-node-$i"
        $ip = docker inspect -f '{{.NetworkSettings.Networks.dispatch_network.IPAddress}}' $name 2>$null
        if ($ip) {
            $ipMap += "${ip}:6379=127.0.0.1:${port}"
            $port++
        }
    }
    if ($ipMap.Count -eq 6) {
        $env:REDIS_IP_MAP = $ipMap -join ','
        # Persist to .env so other shells inherit it
        (Get-Content '.env') -replace '^REDIS_IP_MAP=.*$', "REDIS_IP_MAP=$env:REDIS_IP_MAP" | Set-Content '.env'
        Write-Host "  [OK]  REDIS_IP_MAP written to .env"
    } else {
        Write-Warning "[WARN] Could not auto-detect Redis IPs. The cluster bootstrap may still be in progress."
    }
}

# ── 7. Optional seed ─────────────────────────────────────────────────────────
if (-not $SkipSeed) {
    Write-Host "==> Applying bin/seed.sql (idempotent)..."
    $pgPass = $env:POSTGRES_PASSWORD
    $env:PGPASSWORD = $pgPass
    try {
        if (Get-Command psql -ErrorAction SilentlyContinue) {
            psql -h localhost -p 5432 -U postgres -d delivery_platform -f bin/seed.sql 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  [OK]  Seed applied (via host psql)."
            } else {
                Write-Warning "[WARN] psql seed returned non-zero. Likely already seeded."
            }
        } else {
            Write-Host "  psql not on host PATH. Trying to seed via Docker container..."
            Get-Content bin/seed.sql -Raw | docker compose exec -T spatial-db psql -U postgres -d delivery_platform 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  [OK]  Seed applied (via docker compose exec)."
            } else {
                Write-Warning "[WARN] Docker-based psql seed returned non-zero. Likely already seeded."
            }
        }
    } catch {
        Write-Warning "[WARN] Failed to apply seed: $_"
    }
}

# ── 8. Print connection map ──────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================================================="
Write-Host " Drivers-for-u stack is up."
Write-Host "=========================================================================="
Write-Host "  PostgreSQL     -> localhost:5432  (user=postgres db=delivery_platform)"
Write-Host "  Kafka EXTERNAL -> localhost:19092 (use INTERNAL 9092 from inside compose)"
Write-Host "  Redis cluster  -> 127.0.0.1:6379..6384 (3P+3R)"
Write-Host "  Triton gRPC    -> 127.0.0.1:8001  (HTTP 8000, metrics 8002)"
Write-Host "  Gateway HTTP   -> localhost:8080  (/health /ready /metrics)"
Write-Host "  Ingestion gRPC -> localhost:50051 (ClientStreamPositions)"
Write-Host "  Analytics SSE  -> localhost:8089  (/api/v1/analytics/heatmap/stream)"
Write-Host ""
Write-Host " Smoke test:"
Write-Host "   curl http://localhost:8080/health"
Write-Host "   go run ./cmd/simulator"
Write-Host "   go test -v -tags=integration ./test/integration/..."
Write-Host ""
Write-Host " Tear down:"
Write-Host "   pwsh ./scripts/teardown.ps1"
Write-Host "=========================================================================="
