# MagicUI Component Deployment Plan

## Goal
Deploy 8 unused MagicUI components to the rider app for maximum visual impact.

## Available Components

| Component | Best For | Difficulty | Files to Touch |
|-----------|----------|------------|----------------|
| **ShimmerButton** | Primary CTAs (shimmer gradient) | Easy — swap className | ~12 files |
| **MorphingText** | Headings / status labels (morph between words) | Medium — add state + component | ~8 files |
| **WordRotate** | Page titles (rotating carousel) | Easy — wrap text | ~5 files |
| **HyperText** | Reveal effects on mount (scramble/reveal) | Medium — add on-mount trigger | ~6 files |
| **TypingAnimation** | Placeholders / empty states (typewriter) | Easy — swap text | ~6 files |
| **BorderBeam** | Hero cards / premium sections (rotating border) | Easy — wrap element | ~12 files |
| **ShineBorder** | Hover glow on cards/buttons | Medium — conditional on hover | ~8 files |
| **AnimatedBeam** | Flow visualization (SVG connections) | Hard — needs container + refs | ~4 files |

---

## Phase 1 — High Impact, Low Risk (1 session)

### 1.1 ShimmerButton — Primary CTAs
Swap the `className` of primary action buttons to use `ShimmerButton` component.

| Page | Button | Current | Replace With |
|------|--------|---------|--------------|
| Landing `page.tsx:156` | "Get Started Now" | Plain black btn | ShimmerButton |
| Home `BookingSheet.tsx:779` | "Book Driver" | RippleButton | ShimmerButton (keep ripple) |
| Dispatch `dispatch/page.tsx:412` | "Try Again" | Solid btn | ShimmerButton |
| Trip `LiveTripView.tsx:624` | SOS FAB | Red FAB | ShimmerButton (red shimmer) |
| Bill `trip/bill/page.tsx:240` | "Pay" | Solid btn | ShimmerButton |
| Wallet `wallet/page.tsx:92` | "Add Money" | Solid btn | ShimmerButton |
| Bookings `bookings/page.tsx:117` | "Rebook" | Tertiary btn | ShimmerButton |
| Support `support/page.tsx:385` | "Submit Ticket" | Solid btn | ShimmerButton |
| Insurance `insurance/page.tsx:373` | "File a Claim" | Solid btn | ShimmerButton |
| Refer `refer/page.tsx:82` | "Copy Code" | Semi-transparent | ShimmerButton |
| Rewards `rewards/page.tsx:97` | "Save" (promo) | Solid btn | ShimmerButton |
| Login `login/page.tsx` | "Log In" / "Sign up" | Solid btn | ShimmerButton |

**Risk:** Low — component already installed, behavior is identical. Just a visual swap.

---

### 1.2 BorderBeam — Premium Section Wrappers
Wrap hero/card sections in `BorderBeam` for animated rotating border.

| Page | Element | Effect |
|------|---------|--------|
| Landing `page.tsx:171-220` | 4 Feature cards (bento grid) | Rotating gradient border on each card |
| Home `BookingSheet.tsx` | Fare estimate strip | Animated border around pricing |
| Trip `DriverCard.tsx:60` | Entire DriverCard | Rotating border around driver info |
| Trip `LiveTripView.tsx` | StatusBanner | Glowing animated border on active status |
| Account `account/page.tsx` | Profile card (top) | Animated border around rider identity |
| Profile `profile/page.tsx` | Avatar upload circle | Animated border around photo |
| Wallet `wallet/page.tsx` | Balance card | Rotating border around balance |
| Payments `payments/page.tsx` | Default saved card | Animated border on primary method |
| Bookings `bookings/page.tsx` | Active tab button | Rotating border shows which tab is active |
| Notifications `notifications/page.tsx` | Unread notification items | Animated border = unread visual indicator |
| Support `support/page.tsx` | Selected category card | Rotating border on chosen category |
| Login `login/page.tsx` | Active mode toggle (Login/Signup) | Animated border around active auth mode |

**Risk:** Low — component already installed. Needs `position: relative` on parent. Add `<BorderBeam>` child.

---

## Phase 2 — Medium Impact, Low Risk (1 session)

### 2.1 WordRotate — Page Titles & Labels
Replace static page titles with rotating word carousels.

| Page | Current Text | Rotation Words |
|------|-------------|----------------|
| Account | "Account" | Account, Profile, You |
| Support | "Support" | Support, Help Center, Contact Us |
| Settings | "Settings" | Settings, Preferences, Options |
| Wallet | "Wallet" | Wallet, Balance, Payments |
| Rewards | "Promos & Offers" | Promos & Offers, Rewards, Deals |
| Refer | "Refer & Earn" | Refer & Earn, Invite Friends, Share & Get Rewarded |
| Notifications | "Notifications" | Notifications, Updates, Alerts |
| Trips | "My Trips" | My Trips, Ride History, Your Journeys |
| Legal | "Legal" | Legal, Policies, Documents |
| Insurance | "Insurance & Care" | D4M Care, Insurance, Protection |
| Emergency | "Emergency Contacts" | Emergency, Safety Contacts, ICE Contacts |
| Booking Detail | "Trip Detail" | Trip Detail, Journey Info, Ride Details |

**Risk:** Low — component already installed. Just wrap `<h1>` text with `<WordRotate words={[...]} />`.

---

### 2.2 TypingAnimation — Placeholders & Empty States
Replace static placeholder/empty-state text with typewriter effect.

| Page | Current Text | Trigger |
|------|-------------|---------|
| Login | "Your car. Our driver." tagline | On page load |
| Support | Empty ticket list "No tickets yet." | On mount |
| Refer | "No referrals yet. Share your code!" | On mount |
| Rewards | Expired offers description | On accordion expand |
| Bill | "Processing wallet payment…" | On payment start |
| Dispatch TIMEOUT | "Try increasing your search radius" | On mount |

**Risk:** Low — component already installed. Replace `<p>` with `<TypingAnimation>`.

---

## Phase 3 — High Impact, Medium Risk (1 session)

### 3.1 MorphingText — Status Transitions & Engaging Text
Replace static text that changes state with smooth morphing animation.

| Page | Element | Morph Sequence |
|------|---------|----------------|
| Dispatch | "Finding a driver near you…" | "Finding a driver…" → "Scanning nearby drivers…" → "Matching with the best…" |
| Dispatch TIMEOUT | "No drivers available" | "No drivers available" → "All drivers busy" → "Try again soon" |
| Rate | Star-rating caption | "Tap to rate" → "Good" → "Great!" → "Excellent!" → "Perfect!" |
| Trip Share | Status label | "Driver on the way" → "Arrived" → "Trip in progress" |
| Login | Tagline | "Your car. Our driver." → "Your journey. Our service." → "Your safety. Our priority." |
| StatusBanner | Status label | Morphs between trip statuses on WS events |

**Risk:** Medium — needs state management tied to existing transitions. The status sequences already have clear state machines (WS events, rating clicks, etc.).

---

### 3.2 HyperText — Scramble/Reveal Effects
Add scramble/reveal on mount for key text reveals.

| Page | Element | When |
|------|---------|------|
| Login | Tagline "Your car. Our driver." | On page load |
| Refer | Referral code display | On page load |
| Rewards | Saved promo code confirmation | On code save |
| Emergency | Auto-share info tooltip | On tooltip open |
| Insurance | "Your next trip is covered" | On page load |

**Risk:** Medium — needs `trigger` state. Add `useEffect` + boolean to trigger once on mount.

---

## Phase 4 — Social/Proof Points, Medium Risk (1 session)

### 4.1 BorderBeam (continued) + ShineBorder on Lists

**ShineBorder — Hover Glow on List Items**

| Page | Element | Effect |
|------|---------|--------|
| Refer | Referral list items | Glowing border on hover |
| Rewards | Active offer cards | Glowing border on hover |
| Bookings | TripCard items | Glowing border on hover |
| Notifications | Notification items | Glowing border on hover |
| Support | Ticket history items | Glowing border on hover |
| Payments | Saved card entries | Glowing border on hover |

**Risk:** Low — component already installed. Add `ShineBorder` as sibling with conditional `show={isHovered}`.

---

## Phase 5 — Complex, High Impact (1-2 sessions)

### 5.1 AnimatedBeam — Flow Visualization

| Page | Connection | Nodes |
|------|-----------|-------|
| Landing `page.tsx` | Feature ecosystem | Center icon → 4 feature cards (radial) |
| Trip Share `trip-share/page.tsx` | Route visualization | Green pickup dot → Red drop-off dot |
| Trip Detail `bookings/detail/page.tsx` | Timeline route | Green dot → Red dot (replaces static dots) |
| Payments `payments/page.tsx` | Form flow | Card number → Expiry → Name on card |
| BookingSheet | Booking flow | Trip type → Pickup → Dropoff → Car |

**Risk:** Higher — needs container with `relative`, `div` refs for each endpoint. Most impactful on Trip Share (live route animation) and Landing page (ecosystem visualization).

---

## Summary by Session

| Session | Components | Files | Effort |
|---------|-----------|-------|--------|
| **Session 1** | ShimmerButton (12), BorderBeam (12) | ~20 files | Large but mechanical |
| **Session 2** | WordRotate (12), TypingAnimation (6) | ~15 files | Medium — text swaps |
| **Session 3** | MorphingText (6), HyperText (5) | ~10 files | Medium — state binding |
| **Session 4** | ShineBorder (6) | ~6 files | Easy — hover additions |
| **Session 5** | AnimatedBeam (4-5) | ~5 files | Complex — refs + layout |

**Recommended order:** Session 1 → Session 2 → Session 4 → Session 3 → Session 5

This prioritizes high-impact, low-risk changes first (ShimmerButton + BorderBeam transform the app's perceived quality immediately) and defers the most complex work (AnimatedBeam) to last.

---

## Key Constraints

- No logic/API changes — 100% UI only
- No gradients (already present in app are fine, don't add new ones)
- Light theme, solid colors
- Consistent spring easing: `cubic-bezier(0.34, 1.56, 0.64, 1)`
- Build must pass clean after each session
