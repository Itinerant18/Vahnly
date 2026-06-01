# Frontend Dashboard Design System

**Name:** Operations Control Room (OCR)  
**Purpose:** Admin/monitoring dashboard for ride-dispatch platform  
**Tech Stack:** Next.js 15 + React + TailwindCSS v4 + Shadcn UI + Mapbox GL  
**Target:** Web only (`:3000` dev, production SPA)  
**Audience:** Operations team, fleet managers, dispatchers

---

## Core Principles

### 1. Real-Time Intelligence
- **WebSocket-driven updates** from backend streaming services.
- Live driver locations, order state changes, surge pricing, fleet health metrics.
- No polling. Events push data to frontend immediately.

### 2. Map-Centric Layout
- Full-bleed map showing real-time driver positions, order flow, surge heatmaps.
- Overlays for metrics, filters, drill-downs.
- Mapbox GL for rendering, H3 hex grid for surge zones.

### 3. Data-Rich Panels
- Left sidebar: Filters, fleet summary, alerts.
- Bottom panel: Order queue, metrics, event log.
- Right sidebar: Drill-down details (driver profile, order timeline, telemetry).

### 4. Dark Mode / High Contrast
- Professional dark dashboard aesthetic.
- White text on dark backgrounds for reduced eye strain during long shifts.
- Color-coded badges for order states, driver states, alerts.

---

## Design Tokens

### Color Palette
```
Dark BG:      #0F172A (Slate 950)   — Main background
Card BG:      #1E293B (Slate 800)   — Panel backgrounds
Border:       #334155 (Slate 700)   — Card borders
Text Primary: #F1F5F9 (Slate 100)   — Body text
Text Muted:   #94A3B8 (Slate 400)   — Secondary text
Accent:       #3B82F6 (Blue 500)    — Links, highlights
Success:      #10B981 (Emerald)     — Order completed, driver online
Warning:      #F59E0B (Amber)       — Surge active, ETA delays
Danger:       #EF4444 (Red)         — Order failed, driver offline
Info:         #06B6D4 (Cyan)        — Information alerts
```

### Spacing
- xs: 4px | sm: 8px | md: 16px | lg: 24px | xl: 32px | 2xl: 48px

### Typography
- **Headers:** Inter Bold, 20px–28px, line height 1.3
- **Body:** Inter Regular, 14px, line height 1.6
- **Monospace:** Fira Code, 12px (for IDs, timestamps, metrics)

---

## Layout Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HEADER / NAVBAR                           │
│  OCR Logo | Status Indicators | Date/Time | Admin Menu         │
├──────────────────────────────────────────────────────────────────┤
│          │                                          │             │
│  LEFT    │                                          │   RIGHT     │
│  SIDEBAR │         FULL-BLEED MAP (Mapbox GL)       │  SIDEBAR   │
│          │         + Surge Heatmap Overlay          │             │
│          │         + Driver Pins + Order Markers    │             │
│          │                                          │             │
├──────────────────────────────────────────────────────────────────┤
│                    BOTTOM PANEL (Order Queue/Metrics)            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Left Sidebar (Filters & Fleet Summary)

**Width:** 280px | **Collapsible**

### Header Section
```
─────────────────────────────
🎛️ CONTROL PANEL
─────────────────────────────
```

### Filter Controls
```
🔍 Search Orders
┌──────────────────┐
│ Order ID / Phone │
└──────────────────┘

Status Filter
[ ] ALL
[ ] CREATED
[ ] ASSIGNED
[x] IN_TRIP
[ ] COMPLETED
[ ] CANCELLED

Driver Status
[x] Online
[ ] Offline
[ ] On Break
[ ] Inactive

Surge Zones
[x] Display Heatmap
[ ] Highlight > 1.5x
```

### Fleet Summary Cards
```
┌──────────────────────┐
│ 🚗 Fleet Size        │
│ 47 / 60 online      │
│ ━━━━━━━━━━━━━━━━   │
│ 78% Utilization     │
└──────────────────────┘

┌──────────────────────┐
│ 📊 Today's Orders    │
│ 312 completed       │
│ 28 active           │
│ 5 failed            │
└──────────────────────┘

┌──────────────────────┐
│ 💰 Surge Summary     │
│ Peak: 2.1x (1:15pm) │
│ Avg: 1.3x           │
│ Revenue: +$3,240    │
└──────────────────────┘

┌──────────────────────┐
│ ⚠️ Active Alerts     │
│ 3 high priority     │
│ 12 warnings         │
└──────────────────────┘
```

---

## Main Map Area

**Rendering:**
- Full-bleed Mapbox GL with dark theme.
- Layer 1: Base map (Dark mode mapbox://styles/mapbox/dark-v11).
- Layer 2: H3 hex grid (surge zones, color intensity = surge_multiplier).
- Layer 3: Driver pins (24px circles, color = driver state).
- Layer 4: Order markers (pickup = blue pin, dropoff = red pin).
- Layer 5: Route polylines (In-trip orders only, Emerald color).

### Map Interactions
- **Pan/Zoom:** Standard Mapbox GL.
- **Tap Driver Pin:** Open right sidebar drill-down (driver profile, trips, telemetry).
- **Tap Order Marker:** Open order details modal (pickup/dropoff, fare, timeline).
- **Tap H3 Cell:** Show cell stats (demand, avg ETA, est. hourly revenue).

### Real-Time Updates
- **Driver Location:** Every 4 seconds, pins animate smoothly (Framer Motion or Mapbox `easeTo()`).
- **Order State Changes:** Markers update color/state immediately.
- **Surge Zone Changes:** Heatmap colors update every 30s or on event.

---

## Right Sidebar (Drill-Down Details)

**Width:** 320px | **Collapsible** | **Context-Sensitive**

### When Driver Pin Tapped

```
┌─────────────────────────────┐
│ 👤 DRIVER PROFILE           │
├─────────────────────────────┤
│ Alex Chen                   │
│ ⭐ 4.8 / 2,340 trips       │
│ 🚗 Toyota Prius (LMP32)    │
│ 📱 +1-555-1234              │
│ 🎫 License: DL789XYZ       │
├─────────────────────────────┤
│ 📊 TODAY'S STATS            │
│ Trips: 12 completed        │
│ Revenue: $156.50           │
│ Avg Rating: 4.9            │
│ Online Time: 6h 45m        │
├─────────────────────────────┤
│ 📍 LOCATION                 │
│ Lat: 22.5726               │
│ Lng: 88.3639               │
│ Bearing: 45° NE            │
│ Speed: 32 mph              │
│ Last Update: 2m ago        │
├─────────────────────────────┤
│ 📋 ACTIVE ORDER             │
│ Order ID: ORD-0012345      │
│ State: IN_TRIP              │
│ ETA: 3m 15s                │
│ Fare: $8.75                │
│ [ View Order ] [ Contact ] │
└─────────────────────────────┘
```

### When Order Marker Tapped

```
┌─────────────────────────────┐
│ 📦 ORDER DETAILS            │
├─────────────────────────────┤
│ Order ID: ORD-0012345      │
│ State: IN_TRIP              │
│ Created: 1:04 PM            │
│ ETA Completion: 1:12 PM     │
├─────────────────────────────┤
│ 👤 RIDER                    │
│ Sarah Khan                  │
│ ⭐ 4.6 / 89 trips          │
│ 📱 +1-555-5678              │
├─────────────────────────────┤
│ 🚗 DRIVER                   │
│ Alex Chen                   │
│ ⭐ 4.8 / 2,340 trips       │
│ Toyota Prius (LMP32)       │
├─────────────────────────────┤
│ 📍 ROUTE                    │
│ Pickup: 123 Main St        │
│ Dropoff: 567 Park Ave      │
│ Distance: 2.5 miles        │
│ Duration: 8m 20s (est.)    │
│ Fare: $12.50               │
├─────────────────────────────┤
│ ⏱️ TIMELINE                 │
│ ✓ 1:04 PM - Order Created  │
│ ✓ 1:05 PM - Driver Assigned│
│ ✓ 1:07 PM - Pickup Arrived │
│ ⟳ 1:09 PM - Trip Started   │
│ ─ 1:12 PM - Est. Completion│
└─────────────────────────────┘
```

---

## Bottom Panel (Order Queue & Metrics)

**Height:** 220px | **Collapsible**

### Tabs

**Tab 1: Active Orders (Queue)**
```
┌──────────────────────────────────────────────────────────┐
│ 🔄 ACTIVE ORDERS (28)                       [Refresh] [>]│
├──────────────────────────────────────────────────────────┤
│ ID        │ Rider       │ Driver      │ State   │ ETA    │
├──────────────────────────────────────────────────────────┤
│ ORD-0001  │ Sarah K.    │ Alex C.     │ IN_TRIP │ 3m 15s │
│ ORD-0002  │ John D.     │ Maria L.    │ ASSIGNED│ 5m 40s │
│ ORD-0003  │ Amy W.      │ (none)      │ CREATED │ —      │
│ ORD-0004  │ Bob T.      │ Raj P.      │ IN_TRIP │ 2m 10s │
│ ORD-0005  │ Lisa M.     │ Kim S.      │ ASSIGNED│ 7m 20s │
└──────────────────────────────────────────────────────────┘
```

**Tab 2: Metrics**
```
┌──────────────────────────────────────────────────────────┐
│ 📊 METRICS (Real-Time)                                   │
├───────────────────────┬──────────────────────────────────┤
│ Orders Completed      │ 312 (↑ 12 this hour)            │
│ Avg. Completion Time  │ 7m 32s (↓ 18s vs yesterday)    │
│ Revenue              │ $4,240 (↑ $340 vs 2pm)          │
│ Driver Utilization    │ 78% (9 idle, 47 active)        │
│ Surge Avg            │ 1.3x (peak: 2.1x)              │
│ System Health        │ ✓ All systems nominal           │
└───────────────────────┴──────────────────────────────────┘
```

**Tab 3: Event Log**
```
┌──────────────────────────────────────────────────────────┐
│ 📋 EVENT LOG (Last 50)                   [Export] [>]    │
├──────────────────────────────────────────────────────────┤
│ 1:15 PM │ ✓ ORD-0012 completed ($12.50 fare)          │
│ 1:14 PM │ ⚠️  Pod failover detected (api-gateway-3)  │
│ 1:14 PM │ ✓ Reconnected (16 drivers)                   │
│ 1:13 PM │ 📞 Driver support call (ORD-0011)           │
│ 1:12 PM │ ⚙️  Surge zone update: KOL-A05 → 1.8x      │
└──────────────────────────────────────────────────────────┘
```

---

## Header / Navbar

```
┌──────────────────────────────────────────────────────────┐
│ 🚗 Drivers-for-U OCR │ KOL │ 📡 Connected │ 2026-06-01 13:15:42 UTC │ ⚙️ │
│ [Fleet Status: 47/60 online] [Peak Surge: 2.1x] [No alerts] │
└──────────────────────────────────────────────────────────┘
```

- **Left:** Logo, region selector, connection status (Green = healthy, Red = degraded).
- **Center:** Timestamp (UTC), system metrics ticker.
- **Right:** Alerts count, admin menu (settings, logout).

---

## Component Library

### Status Badge
```tsx
<Badge variant={status}>
  {status === 'COMPLETED' && '✓ Completed'}
  {status === 'IN_TRIP' && '🚗 In Trip'}
  {status === 'CREATED' && '📦 Pending'}
  {status === 'CANCELLED' && '❌ Cancelled'}
</Badge>
```

### Driver State Indicator (Map Pin)
```
Color Coding:
- Green (#10B981):   Online, Available
- Blue (#3B82F6):    Online, On Trip
- Gray (#94A3B8):    Offline / Break
- Red (#EF4444):     Inactive (no location update > 5m)
```

### Data Table (Orders Queue)
- Sortable columns: ID, Rider, Driver, State, ETA.
- Click row to drill-down (right sidebar or modal).
- Highlight critical states (CREATED = requires assignment).

### Metric Card
```tsx
<MetricCard 
  label="Orders Today" 
  value={312} 
  change="+12 this hour"
  trend="up"
/>
```

---

## Real-Time Data Flow

### WebSocket Events Listened
```
driver.location.updated
  → Update driver pin position (animate smoothly)
  → Update right sidebar location (if driver details open)

order.state.changed
  → Update order marker color/icon
  → Update bottom panel queue
  → Refresh metrics

surge.zone.updated
  → Update H3 heatmap colors
  → Update surge metric card

system.alert
  → Add to alerts count (header)
  → Log event (bottom panel)
```

### API Endpoints Called
```
GET /api/v1/orders?state=CREATED,ASSIGNED,IN_TRIP
  → Populate bottom panel order queue on load

GET /api/v1/drivers?region=KOL&state=ONLINE
  → Populate driver list for assignment

GET /api/v1/analytics/metrics?period=today
  → Populate metrics tab (if not streamed)

GET /api/v1/routing/directions?origin=X&destination=Y
  → Fetch route polyline for order (on order detail tap)
```

---

## Responsive Behavior

- **Desktop (1920px+):** Full layout with all sidebars and bottom panel.
- **Laptop (1366px):** Sidebars collapse to icons; bottom panel smaller.
- **Tablet (768px):** Left sidebar hides; tap hamburger to open. Right sidebar stacks bottom.
- **Mobile:** Not supported (admin-only tool).

---

## Dark Mode (Default)

- **Background:** Slate 950 (`#0F172A`)
- **Cards:** Slate 800 (`#1E293B`)
- **Text:** Slate 100 (`#F1F5F9`)
- **Borders:** Slate 700 (`#334155`)
- **Mapbox Style:** `mapbox://styles/mapbox/dark-v11`

No light mode variant needed for this admin dashboard.

---

## Performance & Polishing

- **Map Pan/Zoom:** Smooth transitions, no lag.
- **Driver Pin Updates:** 60 FPS animation (Framer Motion + Mapbox `easeTo()`).
- **Order Queue:** Virtual scrolling if > 100 rows (TanStack Virtual).
- **Tooltips:** Shadcn Tooltip for hover info on dense metrics.
- **Keyboard Shortcuts:** Cmd/Ctrl+K for command palette (filter orders, drill-down driver).

---

## Do's & Don'ts

✅ **DO:**
- Stream all data via WebSocket; updates push in real-time.
- Animate map transitions smoothly (driver pins, route changes).
- Show live metrics; refresh every 30s if not streamed.
- Use color coding consistently (Green = good, Red = bad, Amber = caution).
- Make sidebars collapsible to maximize map view.

❌ **DON'T:**
- Poll API endpoints; use WebSocket for real-time.
- Block UI during map updates or WebSocket reconnection.
- Show error modals for transient failures (reconnect silently).
- Use real driver/rider names in screenshots/demos (PII).
- Clutter the map with too many overlays.

---

## API Gateway Configuration (Vite Dev Proxy)

**vite.config.ts:**
```ts
proxy: {
  '/api/v1': {
    target: 'http://localhost:8080',
    changeOrigin: true,
  },
  '/api/v1/dispatch/stream': {
    target: 'ws://localhost:8080',
    ws: true,
  },
  '/api/v1/analytics': {
    target: 'http://localhost:8089',
    changeOrigin: true,
  },
}
```

---

**Last Updated:** 2026-06-01  
**Source of Truth:** `DOC/STATE_ARCHITECTURE_AND_WEBSOCKET_INTEGRATION.md`  
**Related:** `client-app/design.md` (Mobile App Design System)
