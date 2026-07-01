# Animation Enhancement Report — Rider App

---

## 1. Foundation Setup

**Build initialization:**
- Ran `npx shadcn@latest init --defaults --force` to init shadcn/ui
- Installed **14 MagicUI components** via shadcn CLI

**Dependencies installed:**
- `framer-motion`: ^12.40.0
- `motion`: ^12.42.2
- `tw-animate-css`: ^1.4.0
- `shadcn`: ^4.12.0
- `lottie-web`: ^5.13.0

**MCP Server configured** at `C:\workspace\Driver\opencode.jsonc` for MagicUI Design

---

## 2. Design Tokens & CSS Foundation

**File:** `rider-app/app/globals.css`

| Token | Value | Purpose |
|-------|-------|---------|
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Spring physics for all interactions |
| `--glow-accent` | `0 0 16px rgba(74, 111, 165, 0.15)` | Accent glow shadow |
| `--glow-positive` | `0 0 16px rgba(58, 157, 104, 0.15)` | Positive glow shadow |
| `--glow-negative` | `0 0 16px rgba(201, 64, 48, 0.15)` | Negative glow shadow |

**CSS classes defined:**

| Class | Purpose |
|-------|---------|
| `.glass-card` | `backdrop-blur(24px)` semi-transparent card |
| `.glass-solid` | `backdrop-blur(12px)` solid glass |
| `.animate-spring-up` | `springUp` keyframe — modal/sheet entrance |
| `.press-spring` | `active: scale(0.97)` spring press |
| `.lift-spring` | `hover: translateY(-2px)` + shadow |
| `.animate-sos-pulse` | SOS button pulse animation |
| `.transition-base` | 200ms quint easing |
| `.transition-moderate` | 300ms quint easing |
| `.stagger-1` through `.stagger-5` | 40–200ms animation delays |

---

## 3. MagicUI Components (14 installed)

| Component | File | Status |
|-----------|------|--------|
| `BlurFade` | `src/components/ui/blur-fade.tsx` | ✅ **Active** — 17 files |
| `NumberTicker` | `src/components/ui/number-ticker.tsx` | ✅ **Active** — 2 files |
| `RippleButton` | `src/components/ui/ripple-button.tsx` | ✅ **Active** — 1 file |
| `AnimatedShinyText` | `src/components/ui/animated-shiny-text.tsx` | ✅ **Active** — 2 files |
| `Particles` | `src/components/ui/particles.tsx` | ✅ **Active** — 1 file |
| `Ripple` | `src/components/ui/ripple.tsx` | ✅ **Active** — 1 file |
| `ShimmerButton` | `src/components/ui/shimmer-button.tsx` | ❌ Unused |
| `MorphingText` | `src/components/ui/morphing-text.tsx` | ❌ Unused |
| `WordRotate` | `src/components/ui/word-rotate.tsx` | ❌ Unused |
| `HyperText` | `src/components/ui/hyper-text.tsx` | ❌ Unused |
| `TypingAnimation` | `src/components/ui/typing-animation.tsx` | ❌ Unused |
| `BorderBeam` | `src/components/ui/border-beam.tsx` | ❌ Unused |
| `ShineBorder` | `src/components/ui/shine-border.tsx` | ❌ Unused |
| `AnimatedBeam` | `src/components/ui/animated-beam.tsx` | ❌ Unused |

---

## 4. Page-by-Page Implementation

### 4.1 Home Page (`app/(app)/home/page.tsx`)

| Element | Animation |
|---------|-----------|
| Entire page wrapper | `BlurFade` at `duration={0.5}` |

### 4.2 Dispatch Page (`app/(app)/dispatch/page.tsx`)

| Element | Animation | Details |
|---------|-----------|---------|
| Radar background | `Ripple` | `mainCircleSize={90}`, `numCircles={5}` |
| Decorative background | `Particles` | 30 dots, `#4A6FA5`, `staticity={30}` |
| "Finding a driver" text | `AnimatedShinyText` | `shimmerWidth={80}` |
| BOOKING/SEARCHING/TIMEOUT states | `BlurFade` | 3 instances, no delay |
| Driver assigned modal | `animate-spring-up` | Bottom sheet entrance |

### 4.3 Live Trip View (`app/(app)/trip/LiveTripView.tsx`)

| Element | Animation | Details |
|---------|-----------|---------|
| Status banner | `BlurFade` | Default direction |
| Right-side FABs | `BlurFade` | `direction="right" offset={8}` |
| Bottom panel | `BlurFade` | `direction="up" offset={8}` |
| FAB press | `active:scale-90` + spring easing | SOS pulse on SOS button |
| Chat messages | `BlurFade` | Direction-aware per sender |
| Cancel/extend sheets | `animate-spring-up` | Modal entrance |

### 4.4 Booking Sheet (`src/components/booking/BookingSheet.tsx`)

| Element | Animation | Details |
|---------|-----------|---------|
| Book CTA | `RippleButton` | Ripple effect + `active:scale-[0.99]` |
| Vehicle type chips | `active:scale-95` + spring easing | Spring press |
| Car picker / fare / promo modals | `animate-spring-up` | 3 separate modals |

### 4.5 Trip Sub-Components

| Component | Animation |
|-----------|-----------|
| `StatusBanner.tsx` | `AnimatedShinyText` shimmer on status label |
| `DriverCard.tsx` | Avatar green pulse ring, `enterUp` keyframe on expand, spring press |
| `SOSModal.tsx` | `animate-spring-up` confirm + active |
| `ShareTripSheet.tsx` | `animate-spring-up` entrance |
| `RideCheckModal.tsx` | `animate-spring-up` entrance |

### 4.6 Account Pages (16 files)

**Uniform pattern:**
- `BlurFade` staggered sections at `0.1`, `0.15`, `0.2`, `0.25`, `0.3`, etc.
- List items staggered at `0.1 + i * 0.05` or `0.2 + i * 0.03`
- `active:scale-[0.98]` on primary CTAs
- `active:scale-95` on secondary buttons
- `active:scale-90` on toggles / icon buttons
- `hover:scale-[1.01]` spring lift on card items

| Page | BlurFade sections | Spring buttons | hover:scale |
|------|-------------------|----------------|-------------|
| `account/page.tsx` | 5 | Links grid, logout | — |
| `profile/page.tsx` | 4 | Avatar, chips, verify, save | — |
| `bookings/page.tsx` | 3 | Tabs, actions, confirm | TripCards |
| `bookings/detail/page.tsx` | 4 | Rate, invoice, report | — |
| `settings/page.tsx` | 8 | Selection, toggle, delete | — |
| `notifications/page.tsx` | 3 | Mark read, items, link | — |
| `emergency/page.tsx` | 2 | Toggle, edit, delete, add | Contact cards |
| `garage/page.tsx` | 2 | FAB, edit, default, delete | — |
| `places/page.tsx` | 2 | Delete, add button | Place cards |
| `payments/page.tsx` | 4 | All form buttons | Card/UPI rows |
| `refer/page.tsx` | 5 | Copy, share buttons | Referral items |
| `rewards/page.tsx` | 4 | Save, remove, accordion | Offer cards |
| `legal/page.tsx` | 2 | Tabs, download, retry | — |
| `support/page.tsx` | 4 | Category, submit, chat, call | — |
| `insurance/page.tsx` | 2 | File claim button | — |

### 4.7 Wallet Page (`account/wallet/page.tsx`)

| Element | Animation |
|---------|-----------|
| Balance display | `NumberTicker` — spring `damping:60`, `stiffness:100` |
| Locked amount | `NumberTicker` — animated counter |
| Balance card | `BlurFade` wrapper |
| Add Money button | `BlurFade delay={0.1}` + `active:scale-[0.98]` |
| Transactions heading | `BlurFade delay={0.15}` |
| Transaction rows | `BlurFade` stagger `delay={0.2 + i * 0.03}` + `inView` |
| Add Money sheet | `animate-spring-up` entrance |

---

## 5. Build Status

```
✓ Compiled successfully in 4.2s
✓ TypeScript passed (7.5s)
✓ 30 static pages generated
✓ 0 errors, 0 warnings
```

**All 28 routes build clean:**
`/`, `/account/*` (16), `/dispatch`, `/home`, `/login`, `/onboarding`, `/privacy`, `/terms`, `/trip-share`, `/trip/bill`, `/trip/live`, `/trip/rate`, `/trip/receipt`

---

## 6. Unused Components (available for future work)

These 8 MagicUI components exist but are **not deployed** anywhere:
`ShimmerButton`, `MorphingText`, `WordRotate`, `HyperText`, `TypingAnimation`, `BorderBeam`, `ShineBorder`, `AnimatedBeam`

---

## 7. Key Design Decisions

- **No gradients** — solid accent colors only (`bg-accent-400`, `bg-interactive-primary`, etc.)
- **Light theme only** — warm off-white base (`bg-background-primary`), charcoal text (`text-content-primary`), steel blue accent (`accent-400: #4A6FA5`)
- **Animation is the accent** — movement replaces gradient/depth as visual interest
- **Spring physics** via `cubic-bezier(0.34, 1.56, 0.64, 1)` everywhere — buttons press, cards lift, toggles slide
- **`BlurFade`** chosen over manual framer-motion wrappers for simpler staggered entrance patterns
- **`animate-spring-up`** (CSS keyframe) used for modals/sheets instead of framer-motion to avoid import overhead
