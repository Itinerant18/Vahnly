# Backend Test Coverage

How the Go backend is tested, what runs where, and how to read the coverage gate.

## Conventions (read before adding tests)

- **Standard library `testing` only.** No `testify`, no `testcontainers-go`, no `gomock`.
  Mocks are hand-written fakes that satisfy small local interfaces (see
  `internal/rider/service/auth_service_test.go` for the canonical pattern). New tests
  must match this — do not add a mocking/container dependency to `go.mod`.
- **Two test tiers, distinguished by infra need:**
  - *Pure / algorithmic* — no Postgres/Redis/Kafka. Deterministic in CI. These are the
    gated packages below.
  - *Infra-gated integration* — talk to a live Postgres/Redis/Kafka. They **skip**
    (not fail) when the dependency is absent, via a ping-with-timeout guard
    (`setupTestRedis`, `SetupTestDB`-style helpers, the `internal/test/e2e_*` suite).
    Without infra they report ~0% and are reported, not enforced.

## Why some "money" packages read low without infra

`internal/pricing/service` and several handlers hold their state behind a **concrete**
`*redis.ClusterClient` / `*pgxpool.Pool` rather than an interface, so the surge-read and
ledger-write paths can only be exercised with a live cluster. To keep the critical
*formulas* testable headless, the side-effect-free math is extracted into pure helpers
that have their own unit tests:

| Formula | Pure helper | Unit test |
|---|---|---|
| Fare = (base + perMeter·dist) × surge | `computeFarePaise` (`order_pricing_service.go`) | `fare_math_test.go` |
| Promo discount (FLAT/PERCENT/cap/floor) | `computeDiscount` (`promo_repo.go`) | `promo_discount_test.go` |
| Tiered commission take-rate | `takeRatePctForCompletedTrips` (`driver_trip_handler.go`) | `ledger_split_test.go` |
| Double-entry split (driver + commission = total) | `driverLedgerSplit` (`driver_trip_handler.go`) | `ledger_split_test.go` |
| Odometer variance % + auto-flag threshold | `odometerVariancePct` / `odometerFlagged` (`odometer_writer_handler.go`) | `odometer_variance_test.go` |

The surrounding Redis/DB wiring for those same paths is covered by the infra-gated
suites (`order_pricing_service_test.go`, `internal/test/e2e_odometer_audit_test.go`,
`test/integration/dispatch_e2e_test.go`).

## Running

```bash
# Gate + report (no infra needed; gated packages run headless)
pwsh scripts/coverage.ps1          # Windows
scripts/coverage.sh                # Linux/CI
scripts/coverage.ps1 -Html         # also write coverage.html

# Full numbers for the infra-gated tiers — start dependencies first:
docker compose up -d postgres redis kafka
go test ./... -coverprofile=coverage.out && go tool cover -func=coverage.out
```

> Note: `internal/pricing/service` is slow (~150s) without Redis — the cluster client
> spends its dial budget before the skip guard trips. Bring Redis up to make it fast.

## Coverage gate (`scripts/coverage.{ps1,sh}`)

**Enforced** (hard floor, fails CI on a drop) — pure, infra-free, the dispatch + surge
cores:

| Package | Min | Current |
|---|---|---|
| `internal/dispatch/matcher` | 75% | 95.3% |
| `internal/pricing/surge` | 90% | 100% |

**Reported** (printed, not enforced — would flake headless): `internal/rider/service`,
`internal/pricing/service`, `internal/rider/repository`, `internal/gateway/delivery/http`.

## Critical-path status

The brief's "must be 100% covered" paths and where they live:

- **Fare formula** — `computeFarePaise` ✅ pure-tested; surge wiring ✅ infra-gated.
- **Double-entry ledger** — `driverLedgerSplit` ✅ pure-tested incl. the
  `driver + commission == total` balance invariant; ledger INSERTs ✅ infra-gated.
- **OTP verify + JWT** — `auth_service_test.go` ✅ (issue→verify round-trip, tampered
  token rejection, session-jti revocation).
- **Odometer variance** — `odometerVariancePct`/`odometerFlagged` ✅ pure-tested against
  the worked example (70km→91km expected; 9.9% within, 31.9% flagged); the
  `payout_hold` write ✅ infra-gated (`e2e_odometer_audit_test.go`).

## Not tested — feature does not exist yet

These items from the original test brief describe behaviour the code does **not**
implement; there is nothing to assert until the feature lands:

- Rich fare engine (round-trip hours, night charge, D4M-Care ₹49 add-on, promo applied
  inside the fare) — the live engine is `base + perMeter·distance × surge` only.
- Matcher eligibility gates on **transmission match** and **rating threshold** —
  `CandidateDriver` carries neither field (deferred: matcher plumbing / FLOW 1).
