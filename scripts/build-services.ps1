#requires -Version 7.0
<#
.SYNOPSIS
    Cross-compile all 14 Go service binaries into ./bin/.

.EXAMPLE
    pwsh ./scripts/build-services.ps1
#>

[CmdletBinding()]
param(
    [string]$OutputDir = "$PSScriptRoot\..\bin",
    [string]$GoArch    = "amd64",
    [string]$GoOS      = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows) ? "windows" : "linux"
)

$ErrorActionPreference = 'Stop'
$Script:Root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $Script:Root

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir | Out-Null }

$env:GOOS   = $GoOS
$env:GOARCH = $GoArch
$env:CGO_ENABLED = "1"   # required for h3-go

$services = @(
    'dispatch', 'ingestion', 'gateway', 'reconciler', 'pruner', 'expiry',
    'rebalancer', 'surge', 'pricing', 'notification', 'analytics',
    'simulator', 'migrate', 'osm-preprocessor'
)

foreach ($svc in $services) {
    $ext = if ($GoOS -eq 'windows') { '.exe' } else { '' }
    $out = Join-Path $OutputDir "$svc$ext"
    Write-Host "  [BUILD] $svc -> $out"
    go build -o $out "./cmd/$svc"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed for $svc"
        exit 1
    }
}

Write-Host "==> All 14 binaries built into $OutputDir"
