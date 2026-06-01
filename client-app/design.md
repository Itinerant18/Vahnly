# Client App Design System

**Platforms:** Web (PWA), iOS (Capacitor), Android (Capacitor)  
**Tech Stack:** Next.js 15 + App Router + TailwindCSS v4 + Shadcn UI + Framer Motion + Mapbox GL  
**Design System:** Mobile-first, state-driven, WebSocket-driven, real-time GPS interpolation

---

## Core Principles (MANDATORY)

### 1. State-Driven (WebSocket-First)
- **Every screen transition is event-driven via WebSocket**, NOT page reloads.
- Backend order state: `CREATED` → `ASSIGNED` → `ARRIVED_AT_PICKUP` → `IN_TRIP` → `COMPLETED`.
- Frontend subscribes and re-renders in real-time. **No polling. No refresh buttons.**

### 2. 4-Second GPS Interpolation
- Driver GPS coordinates batch every 4 seconds from backend.
- Client receives updates via WebSocket `driver.location.updated`.
- **Vehicle pins must glide smoothly** using linear interpolation (4s duration).
- **Never teleport vehicle pins.** Always animate.
- Use Framer Motion or Mapbox `easeTo()` for smooth transitions.

### 3. Connection Resilience
- When backend pod terminates, send WebSocket `CloseGoingAway` (1001) signal.
- **UI detects silently** and shows subtle "Acquiring GPS Signal..." overlay (glassmorphism).
- Auto-reconnect with exponential backoff (1s → 30s, max 10 retries).
- **No error messages.** No frozen interface. Just brief loading state.
- After reconnect, state syncs automatically via outbox notification pattern.

### 4. Gesture-First UX (Neo-Brutalism for Driver)
- **Critical actions use swipe gestures**, not button taps.
- `SlideToConfirm` component for trip start/complete (80% track drag required).
- Haptic feedback (Capacitor vibration API) on confirm/error.
- Prevents accidental high-impact operations.

---

## Design Tokens

### Color Palette (Tailwind)
```
Primary:      #1F2937 (Dark Slate)  — Main actions, active states
Success:      #10B981 (Emerald)     — Accept, complete trip
Danger:       #EF4444 (Red)          — Decline, cancel
Warning:      #F59E0B (Amber)        — Surge pricing, caution
Info:         #3B82F6 (Blue)         — Neutral info badges
Neutral:      #F3F4F6 (Light Gray)   — Backgrounds
Text Dark:    #111827                — Body text
Text Light:   #FFFFFF                — On dark backgrounds
Map Tint:     #E5E7EB (Subtle Gray)  — Map overlay
```

### Spacing (Tailwind)
- xs: 4px | sm: 8px | md: 16px | lg: 24px | xl: 32px | 2xl: 48px

### Typography
- **Headings:** Inter Bold, 24px–32px, line height 1.3
- **Body:** Inter Regular, 16px, line height 1.5
- **Labels:** Inter Medium, 12px–14px, uppercase tracking 0.05em

---

## Reusable Components

### SlideToConfirm (Framer Motion Drag)
```tsx
<SlideToConfirm 
  label="SLIDE TO START TRIP" 
  onConfirm={handleStart}
  color="emerald"
/>
```
- Horizontal slider track (user swipes right).
- Requires 80% track width drag to trigger.
- Haptic feedback on confirm/error.
- Loading state prevents double-swipes.

### RadialCountdown (SVG Timer)
```tsx
<RadialCountdown 
  duration={15} 
  onExpire={handleExpire}
/>
```
- SVG circular progress bar.
- Color gradient: Green (15s) → Amber (10s) → Red (5s).
- Calculates remaining time from backend `expiresAt` (prevents clock drift).
- Used for 15-second ride offer acceptance.

### ReconnectingOverlay (Glassmorphism)
```tsx
<ReconnectingOverlay isVisible={isReconnecting} />
```
- Subtle "Acquiring GPS Signal..." overlay with pulsing dots.
- Subscribes to Zustand `isReconnecting` state.
- Non-intrusive connection resilience feedback.
- Shows only briefly; no error messages.

### DriverProfileCard
```tsx
<DriverProfileCard 
  photo={driverPhoto}
  name="Alex"
  rating={4.8}
  vehicle="Toyota Prius"
  eta="8 min"
/>
```
- 48px circular avatar, name + rating, vehicle details, live ETA.
- Renders on rider tracking screen and driver home dashboard.

---

## Rider App Screens

### Screen 1: Home & Fare Preview (`/rider/home`)
**Trigger:** App launch or "Order Now" tap

- **Map:** Full-bleed Mapbox GL, user centered.
- **Driver Pins:** 24px circles, available drivers nearby.
- **Bottom Sheet:** Pickup (read-only, auto-filled) → Dropoff (input + autocomplete).
- **Surge Badge:** If `surge_multiplier > 1.0`, show Amber badge: "High Demand Surge: x1.4"
- **GET FARE ESTIMATE:** Primary Emerald button.

### Screen 2: Booking Acceptance (`/rider/matching`)
**Trigger:** Fare estimate confirmed; matching begins.

- **Map:** Same, inputs now disabled (grayscale, `pointer-events: none`).
- **Radar Animation:** 60px SVG radar pulsing outward every 1.5s (Framer Motion).
- **Status:** "⏳ Searching for drivers..." badge (top-center).
- **CANCEL SEARCH:** Secondary button.

### Screen 3: Match Confirmation (`/rider/tracking/{orderId}`)
**Trigger:** `order.assigned` event published.

- **Map:** Zoom to bbox containing driver + pickup marker.
- **Driver Vehicle:** Animated glide with 4-second interpolation.
- **Pickup Marker:** Static blue pin.
- **Profile Card:** Driver photo, name, rating, vehicle, live ETA, share trip code button.

### Screen 4a: Driver Arrived (`/rider/tracking/{orderId}` state change)
**Trigger:** `order.arrived_at_pickup` event.

- **Pickup Marker:** Pulsing ring animation (scale 1.0 → 1.2, 1.5s repeat).
- **Modal Alert:** Non-dismissible. "🚗 Driver Arrived! Alex is here. Please come out now." + "OK, I'm coming out" button.

### Screen 4b: Active Trip (`/rider/tracking/{orderId}` in-trip phase)
**Trigger:** `order.in_trip` event.

- **Map:** Route line (Emerald, 3px) from driver to dropoff (red pin).
- **Navigation:** "Continue for 1.2 miles, then turn right..." (top text).
- **Minimized Card:** 60px height showing ETA countdown.
- **Listen:** `order.completed` event to transition to Screen 5.

### Screen 5: Trip Completed (`/rider/feedback/{orderId}`)
**Trigger:** `order.completed` event.

- **Success Checkmark:** Large centered SVG/Lottie animation.
- **Trip Summary:** Distance, fare, duration, trip time.
- **Buttons:** "RATE DRIVER" (optional modal) + "DONE" (back to `/rider/home`).

---

## Driver App Screens

### Screen 6: Online Duty Dashboard (`/driver/home`)
**Trigger:** App launch; driver authenticated.

- **Map:** Full-bleed, driver's current region.
- **H3 Hexagon Grid:** 15×15 km cells, color-coded surge: light yellow (1.0x) → dark red (2.0x+).
- **Tap Cell:** Modal with local demand, avg ETA, est. earnings.
- **Greeting Badge:** "☀️ Good Morning, Alex!" (time-aware).
- **Status Badge:** "🎯 Currently Online" / "Offline".
- **Online/Offline Toggle:** Massive Shadcn Switch (48px), Emerald if online, Gray if offline.
- **Earnings Card:** "💰 Earnings Today: $156.50" + "✅ 12 trips completed".

**On Toggle:**
- Send WebSocket `driver.state.changed` with `{ state: "ONLINE_AVAILABLE" | "OFFLINE" }`.
- Store in Redis `ws:presence:{driver_id}`.

### Screen 7: High-Priority Offer Flash Card (MODAL)
**Trigger:** Backend publishes `order.created` + matching selects this driver.

- **Background:** Map blurred (`backdrop-blur-sm`).
- **Card:** Center overlay, full-screen, non-dismissible.
- **Content:**
  - 📍 Pickup: 123 Main St
  - 📍 Dropoff: 567 Park Ave
  - 💰 Fare: $12.50
  - 📏 Distance: 2.5 miles
  - **RadialCountdown:** 15 seconds (Green → Amber → Red)
- **Buttons:** Red "❌ DECLINE" + Green "✅ ACCEPT" (full width, 24px font).
- **Haptic:** Vibrate on tap.

**Auto-Decline:** If no response after 15s, decline with reason "No response" + 30s cooldown banner.

**On Accept:** Send `order.accepted` → transitions to Screen 8.

### Screen 8: Navigation & Passenger Verification (`/driver/navigation/{orderId}`)
**Trigger:** Order accepted.

- **Map:** Route from driver to pickup (Emerald polyline).
- **Top Panel:**
  - "🚗 Navigating to Pickup"
  - "➡️ Turn right on Main St (500 ft)"
  - "Duration: 3 min 45 sec"
  - "✓ ARRIVED AT PICKUP" button (disabled until within 50m).

**On "Arrived":**
- Show swipe verification modal: "🎫 Verify Passenger. Confirm code: GK7P9"
- `<SlideToConfirm label="SLIDE TO START TRIP" color="emerald" />`
- Send `order.started` → transitions to Screen 9.

### Screen 9: Active Trip & Completion (`/driver/navigation/{orderId}` in-trip)
**Trigger:** `order.in_trip` event.

- **Map:** Route to dropoff (Emerald polyline, red pin).
- **Top Panel:** Turn-by-turn (same as Screen 8).
- **Bottom Swipe Panel:**
  - "🏁 Approaching Destination"
  - "➡️ Turn left on Park Ave (250 ft)"
  - "ETA: 1 min 30 sec"
  - `<SlideToConfirm label="SLIDE TO COMPLETE TRIP" color="emerald" />`
- **On Swipe:** Send `order.completed` → transitions to Screen 5 (completion feedback).

---

## State Management

### Zustand Stores

**useAppState.ts:** App metadata only (NOT coordinates)
```ts
{
  orderStatus: "CREATED" | "ASSIGNED" | "IN_TRIP" | "COMPLETED",
  driverState: "ONLINE_AVAILABLE" | "OFFLINE",
  surgeMultiplier: number,
  isConnected: boolean,
  isReconnecting: boolean,
  // Actions: setOrderStatus, setDriverState, etc.
}
```

**useAuthStore.ts:** Authentication state
```ts
{
  token: string,
  userRole: "rider" | "driver",
  // Actions: login, logout
}
```

### VehicleTracker (Mutable Refs, No React Re-renders)
- Manages coordinate queue with 4-second delay.
- `requestAnimationFrame` loop for 60 FPS smooth gliding.
- Linear lerp between current and target position.
- `onUpdate` callback fires every frame (updates Mapbox directly, bypasses React).
- **Critical:** No React re-renders. Coordinates stored in refs.

### ResilientWebSocketProvider
- WebSocket manager with exponential backoff (1s → 30s, max 10 retries).
- Handles `CloseGoingAway` (1001) gracefully.
- Routes events: `driver.location.updated` → VehicleTracker, `order.*` → Zustand.
- `sendMessage` utility for dispatching WebSocket events.

---

## Asset Library

**Path:** `client-app/src/components/`

- `SlideToConfirm.tsx` — Framer Motion drag gesture
- `RadialCountdown.tsx` — SVG circular timer
- `ReconnectingOverlay.tsx` — Glassmorphism connection feedback
- `AuthGuard.tsx` — Route protection
- `DriverProfileCard.tsx` — Avatar + metadata
- All using Shadcn UI primitives + TailwindCSS

**Path:** `client-app/src/lib/`

- `VehicleTracker.ts` — GPS interpolation engine
- `providers/ResilientWebSocketProvider.tsx` — WebSocket resilience

**Path:** `client-app/src/store/`

- `useAppState.ts` — Zustand app metadata store
- `useAuthStore.ts` — Zustand authentication store

---

## Do's & Don'ts

✅ **DO:**
- Subscribe to WebSocket events; let state drive UI.
- Use `requestAnimationFrame` for high-frequency GPS updates (bypass React).
- Show glassmorphism overlays for transient states (reconnecting, loading).
- Use swipe gestures for critical driver actions.
- Animate vehicle pins smoothly; never teleport.

❌ **DON'T:**
- Poll the API; use WebSocket only.
- Store coordinates in React state (will cause jank).
- Use standard button taps for trip start/complete.
- Show error modals for pod failover; reconnect silently.
- Block the UI during reconnection.

---

## Deployment Targets

- **Web:** Next.js dev server on `:3000` (Vite proxy) or production build.
- **iOS:** Capacitor wrapper, deployed to App Store.
- **Android:** Capacitor wrapper, deployed to Google Play Store.

**Same codebase.** Platform-specific code guarded by `Capacitor.isNativePlatform()` checks.

---

**Last Updated:** 2026-06-01  
**Source of Truth:** `DOC/UBER_LIKE_UI_UX_DESIGN_GUIDE.md`
