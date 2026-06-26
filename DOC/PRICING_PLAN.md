# Vahnly Pricing Plan — Tiered Rate Card (FINAL spec)

Status: **spec locked, ready to implement (Phase 1)**. Grounded in current code (file:line below).
Money in **paise** internally; ₹ in copy. Market: **Kolkata (KOL)** first.

---

## 1. Current state — the gap to close

- **Admin pricing config** already models per-`(city × car_type × trip_type)` rates (base, night, outstation
  per-day/night-halt/allowance, versioning) — but **Redis-only** and **booking never reads it**
  (`PricingDashboard.tsx`, `pricing_handler.go`).
- **Booking engine** (`booking_service.go:142-258`, `package_pricing.go:24-52`) actually prices via
  **hardcoded constants + env `PKG_*`, no vehicle tier**.

**Backbone of the work:** wire `EstimateFare` → the rate card + seed it. Not a new rate store.

---

## 2. Pricing models (final)

Two block models + existing metered/monthly. Tiers: **HATCHBACK · SEDAN · SUV · PREMIUM**
(Premium = Innova Crysta / Fortuner / Camry).

### 2a. In-City Block — time + km capped

| Tier | 6h / 60km | 8h / 80km | Extra km (city) | Overtime /hr |
| :-- | --: | --: | --: | --: |
| Hatchback | ₹650 | ₹800 | ₹11/km | ₹50 |
| Sedan | ₹850 | ₹1,050 | ₹13/km | ₹60 |
| SUV | ₹1,050 | ₹1,300 | ₹15/km | ₹80 |
| Premium | ₹1,300 | ₹1,600 | ₹18/km | ₹100 |

- Flat block fare up to the time **and** km cap. Beyond km cap → `extra_km × rate[tier]`.
- Beyond block hours → `overtime/hr[tier] × ceil(extra_hours)` (in-city only).
- 60/80 km caps deliberately leave headroom over realistic city errands (40–60 km) while blocking
  "city block used as cheap outstation" (Kalyani/Barrackpore runs).

### 2b. Outstation — per day, 300 km/day included

| Tier | Day rate (300km) | Extra km/day | Night allowance | Night surcharge/night |
| :-- | --: | --: | --: | --: |
| Hatchback | ₹2,800 | ₹10/km | ₹600 | ₹100 |
| Sedan | ₹3,200 | ₹12/km | ₹600 | ₹100 |
| SUV | ₹4,000 | ₹14/km | ₹600 | ₹100 |
| Premium | ₹4,800 | ₹16/km | ₹700 | ₹100 |

```
days        = ceil(booked_hours / 12)  (min 1)     # IMPLEMENTED: rider books the engagement in
                                                   # days (12h/day), NOT distance ÷ 300
nights_away = days − 1
day_fare    = day_rate[tier] × days
extra_km    = max(0, total_km − 300×days) × extra_km_rate[tier]   # billed at trip-end on actuals
allowance   = §4.3 cash allowance (separate line)
night_chg   = ₹100 × nights_away                   # §4.2, into night_charge_paise
overtime    : NONE hourly — an outstation overrun > 3h converts to a FULL extra day (§4.1)
```

> ⚠ **OPEN DECISION:** day-count is **booked-hours ÷ 12** (implemented), not distance ÷ 300. A 12h
> booking on a 500 km route = 1 day, even though the route table below implies 2. Booked-hours is
> rider-controlled and deterministic; distance ÷ 300 matches the route table but needs a known total
> distance. Confirm which basis is authoritative — they differ ~2× on long routes.

**Common routes (reference, Sedan):** Digha 185km 1–2d ₹3,200+₹600 · Puri 500km 2–3d ₹6,400+2×₹600 ·
Siliguri/NJP 600km 2d ₹6,400+1×₹600 · Durgapur 165km same-day ₹3,200 · Bishnupur 150km same-day ₹3,200.

### 2c. Existing, unchanged (rates TBD, not in this round)
- `IN_CITY_ONE_WAY` / `IN_CITY_ROUND` — distance-metered (existing base+per-km), to be re-tiered later.
- `MONTHLY` — flat/month per tier, TBD.

---

## 3. Trip-type mapping (resolved against existing enum)

Existing `trip_type` (`types.ts:4-10`): `IN_CITY_ONE_WAY · IN_CITY_ROUND · IN_CITY_HOURLY · MINI_OUTSTATION · OUTSTATION · MONTHLY`.

| Model (§2) | trip_type | Notes |
| :-- | :-- | :-- |
| In-City Block (6h/8h) | `IN_CITY_HOURLY` | extended from per-hour to fixed 6h/8h blocks + km cap |
| Outstation per-day | `OUTSTATION` | single-day route = `days=1` (no night allowance/surcharge) |
| Metered point-to-point | `IN_CITY_ONE_WAY` / `IN_CITY_ROUND` | unchanged |
| Monthly | `MONTHLY` | unchanged |

**`MINI_OUTSTATION` is retired** — a sub-100/300 km day trip is just `OUTSTATION` with `days=1`. (Remove
from KOL `supported_trip_types` seed `000119`; keep the enum value for back-compat on old rows.)

---

## 4. Surcharge & allowance rules (precise)

### 4.1 Overtime
- In-city block: `overtime/hr[tier]` (₹50/₹60/₹80/₹100) × `ceil(hours − block_hours)`.
- Outstation: **no hourly overtime**. If overrun `> 3h`, bill **one full extra day** (`day_rate[tier]`).
  (≤3h overrun absorbed.)

### 4.2 Night charge — tiered, IST, higher bracket REPLACES (₹100 max/booking)
Window check on `scheduled_at` / `trip_start_at` (NOT booking time):

| Window (IST) | Surcharge |
| :-- | --: |
| 22:00 – 23:59 | +₹50 |
| 00:00 – 05:59 | +₹100 |
| else | ₹0 |

Replacement, not cumulative — a trip straddling midnight = ₹100, not ₹150. Edge: 05:59 → ₹100, 06:01 → ₹0.
**Outstation multi-night:** `+₹100 × nights_away`, applied once per night regardless of arrival time.
Stored in `night_charge_paise`.

### 4.3 Driver food & lodging — CASH allowance (not in-kind), separate bill line
`driver_allowance_paise`, labelled e.g. "Driver night allowance (2 nights) ₹1,200".

| Component | Amount |
| :-- | --: |
| Food / day | ₹250 |
| Lodging / night | ₹350 |
| **Full night away** (Hatchback/Sedan/SUV) | **₹600** |
| **Full night away** (Premium) | **₹700** |

Apply: same-day return → ₹0 · overnight stay but driving back that evening → ₹300 (food only) ·
each full night away → ₹600 (₹700 Premium).

---

## 5. Eligibility gate (distance = eligibility, not price)
`EstimateFare` already has haversine road distance (`booking_service.go:193-200`). Surface
`eligible_trip_types` in fare-estimate + city-config:
- distance ≤ block km cap (60/80) → In-City Block + metered eligible.
- larger / out-of-city → Outstation. (City `supported_trip_types` is the city allow-list; this is the
  per-trip filter on top.)

---

## 6. `fare_breakdown` fields (Go `booking_service.go:117-126`, TS `types.ts:86-95`)

| Field | Status | Use |
| :-- | :-- | :-- |
| `base_fare_paise` | exists | block fare / day-rate × days / metered base |
| `distance_charge_paise` | exists | metered + **extra-km** (block over-cap / outstation over-300) |
| `night_charge_paise` | retier | §4.2 tiered night + outstation ₹100×nights |
| `overtime_paise` | **NEW** | §4.1 in-city overtime |
| `driver_allowance_paise` | **NEW** | §4.3 cash food+lodging |
| `surge_multiplier` | exists | blocks/outstation = 1.0 (no surge) |
| `d4m_care_paise` · `promo_discount_paise` | exists | unchanged |
| `included_hours` / `overtime_hours` / `nights_away` / `days` | **NEW meta** | receipt transparency |

Add to Go struct + TS type together; persist new money fields on the order row (`InsertRiderOrder`).

---

## 7. Implementation — Phase 1 status

**SHIPPED (this change):**
- ✅ Tier-aware rate engine — `package_pricing.go` rewritten: `packageQuote(packageType, carType,
  durationHours, distanceKm, when)` returns a decomposed `PackageQuote`. In-City block (6h/8h select by
  duration), Outstation per-day (ceil 12h/day, nights, allowance, ₹100/night, extra-km). Rate cards as Go
  maps (the code-level default). Pure function — `when` passed in.
- ✅ `EstimateFare` wired (`booking_service.go`) — distance computed up-front; packages routed through the
  engine; tiered night surcharge (₹50/₹100, replaces) on blocks; `dispatchFarePaise` = **service fare only**
  (base+extra-km+overtime) — allowance/night/d4m/promo excluded from the commission/payout basis.
- ✅ `fare_breakdown` new fields `overtime_paise`, `driver_allowance_paise` — Go struct + TS type.
- ✅ Tests rewritten (`package_pricing_test.go`): tier blocks, night tiers (21/22/00/05/06 IST), outstation
  days/nights/allowance/extra-km, MINI→outstation, monthly, fall-through. `go build ./...`, service tests,
  `tsc` all green.
- ✅ `MINI_OUTSTATION` retired in pricing (routes to the outstation card; enum kept for old rows).

**DEFERRED (next slices, noted in code with `ponytail:`):**
- ⏸ **Trip-end reconciliation** — overtime + extra-km are 0 at estimate (no actual km/hours yet); the per-tier
  rates exist on the card but get *applied* in the driver-side trip-end bill flow. This is the next slice.
- ⏸ **`eligible_trip_types` distance gate** (§5) in fare-estimate/city-config + picker filter.
- ⏸ **Granular DB persistence** of `overtime_paise`/`driver_allowance_paise` columns (the *total* already
  persists via `dispatchFarePaise`→`base_fare`).
- ⏸ **KOL seed** — remove `MINI_OUTSTATION` from `supported_trip_types` (`000119`).
- ⏸ **Redis admin-config wiring** — booking reads the Go default map today; reading
  `pricing:fare:active:<city>:<car>:<trip>` is Phase 2.

**Phase 2 (optional):** promote rate storage Redis-only → DB `rate_card` table (audit/durability).

---

## 8. Tests
- Rewrite `package_pricing_test.go` to §2 numbers (block 6h ₹650/8h ₹800 Hatchback; over-km extra; per-tier
  overtime; outstation per-day/extra-km/allowance/night; >3h→full-day).
- Add: distance gate (≤80 block vs > outstation), night tiers (21:59 ₹0 / 22:30 ₹50 / 00:30 ₹100 / 06:01 ₹0),
  allowance (same-day ₹0 / evening-return ₹300 / full-night ₹600/₹700), outstation multi-day ceil + nights.

---

## 9. Still open (small, non-blocking)
1. `IN_CITY_ONE_WAY/ROUND` metered per-tier base+per-km — keep current flat for now? (TBD rates)
2. `MONTHLY` per-tier rates — TBD.
3. Confirm `MINI_OUTSTATION` retire (vs keep as alias for single-day outstation).

Rationale notes (driver economics, route benchmarks) captured inline; full reasoning in chat history.
