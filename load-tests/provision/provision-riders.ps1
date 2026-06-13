<#
.SYNOPSIS
  Option A rider-token provisioner for the k6 load suite (log-scrape).

.DESCRIPTION
  Rider auth is OTP-based with no test bypass: SendOTP writes a crypto-random 6-digit code
  to the gateway log via LogSMSSender ("[RIDER_SMS] OTP for <phone> is <otp>") and never
  returns it from the API. This script, for each synthetic rider, calls send-otp, scrapes the
  code from the gateway log, calls verify-otp, and collects the returned JWT into tokens.json
  for `k6 run -e RIDER_TOKENS_FILE=tokens.json ...`.

  Best for <= ~50 riders (scaled-down runs). For full 200-500 scale, mint sessions directly
  (see provision-rider-tokens.md, Option B).

.PARAMETER GatewayLog
  Path to the gateway's stdout log file (where [RIDER_SMS] lines appear). Required.

.EXAMPLE
  ./provision-riders.ps1 -GatewayLog C:\logs\gateway.log -Count 50 -OutFile tokens.json
#>
[CmdletBinding()]
param(
  [string]$BaseUrl = 'http://localhost:8085',
  [Parameter(Mandatory = $true)][string]$GatewayLog,
  [int]$Count = 50,
  [string]$OutFile = 'tokens.json',
  [string]$PhonePrefix = '+918',   # +91 then leading digit 8 (must be 6-9), then 9 digits
  [int]$StartIndex = 1,
  [int]$DelayMs = 1200             # gap between send-otp and log scrape
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $GatewayLog)) {
  throw "Gateway log not found: $GatewayLog. Point -GatewayLog at the gateway's stdout log."
}

# Quick reachability check so we fail fast instead of mid-loop.
try {
  Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" -TimeoutSec 5 | Out-Null
} catch {
  Write-Warning "Gateway at $BaseUrl/health not reachable ($($_.Exception.Message)). Start it first."
}

$headers = @{ 'Content-Type' = 'application/json' }
$tokens = New-Object System.Collections.Generic.List[string]
$failures = 0

for ($i = $StartIndex; $i -lt ($StartIndex + $Count); $i++) {
  $phone = $PhonePrefix + ($i.ToString('D9'))

  # 1. Request an OTP.
  try {
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/rider/auth/send-otp" `
      -Headers $headers -Body (@{ phone = $phone } | ConvertTo-Json) -TimeoutSec 10 | Out-Null
  } catch {
    Write-Warning "[$phone] send-otp failed: $($_.Exception.Message)"
    $failures++; continue
  }

  Start-Sleep -Milliseconds $DelayMs

  # 2. Scrape the most recent OTP for this phone from the gateway log.
  $pattern = "OTP for $([regex]::Escape($phone)) is (\d{6})"
  $match = Get-Content -Path $GatewayLog -Tail 4000 |
           Select-String -Pattern $pattern | Select-Object -Last 1
  if (-not $match) {
    Write-Warning "[$phone] no OTP line found in $GatewayLog (is the log path correct / SMS stub logging?)."
    $failures++; continue
  }
  $otp = $match.Matches[0].Groups[1].Value

  # 3. Verify and capture the JWT.
  try {
    $resp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/rider/auth/verify-otp" `
      -Headers $headers -Body (@{ phone = $phone; otp = $otp } | ConvertTo-Json) -TimeoutSec 10
    $token = $resp.data.token
    if ([string]::IsNullOrWhiteSpace($token)) { throw "empty token in response" }
    $tokens.Add($token)
    Write-Host ("[{0}/{1}] {2} -> token acquired" -f $tokens.Count, $Count, $phone)
  } catch {
    Write-Warning "[$phone] verify-otp failed: $($_.Exception.Message)"
    $failures++; continue
  }
}

if ($tokens.Count -eq 0) {
  throw "Provisioned 0 tokens ($failures failures). Check gateway, log path, and rate limits."
}

# Write a JSON array of strings (deterministic; avoids ConvertTo-Json single-element quirks).
$json = '[' + (($tokens | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']'
Set-Content -Path $OutFile -Value $json -Encoding UTF8

Write-Host ""
Write-Host "Wrote $($tokens.Count) tokens to $OutFile ($failures failures)."
Write-Host "Run: k6 run -e BASE_URL=$BaseUrl -e RIDER_TOKENS_FILE=$OutFile load-tests/booking-flow.js"
