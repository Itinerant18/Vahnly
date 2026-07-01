# Vahnly Rider App — Comprehensive UI Polish Plan

## Surface 1: Home / Map

**Files:** `home/page.tsx`, `RiderMap.tsx`, `TopBar.tsx` + marquee

### Issues

- Marquee `top: 64px` hardcoded to TopBar height — brittle
- RiderMap receives `pickup`/`dropoff` props but never renders them (dead props)
- Recenter FAB `bottom-[136px]` hardcoded to BookingSheet peek height
- No geolocation-denied fallback UI
- SOS button is mislabeled — it's just a trip shortcut, not an emergency flow
- City list hardcoded to `["KOL","BLR"]`
- No `aria-controls` on city dropdown
- Driver markers lack `aria-label`

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `RiderMap.tsx` | Render pickup/dropoff markers on map; add geolocation-denied fallback banner; replace hardcoded `bottom-[136px]` with CSS variable or dynamic calc |
| `layout` | `home/page.tsx` | Replace hardcoded `top: 64px` with `top-[var(--topbar-height)]` or dynamic ref; use `env(safe-area-inset-bottom)` |
| `animate` | `RiderMap.tsx` | Smooth marker entrance (drop from top, scale-in); recenter button spin on click |
| `colorize` | `TopBar.tsx` | Audit all inline colors → tokens; replace hardcoded `bg-negative-400` pulse with `bg-status-negative` |
| `bolder` | `TopBar.tsx` | Increase SOS touch target to 44×44; increase notification badge contrast |
| `adapt` | `TopBar.tsx` | Dynamic city list from API/config; add `aria-live` on SOS state changes; add `aria-controls` on city button |

**Effort:** Medium (~8 commands across 3 files)

---

## Surface 2: Booking / Dispatch

**Files:** `BookingSheet.tsx`, `dispatch/page.tsx`

### Issues

- Two duplicate `garageApi.list()` calls on mount
- "Monthly — coming soon" is selectable but disabled — misleading
- "Add Stop" button does nothing (placeholder)
- "Increase search radius" uses same handler as "Try Again" (bug)
- `<a href="tel:">` with empty href on DriverAssignedModal
- FareShimmer uses hardcoded `bg-gray-100` instead of token
- No keyboard escape on overlay modals
- No `aria-live` on dynamic state announcements
- Dispatch `dispatchDown` check only considers HTTP 503, not network errors

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `BookingSheet.tsx` | Remove duplicate API call; replace `bg-gray-100` with `bg-surface-neutral`; add ESC key handling on overlays; add `aria-live` on fare estimate/promo feedback |
| `polish` | `dispatch/page.tsx` | Fix "Increase search radius" handler; add phone number to `tel:` link; handle non-503 dispatch-down errors |
| `animate` | `dispatch/page.tsx` | Add crossfade between SEARCHING ↔ TIMEOUT states (currently hard cut); add driver-card slide-up on assignment |
| `layout` | `BookingSheet.tsx` | Grey out "Monthly" chip in trip type picker instead of allowing selection; surface "Add Stop" inline form when clicked |
| `typeset` | `BookingSheet.tsx` | Audit typography hierarchy — fare estimate, section headers, chip labels |
| `bolder` | `dispatch/page.tsx` | Increase countdown number size; increase CTA touch targets |
| `adapt` | `BookingSheet.tsx` | Handle `durationHours = 0` edge case (remove falsy `|| 4` fallback) |

**Effort:** Large (~12 commands across 2 files)

---

## Surface 3: Trip Live

**Files:** `trip/live/page.tsx` → `LiveTripView.tsx` (778 lines)

### Issues

- DriverCard Chat button shows "coming soon" toast but chat panel below is fully functional — confusing
- Two simultaneous `BorderBeam` components (status banner + fare strip) — visual busyness
- `WaitingMeter` timer resets on remount, doesn't track server-side start time
- FABs are plain `<button>` elements, not `ShimmerButton` — style inconsistency
- Cancel fee values hardcoded client-side
- `ChangeDropSheet` lacks loading/error states for geocode API
- No keyboard escape on bottom sheets

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `LiveTripView.tsx` | Fix DriverCard Chat button behavior (either remove "coming soon" or link to working chat); deduplicate BorderBeam (use on status banner OR fare strip, not both); add loading/error states to ChangeDropSheet |
| `animate` | `LiveTripView.tsx` | Add crossfade transitions between trip status changes (EN_ROUTE→ARRIVED→DELIVERING); smooth bottom-sheet expand/collapse; FAB entrance stagger |
| `layout` | `LiveTripView.tsx` | Replace plain FABs with ShimmerButton for consistency; add ESC key on sheets; reorder bottom panel content priority per status |
| `typeset` | `LiveTripView.tsx` | Reduce driver info text complexity; tighten status banner copy |
| `bolder` | `LiveTripView.tsx` | Increase OTP display size; make stop/drop/extend FAB labels more readable |
| `colorize` | `LiveTripView.tsx` | Audit inline colors → tokens; handle WaitingMeter color transitions |
| `adapt` | `LiveTripView.tsx` | Remove hardcoded cancel fees (use API response); fix WaitingMeter to use server-side timestamps |

**Effort:** Large (~14 commands across 1 file, but it's 778 lines)

---

## Surface 4: Bill / Payment

**Files:** `trip/bill/page.tsx`

### Issues

- "Mark as Paid" for Cash has no confirmation step — one tap books it
- UPI payment is purely optimistic (800ms timeout, no verification)
- Wallet payment has hardcoded 1200ms artificial delay
- Payment method pills not locked during payment processing
- `clientTotal` can produce negative total if promo > charges
- No saved payment method management
- Header `WordRotate` flickers before redirect on empty fare data
- `<RowItem>` re-renders on every render (no `React.memo`)

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `bill/page.tsx` | Add confirmation step for Cash payment; add payment-failure error UI; clamp `clientTotal` at 0 minimum; wrap `<RowItem>` in `React.memo` |
| `animate` | `bill/page.tsx` | Smooth transition from payment to checkmark overlay; pill selection spring feedback |
| `layout` | `bill/page.tsx` | Lock payment method pills while `paying`; add loading state to UPI payment |
| `bolder` | `bill/page.tsx` | Increase total fare emphasis; make "Mark as Paid" / "Pay" CTA more prominent |
| `typeset` | `bill/page.tsx` | Tighten fare breakdown row spacing |
| `adapt` | `bill/page.tsx` | Remove artificial payment delays; add real payment verification callbacks |
| `extract` | `bill/page.tsx` | Extract `<FareBreakdownCard>` and `<PaymentMethodSelector>` as reusable components |

**Effort:** Medium (~10 commands across 1 file)

---

## Surface 5: Rate / Feedback

**Files:** `trip/rate/page.tsx`

### Issues

- No back button — only "Skip" which goes to `/home`
- Unicode ★ characters instead of styled SVG stars (rendering varies by platform)
- Tags are polarity-exclusive (4-star user can't also report "Rash Driving")
- Submit button is plain `<button>` not `ShimmerButton`
- Toast appears without animation
- No loading shimmer while data loads
- "Skip" link has no minimum touch target size
- Comment textarea `resize-none` prevents user resize

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `rate/page.tsx` | Replace unicode ★ with styled SVG stars or Lucide `Star`; allow mixed-polarity tag selection; replace submit button with ShimmerButton |
| `animate` | `rate/page.tsx` | Add star fill animation on tap (scale + color transition); add toast fade-in/slide-up; add entrance stagger for tags |
| `layout` | `rate/page.tsx` | Add back button; increase "Skip" touch target to 44px; enable textarea resize |
| `typeset` | `rate/page.tsx` | Tighten tip option spacing; improve rating label hierarchy |
| `bolder` | `rate/page.tsx` | Increase star size; increase submit button contrast |
| `adapt` | `rate/page.tsx` | Validate custom tip input (reject negatives/zero); add loading shimmer skeleton |

**Effort:** Medium (~8 commands across 1 file)

---

## Surface 6: Receipt

**Files:** `trip/receipt/page.tsx`

### Issues

- No animations — statically renders all content (inconsistent with bill page)
- Fare details uses raw `<div>`+`<span>` markup instead of shared `<RowItem>` component
- "Email Receipt" permanently disabled with no timeline
- Timeline shows raw lat/lng coordinates instead of human-readable addresses
- No fare breakdown for surge or D4M Care lines
- No loading state for PDF download
- No `SentryErrorBoundary`

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `receipt/page.tsx` | Replace raw fare markup with `<RowItem>`; add surge/D4M Care lines; add loading state for PDF download; wrap in `SentryErrorBoundary` |
| `animate` | `receipt/page.tsx` | Add `BlurFade` entrance stagger for sections; add button hover/press effects |
| `layout` | `receipt/page.tsx` | Replace lat/lng with reverse-geocoded addresses; sort action items by priority |
| `bolder` | `receipt/page.tsx` | Increase "Total Paid" emphasis; make "Report a Problem" more discoverable |
| `adapt` | `receipt/page.tsx` | Add `Suspense` fallback with shimmer/spinner instead of empty colored div |

**Effort:** Small-Medium (~7 commands across 1 file)

---

## Surface 7: Account Hub

**Files:** `account/page.tsx`

### Issues

- Loyalty tier thresholds hardcoded (5/15 trips for Gold/Platinum)
- Total spent uses `base_fare_paise` only — under-reports actual spend
- Stats API uses `limit: 100` — inaccurate for power users
- On API failure, silently sets stats to 0 — user sees "0 Trips"
- Platinum tier uses same `text-content-secondary` color as Silver — indistinguishable
- Profile photo uses `<img>` instead of Next.js `Image`
- No loading shimmer for profile card or links grid
- No unread notification badge on links grid
- No pull-to-refresh

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `account/page.tsx` | Use `totalFarePaise` instead of `base_fare_paise` for spent stat; increase API limit or add pagination; add error state UI for stats failure |
| `animate` | `account/page.tsx` | Add staggered link card entrance (already has BlurFade, but could add scale-on-appear); add shimmer for profile card while loading |
| `layout` | `account/page.tsx` | Add unread badge to Notifications link; increase Platinum tier color distinction |
| `colorize` | `account/page.tsx` | Fix Platinum tier color (use `content-accent` or distinct token); audit all inline colors |
| `bolder` | `account/page.tsx` | Increase stats number emphasis; increase KYC badge legibility |
| `adapt` | `account/page.tsx` | Replace `<img>` with Next.js `Image`; add pull-to-refresh for stats; add SentryErrorBoundary |

**Effort:** Medium (~9 commands across 1 file)

---

## Surface 8: Login / Auth

**Files:** `login/page.tsx`

### Issues

- Hero/card ratio `flex-1` vs `flex-[4]` pushes hero off-screen on large devices
- OTP auto-advance skips fields on fast paste
- Apple sign-in permanently disabled with no timeline
- Forgot password only available in login mode, not signup mode
- Error banner uses `rounded-sm` — inconsistent with rest of app
- No Exit animation on step transitions (AnimatePresence but no exit)
- PhoneVerifyScreen transition is a hard cut
- Referral code input doesn't reset when switching between signup modes
- `handleForgotSend` advances step before API resolves
- No SentryErrorBoundary

### Commands

| Command | Target | What it does |
|---|---|---|
| `polish` | `login/page.tsx` | Fix hero/card ratio for large screens; add exit animations for step transitions; animate PhoneVerifyScreen entrance; add loading state to forgot-password flow |
| `animate` | `login/page.tsx` | Add fade transitions between all auth steps; add shake animation on error; add success checkmark on registration complete |
| `layout` | `login/page.tsx` | Add back button to hero section; surface forgot-password from both login and signup modes; replace `rounded-sm` with `rounded-md` on error banner |
| `typeset` | `login/page.tsx` | Increase terms/privacy text size; improve step heading hierarchy |
| `bolder` | `login/page.tsx` | Increase OTP input size; increase social button contrast; make "Skip for now" more prominent |
| `adapt` | `login/page.tsx` | Fix OTP paste handling; reset referral state on mode switch; fix `handleForgotSend` to wait for API before advancing step |
| `extract` | `login/page.tsx` | Extract `<AuthStepChooser>`, `<PhoneVerification>`, `<PasswordForm>` as separate components |

**Effort:** Large (~12 commands across 1 file, 400+ lines)

---

## Summary

| # | Surface | Files | Commands | Effort |
|---|---------|-------|----------|--------|
| 1 | Home/Map | 3 | 8 | Medium |
| 2 | Booking/Dispatch | 2 | 12 | Large |
| 3 | Trip Live | 1 | 14 | Large |
| 4 | Bill/Payment | 1 | 10 | Medium |
| 5 | Rate/Feedback | 1 | 8 | Medium |
| 6 | Receipt | 1 | 7 | Small-Med |
| 7 | Account Hub | 1 | 9 | Medium |
| 8 | Login/Auth | 1 | 12 | Large |

**Total: ~80 commands across 11 files**
