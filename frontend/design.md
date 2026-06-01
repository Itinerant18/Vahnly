# Frontend Dashboard Design System — Authentic Uber

**Name:** Operations Control Room (OCR)
**Purpose:** Real-time operations monitoring for ride-dispatch platform
**Tech Stack:** Next.js / React + TailwindCSS + Google Maps JS
**Target:** Web only (`:3000` dev, production SPA)
**Audience:** Operations teams, fleet managers, dispatchers
**Aesthetic:** Authentic Uber brand — black-and-white duet, pill geometry, Geist typography

---

## Core Brand Rules (NON-NEGOTIABLE)

1. **Black-and-white duet. NO third color.** Black (`#000000`) is the only conversion color; white (`#ffffff`) carries everything else; grayscale fills the gaps. No blue, green, orange, purple accent. Introducing an accent flattens the brand.
2. **The pill is the signature shape.** Every interactive element rounds to `rounded-pill` (999px) — buttons, chips, badges, region tags. Cards round to `rounded-xl` (16px). Inputs round to `rounded-md` (8px).
3. **Sentence-case headlines, weight 700.** No all-caps display. Uppercase only on rare small eyebrow labels.
4. **Geist for everything.** Geist Sans (display + body), Geist Mono (numbers, IDs, coordinates, timestamps). No serif.
5. **Flat by default.** Shadow reserved for floating pills and form cards (`rgba(0,0,0,0.12) 0px 4px 16px`). No glows.

---

## Design Tokens (already in tailwind.config.js)

### Color
```
primary / ink:      #000000   — conversion CTAs, footer, dark bands, text
canvas:             #ffffff   — page background
canvas-soft:        #efefef   — chips, input rows, subtle pills, hairline borders
canvas-softer:      #f3f3f3   — sidebar, nested fills
surface-pressed:    #e2e2e2   — pressed-state on white pills
black-elevated:     #282828   — hover on black pills
body:               #5e5e5e   — secondary text
mute:               #afafaf   — placeholders, fine print
on-dark:            #ffffff   — text on black surfaces
```

### Operational status (dots/badges ONLY — never as brand accent)
```
status-online:  #138000   — driver online, success
status-warn:    #a06000   — reconnecting, caution
status-alert:   #b00020   — offline, failure, critical
```
These are muted, desaturated, and appear only as 8px dots or small badge text. They never fill a button or large surface.

### Radius
```
rounded-pill:      999px  — all interactive elements
rounded-pill-tab:  36px   — tab toggles
rounded-xl:        16px   — cards, panels, drawers
rounded-md:        8px    — inputs
```

### Type (Geist)
```
Display:   700 weight, sentence-case, tracking-tight, no letter-spacing flourish
Body:      400 / 500 weight
Numbers:   font-mono (Geist Mono) — metrics, IDs, lat/lng, timestamps
```

---

## Layout (Operations Shell)

```
┌──────────────────────────────────────────────────────────────┐
│ HEADER (72px) — brand · region pill · status · ledger · lock  │
├──────────┬──────────────────────────────────┬────────────────┤
│ LEFT     │  FULL-BLEED MAP (Google Maps)     │  RIGHT DRAWER  │
│ SIDEBAR  │  minimal light style              │  (340px)       │
│ (300px)  │  black H3 surge hexes             │  cell drill-   │
│ metrics  │  (opacity-scaled, no color)       │  down / empty  │
│ + surge  │                                   │                │
├──────────┴──────────────────────────────────┴────────────────┤
│ BOTTOM PANEL (280px) — tabbed                                 │
│ Active orders · Driver queue · Vehicles · Incidents · Ledger  │
└──────────────────────────────────────────────────────────────┘
```

- **Header:** white, hairline bottom border. Brand `drivers-for-u` (bold), region as a gray pill, status with a status-online dot, "Lock terminal" black pill.
- **Left sidebar:** `bg-canvas-softer`, white metric cards (`rounded-xl border-canvas-soft`), big numbers in `font-mono`. Surge control valve lives here.
- **Map:** full-bleed, light minimal Google Maps style (`#f5f5f5` land, `#ffffff` roads, `#e9e9e9` water). Surge hexes are **black** fill, opacity scaled by density — no heat-color ramp.
- **Right drawer:** white, hairline left border. Fleet drill-down on cell select; empty-state prompt otherwise.
- **Bottom panel:** white, tabbed. Active tab marked by `border-b-2 border-ink text-ink`; inactive `text-body`.

---

## Components

### Buttons
```tsx
// Primary (conversion) — black pill
className="bg-ink hover:bg-black-elevated text-on-dark font-medium py-2 px-5 rounded-pill active:scale-[0.98]"

// Secondary — white pill
className="bg-canvas border border-canvas-soft text-ink font-medium py-2 px-5 rounded-pill"

// Subtle / chip — gray pill
className="bg-canvas-soft text-ink font-medium py-1 px-3 rounded-pill"
```

### Cards
```tsx
// Content / metric card
className="bg-canvas rounded-xl border border-canvas-soft p-5"

// Sidebar surface
className="bg-canvas-softer"
```

### Inputs
```tsx
className="bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-3 text-sm text-ink placeholder-mute focus:outline-none"
```

### Status badge / dot
```tsx
<span className="w-2 h-2 rounded-full bg-status-online" />          // online
<span className="bg-canvas-soft text-status-alert px-2 py-0.5 rounded-pill text-xs">Offline</span>
```

### Table (ledger / queue)
- Header row: `text-mute uppercase text-[10px] tracking-wider border-b border-canvas-soft`
- Body rows: `divide-y divide-canvas-soft hover:bg-canvas-softer`
- Numbers: `font-mono`
- DEBIT/CREDIT badge: `bg-ink text-on-dark` (debit) / `bg-canvas-soft text-ink` (credit) — polarity, not color

---

## Real-Time Data Flow

WebSocket events drive the UI (no polling):
```
driver.location.updated  → animate driver pin (smooth glide, never teleport)
order.state.changed      → update marker + queue row
surge.zone.updated       → recolor H3 hex opacity (black, density-scaled)
system.alert             → status dot + event row
```

---

## Do / Don't

✅ **DO**
- Keep the page black-and-white-and-gray. One black pill per visible region carries conversion.
- Use pills on every interactive element, `rounded-xl` on cards.
- Sentence-case headlines, weight 700, Geist.
- Use polarity (black fill vs gray fill) for emphasis instead of color.
- `font-mono` for all numbers, IDs, coordinates.

❌ **DON'T**
- Introduce ANY brand accent color (blue/green/orange/purple). Banned.
- Use solid status colors as buttons or large surfaces — dots/badges only.
- All-caps display headlines.
- Drop shadows on every card — flat is default.
- Use serif anywhere.

---

## Asset Paths

`frontend/src/admin/`
- `ControlRoomDashboard.tsx` — shell (header / sidebar / map / drawer / bottom tabs)
- `ActiveTripRadar.tsx` · `DriverVerificationQueue.tsx` · `VehicleProfilesMatrix.tsx` · `FleetDrillDownDrawer.tsx`
- `components/AdminAuthGateway.tsx` · `SurgeControlValve.tsx` · `IncidentRecoveryTerminal.tsx`

---

**Last Updated:** 2026-06-01
**Theme:** Authentic Uber (black-and-white duet, pill geometry, Geist)
**Reference:** Uber brand kit via design-taste-frontend-v1
