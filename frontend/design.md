# Frontend Dashboard Design System — Uber Aesthetic

**Name:** Operations Control Room (OCR) — Uber Dispatch  
**Purpose:** Real-time operations monitoring for ride-dispatch platform  
**Tech Stack:** Next.js 15 + React + TailwindCSS v4 + Shadcn UI + Mapbox GL  
**Target:** Web only (`:3000` dev, production SPA)  
**Audience:** Operations teams, fleet managers, dispatchers  
**Aesthetic:** Uber-inspired dark tech, electric blue accents, premium polish

---

## Design Philosophy

**Black Canvas, Blue Purpose.** Uber's aesthetic is about precision, clarity, and motion. The OCR dashboard applies this philosophy:
- **Minimal chromatic noise** — one accent color (electric blue), everything else grayscale.
- **High contrast for legibility** — operators work long shifts; readability is non-negotiable.
- **Purposeful motion only** — no decorative animation; every frame communicates state change or urgency.
- **Premium polish** — refined borders, precise shadows, clean typography.
- **Map-first thinking** — the map is the primary interface; panels support, not dominate.

---

## Design Tokens (Uber Palette)

### Color Palette
```
Black 950:     #0A0E27 (Pure black bg)       — Page background
Black 900:     #1A1F3A (Darkest panels)      — Sidebar, panels
Black 850:     #252D48 (Dark card bg)        — Cards, containers
Black 800:     #313958 (Medium dark)         — Hover states, dividers

Slate 600:     #64748B (Muted text)          — Secondary text, labels
Slate 400:     #94A3B8 (Lighter text)        — Tertiary text
Slate 100:     #F1F5F9 (Primary text)        — Body text (on dark)
White:         #FFFFFF                       — Emphasis text, highlights

Uber Blue:     #0073E6 (Electric blue)       — Primary accent, CTAs, active states
Blue 600:      #0056B3 (Darker blue)         — Hover on blue
Blue 400:      #4DA3FF (Lighter blue)        — Highlights, focus rings

Success:       #10B981 (Emerald)             — Online, completed, success state
Warning:       #F59E0B (Amber)               — Surge active, caution, warnings
Danger:        #EF4444 (Red)                 — Offline, failed, critical alerts
Info:          #06B6D4 (Cyan)                — Informational, neutral alerts

Ghost:         #FFFFFF with 8% opacity      — Subtle dividers, borders
```

### Spacing
- xs: 4px | sm: 8px | md: 16px | lg: 24px | xl: 32px | 2xl: 48px

### Typography (Geist Family)
- **Headers:** Geist Bold, 18px–24px, line-height 1.2, letter-spacing -0.01em
- **Body:** Geist Regular, 14px, line-height 1.6, letter-spacing 0
- **Labels:** Geist Medium, 12px, line-height 1.4, uppercase tracking 0.04em
- **Monospace:** Geist Mono, 12px, line-height 1.5 (for IDs, timestamps, metrics, coordinates)

### Border & Shadow System
- **Border Radius:** 8px on cards/modals, 6px on input fields, 4px on buttons/badges
- **Borders:** 1px solid rgba(255, 255, 255, 0.08) — subtle, barely visible
- **Elevation (Shadow):**
  - **Level 1 (Subtle):** `shadow-[0_2px_8px_rgba(0,0,0,0.4)]`
  - **Level 2 (Medium):** `shadow-[0_4px_16px_rgba(0,0,0,0.6)]`
  - **Level 3 (Prominent):** `shadow-[0_8px_32px_rgba(0,0,0,0.8)]`
- **No outer glows.** Keep edges sharp and defined.

---

## Layout Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                    HEADER / NAVBAR (72px fixed)                      │
│  Uber Logo | Region | Status | Alerts | User Menu | Theme           │
├──────────────────────────────────────────────────────────────────────┤
│         │                                             │                │
│  LEFT   │       FULL-BLEED MAP (Mapbox GL)           │     RIGHT      │
│ SIDEBAR │  • H3 Surge Heatmap Overlay                │    SIDEBAR     │
│ (280px) │  • Driver Pins (animated glide)            │   (320px)      │
│ Collapsible  • Order Markers (color-coded)            │  Collapsible   │
│         │  • Route Polylines (Emerald)               │                │
│         │                                             │                │
├──────────────────────────────────────────────────────────────────────┤
│              BOTTOM PANEL (240px, collapsible, tabbed)               │
│  Tabs: Active Orders | Metrics | Event Log | Performance            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Header / Navigation Bar (72px)

**Fixed position, top 0, z-50.**

Layout: `flex items-center justify-between px-6 h-[72px] bg-[#1A1F3A] border-b border-white/8`

- **Left:** Uber logo (24px mark) + region selector (pill button, `bg-white/8`, text-white, 8px padding).
- **Center:** Live status indicators (connection: green/red dot, system health: text + icon, timestamp UTC).
- **Right:** Alert count (badge), user menu (avatar + dropdown).

### Status Bar (Inline)
```
🟢 Connected | 47/60 online | Peak: 2.1x | No critical alerts
```
- Text: `text-slate-400`, font-size 13px, mono family
- Icons: Phosphor Icons, 16px, weight 600

---

## Left Sidebar — Filters & Fleet Summary (280px, Collapsible)

**Background:** `bg-[#252D48]`, border-right `border-white/8`

### Section 1: Control Panel Header
```
╔════════════════════╗
║  🎛️ CONTROL PANEL  ║
╚════════════════════╝
```
- Type: `Geist Bold 16px`, text-white
- Border bottom: `border-white/8`
- Padding: `px-6 py-4`

### Section 2: Filters
```
┌─ Search Orders ────────────────┐
│ [🔍 Order ID / Phone]          │
└────────────────────────────────┘

Status Filter
□ All        □ Created
□ Assigned   ☑ In Trip
□ Completed  □ Cancelled

Driver Status
☑ Online     □ Offline
□ On Break   □ Inactive

Display Options
☑ Surge Heatmap
☑ Driver Pins
☑ Route Lines
☑ Order Markers
```

### Section 3: Fleet Summary Cards
Each card: `bg-[#313958] rounded-lg border border-white/8 p-4 mb-4`

```
┌─────────────────────────┐
│ 🚗 Fleet Size           │
│ 47 / 60 online         │
│ ━━━━━━━━━━━━━━━━━━━━ │
│ 78% Utilization        │
└─────────────────────────┘

┌─────────────────────────┐
│ 📊 Today's Orders      │
│ 312 completed (+12/hr) │
│ 28 active              │
│ 5 failed               │
└─────────────────────────┘

┌─────────────────────────┐
│ 💰 Revenue             │
│ $4,240 today           │
│ +$340 vs 2pm           │
│ Avg: $13.56 / order    │
└─────────────────────────┘

┌─────────────────────────┐
│ ⚡ Surge Summary        │
│ Peak: 2.1x (1:15pm)   │
│ Current: 1.3x          │
│ Avg: 1.2x              │
└─────────────────────────┘
```

- Card heading: `Geist Bold 13px`, text-white
- Card metric: `Geist Bold 18px`, text-white
- Card secondary: `Geist Regular 12px`, text-slate-400
- Progress bar: `bg-[#0073E6]/20`, filled bar `bg-[#0073E6]`, height 2px

---

## Main Map Area (Full-Bleed)

**Canvas:** Mapbox GL, dark theme (`mapbox://styles/mapbox/dark-v11` or custom dark variant)

### Mapbox Layers (Bottom to Top)
1. **Base Map** — Dark Mapbox style, muted colors
2. **H3 Hex Grid** — Surge zones, color scale:
   - Light yellow (1.0x) → Amber (1.3x) → Orange (1.6x) → Red (2.0x+)
   - Cell opacity: 0.7, border: white/10, weight: 1px
3. **Driver Pins** — 24px circles, color-coded:
   - Green (#10B981) — Online, available
   - Blue (#0073E6) — Online, on trip
   - Gray (#64748B) — Offline / break
   - Red (#EF4444) — Inactive (no location > 5min)
   - **Animation:** Smooth glide on update (4s linear interpolation)
4. **Order Markers** — Smaller pins:
   - Blue (#0073E6) — Pickup location
   - Red (#EF4444) — Dropoff location
5. **Route Polylines** — In-trip orders only:
   - Emerald (#10B981), width: 3px, opacity: 0.8
6. **Selection Overlay** — When drilling into a pin:
   - 60px circular pulse animation (Emerald, opacity fade, 1.5s repeat)

### Map Controls
- **Zoom:** Standard +/- buttons, top-right corner, `bg-[#1A1F3A]/80`, text-white
- **Fullscreen:** Icon button, top-right below zoom
- **Reset Bounds:** Icon button, top-right, resets to city view

### Hover & Click States
- **Driver pin hover:** Scale 1.2, glow `shadow-[0_0_12px_rgba(0,115,230,0.6)]`
- **Driver pin click:** Opens right sidebar drill-down
- **H3 cell hover:** Border brightens to white/20
- **H3 cell click:** Shows modal with cell stats (demand, ETA, earnings)

---

## Right Sidebar — Drill-Down Details (320px, Collapsible)

**Background:** `bg-[#252D48]`, border-left `border-white/8`

### When Driver Pin Tapped

```
┌─────────────────────────────────┐
│ 👤 DRIVER PROFILE               │
├─────────────────────────────────┤
│ Alex Chen                       │
│ ⭐ 4.8 / 2,340 trips           │
│ 🚗 Toyota Prius (LMP32)         │
│ 📱 +1-555-1234                  │
│ 🎫 License: DL789XYZ            │
├─────────────────────────────────┤
│ 📊 TODAY'S STATS                │
│ Trips: 12 completed            │
│ Revenue: $156.50               │
│ Avg Rating: 4.9                │
│ Online Time: 6h 45m            │
├─────────────────────────────────┤
│ 📍 LOCATION (Live)              │
│ Lat: 22.5726°N                 │
│ Lng: 88.3639°E                 │
│ Bearing: 45° NE                │
│ Speed: 32 mph                  │
│ Last Update: 2m ago            │
├─────────────────────────────────┤
│ 📋 ACTIVE ORDER (if any)        │
│ Order: ORD-0012345             │
│ State: IN_TRIP                 │
│ ETA: 3m 15s                    │
│ Fare: $8.75                    │
│ [View Order] [Call Driver]     │
└─────────────────────────────────┘
```

Section headers: `Geist Bold 12px`, uppercase, text-slate-400, tracking 0.04em
Data points: `Geist Regular 14px`, text-white
Secondary: `Geist Regular 12px`, text-slate-400

### When Order Marker Tapped

```
┌─────────────────────────────────┐
│ 📦 ORDER DETAILS                │
├─────────────────────────────────┤
│ Order: ORD-0012345             │
│ State: IN_TRIP ●               │ ← Colored dot matches state
│ Created: 1:04 PM               │
│ ETA: 1:12 PM (8m remaining)    │
├─────────────────────────────────┤
│ 👤 RIDER                        │
│ Sarah Khan                      │
│ ⭐ 4.6 / 89 trips              │
│ 📱 +1-555-5678                  │
├─────────────────────────────────┤
│ 🚗 DRIVER                       │
│ Alex Chen                       │
│ ⭐ 4.8 / 2,340 trips           │
│ Toyota Prius (LMP32)            │
├─────────────────────────────────┤
│ 📍 ROUTE                        │
│ Pickup: 123 Main St            │
│ Dropoff: 567 Park Ave          │
│ Distance: 2.5 miles            │
│ Duration: 8m 20s (est.)        │
│ Fare: $12.50                   │
├─────────────────────────────────┤
│ ⏱️ TIMELINE                     │
│ ✓ 1:04 PM - Order Created      │
│ ✓ 1:05 PM - Driver Assigned    │
│ ✓ 1:07 PM - Pickup Arrived     │
│ ⟳ 1:09 PM - Trip Started       │
│ ─ 1:12 PM - Est. Completion    │
├─────────────────────────────────┤
│ [Cancel] [Call Driver]          │
└─────────────────────────────────┘
```

### State Color Dots
- Green (#10B981) — Completed, online
- Blue (#0073E6) — In progress, assigned
- Amber (#F59E0B) — Pending, warning
- Red (#EF4444) — Failed, offline
- Gray (#94A3B8) — Neutral, idle

---

## Bottom Panel — Order Queue & Metrics (240px, Tabbed, Collapsible)

**Background:** `bg-[#1A1F3A]`, border-top `border-white/8`

### Tab Navigation
Inline tabs: `text-slate-400 px-4 py-2`, active tab: `text-[#0073E6] border-b-2 border-[#0073E6]`

### Tab 1: Active Orders Queue

```
┌───────────────────────────────────────────────────────────────────┐
│ 🔄 ACTIVE ORDERS (28)                          [Refresh] [Expand] │
├──────────────────────────────┬────────────┬──────────┬────────────┤
│ ID         │ Rider    │ Driver  │ State    │ ETA     │
├──────────────────────────────┼────────────┼──────────┼────────────┤
│ ORD-0001   │ Sarah K. │ Alex C. │ IN_TRIP  │ 3m 15s  │
│ ORD-0002   │ John D.  │ Maria L.│ ASSIGNED │ 5m 40s  │
│ ORD-0003   │ Amy W.   │ (none)  │ CREATED  │ —       │
│ ORD-0004   │ Bob T.   │ Raj P.  │ IN_TRIP  │ 2m 10s  │
│ ORD-0005   │ Lisa M.  │ Kim S.  │ ASSIGNED │ 7m 20s  │
└──────────────────────────────┴────────────┴──────────┴────────────┘
```

- Table font: `Geist Mono 12px`, text-slate-400
- Row hover: `bg-[#313958]/40`
- Row click: Opens right sidebar drill-down
- Status badge: Colored pill, 6px padding, 4px radius

### Tab 2: Metrics (Real-Time)

```
┌───────────────────────┬──────────────────────────────────┐
│ Orders Completed      │ 312 (↑ 12 this hour)            │
│ Avg Completion Time   │ 7m 32s (↓ 18s vs yesterday)    │
│ Revenue Today        │ $4,240 (↑ $340 vs 2pm)          │
│ Driver Utilization    │ 78% (9 idle, 47 active)        │
│ Avg Surge Multiplier  │ 1.3x (peak: 2.1x at 1:15pm)    │
│ System Health        │ ✓ All systems nominal           │
│ Response Latency     │ 45ms (p95: 120ms)               │
│ WebSocket Connections│ 47 drivers live                 │
└───────────────────────┴──────────────────────────────────┘
```

Each metric row:
- Label: `Geist Medium 12px`, text-slate-400
- Value: `Geist Bold 16px`, text-white
- Trend: `Geist Regular 12px`, color green/red based on direction

### Tab 3: Event Log

```
┌───────────────────────────────────────────────────────────┐
│ 📋 EVENT LOG (Last 50)            [Export] [Clear] [>]   │
├───────────────────────────────────────────────────────────┤
│ 1:15 PM │ ✓ ORD-0012 completed ($12.50)                 │
│ 1:14 PM │ ⚠️  Pod failover detected (api-gateway-3)     │
│ 1:14 PM │ ✓ Reconnected (16 drivers)                    │
│ 1:13 PM │ 📞 Driver support call (ORD-0011)            │
│ 1:12 PM │ ⚙️  Surge zone update: KOL-A05 → 1.8x       │
│ 1:11 PM │ 💰 Order completed (ORD-0010, $9.80)         │
│ 1:10 PM │ 🔴 Alert: 3 drivers offline                 │
└───────────────────────────────────────────────────────────┘
```

Each log row:
- Timestamp: `Geist Mono 12px`, text-slate-400
- Event: `Geist Regular 13px`, text-white
- Icon: Phosphor, 16px, weight 600
- Log row hover: `bg-white/4`

---

## Component Library

### Status Badge (Pill)
```tsx
<span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium">
  {/* Colored dot + status text */}
</span>
```

Colors by state:
- `CREATED` → Gray bg, gray dot
- `ASSIGNED` → Blue/10 bg, blue dot
- `IN_TRIP` → Emerald/10 bg, emerald dot
- `COMPLETED` → Emerald/10 bg, emerald dot
- `CANCELLED` → Red/10 bg, red dot

### Data Table Row
```tsx
<div className="flex items-center gap-4 px-4 py-3 border-b border-white/4 hover:bg-white/4 cursor-pointer">
  {/* Columns */}
</div>
```

### Metric Card (Sidebar)
```tsx
<div className="bg-[#313958] rounded-lg border border-white/8 p-4 mb-4">
  <h3 className="text-xs font-medium uppercase text-slate-400 tracking-wider">Label</h3>
  <p className="text-lg font-bold text-white mt-2">Value</p>
  <p className="text-xs text-slate-400 mt-1">Secondary</p>
</div>
```

### Buttons (Primary CTA)
```tsx
<button className="px-4 py-2 rounded-md bg-[#0073E6] text-white font-medium text-sm hover:bg-[#0056B3] active:scale-95 transition-all">
  Action
</button>
```

Variants:
- **Primary:** Blue bg, white text
- **Secondary:** White/8 bg, white text, white/8 border
- **Danger:** Red/20 bg, red text
- **Disabled:** White/4 bg, text-slate-500

### Input Fields
```tsx
<input 
  className="w-full px-3 py-2 rounded-md bg-[#313958] border border-white/8 text-white text-sm placeholder:text-slate-500 focus:border-[#0073E6] focus:outline-none focus:ring-1 focus:ring-[#0073E6]/30"
  placeholder="Search orders..."
/>
```

---

## Real-Time Updates & WebSocket Integration

### Events Listened
- `driver.location.updated` → Update pin position (smooth 4s glide)
- `order.state.changed` → Update marker color + queue table
- `surge.zone.updated` → Update H3 heatmap colors
- `system.alert` → Add to event log + alert count

### Smooth Motion (MINIMAL)
- **Driver glide:** 4s linear interpolation, no easing bounce
- **Hover glow:** Subtle shadow, no scale
- **Tab transition:** Instant (no animation)
- **Panel open/close:** 200ms cubic-ease (if needed)

**Guiding principle:** Motion communicates state change only. No decorative loops, no perpetual pulsing.

---

## Dark Mode (Default & Only Mode)

**Single theme.** No light mode toggle. Dark mode is the only aesthetic.

Token strategy: **CSS variables** scoped to `[data-theme="dark"]` root (or always-dark default).

```
--bg-primary: #0A0E27
--bg-secondary: #1A1F3A
--bg-tertiary: #252D48
--bg-hover: rgba(255, 255, 255, 0.04)
--text-primary: #F1F5F9
--text-secondary: #94A3B8
--text-muted: #64748B
--accent: #0073E6
--border: rgba(255, 255, 255, 0.08)
```

---

## Responsive Behavior

- **Desktop (1920px+):** Full layout, all sidebars visible, bottom panel 240px
- **Laptop (1366px):** Sidebars collapse to icon-only (24px width), bottom panel 200px
- **Tablet (< 1024px):** Left/Right sidebars stack into modals (tap hamburger), bottom panel full-width above map
- **Mobile (< 768px):** NOT SUPPORTED — ops dashboards are desktop-only tools

---

## Performance & Accessibility

### Motion & Reduced Motion
- Respect `prefers-reduced-motion` → disable all animations, show instant state
- WebSocket updates drive all motion; never use `requestAnimationFrame` for React state

### Core Web Vitals
- **LCP < 1.5s** — map loads lazily after header/sidebar
- **INP < 100ms** — heavy updates (table re-render) off main thread via Web Workers
- **CLS < 0.05** — reserved space for all dynamic content

### Accessibility
- Focus rings: 2px solid `#0073E6` around interactive elements
- Contrast: All text passes WCAG AAA (7:1+) on dark backgrounds
- Keyboard nav: Tab through sidebar filters, table rows, all CTAs
- Aria labels on icons, roles on landmarks (navigation, main, complementary)

---

## Do's & Don'ts

✅ **DO:**
- Stream all data via WebSocket; updates push in real-time.
- Animate driver pins smoothly; never teleport.
- Use one accent color (Uber Blue) everywhere.
- Keep sidebars collapsible to maximize map view.
- Test in dark mode only (no other mode exists).
- Use Geist typography exclusively.

❌ **DON'T:**
- Poll API endpoints; use WebSocket.
- Add neon glows or outer shadows.
- Use more than one accent color.
- Default to rounded corners; use sharp or minimal rounding (4–8px).
- Add decorative animations; motion = state change only.
- Mix light/dark sections or invert mid-page.

---

## Asset & Component Paths

**Path:** `frontend/src/components/`

- `Header.tsx` — Fixed navbar (72px)
- `LeftSidebar.tsx` — Filters + fleet summary (280px, collapsible)
- `MapArea.tsx` — Full-bleed Mapbox GL
- `RightSidebar.tsx` — Drill-down details (320px, context-sensitive)
- `BottomPanel.tsx` — Order queue + metrics + event log (tabbed)
- `StatusBadge.tsx` — Reusable pill component
- `DataTable.tsx` — Order queue table
- `MetricCard.tsx` — Fleet summary card

**Path:** `frontend/src/lib/`

- `mapbox-layers.ts` — H3 grid, driver pins, routes, overlays
- `websocket-handlers.ts` — Event routing (location, order state, surge)
- `color-state-map.ts` — State → color/icon mappings

---

**Last Updated:** 2026-06-01  
**Theme:** Uber Aesthetic (Electric Blue, Black Canvas, Geist Typography)  
**Status:** Ready for implementation
