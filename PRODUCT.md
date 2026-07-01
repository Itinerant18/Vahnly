# Product

## Register

product

## Users

Riders who own cars and need professional drivers to drive them. They book in-city trips, hourly blocks, outstation routes, or monthly arrangements. Primary context: mobile-first, on-the-go, opening the app to schedule or request an immediate driver. Secondary: reviewing trip history, managing payments and account settings.

## Product Purpose

Vahnly connects car-owning riders with vetted drivers for their own vehicle. Unlike ride-hailing, the rider owns the car and the driver travels to it. The platform handles dispatch (offer-accept model), real-time GPS tracking, live trip state, fare calculation, and payment settlement. Success = reliable driver arrival, transparent pricing, and a frictionless end-to-end trip experience.

## Brand Personality

Minimalist, Dependable, Refined. The interface stays out of the way — warm off-white canvas, charcoal ink, deliberate whitespace. Every element has a job. No decoration for its own sake. The brand earns trust through clarity and consistency, not flash.

## Anti-references

- No dark mode. Single warm off-white light theme.
- No gradient text (`background-clip: text`).
- No glassmorphism as a default decorative pattern.
- No random brand colors beyond the defined palette. Charcoal (#1A1A1A) carries emphasis; steel-blue (#4A6FA5) marks accent/info.
- No heavy shadows or glow effects on cards — flat with hairline borders is the default.
- No all-caps display headlines.

## Design Principles

1. **State-driven, not page-driven.** Every screen transition follows WebSocket events. The UI is a faithful reflection of server state, not a local navigation tree. Falls in line with the offer-accept dispatch model.

2. **Trust through transparency.** Surge multipliers, fare breakdowns, driver location, ETA — all shown with explicit numbers and labels, never color alone. The rider always knows what's happening and why.

3. **Minimalist by default, animated with purpose.** The canvas is warm and uncluttered. Motion exists only to convey state change (driver approaching, offer expiring, trip advancing). No decorative entrance animations. Every animation respects `prefers-reduced-motion`.

4. **Consistency over creativity.** The design system (tokens.css) is the single source of truth. No component uses hardcoded hex values. No new UI pattern is introduced without a corresponding token or component.

5. **Mobile-first, touch-optimized.** Every interactive control is ≥44×44px. Bottom-sheet patterns dominate for CTAs. Safe areas respected. The map is the primary spatial interface; everything else layers over it.

## Accessibility & Inclusion

- WCAG AA as the baseline. Body text contrast ≥4.5:1.
- `focus-visible` accent ring on all interactive controls.
- Reduced motion fully supported via `prefers-reduced-motion` — animations collapse to 100ms crossfades or snap instantly.
- Non-color redundancy: surge, fares, countdown, status all carry explicit numeric or text labels.
- Icon-only controls carry `aria-label`. Status regions use `role="status"` / `aria-live`.
