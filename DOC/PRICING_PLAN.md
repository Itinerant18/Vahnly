# Vahnly Pricing Plan — Tiered Rate Table (in depth)

Status: **PROPOSAL / planning**. Not yet implemented. Grounded in the current code
(file:line refs below). Rates in **paise** internally; ₹ in copy.

---

## 1. Current state — two disconnected pricing worlds

| World | What it has | Where | Problem |
| :-- | :-- | :-- | :-- |
| **Admin pricing config** | Per-`(city × car_type × trip_type)`: base, per-km, per-min, min, **night charge**, wait, cancel fees, D4M, platform/convenience/tax, **outstation per-day / per-km-outside / driver-allowance / night-halt**, versioning + revert | `frontend/src/admin/pages/PricingDashboard.tsx`, `internal/admin/.../pricing_handler.go` | **Redis-only** (`pricing:fare:active:<city>:<car>:<trip>`), no DB table, no seed → lost on flush. **Booking never reads it.** |
| **Rider booking engine** (what actually prices) | Hardcoded constants + env `PKG_*`; **flat per package, no vehicle tier** | `booking_service.go:49-56,142-258`, `package_pricing.go:24-52` | No tier differentiation; ignores admin config; placeholder rates. |

**The defect is one sentence:** `BookingService.EstimateFare` (`booking_service.go:142`) never reads the
admin rate config. The rate "table" already exists in the admin surface — booking just doesn't consult it.

So the plan's backbone is **close the booking ↔ rate-config gap + seed it**, *not* design a new rate store.

---

## 2. Trip-type taxonomy (existing — reuse, don't reinvent)

`trip_type` values already shipped (`types.ts:4-10`, migration `000118`, KOL seed `000119`):

```
IN_CITY_ONE_WAY · IN_CITY_ROUND · IN_CITY_HOURLY · MINI_OUTSTATION · OUTSTATION · MONTHLY
```

Vehicle tiers already shipped (`types.ts:17`, rider garage `car_type`, admin `carTypes`):

```
HATCHBACK · SEDAN · SUV · PREMIUM
```

Mapping the user's spec onto this taxonomy:

| User term | Maps to | Pricing model |
| :-- | :-- | :-- |
| **Inter-city, ≤100 km, "6hrs"** | `MINI_OUTSTATION` | **fixed-duration block** per tier (₹/6h) + overtime/hr |
| **Outstation / whole-day** (>100 km or multi-day) | `OUTSTATION` | **per-day** per tier + night-halt + food/lodging in-kind |
| In-city hourly | `IN_CITY_HOURLY` | per-hour per tier, min hours (existing HOURLY) |
| In-city point-to-point | `IN_CITY_ONE_WAY` / `IN_CITY_ROUND` | distance-metered (existing) |
| Monthly | `MONTHLY` | flat/month per tier |

---

## 3. Eligibility gate — distance is NOT pricing

"Inter-city **if within 100 km**" is an **eligibility rule**, not a price input (packages are flat, not
metered). `EstimateFare` already computes haversine road distance (`booking_service.go:193-200`), so add a
pure gate:

```
distance_km = haversine(pickup, dropoff) * roadFactor(1.3) / 1000
≤ 100 km  → offer MINI_OUTSTATION (6h inter-city block) + IN_CITY_*
> 100 km  → offer OUTSTATION (per-day) only; reject MINI_OUTSTATION
```

Surface as `eligible_trip_types` in the fare-estimate / city-config response so the booking picker only
shows valid options. (City `supported_trip_types` stays the city-level allow-list; this is the
per-trip distance filter on top.)

---

## 4. The rate table

Keyed by **(city, vehicle_tier, trip_type)**. Values below: **bold = given by user**, *italic = placeholder,
confirm*. All per-city (KOL first).

### 4a. MINI_OUTSTATION — inter-city ≤100 km, 6-hour block

| Tier | Block (6h) | Overtime /hr | Incl. km* |
| :-- | --: | --: | --: |
| HATCHBACK | **₹450** | **₹50** | *100* |
| SEDAN | *₹500* | **₹50** | *100* |
| SUV | **₹550** | **₹50** | *100* |
| PREMIUM | *₹650* | **₹50** | *100* |

\* incl-km cap per block — confirm whether the 6h block also caps km (e.g. 100 km) with an extra-km charge
beyond, or is purely time-based. Default assumption: **purely time-based**, 100 km is only the
inter-city eligibility ceiling.

- **Block** = flat fare for up to 6h. **Overtime** = `+₹50 × ceil(hours − 6)` for each hour past 6.
- ₹450 / 6h = **₹75/hr effective** — this is a *fresh* card; the old `PKG_*` placeholders (₹150/hr) and
  `package_pricing_test.go` get rewritten to these numbers (see §7).

### 4b. OUTSTATION — whole-day / multi-day (>100 km) — **PROPOSED, confirm rates**

Skeleton from existing `OUTSTATION` (`package_pricing.go:36-44`): per-day, 12h/day, ceil days, night-halt.

| Tier | Per day (12h) | Night-halt /night | Extra hr /hr |
| :-- | --: | --: | --: |
| HATCHBACK | *₹1500* | *₹300* | **₹50** |
| SEDAN | *₹1700* | *₹300* | **₹50** |
| SUV | *₹2000* | *₹300* | **₹50** |
| PREMIUM | *₹2500* | *₹400* | **₹50** |

```
days       = ceil(duration_hours / 12)
day_fare   = per_day[tier] × days
halt       = night_halt[tier] × (days − 1)        # one halt per overnight
food/lodging = rider provides in-kind (see §5.3) — NOT a cash line by default
total      = day_fare + halt + night_surcharge(§5.2) + overtime(extra hours)
```

### 4c. Other tiers (carry existing, re-tier later)

- `IN_CITY_HOURLY`: per-hour per tier, min 2h (existing HOURLY skeleton). *Rates TBD per tier.*
- `IN_CITY_ONE_WAY` / `IN_CITY_ROUND`: distance-metered (existing base + per-km), now **per-tier** base/per-km
  (admin already models this). *Rates TBD.*
- `MONTHLY`: flat/month per tier. *Rates TBD.*

---

## 5. Surcharge rules (precise)

### 5.1 Overtime
`+₹50/hr` for each hour beyond the package's included hours (6h for MINI_OUTSTATION, 12h/day for OUTSTATION).
Flat across tiers unless per-tier overtime is wanted (default: flat ₹50). New breakdown field
`overtime_paise` (§6).

### 5.2 Night charge (one-time, IST) — **tiered-replacement assumed, confirm**
Applies when the booked work window crosses these IST thresholds (based on `scheduled_at`/now, the existing
night-window logic at `booking_service.go:212-219`):

| Window (IST) | Surcharge |
| :-- | --: |
| 23:00 – 23:59 | **+₹50** |
| ≥ 00:00 (past midnight) | **+₹100** |

**Assumption: tiered-replacement** — a trip into the early hours pays ₹100, *not* ₹50+₹100. Confirm vs
cumulative. Reuses the existing `night_charge_paise` field (currently a flat ₹50 → becomes this tier).

### 5.3 Night stay — food & lodging
For OUTSTATION trips with an overnight halt, **the rider provides the driver food and lodging in-kind**
(per spec: "if night stay, have to give food and lodging to the driver"). Default: **no cash line** — shown
as a booking obligation/notice, plus the cash **night-halt allowance** (§4b) which covers incidental driver
allowance, not accommodation.
- *Alternative to confirm:* replace in-kind with a fixed cash **food+lodging allowance** (₹X/night) added to
  the fare and paid out to the driver. (Pick one.)

---

## 6. `fare_breakdown` extension

Map every charge to a field so the rate table and API contract stay in sync.
Go struct `booking_service.go:117-126`, TS `types.ts:86-95`.

| Field | Status | Use |
| :-- | :-- | :-- |
| `base_fare_paise` | exists | package block fare / metered base |
| `distance_charge_paise` | exists | metered trips only (0 for packages) |
| `night_charge_paise` | exists → **retier** | §5.2 tiered night surcharge |
| `surge_multiplier` | exists | packages = 1.0 (no surge) |
| `d4m_care_paise` | exists | unchanged |
| `promo_discount_paise` | exists | unchanged |
| `overtime_paise` | **NEW** | §5.1 overtime |
| `night_halt_paise` | **NEW** | §4b per-night halt allowance (OUTSTATION) |
| `included_hours` / `overtime_hours` | **NEW (meta)** | transparency in receipt |
| `food_lodging_notice` | **NEW (bool/meta)** | renders the in-kind obligation, no money |

Add to both the Go struct and the TS type in the same change; persist new money fields on the order row
(extend `InsertRiderOrder`).

---

## 7. Implementation phases

**Phase 1 — close the gap (delivers the user's table)**
1. Seed the admin rate config (Redis `pricing:fare:active:<city>:<car>:<trip>`) for KOL × 4 tiers ×
   trip_types with the §4 table (a boot-time seeder / migration-style script + a code-level default map so a
   Redis flush degrades to defaults, not zeros).
2. Rewrite `package_pricing.go` → tier-aware: `packageFarePaise(city, tier, tripType, hours)` reads the
   config (fallback to the default map). Add MINI_OUTSTATION 6h-block + overtime; OUTSTATION per-day per tier.
3. Wire `EstimateFare` (`booking_service.go:142`) to pass `carType` + `tripType` into pricing and to compute
   §5 surcharges; populate the new breakdown fields.
4. Add the §3 distance eligibility gate → `eligible_trip_types` in fare-estimate + city-config responses;
   booking picker filters on it.
5. Extend `fare_breakdown` (§6) Go + TS + order persistence.

**Phase 2 — durability (explicitly optional, not the backbone)**
- Promote rate storage from Redis-only to a DB `rate_card` table (source of truth) with the admin handler
  dual-writing + Redis as cache. Only if ops needs audit/durability beyond versioned Redis.
  ⚠ Scope check: this touches `pricing_handler.go` storage layer — keep it a *named option*, not Phase 1.

---

## 8. Test changes
- `package_pricing_test.go:5-38` asserts the old env placeholders (₹150/hr etc.) → **rewrite** to the §4
  table (MINI_OUTSTATION 6h block = ₹450/₹550; overtime; OUTSTATION per-day-per-tier; tiered night charge).
- Add cases: distance gate (≤100 vs >100 km), night-charge tiers (22:59 none / 23:30 ₹50 / 00:30 ₹100),
  overtime (6h→0, 8h→₹100), OUTSTATION multi-day halt.

---

## 9. Decisions to confirm (the only open items)

1. **Full tier rates** — fill the *italic* placeholders: SEDAN/PREMIUM 6h inter-city blocks; **all** OUTSTATION
   per-day rates by tier; IN_CITY_HOURLY / metered / MONTHLY per-tier rates.
2. **Night charge stacking** — tiered-replacement (₹100 max) [assumed] vs cumulative (₹50+₹100).
3. **Food & lodging** — rider in-kind [assumed] vs fixed cash allowance ₹X/night added to fare.
4. **6h block km cap** — purely time-based [assumed] vs 100 km incl. + extra-km charge beyond.
5. **Overtime** — flat ₹50/hr all tiers [assumed] vs per-tier.

Everything else is baked from the spec + existing code. Give me 1–5 and I'll turn this into the
implementation (Phase 1).
