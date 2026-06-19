# Driver App Design System

**Platforms:** Web (PWA), iOS (Capacitor), Android (Capacitor)
**Tech Stack:** Next.js 16 (App Router) + React 19 + TailwindCSS v4 (CSS-first `@theme`) + Framer Motion + Leaflet / react-leaflet + Zustand + next-intl + Capacitor + Sentry
**Design System:** Mobile-first, token-driven, state-driven, WebSocket-driven, real-time GPS interpolation

> **The model.** Vahnly is not a ride-hail. The rider **owns the car**. The platform dispatches a
> **person to drive that car**. There is no platform "vehicle" entity; the asset is driver
> availability and skill (manual/automatic, outstation). This flips the borrowed instant-hail
> assumptions: the driver **travels to the owner's car** (a first-mile leg), pricing is by
> **duration/package** rather than point-to-point, and a large share of bookings are **scheduled**.

---

## Canonical Design Language

The single source of truth for tokens, type, and primitives is the **rider-app `ds/` system**,
mirrored byte-for-byte into the driver app:

- **Tokens:** `src/styles/tokens.css` (Uber Base-modeled). Primitive ramps + semantic aliases as
  CSS custom properties. Light is the default; dark flips automatically via `[data-theme="dark"]`
  on `<html>`. **Never hardcode hex in components** — use the semantic Tailwind classes
  (`bg-background-primary`, `text-content-secondary`, `border-border-opaque`, etc.).
- **Tailwind v4 bridge:** `src/app/globals.css` `@theme` block maps every `--color-*` utility to a
  token variable. No `tailwind.config.js` for the driver app (CSS-first).
- **Primitives (`src/components/ds/`):** `Button`, `Input`, `BottomSheet`, `StatusBadge`,
  `FareDisplay`, `ETADisplay`, `Avatar`, `DriverCard`, `Divider`, `Skeleton`, and the shared
  inline-SVG `Icon` set (`PhoneIcon`, `ChatIcon`, `CashIcon`, `SirenIcon`, …). No Shadcn, no
  emoji glyphs in UI.

---

## Core Principles (MANDATORY)

### 1. State-Driven (WebSocket-First, offer-accept)

- Every screen transition is event-driven via WebSocket, not page reloads.
- Dispatch is **offer-accept**: the matcher offers a job; the rider is told a driver is confirmed
  only on the driver's **accept**, not at match time.
- Order lifecycle: `CREATED → ASSIGNED → EN_ROUTE_TO_PICKUP → ARRIVED_AT_PICKUP → WAITING →
  DELIVERING → COMPLETED`, plus terminal `CANCELLED`. Frontend subscribes and re-renders in
  real time. No polling.

### 2. Real-time GPS Interpolation

- Driver GPS batches from the backend; the client receives updates over WebSocket.
- **Vehicle pins glide smoothly** (`MapInterpolated.tsx`, `requestAnimationFrame` lerp) — never
  teleport. Coordinates live in refs, not React state, to avoid re-render jank.
- The glide **snaps instead of tweening under `prefers-reduced-motion`**.

### 3. Connection Resilience

- WebSocket reconnect with exponential backoff. Pod failover (`CloseGoingAway`, 1001) is handled
  silently with a brief "Reconnecting" badge, not an error modal. State re-syncs via the outbox
  notification pattern.

### 4. Gesture + Accessible Fallback

- High-impact driver actions (start/complete trip) use `SlideToConfirm` (drag the thumb past the
  threshold) with Capacitor haptics.
- **Every swipe has a non-swipe path:** `SlideToConfirm` is focusable, exposes a button role with
  an `aria-label`, and confirms on Enter/Space for keyboard and assistive-tech users.

---

## Theming & Dark Mode

- Theme state lives in `useThemeStore` (driver: persisted via `@capacitor/preferences`; rider:
  `localStorage`). `ThemeProvider` applies it on mount.
- Modes: `light | dark | system`. `system` tracks `matchMedia('(prefers-color-scheme: dark)')`
  with a live change listener.
- **The driver app defaults to dark** (night-driving ergonomics) when no preference is saved;
  the rider app defaults to `system`. Users can switch either at any time.

---

## Accessibility Baseline

- **Focus:** `focus-visible` accent ring on every interactive control (`.focus-ring`, DS Button).
- **Touch targets:** primary/interactive controls are ≥ 44×44px.
- **Safe area:** bottom-pinned CTAs use `env(safe-area-inset-bottom)`.
- **Reduced motion:** `globals.css` `@media (prefers-reduced-motion: reduce)` neutralises CSS
  animation; `<MotionConfig reducedMotion="user">` at the app root makes **all Framer Motion**
  honour the OS setting; the map glide snaps.
- **Non-color redundancy:** the offer countdown shows the **seconds number** (not color alone);
  surge and fare signals are always **labelled with the multiplier/amount**, never color-only.
- **Names:** icon-only controls (call, chat, SOS, close) carry an `aria-label`. Status regions use
  `role="status"`/`aria-live`.

---

## Design Tokens (semantic, via `tokens.css`)

| Concept | Token | Light | Dark |
|---|---|---|---|
| Primary surface | `--background-primary` | `#FFFFFF` | `#000000` |
| Accent (info/active) | `--accent-400` | `#276EF1` | `#7AA3F6` |
| Positive (accept/online) | `--positive-400` | `#3AA76D` | `#5AB285` |
| Warning (surge/caution) | `--warning-400/600` | `#FFC043 / #B38200` | `#FFCC66` |
| Negative (decline/SOS) | `--negative-400` | `#D44333` | `#E36161` |
| Body text | `--content-primary` | `#000000` | `#FFFFFF` |

**Spacing:** 8px grid (`--space-100`…`--space-1200`). **Radius:** `sm 8 / md 12 / lg 16 / pill`.
**Type:** Inter (display/body/labels) + JetBrains Mono (**fares, ETAs, distances, IDs only**).
**Currency:** ₹ (rupees; backend stores paise, `formatCurrency`). **Distance:** km.

---

## Driver App Screens

### Duty Dashboard (`/driver`)

- Full-bleed Leaflet map (`MapInterpolated`) of the driver's H3 region; online drivers glide.
- Go-Online / Go-Offline toggle; today's stats; connection badge; SOS (2-second hold).
- Heatmap toggle surfaces demand density (region + cell count). Time-billed **wait toggle**
  appears mid-trip (round-trip destination wait, ₹2/min).
- In-app **chat with the rider** (pickup coordination, quick replies).

### Incoming Offer (`OfferPopup`, modal)

- Map blurred behind a non-dismissible card. Rider name + rating, trip type, car make/model/
  transmission, **first-mile reach ETA**, fare.
- **Transmission-mismatch** and **owner-not-in-car** warnings render with an icon + label.
- `CountdownRing`: 15s, color shifts pending → negative, **always showing the seconds number**.
- Slide to accept; auto-decline on expiry with a cooldown.

### Navigation to the Car (`EN_ROUTE_TO_PICKUP`)

- Route to the owner's car (the first-mile leg). Rider mini-card with call/chat (`tel:` direct
  dial — no telephony provider). Two-way live location: the rider's pin is shared to the driver.
- "I've Arrived" advances to verification.

### Pickup Verification (`ArrivedVerificationPane`, `ARRIVED_AT_PICKUP`)

- **Car-plate handshake:** the driver enters the car's registration plate; it is verified against
  the rider's registered vehicle (`normalizePlate`) — confirms *right driver + right car* before
  the car moves. OTP is the second factor.
- Start odometer + fuel capture (photo), then `SlideToConfirm` to start the trip.

### In-Trip (`TripInProgressPane`, `DELIVERING` / `WAITING`)

- Turn-by-turn to the drop. Toll / parking / issue charge actions. **Waiting meter** (driver
  toggles wait at the destination for round-trips; billed ₹2/min).
- End odometer + fuel, then `SlideToConfirm` to complete.

### Settlement (`/driver/trip/bill`) & Rate (`/driver/trip/rate`)

- Receipt: base package, extra mileage, waiting, tolls, parking, night/surge, D4M Care.
- Payment: Cash / UPI. Report-car-issue affordance. Rate the rider (1–5 + tags).

### Account (`/driver-account/*`)

- Earnings, payouts, performance, trip history, vehicles, profile, settings, support.

---

## Pricing Model

- **Package / duration tiers**, no surge on packages: One-Way, Round Trip, Hourly,
  Mini-Outstation, Outstation, Monthly (estimate-only until recurring billing lands).
- Distance-based fares retain a surge multiplier; **surge is always shown with its numeric
  multiplier**, never color alone.
- **Cancel-after-travel fees** (tiered by how far the driver got: en-route vs arrived) and a
  **no-show penalty** (re-queue + cancellation-rate bump).
- Owner's fuel; tolls/parking itemised on the settlement.

---

## State Management

- **Zustand stores (`src/store/`):** `useAuthStore`, `useDriverDutyStore`, `useOfferStore`,
  `useSafetyStore`, `useThemeStore`, `useToastStore`.
- **GPS interpolation:** `MapInterpolated.tsx` manages the coordinate queue and `rAF` lerp in
  refs (no React re-renders); honours reduced motion.
- **WebSocket:** `services/telemetryStream.ts` (driver presence/location) and the dispatch stream
  route `order.*` → stores, `driver.location.updated` → the map. Reconnect with backoff.

---

## Do's & Don'ts

✅ **DO**
- Let WebSocket events drive UI; interpolate pins in refs.
- Use semantic tokens; support light **and** dark.
- Give every swipe gesture a keyboard/AT fallback and every icon button an `aria-label`.
- Show numbers/labels alongside color for surge, fares, and the countdown.
- Frame the journey as "the driver travels to the owner's car."

❌ **DON'T**
- Poll the API; hardcode hex; use Mapbox or Shadcn (this app uses Leaflet + the `ds/` system).
- Call the trip a "vehicle handover" or use a "passenger code" — it is a **car-plate handshake**.
- Rely on color alone, or on swipe-only confirmation.
- Animate without honouring `prefers-reduced-motion`.

---

## Deployment Targets

- **Web:** Next.js build, served on Firebase Hosting (`vahnly-driver`).
- **iOS / Android:** Capacitor wrapper. Platform-specific code guarded by
  `Capacitor.isNativePlatform()`.

---

**Last Updated:** 2026-06-19
**Source of Truth:** the shipped code in `client-app/` and the canonical `ds/` token system
(mirrored from `rider-app/src/components/ds` + `src/styles/tokens.css`).
