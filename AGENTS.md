## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

## animation-progress

All 8 MagicUI components deployed across the rider app. Build passes clean (`npm run build`).

### Done
- **ShimmerButton** (15): BookingSheet "Book Driver", Dispatch "Try Again"/"Go to trip", Bill "Pay"/"Mark as Paid", Wallet "+ Add Money" & sheet submit, Support "Submit Ticket", Insurance "File a Claim", Refer "Copy Code", Rewards "Save", Login "Log In"/"Sign up with phone number"/"Reset & Log In"/"Create password & continue"/"Complete Registration"
- **BorderBeam** (9): Wallet balance card, Refer code card, Rewards active offers (staggered), Account profile card, DriverCard (green), LiveTrip fare strip, LiveTrip StatusBanner (active), BookingSheet fare strip, Dispatch DriverAssignedModal strip
- **WordRotate** (16 pages): Account, Bill, Bookings, BookingDetail, Emergency, Garage, Insurance, Legal, Notifications, Payments, Places, Profile, Refer, Rewards, Settings, Support, Wallet — cycles 3 words/3s
- **TypingAnimation** (4): Login tagline (on load), Support "No tickets yet." (in-view), Refer "No referrals yet." (in-view), Bill "Processing wallet payment…" (on payment start)
- **MorphingText** (2): Dispatch SEARCHING cycles 3 status phrases; Dispatch TIMEOUT cycles 3 messages
- **HyperText** (3): Refer referral code (scramble mount), Insurance "Your next trip is covered…" (in-view), Rewards promo confirmation (scramble save)
- **ShineBorder** (all hover): Referral list items, Rewards offers, Booking trip cards, Notifications items, Support tickets, Payments saved cards & UPI items
- **AnimatedBeam** (3): TripShare route pickup→dropoff, Payments add-card form number→expiry→name, BookingSheet trip type→pickup→dropoff
- **CoolMode + RainbowButton** (1): Booking "Book Driver" CTA — particle burst on click, rainbow animated border
- **PixelImage** (1): Profile avatar — pixel reveal on photo
- **KineticText** (1): Refer page "Your Referrals" heading — letter-weight hover effect
- **Text3DFlip** (1): Rewards page "Active Offers" heading — 3D flip on hover
- **SparklesText** (1): Rewards offer titles — sparkle animation
- **DiaTextReveal** (1): Rewards loyalty tier name — gradient sweep reveal
- **Highlighter** (1): Support FAQ answers — underline on open
- **AnimatedList** (1): Bookings trip cards — sequential spring reveal
- **AvatarCircles** (1): Profile "Connected Accounts" — overlapping avatars
- **ScrollBasedVelocity** (1): Home page marquee strip — scroll-reactive text

### Key Decisions
- `AccountScaffold` `title` prop type changed from `string` to `ReactNode` for WordRotate
- ShimmerButton replaces `RippleButton`/`<button>` — visual swap only
- BorderBeam needs `position: relative` + `overflow-hidden` on parent
- MorphingText `className` overrides default `h-16 text-[40pt]` → `h-8 text-xl`
- HyperText `children` must be plain string (backtick literals), not JSX
- ShineBorder hover uses CSS `group-hover:opacity-100` pattern with `group relative overflow-hidden`
- Section component converted to `forwardRef` for AnimatedBeam ref attachment
- AnimatedBeam uses `curvature={-30}` default, `pathColor="#4A6FA5"`, `gradientStartColor="#4A6FA5"`, `gradientStopColor="#1a5cff"`
- CoolMode wraps RainbowButton on "Book Driver" CTA for particle burst on every click/tap
- PixelImage on profile uses `grid="4x6"`, `pixelFadeInDuration={800}`, `colorRevealDelay={900}`
- SparklesText className overrides `text-6xl` → `text-sm` to fit offer card titles
- DiaTextReveal override `textColor="var(--content-primary)"` to match light theme
- RainbowButton default variant: dark bg with rainbow animated border; disabled state keeps `opacity-50`
- ScrollBasedVelocity on home page at `top: 64px` below TopBar, `text-content-tertiary/30` for subtle appearance
- AnimatedList on bookings uses `delay={500}` — 500ms between each card spring reveal; replaces BlurFade stagger`

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
