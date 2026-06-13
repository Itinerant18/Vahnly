# Provisioning rider tokens for load tests

## Why this step exists

Rider auth is OTP-based (`internal/rider/service/auth_service.go`):

- `SendOTP` generates a **crypto-random 6-digit** code, stores it **bcrypt-hashed**, and
  delivers it only through `LogSMSSender` — i.e. it is written to the **gateway log**
  (`[RIDER_SMS] OTP for <phone> is <otp>`) and **never returned by the API**.
- There is **no test/dev bypass** (no fixed `000000`, no env flag).

So a rider JWT cannot be minted from inside k6. You must pre-provision a pool of rider
tokens and pass it to the scripts via `-e RIDER_TOKENS_FILE=tokens.json`.

**How many?** Each rider may hold only **one active order at a time**
(`booking_service.go:259`). Provision **one distinct rider per concurrent VU**:
- `booking-flow.js`: ≥ `MAX_VUS` (default 200; 50 for a scaled-down run).
- `dispatch-rush.js`: ≥ peak concurrent rider VUs (start with ~120).
- `websocket-stress.js`: ideally ≥ `WS_CONNS` (500), though tokens can be reused for WS since
  holding a socket doesn't create an active order.

## `tokens.json` format

Either form is accepted by `lib/auth.js`:

```json
["eyJhbGciOi...JWT1", "eyJhbGciOi...JWT2"]
```
```json
[{ "token": "eyJhbGciOi...JWT1" }, { "token": "eyJhbGciOi...JWT2" }]
```

## Option A — log-scrape (simplest; good for ≤ ~50 riders / scaled-down runs)

The OTP is only emitted to the gateway log, so this approach calls `send-otp`, scrapes the
code from the log, then calls `verify-otp`. Phones must be unique E.164 Indian mobiles
(`+91[6-9]XXXXXXXXX`); OTP send is rate-limited to 5/phone/hour, so one OTP per phone is fine.

### Recommended: `provision-riders.ps1` (Windows-native, no curl)

```powershell
# from repo root, where you can read the gateway's stdout log
load-tests\provision\provision-riders.ps1 `
  -GatewayLog C:\path\to\gateway.log -Count 50 -OutFile tokens.json
# then:
k6 run -e BASE_URL=http://localhost:8085 -e RIDER_TOKENS_FILE=tokens.json load-tests\booking-flow.js
```

It uses `Invoke-RestMethod` (no curl dependency), does a fast `/health` pre-check, retries
past per-phone failures, and writes a clean JSON string array. `-GatewayLog` must point at
wherever the gateway writes the `[RIDER_SMS] OTP for <phone> is <otp>` lines.

### Alternative: bash + curl (non-Windows)

```bash
BASE=http://localhost:8085
GATEWAY_LOG=/path/to/gateway.log
N=50
echo "[" > tokens.json
for i in $(seq 1 $N); do
  PHONE="+918$(printf '%09d' $i)"
  curl -s -XPOST $BASE/api/v1/rider/auth/send-otp -H 'Content-Type: application/json' \
       -d "{\"phone\":\"$PHONE\"}" >/dev/null
  sleep 1
  OTP=$(grep "OTP for $PHONE is" "$GATEWAY_LOG" | tail -1 | grep -oE '[0-9]{6}$')
  TOKEN=$(curl -s -XPOST $BASE/api/v1/rider/auth/verify-otp -H 'Content-Type: application/json' \
       -d "{\"phone\":\"$PHONE\",\"otp\":\"$OTP\"}" | python -c "import sys,json;print(json.load(sys.stdin)['data']['token'])")
  printf '%s"%s"' "$([ $i -gt 1 ] && echo ,)" "$TOKEN" >> tokens.json
done
echo "]" >> tokens.json
```

> Note: `curl` is blocked inside the Claude Code assistant session on this machine, so run
> this provisioner yourself in a normal terminal (or substitute `k6`/PowerShell
> `Invoke-RestMethod`).

## Option B — direct session mint (for full-scale 200–500 rider pools)

Log-scraping hundreds of OTPs is slow. For large pools, mint sessions directly using the
existing rider auth internals. A rider JWT is HS256 signed with `JWT_SECRET_SIGNING_KEY`
(dev default `change-me-in-prod-this-is-a-dev-only-hs256-key`) and is only accepted if its
`jti` matches the Redis session key `rider:session:{riderID}` (`auth_service.go`). So a valid
token requires: (1) a `riders` row, (2) a Redis session entry, (3) a JWT whose `jti` matches.

Write a small Go provisioner (e.g. `cmd/loadgen-provision/main.go`) that reuses
`internal/rider/service` to create N riders and call the same session-minting path the
handler uses, then dumps `tokens.json`. This reuses verified code instead of hand-rolling the
session/JWT shape. Claims for reference (`auth_service.go`):

```
{ user_id, role:"RIDER", city_scope, jti:<session-uuid>, sub:user_id,
  exp, iat, iss:"drivers-for-u-rider-auth" }   // TTL 72h
```

This is the recommended path for a real 200-driver / 500-booking rush run.
