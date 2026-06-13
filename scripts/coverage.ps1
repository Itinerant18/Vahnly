#!/usr/bin/env pwsh
# Backend test-coverage gate. Run from anywhere:
#   pwsh scripts/coverage.ps1            # gate + report
#   pwsh scripts/coverage.ps1 -Html      # also emit coverage.html
#
# GATED packages are pure/algorithmic — they run deterministically in CI with NO
# external infra (no Postgres/Redis/Kafka). Their coverage is a hard floor; the script
# exits 1 if any drops below target.
#
# REPORTED packages carry the money/auth logic but many of their suites SKIP without a
# live Postgres/Redis (concrete clients, not interfaces — see DOC/TEST_COVERAGE.md), so
# gating them would flake in a headless runner. Numbers are printed for visibility.
[CmdletBinding()]
param([switch]$Html)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$gates = [ordered]@{
    'internal/dispatch/matcher' = 75
    'internal/pricing/surge'    = 90
}
$reported = @(
    'internal/rider/service'
    'internal/pricing/service'
    'internal/rider/repository'
    'internal/gateway/delivery/http'
)

$profile = 'coverage.out'
$pkgs = @($gates.Keys) + $reported | ForEach-Object { "./$_" }

Write-Host "==> go test (coverage) over $($pkgs.Count) package(s)..." -ForegroundColor Cyan
$out = & go test @pkgs "-coverprofile=$profile" -covermode=set 2>&1
$out | ForEach-Object { Write-Host $_ }

$cov = @{}
foreach ($line in $out) {
    if ($line -match 'driver-delivery/(internal/[^\s]+).*coverage:\s+([\d.]+)% of statements') {
        $cov[$Matches[1]] = [double]$Matches[2]
    }
}

Write-Host "`n==> Coverage gate" -ForegroundColor Cyan
$fail = $false
foreach ($g in $gates.Keys) {
    $have = $cov[$g]
    $min = $gates[$g]
    if ($null -eq $have) {
        Write-Host ("{0,-6} {1,-36} (no result)" -f 'FAIL', $g) -ForegroundColor Red
        $fail = $true
        continue
    }
    if ($have -ge $min) {
        Write-Host ("{0,-6} {1,-36} {2,6}%  (min {3}%)" -f 'PASS', $g, $have, $min) -ForegroundColor Green
    } else {
        Write-Host ("{0,-6} {1,-36} {2,6}%  (min {3}%)" -f 'FAIL', $g, $have, $min) -ForegroundColor Red
        $fail = $true
    }
}

Write-Host "`n==> Reported (infra-gated, not enforced)" -ForegroundColor Cyan
foreach ($r in $reported) {
    $have = if ($null -ne $cov[$r]) { "$($cov[$r])%" } else { 'n/a' }
    Write-Host ("       {0,-36} {1,7}" -f $r, $have)
}

if ($Html) {
    & go tool cover "-html=$profile" -o coverage.html
    Write-Host "`nWrote coverage.html"
}

if ($fail) {
    Write-Host "`nCoverage gate FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "`nCoverage gate passed" -ForegroundColor Green
