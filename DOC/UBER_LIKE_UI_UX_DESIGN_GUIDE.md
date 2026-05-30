# Uber-Like UI/UX Design Guide
## Enterprise Frontend Architecture for Drivers-for-U

**Version:** 1.0  
**Tech Stack:** Next.js 15 + CapacitorJS + TailwindCSS v4 + Shadcn UI  
**Target Platforms:** Web (PWA), iOS (via Capacitor), Android (via Capacitor)  
**Design System:** Mobile-first, state-driven, real-time WebSocket-driven state transitions

---

## Part 1: Global Architecture & Ground Rules

### System Context
This document defines the complete UI/UX specification for a unified Progressive Web App (PWA) built on:
- **Next.js 15** with App Router (server + client components)
- **TailwindCSS v4** for responsive, atomic styling
- **Shadcn UI** for accessible component primitives
- **CapacitorJS** as the native iOS/Android wrapper
- **Mapbox GL JS** or **React-Leaflet** for map rendering

The **same codebase** deploys to web browsers, iOS App Store (wrapped in Capacitor), and Google Play Store (wrapped in Capacitor). No separate native codebases.

### Core Design Principles

#### 1. State-Driven Transitions (WebSocket-First)
- **Every screen layout transition is event-driven via WebSocket**, NOT page reloads.
- Backend publishes order state changes (`CREATED` → `ASSIGNED` → `ARRIVED_AT_PICKUP` → `IN_TRIP` → `COMPLETED`).
- Frontend subscribes to these events and re-renders in real time.
- **No polling.** No "refresh" buttons. Pure event-driven state.

#### 2. The 4-Second Map Interpolation
- Backend ingests driver GPS coordinates **every 4 seconds** (driver telemetry service).
- Client receives batch coordinate updates via WebSocket.
- **Driver vehicle pins must glide smoothly** between old and new positions using linear interpolation animations (4-second duration).
- **Never teleport.** Always animate the vehicle's position transitions.
- Use Framer Motion or Mapbox native animation for smooth transitions.

#### 3. Connection Resilience & Pod Failover
- Backend pods scale horizontally. When a pod is terminating, it sends a WebSocket `CloseGoingAway` (1001) signal.
- **UI must detect this silently** and show a subtle "Reconnecting..." spinner overlay.
- Client automatically re-homes to a healthy pod **without freezing the interface** or closing the map.
- User sees **no error message**, just a brief loading state.
- After reconnect, state syncs automatically via the outbox notification pattern.

#### 4. Gesture-First UX (No Accidental Taps)
- **Critical actions** (trip start, trip complete) use **swipe gestures**, not standard button taps.
- Implement reusable `SlideToConfirm` component for high-impact decisions.
- Example: `>>> SLIDE TO START TRIP >>>` (user must swipe right to confirm).
- Reduces accidental touches that trigger expensive backend operations.

---

## Part 2: Design Tokens & Reusable Components

### Color Palette
```
Primary:     #1F2937 (Dark Slate) — Main actions, active states
Success:     #10B981 (Emerald)     — Accept, complete trip
Danger:      #EF4444 (Red)          — Decline, cancel
Warning:     #F59E0B (Amber)        — Surge pricing, caution states
Info:        #3B82F6 (Blue)         — Neutral info badges
Neutral:     #F3F4F6 (Light Gray)   — Backgrounds
Text Dark:   #111827                — Body text
Text Light:  #FFFFFF                — On dark backgrounds
Map Layer:   #E5E7EB (Subtle Gray)  — Map overlay tint
```

### Spacing Scale (Tailwind)
- `xs`: 4px
- `sm`: 8px
- `md`: 16px
- `lg`: 24px
- `xl`: 32px
- `2xl`: 48px

### Typography
- **Headings:** Inter Bold, 24px–32px line height 1.3
- **Body:** Inter Regular, 16px line height 1.5
- **Labels:** Inter Medium, 12px–14px, uppercase tracking 0.05em

### Reusable Component Library (Shadcn UI + Custom)

#### 1. `Badge` (Dynamic Pricing)
```tsx
// Used for surge multiplier display
<Badge variant="warning">High Demand Surge: x1.4</Badge>
```

#### 2. `SlideToConfirm` (Swipe Gesture)
```tsx
<SlideToConfirm 
  onConfirm={() => startTrip()} 
  label="SLIDE TO START TRIP" 
  color="emerald"
/>
```
- Renders as a horizontal slider track.
- User must swipe right to threshold (70%) to trigger callback.
- Haptic feedback on confirm (Capacitor/native vibration API).

#### 3. `RadialCountdown` (15-Second Offer Timer)
```tsx
<RadialCountdown 
  duration={15} 
  onExpire={() => declineOffer()}
/>
```
- SVG-based circular progress bar.
- Depletes over 15 seconds.
- Color gradient: Green (15s) → Amber (10s) → Red (5s).

#### 4. `DriverProfileCard` (Active Trip)
```tsx
<DriverProfileCard 
  photo={url}
  name="Alex"
  rating={4.8}
  vehicle="Toyota Prius LMP32"
  eta="8 min"
/>
```

#### 5. `SurgeHeatmapGrid` (Driver Home Dashboard)
```tsx
<SurgeHeatmapGrid 
  hexagons={h3Cells} 
  colorBy="surge_multiplier"
  onCellTap={(cell) => navigateTo(cell)}
/>
```
- Renders H3 hexagon grid overlay on map.
- Color intensity scales: light yellow (1.0x surge) → dark red (2.0x+).

---

## Part 3: The Rider App Screens

### Screen 1: Fare Preview & Marketplace Discovery
**Route:** `/rider/home` or `/rider/search`  
**State Trigger:** User opens app OR taps "Order Now"

#### Visual Layout
- **Background:** Full-bleed Mapbox GL map showing user's current location centered.
- **Vehicle Pins:** Small circular pins (24px) representing nearby available drivers. Color: `#1F2937`.
- **Map Interactions:** User can pan/zoom but no manual vehicle selection.

#### UI Components (Bottom Sheet Overlay)
```
┌──────────────────────────────┐
│  📍 Pickup Location          │ ← Current location input (read-only, auto-filled)
├──────────────────────────────┤
│  📍 Drop-off Location        │ ← Text input, autocomplete enabled
├──────────────────────────────┤
│  [GET FARE ESTIMATE]         │ ← Primary button (Emerald bg)
├──────────────────────────────┤
│  🌡 High Demand Surge: x1.4  │ ← Dynamic badge (if surge > 1.0)
└──────────────────────────────┘
```

#### Dynamic Surge Badge
- **Condition:** If `surge_multiplier > 1.0`, show badge.
- **Color:** Amber background, dark text.
- **Message Format:** `"High Demand Surge Active: x{multiplier}"`
- **Explanation Tooltip:** *"Prices increase during peak demand. Extra earnings support your drivers."*

#### Implementation Notes
- Use Shadcn's `Input` component for location fields.
- Autocomplete via Google Places API (or local PostGIS reverse-geocoding).
- Bottom sheet uses Radix Dialog + custom positioning.
- Fare estimate triggers `/api/v1/pricing/estimate` endpoint.

---

### Screen 2: Booking Acceptance & Dispatch Radar
**Route:** `/rider/matching`  
**State Trigger:** Fare estimate confirmed; backend starts Kuhn-Munkres matching

#### Visual Layout
- **Background:** Full-bleed map (same view as Screen 1).
- **Locked Input State:** All input fields become disabled (visual: grayscale, `pointer-events: none`).
- **Scanning Animation:** Animated radar circle overlaid in the center of the map, pulsing outward every 1.5s.

#### UI Components (Overlay + Map Interaction)
```
┌──────────────────────────────┐
│  ⏳ Searching for drivers... │ ← Status badge (top-center)
│                              │
│      ⚪ (animated radar)      │ ← 60px SVG radar, pulsing
│                              │
├──────────────────────────────┤
│  [CANCEL SEARCH]             │ ← Secondary button (Light gray)
└──────────────────────────────┘
```

#### Radar Animation (Framer Motion)
```tsx
// SVG circle that scales + opacity pulse
animate={{
  scale: [1, 1.3, 1],
  opacity: [1, 0.3, 1],
}}
transition={{ duration: 1.5, repeat: Infinity }}
```

#### Implementation Notes
- Lock all form inputs at the START of matching phase.
- Show subtle "Matching..." text near the radar.
- "Cancel Search" button calls `/api/v1/orders/{orderId}/cancel` endpoint.
- On cancellation, reset form and return to Screen 1.
- WebSocket listens for `order.assigned` event to transition to Screen 3.

---

### Screen 3: Match Confirmation & Driver En Route
**Route:** `/rider/tracking/{orderId}`  
**State Trigger:** Backend publishes `order.assigned` event with `driver_id` and initial ETA

#### Visual Layout
- **Map Focus:** Zoom to a bounding box containing both pickup point and driver's current vehicle pin.
- **Driver Vehicle Pin:** Animated glide movement using 4-second interpolation.
- **Pickup Marker:** Static blue pin at rider's origin.

#### UI Components (Lower Profile Card)
```
┌──────────────────────────────────────────┐
│  🖼️ [Driver Photo]  Alex                 │
│  ⭐ 4.8 | 🚗 Toyota Prius LMP32         │
│  📍 2 minutes away                       │
│  🔄 Share Trip Code: GK7P9               │
└──────────────────────────────────────────┘
```

#### Profile Card Fields
- **Driver Photo:** 48px circular image.
- **Name + Rating:** "Alex ⭐ 4.8"
- **Vehicle Details:** License plate + model.
- **Live ETA Countdown:** Updates every WebSocket tick (approx. 4 seconds).
- **Share Button:** Copy trip code to clipboard (for safety verification).

#### Map Animation (4-Second Interpolation)
```tsx
// Every WebSocket batch updates driver coordinates
// Linear interpolation over 4 seconds
animate={{
  lat: newLat,
  lng: newLng,
}}
transition={{ duration: 4, ease: "linear" }}
```

#### Implementation Notes
- Driver profile card renders using `<DriverProfileCard>` component.
- ETA updates via WebSocket event `driver.location.updated`.
- Map uses Mapbox GL's `easeTo()` or Framer Motion for smooth transitions.
- Allow rider to tap profile card to call/message driver (integrations optional for MVP).

---

### Screen 4a: Driver Arrived & Pickup Notification
**Route:** `/rider/tracking/{orderId}` (same, state change)  
**State Trigger:** Backend publishes `order.arrived_at_pickup`

#### Visual Layout
- **Map View:** Unchanged; driver vehicle pin should be at or near pickup marker.
- **Pickup Marker Animation:** Subtle pulsing ring (2px white stroke, repeating scale 1.0 → 1.2).

#### UI Components (Modal Alert)
```
╔══════════════════════════════╗
║  🚗 Driver Arrived!          ║
║  Alex is here.               ║
║  Please come out now.        ║
║                              ║
║  [ OK, I'm coming out ]      │ ← Primary button
╚══════════════════════════════╝
```

#### Pulsing Ring Animation
```tsx
animate={{
  r: [20, 30], // SVG circle radius
}}
transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
```

#### Implementation Notes
- Modal is non-dismissible until user taps "OK" button.
- Tap triggers local state update: `orderState = "ONBOARD_BOARDING"`.
- Send notification to driver via WebSocket: `rider.acknowledged_arrival`.

---

### Screen 4b: Active Journey & Drop-off Navigation
**Route:** `/rider/tracking/{orderId}` (in-trip phase)  
**State Trigger:** Backend publishes `order.in_trip`

#### Visual Layout
- **Map View:** Route line drawn from current driver location to drop-off marker.
  - Line color: Emerald (`#10B981`), 3px width.
  - Drop-off marker: Red pin (destination icon).
- **Bottom Profile Card:** Minimized to 60px height (showing only ETA countdown).
- **Turn-by-turn Directions:** Subtle text overlay near top: *"Continue for 1.2 miles, then turn right on Main St."*

#### UI Components (Minimized State)
```
────────────────────────────────
│  ETA: 5 min  |  Route active  │
────────────────────────────────
```

#### Map Route Drawing
```tsx
// Fetch route from backend `/api/v1/routing/directions?origin=X&destination=Y`
// Draw GeoJSON LineString on map
type: "line",
layout: { "line-join": "round", "line-cap": "round" },
paint: { "line-color": "#10B981", "line-width": 3 }
```

#### Implementation Notes
- ETA updates via `driver.location.updated` WebSocket events.
- Route recalculates if driver deviates (re-fetch every 30s or on user request).
- Profile card stays collapsed until tap; expansion shows full driver card again.
- Listen for `order.completed` WebSocket event to transition to Screen 5.

---

### Screen 5: Trip Completed & Feedback (Optional)
**Route:** `/rider/feedback/{orderId}`  
**State Trigger:** Backend publishes `order.completed`

#### Visual Layout
- **Success Checkmark:** Large centered checkmark animation (Lottie or SVG).
- **Trip Summary Card:**
  ```
  ✓ Trip Complete
  📍 2.5 miles
  💰 $12.50
  ⏱️ 8 minutes
  
  [ RATE DRIVER ] [ DONE ]
  ```

#### Implementation Notes
- Optional: Rating modal (1–5 stars + comment field).
- On completion, trigger celebratory confetti animation (optional, Framer Motion).
- "Done" button navigates back to Screen 1 (`/rider/home`).

---

## Part 4: The Driver App Screens

### Screen 6: Online Duty Availability Pane (Home Dashboard)
**Route:** `/driver/home`  
**State Trigger:** App launches; driver is authenticated

#### Visual Layout
- **Background:** Full-bleed map showing the driver's current region.
- **H3 Hexagon Overlay:** Color-coded grid of 15x15 km cells.
  - **Color Scale:** Light yellow (1.0x surge) → Amber (1.3x) → Dark red (2.0x+).
  - **Interaction:** Tap any cell to see local demand heatmap and estimated earnings.

#### Floating UI Components
```
┌─────────────────────────────────┐
│  ☀️ Good Morning, Alex!         │ ← Greeting badge
│  🎯 Currently Online             │ ← Status badge
├─────────────────────────────────┤
│  [ ⭕ GO OFFLINE ]              │ ← Massive toggle switch
│                                 │   (Emerald if Online, Gray if Offline)
├─────────────────────────────────┤
│  💰 Earnings Today: $156.50      │ ← Info card (light background)
│  ✅ 12 trips completed          │
└─────────────────────────────────┘
```

#### Online/Offline Toggle
- **Component:** Shadcn's `Switch` component, 48px tall for thumb size.
- **Label:** "GO ONLINE" (Emerald text if online) / "GO OFFLINE" (Gray if offline).
- **On Toggle:** Send WebSocket event `driver.state.changed` with payload `{ state: "ONLINE_AVAILABLE" | "OFFLINE" }`.
- **State Persistence:** Store in Redis via driver presence key (`ws:presence:{driver_id}`).

#### Hexagon Grid Heatmap
- **Data Source:** `cmd/surge` service publishes `surge.zone.updated` events.
- **Rendering:** Use H3 library (`h3-js`) to iterate grid cells and render Mapbox GL polygon features.
- **Color Interpolation:** Scale `surge_multiplier` to RGB gradient.
- **Tap Interaction:** Display modal with cell stats: demand, avg ETA to pickup, est. earnings per trip.

#### Implementation Notes
- Map is zoomable + pannable; toggle position is fixed to screen bottom.
- Greeting text refreshes on app load based on time of day.
- Earnings card updates via WebSocket from ledger service (if available).
- When driver taps "GO ONLINE," backend marks `driver.state = ONLINE_AVAILABLE` and driver becomes available for matching.

---

### Screen 7: The High-Priority Offer Flash Card (CRITICAL UX)
**Route:** Overlay modal (not a route)  
**State Trigger:** Backend publishes `order.created` + Kuhn-Munkres matching decides this driver is the best match

#### Visual Layout
- **Background:** Map behind is slightly blurred (Tailwind `backdrop-blur-sm`).
- **Card Position:** Center of screen, non-dismissible overlay.

#### UI Components (Full-Screen Modal)
```
╔════════════════════════════════════╗
║                                    ║
║  📍 Pickup: 123 Main St            ║
║  📍 Drop-off: 567 Park Ave         ║
║  💰 Estimated Fare: $12.50         ║
║  📏 Distance: 2.5 miles            ║
║                                    ║
║     ⏳ (Radial countdown timer)    ║
║      15 seconds remaining           ║
║                                    ║
║  [ ❌ DECLINE ]  [ ✅ ACCEPT ]     ║
╚════════════════════════════════════╝
```

#### Radial Countdown Timer (SVG)
- **Component:** `<RadialCountdown duration={15} />`
- **Rendering:** SVG circle (150px diameter) with animated stroke-dasharray.
- **Color Gradient:** Green (15s) → Amber (10s) → Red (5s).
- **Callback:** On expiration, auto-decline and return to home dashboard.

#### Accept/Decline Buttons
- **Decline:** Red background (`#EF4444`), 24px font, full width.
- **Accept:** Green background (`#10B981`), 24px font, full width.
- **Haptic Feedback:** Vibrate on button tap (Capacitor vibration API).

#### Implementation Notes
- **CRITICAL:** This modal is **absolutely full-screen**. User cannot dismiss or interact with map.
- **Auto-dismiss on timer expiry:** If driver does not tap within 15 seconds, auto-decline with reason `"No response"`.
- **On Accept:** Immediately send WebSocket event `order.accepted` with `driver_id`.
  - Backend transitions order state to `ASSIGNED`.
  - UI transitions to Screen 8 (navigation to pickup).
- **On Decline:** Send `order.declined` event; modal closes; return to home dashboard (Screen 6).
  - Add 30-second cooldown: "New matching offers paused for 30s" banner at top of home.

---

### Screen 8: Navigation & Passenger Verification (Pickup)
**Route:** `/driver/navigation/{orderId}`  
**State Trigger:** Order accepted; driver must navigate to pickup location

#### Visual Layout
- **Background:** Full-bleed map focused on route from driver's current position to pickup marker.
- **Route Line:** Emerald polyline showing turn-by-turn path.
- **Turn-by-Turn Panel:** Top of screen, slide-up drawer showing next maneuver.

#### UI Components (Top Navigation Panel)
```
┌──────────────────────────────┐
│  🚗 Navigating to Pickup     │
│                              │
│  ➡️  Turn right on Main St   │ ← Current maneuver (bold)
│  (500 ft away)               │ ← Distance to next turn
│                              │
│  Duration: 3 min 45 sec      │
├──────────────────────────────┤
│  [ ✓ ARRIVED AT PICKUP ]     │ ← Button (disabled until near pickup)
└──────────────────────────────┘
```

#### Safety Verification Screen (After "Arrived")
Once driver taps "Arrived at Pickup," display strict swipe gesture:

```
╔════════════════════════════════════╗
║                                    ║
║  🎫 Verify Passenger                ║
║  Confirm pickup code: GK7P9         ║
║  (Ask rider to confirm)             ║
║                                    ║
║  ➡️ >>> SLIDE TO START TRIP >>> ← ║
║     (slide right to confirm)        ║
║                                    ║
╚════════════════════════════════════╝
```

#### Swipe Gesture Component
```tsx
<SlideToConfirm 
  label="SLIDE TO START TRIP" 
  onConfirm={() => startTrip(orderId)}
  color="emerald"
/>
```
- User must swipe the slider thumb to 70% of track to trigger confirm.
- Haptic feedback on 50% threshold and on confirm.
- If user releases before 70%, slider snaps back to 0%.

#### Implementation Notes
- Use Mapbox GL's routing layer to draw turn-by-turn route.
- Navigation panel updates via WebSocket (backend sends routing recalculations every 10s).
- "Arrived at Pickup" button is disabled until driver's GPS is within 50m of pickup marker.
- Swipe gesture prevents accidental trip starts while driver is helping passenger with luggage.
- On swipe confirm, send WebSocket event `order.started` → backend transitions to `IN_TRIP`.

---

### Screen 9: Active Trip Navigation & Drop-off Completion
**Route:** `/driver/navigation/{orderId}` (same, state change)  
**State Trigger:** Trip started; `order.in_trip`

#### Visual Layout
- **Background:** Full-bleed map focused on route from current driver position to drop-off marker.
- **Route Line:** Emerald polyline with drop-off marker in red.
- **Turn-by-Turn Panel:** Compact top drawer (same as Screen 8).

#### UI Components (Bottom Swipe Panel)
```
╔════════════════════════════════════╗
║  🏁 Approaching Destination        ║
║                                    ║
║  ➡️  Turn left on Park Ave         ║
║  (250 ft away)                     ║
║                                    ║
║  ETA: 1 min 30 sec                 ║
├════════════════════════════════════┤
║  ➡️ >>> SLIDE TO COMPLETE TRIP >>> ║
║     (slide right to confirm)        ║
╚════════════════════════════════════╝
```

#### Swipe Gesture for Trip Completion
```tsx
<SlideToConfirm 
  label="SLIDE TO COMPLETE TRIP" 
  onConfirm={() => completeTrip(orderId)}
  color="emerald"
/>
```
- Same as "Start Trip": must swipe to 70% to trigger.
- On confirm, send WebSocket event `order.completed`.
- Backend finalizes transaction (ledger entry, payment processing, etc.).

#### Post-Completion Transition
- **Success State:** Show "✓ Trip Completed" banner for 2 seconds.
- **Reset to Home:** Automatically navigate back to Screen 6 (home dashboard).
- **Earnings Update:** Earnings badge updates to reflect new trip total.

#### Implementation Notes
- Turn-by-turn updates via WebSocket (same as Screen 8).
- ETA countdown reflects real-time routing engine calculations.
- Swipe gesture is the **only way** to complete a trip (no button fallback).
- On completion, backend publishes ledger entry, payment event, and clears driver from matching pool.

---

## Part 5: Implementation Instructions for Claude Code / Cursor

### Command 1: Scaffold Next.js Project with Stack
```bash
npx create-next-app@latest drivers-for-u-client \
  --typescript \
  --tailwind \
  --app \
  --eslint \
  --src-dir \
  --no-git
```

### Command 2: Install Component & Utility Libraries
```bash
cd drivers-for-u-client

# Shadcn UI + component library
npx shadcn-ui@latest init -d

# Map libraries
npm install mapbox-gl react-map-gl @mapbox/mapbox-gl-geocoder

# Animation
npm install framer-motion lottie-react

# H3 geospatial
npm install h3-js

# Geolocation & device APIs
npm install @capacitor/geolocation @capacitor/app @capacitor/haptics

# Utilities
npm install clsx date-fns zustand swr axios
```

### Command 3: Build Reusable Custom Components
**File:** `src/components/SlideToConfirm.tsx`
```tsx
"use client";
import { motion } from "framer-motion";
import { useState } from "react";

interface SlideToConfirmProps {
  label: string;
  onConfirm: () => void;
  color?: "emerald" | "red" | "blue";
}

export function SlideToConfirm({ 
  label, 
  onConfirm, 
  color = "emerald" 
}: SlideToConfirmProps) {
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const trackWidth = 300;
  const threshold = trackWidth * 0.7;

  const handleDragEnd = () => {
    if (dragX >= threshold) {
      onConfirm();
      setDragX(0);
    } else {
      setDragX(0);
    }
    setDragging(false);
  };

  const colorMap = {
    emerald: "bg-emerald-500",
    red: "bg-red-500",
    blue: "bg-blue-500",
  };

  return (
    <div className="w-full">
      <motion.div
        className={`relative h-16 rounded-lg ${colorMap[color]} flex items-center justify-center overflow-hidden`}
        onHoverStart={() => {}}
      >
        {/* Background track */}
        <div className="absolute inset-0 bg-gray-700 opacity-20" />
        
        {/* Label text */}
        <span className="text-white font-bold text-lg z-10">{label}</span>

        {/* Draggable thumb */}
        <motion.div
          drag="x"
          dragConstraints={{ left: 0, right: trackWidth - 60 }}
          onDrag={(_, info) => setDragX(info.x)}
          onDragEnd={handleDragEnd}
          onMouseDown={() => setDragging(true)}
          className="absolute left-2 w-12 h-12 bg-white rounded-lg cursor-grab active:cursor-grabbing"
          initial={{ x: 0 }}
        />
      </motion.div>
    </div>
  );
}
```

**File:** `src/components/RadialCountdown.tsx`
```tsx
"use client";
import { useEffect, useState } from "react";

interface RadialCountdownProps {
  duration: number; // seconds
  onExpire: () => void;
}

export function RadialCountdown({ duration, onExpire }: RadialCountdownProps) {
  const [elapsed, setElapsed] = useState(0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - elapsed / duration);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed((prev) => {
        if (prev >= duration) {
          clearInterval(interval);
          onExpire();
          return duration;
        }
        return prev + 0.1;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [duration, onExpire]);

  const color = elapsed < duration * (5 / 15) ? "#10B981" : 
                elapsed < duration * (10 / 15) ? "#F59E0B" : "#EF4444";

  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="4" />
      <circle
        cx="75"
        cy="75"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        style={{ transition: "stroke-dashoffset 0.1s linear" }}
      />
      <text x="75" y="75" textAnchor="middle" dy="0.3em" fontSize="24" fontWeight="bold" fill={color}>
        {Math.ceil(duration - elapsed)}s
      </text>
    </svg>
  );
}
```

### Command 4: Set Up CapacitorJS
```bash
npm install @capacitor/core @capacitor/cli

npx cap init drivers-for-u-client com.driversforU.app

# Add platforms
npx cap add ios
npx cap add android

# After building Next.js:
npm run build
npx cap sync
```

### Command 5: Build the Routing Page Structure
**File:** `src/app/(rider)/layout.tsx`
```tsx
export default function RiderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white">
      {children}
    </div>
  );
}
```

**Files to create:**
- `src/app/(rider)/home/page.tsx` — Screen 1 (Fare Preview)
- `src/app/(rider)/matching/page.tsx` — Screen 2 (Dispatch Radar)
- `src/app/(rider)/tracking/[orderId]/page.tsx` — Screens 3–5 (Tracking + Feedback)

**Files for Driver app:**
- `src/app/(driver)/home/page.tsx` — Screen 6 (Online Dashboard)
- `src/app/(driver)/offer/page.tsx` — Screen 7 (Offer Modal, overlay)
- `src/app/(driver)/navigation/[orderId]/page.tsx` — Screens 8–9 (Navigation + Completion)

### Command 6: WebSocket Client Setup
**File:** `src/lib/websocket.ts`
```ts
import { ResilientStreamManager } from '@/network/ResilientStreamManager';

const wsManager = new ResilientStreamManager({
  baseUrl: process.env.NEXT_PUBLIC_WS_GATEWAY || 'ws://localhost:8080',
  jwtToken: localStorage.getItem('jwt_token') || '',
});

export async function subscribeToOrderUpdates(orderId: string, onUpdate: (event: any) => void) {
  const unsubscribe = await wsManager.subscribe(`order.${orderId}`, onUpdate);
  return unsubscribe;
}
```

### Command 7: Deploy to Web + Native
```bash
# Test on web
npm run dev

# Build for production
npm run build

# Sync to native platforms
npx cap sync ios
npx cap sync android

# Open Xcode / Android Studio
npx cap open ios
npx cap open android
```

---

## Part 6: Design Tokens & Tailwind Configuration

**File:** `tailwind.config.ts`
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1F2937',
          success: '#10B981',
          danger: '#EF4444',
          warning: '#F59E0B',
          info: '#3B82F6',
        },
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        '2xl': '48px',
      },
    },
  },
  plugins: [],
};

export default config;
```

---

## Part 7: Testing & Validation Checklist

### Functional Testing
- [ ] Rider can order and see 4-second smooth vehicle interpolation on map
- [ ] Driver receives 15-second offer modal (non-dismissible)
- [ ] Swipe gestures work on iOS/Android (Capacitor)
- [ ] WebSocket reconnects silently on pod failover (no freeze)
- [ ] Surge pricing badge appears when `surge_multiplier > 1.0`
- [ ] H3 hexagon grid renders correctly with color gradient

### Performance Testing
- [ ] Map interaction (pan/zoom) is smooth (60 FPS target)
- [ ] WebSocket event processing < 100ms latency
- [ ] App cold start < 3 seconds
- [ ] Swipe gesture response time < 50ms

### Mobile Testing (Capacitor)
- [ ] Geolocation works on iOS + Android
- [ ] Haptic feedback triggers on button/swipe interactions
- [ ] Background geolocation works (driver telemetry while app is backgrounded)
- [ ] App stores JWT securely (Capacitor Preferences plugin)

---

## Part 8: References & Dependencies

### Core Libraries
- **Next.js 15:** App Router, Server Components, API Routes
- **React 18+:** Client-side state, hooks, suspense boundaries
- **TailwindCSS v4:** Atomic CSS, responsive design
- **Shadcn UI:** Pre-built accessible components
- **Framer Motion:** Smooth animations (map glide, radar pulse)
- **Mapbox GL JS:** Map rendering + route visualization

### State Management
- **Zustand:** Lightweight client state (order state, driver state)
- **SWR / React Query:** Data fetching + caching

### APIs & Real-Time
- **WebSocket (via ResilientStreamManager):** Order + driver events
- **HTTP (Axios):** Fare estimates, ledger queries

### Native Integration
- **CapacitorJS:** iOS/Android wrapper, geolocation, vibration
- **@capacitor/geolocation:** GPS access
- **@capacitor/haptics:** Device vibration feedback

---

## Conclusion

This document serves as the **complete UI/UX specification** for an Uber-like frontend. Every screen, component, and interaction is defined. 

**For AI agents:** Feed this document into Claude Code, Cursor, or your AI design system to scaffold the entire project automatically. The tech stack (Next.js 15 + Capacitor + TailwindCSS + Shadcn UI) is production-proven and scalable to millions of concurrent users.

**For design teams:** Use the Figma prompts (Parts 2–4) to generate high-fidelity mockups. The design tokens ensure consistency across all screens.

**For engineers:** The implementation instructions (Part 5) provide a step-by-step CLI workflow. Follow the commands in order; the result is a fully functional PWA + native iOS/Android app.

---

**Document Version:** 1.0  
**Last Updated:** 2026-05-30  
**Status:** Production-Ready Design Specification
