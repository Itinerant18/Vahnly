#requires -Version 7.0
<#
.SYNOPSIS
    Drivers-for-u teardown helper. Stops all services, removes containers and
    volumes. Safe to re-run.

.EXAMPLE
    pwsh ./scripts/teardown.ps1
#>

[CmdletBinding()]
param(
    [switch]$KeepVolumes   # If set, postgres/redis data is preserved
)

$ErrorActionPreference = 'Stop'
$Script:Root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $Script:Root

Write-Host "==> Stopping Docker Compose stack..."
if ($KeepVolumes) {
    docker compose down
} else {
    docker compose down -v
}

Write-Host "==> Killing any leftover port-forward processes..."
Get-Process | Where-Object { $_.Name -eq 'kubectl' } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "  [OK] Teardown complete."
