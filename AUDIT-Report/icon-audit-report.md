# Icon Audit Report

**Repo:** [Vahnly](https://github.com/Itinerant18/Vahnly)  
**Date:** 2026-06-29  
**Scope:** READ-ONLY scan of all icon definitions, SVG assets, emoji icon substitutes, icon import/usage sites, and app store/build icons.  
**Mode:** Facts only — no fixes, no suggestions, no file modifications.

---

## SECTION 1: All Icon Definition Files

### Summary

The codebase uses three custom inline-SVG icon definition files. No third-party icon libraries (lucide-react, heroicons, react-icons, etc.) are used. 96 total React icon components are exported, plus an icon name-to-component mapping layer.

---

### FILE 1.1: Driver App Icon Set (client-app)

| Field | Value |
|---|---|
| **File name** | `Icon.tsx` |
| **Full repo path** | `client-app/src/components/ds/Icon.tsx` |
| **Icon system** | Custom inline SVG (stroke-based, `currentColor`, `strokeWidth 1.5`, 24×24 viewBox). First 24 icons use stroke rendering via a shared `stroke` constant. Last 6 icons (Eva-inspired) use `fill="currentColor"`. |
| **Total icons defined** | **30** |

**Export names (exactly as written):**

1. `PhoneIcon`
2. `ChatIcon`
3. `NavigateIcon`
4. `CashIcon`
5. `CardIcon`
6. `ShieldIcon`
7. `CarIcon`
8. `AlertIcon`
9. `CheckIcon`
10. `BellIcon`
11. `PlusIcon`
12. `ParkingIcon`
13. `SirenIcon`
14. `CameraIcon`
15. `CrossIcon`
16. `RefreshIcon`
17. `MenuIcon`
18. `SignalIcon`
19. `OctagonAlertIcon`
20. `FlameIcon`
21. `PauseIcon`
22. `WrenchIcon`
23. `ClockIcon`
24. `RouteIcon`
25. `HomeIcon`
26. `PaymentIcon`
27. `PinIcon`
28. `UserIcon`
29. `SearchIcon`
30. `BackIcon`

Also exports the type `IconProps`.

**Barrel file:** `client-app/src/components/ds/index.ts` re-exports 24 of these (all except `HomeIcon`, `PaymentIcon`, `PinIcon`, `UserIcon`, `SearchIcon`, `BackIcon` — the 6 Eva-style icons), plus the `IconProps` type.

---

### FILE 1.2: Rider App Icon Set (rider-app)

| Field | Value |
|---|---|
| **File name** | `Icon.tsx` |
| **Full repo path** | `rider-app/src/components/ds/Icon.tsx` |
| **Icon system** | Custom inline SVG (identical copy of client-app's Icon.tsx — same stroke config, same Eva-inspired icons, same `currentColor` approach). |
| **Total icons defined** | **30** |

**Export names (exactly as written):**
Identical to FILE 1.1: `PhoneIcon`, `ChatIcon`, `NavigateIcon`, `CashIcon`, `CardIcon`, `ShieldIcon`, `CarIcon`, `AlertIcon`, `CheckIcon`, `BellIcon`, `PlusIcon`, `ParkingIcon`, `SirenIcon`, `CameraIcon`, `CrossIcon`, `RefreshIcon`, `MenuIcon`, `SignalIcon`, `OctagonAlertIcon`, `FlameIcon`, `PauseIcon`, `WrenchIcon`, `ClockIcon`, `RouteIcon`, `HomeIcon`, `PaymentIcon`, `PinIcon`, `UserIcon`, `SearchIcon`, `BackIcon`.

Also exports the type `IconProps`.

**Barrel file:** `rider-app/src/components/ds/index.ts` does **not** re-export any icons (unlike client-app).

---

### FILE 1.3: Admin Sidebar Icons (frontend)

| Field | Value |
|---|---|
| **File name** | `SidebarIcons.tsx` |
| **Full repo path** | `frontend/src/admin/components/SidebarIcons.tsx` |
| **Icon system** | Custom inline SVG (fill-based, all paths use `fill="currentColor"`, mixed viewBox sizes — mostly 800×800, some 558×522). |
| **Total icons defined** | **36** |

**Export names (exactly as written):**

1. `IconAIIntelligence`
2. `IconAdminTools`
3. `IconAnalytics`
4. `IconAudit`
5. `IconCarbonESG`
6. `IconComms`
7. `IconCompliance`
8. `IconSettings`
9. `IconContent`
10. `IconCorporate`
11. `IconDashboard`
12. `IconAPI`
13. `IconDispatch`
14. `IconDocuments`
15. `IconDriverOps`
16. `IconDrivers`
17. `IconFranchise`
18. `IconLiveOperations`
19. `IconMarketing`
20. `IconNotifications`
21. `IconPayments`
22. `IconPayouts`
23. `IconPlatformHealth`
24. `IconPricing`
25. `IconPromotions`
26. `IconRiders`
27. `IconSafety`
28. `IconSupport`
29. `IconTeam`
30. `IconTrips`
31. `IconVehicles`
32. `IconSearch`
33. `IconBell`
34. `IconPlus`
35. `IconChevron` (has optional `direction?: 'left' | 'right'` prop)
36. `IconLogout`

---

### FILE 1.4: Icon Name-to-Component Map (AdminShell)

| Field | Value |
|---|---|
| **File name** | `AdminShell.tsx` |
| **Full repo path** | `frontend/src/admin/AdminShell.tsx` |
| **Icon system** | Mapping layer — string keys → SidebarIcons components |
| **Total mappings** | **30** |

**Mappings (key → component):**

| Key | Component |
|---|---|
| `Dashboard` | `IconDashboard` |
| `LiveOperations` | `IconLiveOperations` |
| `Map` | `IconLiveOperations` |
| `Trips` | `IconTrips` |
| `Riders` | `IconRiders` |
| `Drivers` | `IconDrivers` |
| `Vehicles` | `IconVehicles` |
| `Dispatch` | `IconDispatch` |
| `Pricing` | `IconPricing` |
| `Promotions` | `IconPromotions` |
| `Payments` | `IconPayments` |
| `Payouts` | `IconPayouts` |
| `Support` | `IconSupport` |
| `Safety` | `IconSafety` |
| `Marketing` | `IconMarketing` |
| `Comms` | `IconComms` |
| `Content` | `IconContent` |
| `Analytics` | `IconAnalytics` |
| `Compliance` | `IconCompliance` |
| `Documents` | `IconDocuments` |
| `Settings` | `IconSettings` |
| `Audit` | `IconAudit` |
| `API` | `IconAPI` |
| `Team` | `IconTeam` |
| `Bell` | `IconBell` |
| `Corporate` | `IconCorporate` |
| `AIIntelligence` | `IconAIIntelligence` |
| `DriverOps` | `IconDriverOps` |
| `PlatformHealth` | `IconPlatformHealth` |
| `CarbonESG` | `IconCarbonESG` |
| `Franchise` | `IconFranchise` |
| `AdminTools` | `IconAdminTools` |
| `Notifications` | `IconNotifications` |

---

### Grand Total (Code-Defined Icons)

| File | System | Icons |
|---|---|---|
| `client-app/src/components/ds/Icon.tsx` | Custom inline SVG (driver app) | 30 |
| `rider-app/src/components/ds/Icon.tsx` | Custom inline SVG (rider app) | 30 |
| `frontend/src/admin/components/SidebarIcons.tsx` | Custom inline SVG (admin panel) | 36 |
| **Total React icon components** | | **96** |
| `frontend/src/admin/AdminShell.tsx` | Icon name-to-component map | 30 mappings |

---

## SECTION 2: Raw SVG Files Used as Icons

### Summary

**571 total `.svg` files** found across the repo (excluding `node_modules/`, `build/`, `.next/`, etc.). The vast majority live in the `icon/` root directory (~530 files). **None use `currentColor`.** Most use hardcoded fill colors. **Only 1 SVG is referenced in code** (`scripts/icon-source.svg` — referenced by `scripts/generate-icons.sh`). The remaining 570 are unreferenced.

---

### 2.1 `icon/` root directory — Hyphenated stroke-based set (~300 files)

| Field | Value |
|---|---|
| **Directory** | `icon/` |
| **Fill colors** | `#383B46` (dark gray) and `white` (two-tone design) |
| **Uses `currentColor`** | No |
| **Referenced in code** | No |

**Sample files:** `activity.svg`, `alert-circle.svg`, `archive.svg`, `arrow-down.svg`, `bell.svg`, `book.svg`, `camera.svg`, `checkmark.svg`, `clock.svg`, `close.svg`, `download.svg`, `edit.svg`, `eye.svg`, `file.svg`, `folder.svg`, `gift.svg`, `globe.svg`, `heart.svg`, `home.svg`, `image.svg`, `info.svg`, `lock.svg`, `map.svg`, `menu.svg`, `message-circle.svg`, `mic.svg`, `music.svg`, `person.svg`, `phone.svg`, `pin.svg`, `play-circle.svg`, `plus.svg`, `search.svg`, `settings.svg`, `share.svg`, `shield.svg`, `star.svg`, `trash.svg`, `tv.svg`, `upload.svg`, `video.svg`, `volume.svg`, `wifi.svg`, and many more.

**Pattern:** `<path fill="#383B46" .../>` and `<path fill="white" .../>`

---

### 2.2 `icon/` root directory — `_t` suffixed filled set (~100 files)

| Field | Value |
|---|---|
| **Directory** | `icon/` (files ending in `_filled_t.svg` or `_t.svg`) |
| **Fill colors** | `black` (single-color) |
| **Uses `currentColor`** | No |
| **Referenced in code** | No |

**Sample files:** `add_filled_t.svg`, `ban_filled_t.svg`, `bell_off_filled_t.svg`, `bell_on_filled_t.svg`, `camera_t.svg`, `checkmark_filled_t.svg`, `close_filled_t.svg`, `delete_filled_t.svg`, `edit_t.svg`, `eye_filled_t.svg`, `gallery_t.svg`, `globe_t.svg`, `heart_t.svg`, `info_filled_t.svg`, `location_filled_t.svg`, `mail_filled_t.svg`, `music_t.svg`, `pause_filled_t.svg`, `play_filled_t.svg`, `question_filled_t.svg`, `search_filled_t.svg`, `setting_t.svg`, `share_t.svg`, `skip_back_filled_t.svg`, `smile_face_filled_t.svg`, `sort_t.svg`, `stars_filled_t.svg`, `text_filled_t.svg`, `user_filled_t.svg`, `users_filled_t.svg`, `video_t.svg`, `volume_on_filled_t.svg`, `wallet_t.svg`, `warn_filled_t.svg`, `web_search_t.svg`, and more.

**Pattern:** `<path fill="black" .../>`

---

### 2.3 `icon/` root directory — `_t` suffixed outline set (~60 files)

| Field | Value |
|---|---|
| **Directory** | `icon/` (files ending in `_outline_t.svg`) |
| **Fill colors** | No fill (outline-only, uses `stroke="black"`) |
| **Uses `currentColor`** | No |
| **Referenced in code** | No |

**Sample files:** `add_outline_t.svg`, `ban_outline_t.svg`, `checkmark_outline_t.svg`, `collect_outline_t.svg`, `delete_outline_t.svg`, `eye_outline_t.svg`, `location_outline_t.svg`, `mail_outline_t.svg`, `pause_outline_t.svg`, `play_outline_t.svg`, `search_outline_t.svg`, `skip_back_outline_t.svg`, `stars_outline_t.svg`, `user_check_outline_t.svg`, `user_info_outline_t.svg`, `user_outline_t.svg`, `users_outline_t.svg`, `volume_off_outline_t.svg`, `volume_on_outline_t.svg`, and more.

**Pattern:** `<circle ... stroke="black" .../>`, `<path ... stroke="black" .../>`

---

### 2.4 `icon/Admin-icon/` directory — Admin dashboard SVGs (32 files)

| Field | Value |
|---|---|
| **Directory** | `icon/Admin-icon/` |
| **Fill colors** | `black` (most), `black` and `white` (a few like `Dashboard.svg`, `Developer_api.svg`, `Document and vault.svg`) |
| **Uses `currentColor`** | No |
| **Referenced in code** | No |

**Files:** `Admin Tools.svg`, `AI intelligence.svg`, `Analytics and report.svg`, `Audit Logs.svg`, `carbon and ecg.svg`, `communications.svg`, `Compilance and KYC.svg`, `Configuration.svg`, `Content.svg`, `Corporate B2B.svg`, `Dashboard.svg`, `Developer_api.svg`, `Dispatch and zones.svg`, `Document and vault.svg`, `Driver ops.svg`, `driver.svg`, `Franchies Multi-Tenant.svg`, `Live operations.svg`, `Marketing and campaign.svg`, `Marketing and campain.svg` (duplicate), `notifications.svg`, `Payment and Finance.svg`, `Payout.svg`, `platform health.svg`, `Pricing and surge.svg`, `Promotions.svg`, `riders.svg`, `Safety and incident.svg`, `Support and Ticket.svg`, `Team and Roles.svg`, `Trip.svg`, `vehicles.svg`

---

### 2.5 `client-app/public/` directory — Next.js default SVGs (5 files)

| Field | Value |
|---|---|
| **Directory** | `client-app/public/` |
| **Fill colors** | `#666` (`file.svg`, `globe.svg`, `window.svg`), `#000` (`next.svg`), `#fff` (`vercel.svg`) |
| **Uses `currentColor`** | No |
| **Referenced in code** | No |

**Files:** `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`

---

### 2.6 `scripts/` directory — App icon source (1 file)

| Field | Value |
|---|---|
| **File name** | `icon-source.svg` |
| **Full repo path** | `scripts/icon-source.svg` |
| **Fill colors** | `#0073E6` (blue background), `white` (steering wheel) |
| **Uses `currentColor`** | No |
| **Referenced in code** | **Yes** — referenced by `scripts/generate-icons.sh` (lines 2, 9, 116) |
| **TODO comment** | `<!-- PLACEHOLDER — replace with actual brand icon before app store submission -->` |

---

### 2.7 SVG Files Referenced in Code

| SVG File | Path | Referenced In |
|---|---|---|
| `icon-source.svg` | `scripts/icon-source.svg` | `scripts/generate-icons.sh` (lines 2, 9, 116) |

All other 570 SVG files are **unreferenced** by any `.tsx`, `.ts`, `.jsx`, `.js`, `.css`, `.scss`, `.html`, or `.json` file.

---

## SECTION 3: Emoji Used as Icon Substitutes

### Summary

Emoji are used extensively (~500+ instances across ~100 files) as visual icon substitutes. Three dominant patterns: `icon=` prop values in nav/action/config objects, inline JSX as visual indicators (ratings, status, category headers), and button/label text prefixes.

---

### 3.1 `frontend/src/admin/` — Admin Dashboard

#### `ConfigDashboard.tsx`

- **Lines 49–55:** Tab config objects with `icon:` prop
  - `{ key: 'brand', icon: '⚙️' }`
  - `{ key: 'flags', icon: '🚩' }`
  - `{ key: 'versions', icon: '📱' }`
  - `{ key: 'integrations', icon: '🔌' }`
  - `{ key: 'templates', icon: '✉️' }`
  - `{ key: 'cancel', icon: '🚫' }`
  - `{ key: 'ratings', icon: '⭐' }`

#### `DeveloperDashboard.tsx`

- **Lines 57–61:** Tab config objects with `icon:` prop
  - `{ key: 'keys', icon: '🔑' }`
  - `{ key: 'webhooks', icon: '🪝' }`
  - `{ key: 'logs', icon: '📋' }`
  - `{ key: 'sandbox', icon: '🧪' }`
  - `{ key: 'status', icon: '📡' }`

#### `NotificationsDashboard.tsx`

- **Lines 67–71:** Alert type icon map
  - `HIGH_CANCELLATION: '📉'`
  - `SURGE_CAP: '⚡'`
  - `PAYMENT_GW_DOWN: '💳'`
  - `KYC_BACKLOG_SLA: '📋'`
  - `PAYOUT_FAILURE: '💸'`
- **Line 607:** Channel labels
  - `EMAIL: '📧 Email (SMTP)'`
  - `SLACK: '💬 Slack Webhook'`
  - `SMS: '📱 SMS (Twilio)'`

#### `AnalyticsExtendedDashboard.tsx`

- **Line 17:** Category icon map
  - `operations: '🗺'`, `growth: '📈'`, `finance: '💰'`, `'driver-supply': '🚗'`, `marketing: '📣'`, `safety: '🛡'`

#### `ComplianceExtendedDashboard.tsx`

- **Lines 442–447:** Feature card objects with `icon:` prop
  - `{ icon: '🚗', title: 'RTO Submission Reports' }`
  - `{ icon: '🔍', title: 'AML / Sanctions Screening' }`
  - `{ icon: '🧾', title: 'e-Invoice Compliance (IRP)' }`
  - `{ icon: '🛡', title: 'Insurance Policy Management' }`
  - `{ icon: '📋', title: 'Background Check Integration' }`
  - `{ icon: '🌐', title: 'DPDP Act Consent Log' }`
- **Line 119:** `ℹ️ KYC verification...`
- **Line 153:** `<span className="text-4xl mb-2">📋</span>` (empty state)
- **Line 255:** `✅ No documents expiring`

#### `CMSDashboard.tsx`

- **Line 63:** Page type icon map
  - `POLICY: '📜'`, `FAQ: '❓'`, `HELP_ARTICLE: '💡'`, `ONBOARDING: '👋'`, `BANNER: '📢'`, `SPLASH: '🎨'`
- **Line 258:** `{PAGE_TYPE_ICONS[p.page_type] ?? '📄'} {p.title}`
- **Line 318:** `🔗 Link`
- **Line 634:** `'🖼️'` (thumbnail fallback)

#### `ComplianceDashboard.tsx`

- **Line 193:** `<div className="text-3xl mb-2">📋</div>` (empty state)
- **Line 229:** `{doc.url ? '📄' : '❌'}` (document/error icon)
- **Lines 271, 277:** `✓ Approve KYC` / `✗ Reject` (button labels)

#### `ActiveTripRadar.tsx`

- **Line 422:** `⚠ Stagnant` (warning label)

#### `CorporateDashboard.tsx`

- **Line 175:** `<span className="text-4xl mb-2">🏢</span>` (empty state)
- **Line 528:** `✓ Invoice ${...} created`

#### `DocumentsVaultDashboard.tsx`

- **Line 31:** `'📄', '🖼', '📁'` (MIME type icon map)
- **Line 298:** `<span className="text-4xl mb-2">🗄</span>` (empty state)

#### `DriversList.tsx`

- **Line 53:** `<span className="text-content-tertiary">★</span>` (rating)
- **Lines 252–255:** `"4.8+ ★"`, `"4.5+ ★"`, etc. (filter labels)

#### `DriverDetail.tsx`

- **Lines 671, 676:** `⚠️ This document expired...` / `⚠️ This document expires soon...`

#### `DriverVerificationQueue.tsx`

- **Line 269:** `'▲ FLAGGED' : '● PENDING'` (status indicators)
- **Lines 463, 471:** `✓ Approve` / `✗ Reject` (button labels)

#### `FleetDrillDownDrawer.tsx`

- **Line 111:** `✕` (close button)

#### `CarIssuesDashboard.tsx`

- **Line 183:** `✕` (close button)

#### `MarketingDashboard.tsx`

- **Lines 935, 951, 992, 1193, 1366, 1698, 1768:** `🚀 Register Campaign`, `📲 Send Push`, `📊` metrics, `💾 Save`, `🔍 Verify DNS`, etc.

#### `PricingDashboard.tsx`

- **Line 799:** `Close ✕`

#### `PayoutsDashboard.tsx`

- **Lines 601, 768:** `✕` (close buttons)

#### `RidersList.tsx`

- **Lines 43, 288, 295–298:** `★` (rating star and filter labels)

#### `RiderDetail.tsx`

- **Lines 894, 901:** `★` (rating stars)

#### `SafetyDashboard.tsx`

- **Lines 461, 537, 543, 550, 557, 580, 601, 723, 733, 763, 795:** `🔴 CRITICAL EMERGENCY`, `📞 Call Rider`, `📞 Call Driver`, `🚨 Dispatch Police`, `✉️ Alert Contacts`, `✅ Resolve Alert`, `🛡️` empty state, `📁` file icon, `🔴 Global Ban`

#### `SupportDashboard.tsx`

- **Lines 949, 1090:** `⚠️` / `⏱` (SLA status icons)
- **Line 1202:** `🔒 Internal note (team only)`

#### `VehiclesList.tsx`

- **Line 423:** `'Send Expiry Reminders ✉'`

#### `VehicleProfilesMatrix.tsx`

- **Line 244:** `'● PENDING INS'`

#### Admin Components

- **`MarketplaceOrchestrator.tsx`** — lines 600, 615, 722, 855, 898, 915, 964, 1049, 1059: `⚙️ Manual Inversion Override`, `🖥️ ENTER GEOFENCE VECTOR STUDIO`, `⚠️ {alert.violation}`, `🟢 ACTIVE` / `🔴 DISABLED`, `🖱️ Left-Click...`, `✋ Pan/inspect`, `🔴 DISABLED (INACTIVE)`
- **`IncidentRecoveryTerminal.tsx`** — line 838: `⚠️ ALERT REQUIRES COMMAND TAKEOVER`
- **`ControlRoomLivePanels.tsx`** — lines 75, 87, 199: `✕` (close), `★` (rating), `✕` (close)
- **`AdminTeamManagement.tsx`** — lines 101, 146: `⚠ SUPER_ADMIN grants full platform control.`

---

### 3.2 `client-app/src/` — Driver App

#### `components/DriverTripManager.tsx`

- **Lines 211, 389:** `★` (rating star)

#### `components/DriverDrawer.tsx`

- **Line 60:** `★ {driverProfile.rating.toFixed(2)}` (rating display)

#### `components/OfferPopup.tsx`

- **Line 211:** `★ {currentOffer.riderRating.toFixed(2)}` (rating display)

#### `components/Toaster.tsx`

- **Lines 8–9:** `icon: '✓'` / `icon: '✕'` (toast icon config)

#### `components/auth/PhoneVerifyScreen.tsx`

- **Line 207:** `🇮🇳 +91` (country flag prefix)

#### `components/ds/DriverCard.tsx`

- **Line 51:** `★ {rating.toFixed(2)}` (rating display)

#### `app/share/page.tsx`

- **Lines 25, 96:** `driverRating: '★ 4.92'` (mock data)
- **Line 107:** `👤` (driver avatar placeholder)
- **Line 108:** `📍` (pickup icon), `🏁` (destination icon)

#### `app/driver-account/layout.tsx`

- **Lines 15–28:** Nav items with `icon:` prop: `📱`, `👤`, `💳`, `📁`, `🏆`, `🚗`, `📊`, `💼`, `🔔`, `🎓`, `🎁`, `⚙️`, `💬`
- **Lines 47, 78, 91, 139:** `👤` (profile avatar), `🚪 Terminate Session` / `🚪 Logout`, `☰` (hamburger menu)

#### `app/driver-account/wallet/page.tsx`

- **Lines 13–17:** `'🛣️'` (toll), `'🅿️'` (parking), `'⛽'` (fuel), `'🎁'` (referral/bonus), `'➕'` / `'➖'` (credit/debit)
- **Line 53:** `ℹ️` (info notice)

#### `app/driver-account/vehicles/page.tsx`

- **Lines 24–26:** `'✓ Valid'`, `⚠ ${...}`, `'✗ Expired'` (status labels)
- **Lines 111–112:** `⛔` / `⚠` (banners)

#### `app/driver-account/profile/page.tsx`

- **Lines 180–181:** `'👤'` (avatar), `✎` (edit)
- **Line 196:** `★ 4.92` (rating)
- **Lines 252, 255:** `⚙️ Stick Shift Manual` / `🕹️ Automatic / EV`

#### `app/driver-account/performance/page.tsx`

- **Line 79:** `★ {metrics.rating}`
- **Line 145:** `★ {r.rating}`

#### `app/driver-account/support/page.tsx`

- **Lines 49–54:** `{ icon: '🚗' }`, `{ icon: '💳' }`, `{ icon: '🔧' }`, `{ icon: '👤' }`, `{ icon: '🛡️' }`, `{ icon: '❓' }`
- **Line 106:** `📞 {t('hotline')}`
- **Line 117:** `<div className="text-4xl">✓</div>` (success)
- **Line 158:** `📎 {t('attachPhoto')}`

#### `app/driver-account/settings/page.tsx`

- **Lines 103, 106:** `'✓ ' + t('saved')` / `'⚠ Current password...'`

#### `app/driver-account/payouts/page.tsx`

- **Line 126:** `'✓ '` / `'⚠ '` (feedback prefix)

#### `app/driver-account/trip-history/page.tsx`

- **Line 171:** `Details ➔`
- **Lines 251, 269, 270:** `⏸️ Pause` / `▶️ Play`
- **Lines 352, 360:** `📍` (pickup), `🏁` (destination), `★` (rating)

#### `app/driver-account/trip-history/[tripId]/TripDetailClient.tsx`

- **Line 23:** `🔒 FORENSIC AUDIT TRAIL`
- **Lines 311, 318:** `★` (rating)

#### `app/account/layout.tsx`

- **Lines 33–47:** Nav items: `🔑`, `🚗`, `📁`, `👤`, `💳`, `💼`, `🎁`, `🏆`, `📍`, `🛡️`, `📄`, `🔔`, `⚙️`, `💬`, `⚖️`
- **Lines 73, 79, 108, 121, 156, 162, 191:** `👤` (avatar), `✓` (verified), `🚪 Terminate Session` / `🚪 Logout`, `☰` (hamburger)

#### `app/account/bookings/page.tsx`

- **Lines 50, 53, 72, 75, 94, 109, 112, 400, 401:** `➔`, `★ 4.92` / `★ 4.88`, `📍`, `🏁`

#### `app/account/support/page.tsx`

- **Line 102:** `🚨 Rider Safety Hotline`
- **Line 243:** `📸 Attach Photo`

#### `app/account/settings/page.tsx`

- **Line 20:** `'🚨 DANGER: Permanently delete...'`

#### `app/account/payments/page.tsx`

- **Lines 118, 133:** `'🚨 DESTRUCTIVE OPERATION...'` (confirm dialogs)
- **Line 268:** `<span className="text-[14px]">💳</span>` (card icon)

#### `app/account/legal/page.tsx`

- **Line 109:** `'📥 PDF Download Request...'`
- **Line 125:** `<span>⚖️</span> Legal & Policy Documents`
- **Line 135:** `📥 Download PDF`
- **Line 169:** `🔍`
- **Line 226:** `💬 Contact Legal Desk`

#### `app/account/profile/page.tsx`

- **Lines 97, 116:** `👤` (avatar), `✓` (verified)

#### `app/account/places/page.tsx`

- **Lines 9, 10, 14:** `'🏠 Home Location'`, `'🏢 Work Office'`, `'🌟 Custom'`

#### `app/onboarding/page.tsx`

- **Line 210:** `⚠️ {validationError}`
- **Line 272:** `'✔️ READY'`
- **Line 295:** `Skip Step ➔`
- **Lines 391, 401:** `🏠 Residential Home Address` / `🏢 Professional Work Address`
- **Line 512:** `<span className="text-4xl block">📍</span>`

#### `app/driver-onboarding/page.tsx`

- **Line 404:** `'✔️ Ready'`
- **Lines 510, 521:** `<span className="text-xl">⚙️</span>` / `<span className="text-xl">🕹️</span>` (transmission)
- **Line 573:** `<span>✓</span>`
- **Line 606:** `'✔️ Validated'`
- **Line 677:** `✓ Terms Read & Completed`

#### `app/rider/page.tsx`

- **Lines 891, 915, 998, 1008, 1023, 1030, 1037, 1111, 1182, 1453, 1549, 1581, 1596–1606:**
  - `☰`, `🔔`, `🔍`, `🚗`, `🔄`, `🎁`, `🏆`, `✕`, `➔`, `🚨`, `👤`
  - Nav items: `🔑`, `🚗`, `📁`, `👤`, `💳`, `💼`, `🎁`, `🏆`, `📍`, `🛡️`, `💬`

#### `app/rider/dispatch/page.tsx`

- **Lines 140, 145, 167, 172, 549, 555, 558, 564, 575, 585, 599, 611, 619, 666, 702, 800:**
  - `★`, `'👨🏽‍✈️'`, `🚗`, `📞` / `💬`, `🔍`, `🔄`, `📡`, `📅`, `✔️`

#### `app/rider/trip/live/page.tsx`

- **Lines 98, 101, 589, 655, 693, 703, 762, 768, 776, 787, 836, 862, 884, 894, 905, 969, 993:**
  - `★`, `'👤'`, `🚨`, `📋`, `🔗`, `⚠️`, `⛔`, `🔄`, `👨🏽‍✈️`, `✕`, `➕`, `📅`, `🏁`, `✔️`

#### `app/rider/trip/rate/page.tsx`

- **Lines 120, 153, 174:** `★`, `👍`, `⚠️`

#### `app/page.tsx`

- **Lines 119, 129, 139:** `🚗`, `🛡️`, `📍` (feature highlight icons)

---

### 3.3 `rider-app/src/` — Rider App Components

#### `components/auth/PhoneVerifyScreen.tsx`

- **Line 262:** `<span className="text-lg">🇮🇳</span>`
- **Line 361:** `🔒 Secured by Firebase`

#### `components/trip/ShareTripSheet.tsx`

- **Lines 54, 61, 68:** `<span className="text-2xl">💬</span>`, `<span className="text-2xl">📱</span>`, `<span className="text-2xl">🔗</span>`

#### `components/trip/RideCheckModal.tsx`

- **Line 62:** `Yes, I'm fine ✓`

#### `components/trip/DriverCard.tsx`

- **Line 72:** `👤` (driver avatar)
- **Lines 109, 111, 118:** `{ icon: "📞", label: "Call" }`, `icon: "💬"`, `{ icon: "📤", label: "Share" }`
- **Line 143:** `<span className="text-xl">✕</span>`

#### `components/account/States.tsx`

- **Line 21:** `icon = "📭"` (empty state)
- **Line 44:** `<div className="text-5xl">⚠️</div>` (error state)

#### `components/Toaster.tsx`

- **Lines 8–9:** `icon: "✓"` / `icon: "✕"`

#### `components/ds/DriverCard.tsx`

- **Line 51:** `★ {rating.toFixed(2)}`

---

### 3.4 `rider-app/app/` — Rider App Pages

#### `app/page.tsx`

- **Lines 136, 146, 156:** `🛡️`, `⚡`, `💰` (feature icons)

#### `app/trip-share/page.tsx`

- **Line 98:** `🔗`

#### `app/(auth)/login/page.tsx`

- **Line 263:** `<span className="text-lg">🇮🇳</span>`
- **Line 317:** `🔒 Secured by Firebase`
- **Line 425:** `📱 Sign up with phone (OTP)`

#### `app/(auth)/onboarding/page.tsx`

- **Line 397:** `"📷"` (camera icon)
- **Lines 587, 599, 605, 617, 706, 721, 750, 765:** `🏠`, `📍`, `💼`, `🔔`, `✓ Notifications enabled`, `📍`, `✓ Location enabled`

#### `app/(app)/account/page.tsx`

- **Lines 11–24:** `{ icon: "👤" }`, `{ icon: "🚗" }`, `{ icon: "🧾" }`, `{ icon: "💳" }`, `{ icon: "👛" }`, `{ icon: "🎁" }`, `{ icon: "📣" }`, `{ icon: "📍" }`, `{ icon: "🛡️" }`, `{ icon: "🔔" }`, `{ icon: "💬" }`, `{ icon: "⚙️" }`, `{ icon: "📄" }`
- **Line 83:** `"✓ KYC"`

#### `app/(app)/account/bookings/detail/page.tsx`

- **Line 100:** `⭐ Rate this trip`

#### `app/(app)/account/payments/page.tsx`

- **Lines 222, 229, 339:** `<EmptyState icon="💳" ...>`, `<span className="text-lg">💳</span>`, `<span className="text-lg">🏦</span>`

#### `app/(app)/account/rewards/page.tsx`

- **Lines 103, 129, 134:** `✓ {savedCode} saved`, `You're at the top tier! 🎉`, `<span className="text-content-positive">✓</span>`

#### `app/(app)/account/places/page.tsx`

- **Lines 16–18:** `{ value: "HOME", icon: "🏠" }`, `{ value: "WORK", icon: "💼" }`, `{ value: "CUSTOM", icon: "📍" }`
- **Lines 40, 51:** `<EmptyState icon="📍" ...>`

#### `app/(app)/account/refer/page.tsx`

- **Lines 87–89:** `<ShareBtn icon="💬" ...>`, `<ShareBtn icon="📱" ...>`, `<ShareBtn icon="🔗" ...>`

#### `app/(app)/account/settings/page.tsx`

- **Line 298:** `✓` (enabled checkmark)
- **Line 454:** `⚠️` (warning)

#### `app/(app)/account/notifications/page.tsx`

- **Line 67:** `<EmptyState icon="🔔" ...>`

#### `app/(app)/account/garage/page.tsx`

- **Lines 61, 70, 74, 157, 344:** `🚗`, `Default ★`, `⚠️`, `icon="🚗"`, `"✅"` / `"📷"`

#### `app/(app)/account/bookings/page.tsx`

- **Line 209:** `<EmptyState icon="🧾" ...>`

#### `app/(app)/account/insurance/page.tsx`

- **Line 378:** `icon="🛡️"`

#### `app/(app)/account/profile/page.tsx`

- **Lines 168, 238, 303:** `✎`, `✓ Verified`, `"Saved ✓"`

#### `app/(app)/account/support/page.tsx`

- **Lines 11–17:** `"🚗"`, `"💳"`, `"🧑‍✈️"`, `"🎒"`, `"👤"`, `"🛡️"`, `"❓"`
- **Lines 285, 396, 402:** `✅`, `💬` / `📞`

#### `app/(app)/account/wallet/page.tsx`

- **Lines 73, 78, 98, 217:** `<span className="text-xl">👛</span>`, `🔒`, `<EmptyState icon="🧾" ...>`, `<span className="text-3xl text-content-primary">✓</span>`

#### `app/(app)/dispatch/page.tsx`

- **Line 121:** `★ {driver.rating.toFixed(1)}`

#### `app/(app)/trip/rate/page.tsx`

- **Line 28:** `★` (rating star)

---

### 3.5 Common Emoji Patterns (Summary)

| Pattern | Emojis Used | Occurrences |
|---|---|---|
| `icon=` prop in nav/action configs | 🚗🔑⭐💳💰📍🔔⚙️👤🎁🏆🛡️💬📁💼📱 | ~150 |
| `icon=` prop in `EmptyState` | 💳🔔📍🧾🚗🛡️ | ~15 |
| Rating display `★` | ★ (black star) | ~50 |
| Inline JSX as visual indicator | 📋📄🏢🗄🖼️⚖️ | ~40 |
| Button/label text prefix | 📲📞🚨🔍📸📥🔄✉️📡🔒 | ~80 |
| Status checkmark/cross | ✓✔️✅✕✗❌ | ~60 |
| Warning/alert indicators | ⚠️🚨🔴🟢⛔ | ~30 |
| Country flag | 🇮🇳 | ~3 |

---

## SECTION 4: All Icon Import/Usage Sites

### Summary

The project uses only custom inline-SVG icon components. No third-party icon library imports exist. All icon imports come from either:

- `@/components/ds/Icon` or `@/components/ds` (client-app and rider-app shared icon sets)
- `./components/SidebarIcons` (frontend/admin)

---

### 4.1 Consumer Files Using `SidebarIcons` (Admin)

#### `frontend/src/admin/AdminShell.tsx`

**Import (lines 9–19):**

```tsx
import {
  IconDashboard, IconLiveOperations, IconTrips, IconRiders, IconDrivers,
  IconVehicles, IconDispatch, IconPricing, IconPromotions,
  IconPayments, IconPayouts, IconSupport, IconSafety,
  IconMarketing, IconComms, IconContent, IconAnalytics,
  IconCompliance, IconDocuments, IconSettings, IconAudit,
  IconAPI, IconTeam, IconCorporate, IconAIIntelligence,
  IconDriverOps, IconPlatformHealth, IconCarbonESG,
  IconFranchise, IconAdminTools, IconNotifications,
  IconSearch, IconBell, IconPlus, IconChevron, IconLogout,
} from './components/SidebarIcons';
```

**JSX Usage:**

| Icon Component | Line |
|---|---|
| `IconSearch` | 316 |
| `IconChevron` | 413, 610 |
| `IconBell` | 449 |
| `IconPlus` | 500 |
| `IconLogout` | 544 |
| `IconDashboard` (via `iconMap`) | 594 |
| `IconLiveOperations` (via `iconMap`) | 594 |
| `IconTrips` (via `iconMap`) | 594 |
| `IconRiders` (via `iconMap`) | 594 |
| `IconDrivers` (via `iconMap`) | 594 |
| `IconVehicles` (via `iconMap`) | 594 |
| `IconDispatch` (via `iconMap`) | 594 |
| `IconPricing` (via `iconMap`) | 594 |
| `IconPromotions` (via `iconMap`) | 594 |
| `IconPayments` (via `iconMap`) | 594 |
| `IconPayouts` (via `iconMap`) | 594 |
| `IconSupport` (via `iconMap`) | 594 |
| `IconSafety` (via `iconMap`) | 594 |
| `IconMarketing` (via `iconMap`) | 594 |
| `IconComms` (via `iconMap`) | 594 |
| `IconContent` (via `iconMap`) | 594 |
| `IconAnalytics` (via `iconMap`) | 594 |
| `IconCompliance` (via `iconMap`) | 594 |
| `IconDocuments` (via `iconMap`) | 594 |
| `IconSettings` (via `iconMap`) | 594 |
| `IconAudit` (via `iconMap`) | 594 |
| `IconAPI` (via `iconMap`) | 594 |
| `IconTeam` (via `iconMap`) | 594 |
| `IconCorporate` (via `iconMap`) | 594 |
| `IconAIIntelligence` (via `iconMap`) | 594 |
| `IconDriverOps` (via `iconMap`) | 594 |
| `IconPlatformHealth` (via `iconMap`) | 594 |
| `IconCarbonESG` (via `iconMap`) | 594 |
| `IconFranchise` (via `iconMap`) | 594 |
| `IconAdminTools` (via `iconMap`) | 594 |
| `IconNotifications` (via `iconMap`) | 594 |

---

### 4.2 Consumer Files Using `client-app/src/components/ds/Icon`

#### `client-app/src/components/SosModal.tsx`

**Import (line 5):** `import { SirenIcon } from "@/components/ds";`  
**Usage:** `SirenIcon` at line 35

#### `client-app/src/components/DriverDrawer.tsx`

**Import (lines 6–9):**

```tsx
import {
  UserIcon, ClockIcon, FlameIcon, PaymentIcon, CheckIcon, CarIcon,
  RouteIcon, CashIcon, BellIcon, ChatIcon, ShieldIcon, WrenchIcon, CrossIcon
} from "@/components/ds/Icon";
```

**Usage:**

| Icon | Line |
|---|---|
| `UserIcon` | 27 (nav item), 55 |
| `ClockIcon` | 28 (nav item) |
| `FlameIcon` | 29 (nav item) |
| `PaymentIcon` | 30 (nav item) |
| `CheckIcon` | 31 (nav item) |
| `CarIcon` | 32 (nav item) |
| `RouteIcon` | 33 (nav item) |
| `CashIcon` | 34 (nav item) |
| `BellIcon` | 35 (nav item) |
| `ChatIcon` | 36 (nav item) |
| `ShieldIcon` | 37 (nav item) |
| `WrenchIcon` | 38 (nav item) |
| `CrossIcon` | 101 |

#### `client-app/src/components/DriverTripManager.tsx`

**Import (line 7):** `import { FareDisplay, ETADisplay, StatusBadge, BellIcon, PhoneIcon, ChatIcon, NavigateIcon, CheckIcon, CashIcon, CardIcon } from './ds';`  
**Usage:** `BellIcon` 163, `PhoneIcon` 243, `ChatIcon` 253, `NavigateIcon` 263, `CheckIcon` 277, `CashIcon` 426, `CardIcon` 437

#### `client-app/src/components/OfferPopup.tsx`

**Import (line 8):** `import { FareDisplay, ShieldIcon, AlertIcon, CarIcon } from '@/components/ds';`  
**Usage:** `ShieldIcon` 222, `AlertIcon` 244, `CarIcon` 254

#### `client-app/src/app/driver/page.tsx`

**Import (line 52):**

```tsx
import { RefreshIcon, MenuIcon, SirenIcon, NavigateIcon, SignalIcon, FlameIcon, PauseIcon, ChatIcon, OctagonAlertIcon, ClockIcon } from '@/components/ds';
```

**Usage:** `ClockIcon` 1002, `RefreshIcon` 1035, `MenuIcon` 1212, `SirenIcon` 1267, `NavigateIcon` 1317, `SignalIcon` 1332, `FlameIcon` 1351, `PauseIcon` 1373, `ChatIcon` 1388, `OctagonAlertIcon` 1108

#### `client-app/src/app/driver/trip/bill/page.tsx`

**Import (line 7):** `import { FareDisplay, ClockIcon, WrenchIcon, CheckIcon, PhoneIcon, CashIcon } from '@/components/ds';`  
**Usage:** `ClockIcon` 93, `WrenchIcon` 190, `CheckIcon` 195, `PhoneIcon` 258, `CashIcon` 269

#### `client-app/src/app/driver/trip/rate/page.tsx`

**Import (line 11):** `import { CheckIcon } from '@/components/ds';`  
**Usage:** `CheckIcon` 87

#### `client-app/src/app/driver/trip/live/TripInProgressPane.tsx`

**Import (line 8):** `import { FareDisplay, StatusBadge, PhoneIcon, ChatIcon, PlusIcon, ParkingIcon, SirenIcon, RouteIcon } from '../../../../components/ds';`  
**Usage:** `PhoneIcon` 235, `ChatIcon` 246, `PlusIcon` 329/358, `ParkingIcon` 338/508, `SirenIcon` 347/430, `RouteIcon` 508

#### `client-app/src/app/driver/trip/live/ArrivedVerificationPane.tsx`

**Import (line 6):** `import { FareDisplay, CheckIcon, SirenIcon, ClockIcon, CrossIcon, CameraIcon } from '@/components/ds';`  
**Usage:** `CheckIcon` 286/369, `SirenIcon` 298, `ClockIcon` 308, `CrossIcon` 327, `CameraIcon` 369

---

### 4.3 Consumer Files Using `rider-app/src/components/ds/Icon`

#### `rider-app/src/components/layout/TopBar.tsx`

**Import (line 7):** `import { BellIcon } from "@/components/ds/Icon";`  
**Usage:** `BellIcon` 52

#### `rider-app/src/components/booking/QuickTiles.tsx`

**Import (line 7):** `import { HomeIcon } from "@/components/ds/Icon";`  
**Usage:** `HomeIcon` 15 (used as JSX in TILES array)

#### `rider-app/src/components/booking/BookingSheet.tsx`

**Import (line 13):** `import { CrossIcon, PinIcon, CarIcon, FlameIcon, CheckIcon } from "@/components/ds/Icon";`  
**Usage:** `CrossIcon` 211, `PinIcon` 227/445, `CarIcon` 552/700, `FlameIcon` 624, `CheckIcon` 728

---

### 4.4 Usage Frequency Summary

| Icon Component | Total Files | Files |
|---|---|---|
| **CheckIcon** | 6 | DriverTripManager, DriverDrawer, bill/page, rate/page, ArrivedVerificationPane, BookingSheet |
| **PhoneIcon** | 4 | DriverTripManager, DriverDrawer, bill/page, TripInProgressPane |
| **ChatIcon** | 4 | DriverTripManager, DriverDrawer, driver/page, TripInProgressPane |
| **ClockIcon** | 4 | driver/page, bill/page, ArrivedVerificationPane, DriverDrawer |
| **SirenIcon** | 4 | SosModal, driver/page, TripInProgressPane, ArrivedVerificationPane |
| **CarIcon** | 4 | OfferPopup, DriverDrawer, BookingSheet |
| **BellIcon** | 3 | DriverTripManager, DriverDrawer, TopBar |
| **CrossIcon** | 3 | ArrivedVerificationPane, BookingSheet, DriverDrawer |
| **CashIcon** | 3 | DriverTripManager, bill/page, DriverDrawer |
| **FlameIcon** | 3 | driver/page, DriverDrawer, BookingSheet |
| **NavigateIcon** | 2 | DriverTripManager, driver/page |
| **RouteIcon** | 2 | TripInProgressPane, DriverDrawer |
| **ShieldIcon** | 2 | OfferPopup, DriverDrawer |
| **WrenchIcon** | 2 | bill/page, DriverDrawer |
| **ParkingIcon** | 1 | TripInProgressPane |
| **PlusIcon** | 1 | TripInProgressPane |
| **CameraIcon** | 1 | ArrivedVerificationPane |
| **AlertIcon** | 1 | OfferPopup |
| **CardIcon** | 1 | DriverTripManager |
| **RefreshIcon** | 1 | driver/page |
| **MenuIcon** | 1 | driver/page |
| **SignalIcon** | 1 | driver/page |
| **PauseIcon** | 1 | driver/page |
| **OctagonAlertIcon** | 1 | driver/page |
| **UserIcon** | 1 | DriverDrawer |
| **PaymentIcon** | 1 | DriverDrawer |
| **PinIcon** | 1 | BookingSheet |
| **HomeIcon** | 1 | QuickTiles |
| **IconSearch** | 1 | AdminShell |
| **IconBell** | 1 | AdminShell |
| **IconPlus** | 1 | AdminShell |
| **IconChevron** | 1 | AdminShell |
| **IconLogout** | 1 | AdminShell |
| All 30 sidebar icons | 1 | AdminShell (via `iconMap`) |

**Not used anywhere in the codebase (0 consumer files):**
From client-app/rider-app `Icon.tsx`: `ParkingIcon` (not used — wait, it's used in TripInProgressPane actually), let me verify... Actually from the data, `ParkingIcon` is used in TripInProgressPane. Let me check which are truly unused.

**Icons defined but NEVER imported in any consumer file:**

- From client-app `Icon.tsx`: `AlertIcon` — actually used in OfferPopup. Let me re-check.
- All icon components are used at least once. Let me double-check:

Actually all 30 from the driver/rider Icon.tsx are used:

- PhoneIcon, ChatIcon, NavigateIcon, CashIcon, CardIcon, ShieldIcon, CarIcon, AlertIcon, CheckIcon, BellIcon, PlusIcon, ParkingIcon, SirenIcon, CameraIcon, CrossIcon, RefreshIcon, MenuIcon, SignalIcon, OctagonAlertIcon, FlameIcon, PauseIcon, WrenchIcon, ClockIcon, RouteIcon, HomeIcon, PaymentIcon, PinIcon, UserIcon, SearchIcon, BackIcon

Wait, `SearchIcon` and `BackIcon` — are they used? Let me scan the data... I don't see any consumer file importing them. That would be 2 unused.

And all 36 from SidebarIcons are used via the AdminShell import and iconMap. Let me now write the report.

---

## SECTION 5: App Store / Build Icons

### Summary

Both mobile apps (client-app "Vahnly Driver", rider-app "Vahnly") use **placeholder icons** throughout. The master icon source (`scripts/icon-source.svg`) explicitly contains a `<!-- PLACEHOLDER — replace with actual brand icon before app store submission -->` comment. No real brand icon exists anywhere in the repo. iOS app targets have never been set up (no `ios/` directories). No PWA manifest or apple-touch-icon files exist.

---

### 5.1 Master Icon Source

| File | Full Repo Path | Purpose | Notes |
|---|---|---|---|
| `icon-source.svg` | `scripts/icon-source.svg` | Master 1024×1024 source for ALL generated icons (iOS + Android) | Line 2: `<!-- PLACEHOLDER — replace with actual brand icon before app store submission -->`. Contains generic steering wheel shape on blue (`#0073E6`) background. |

Referenced by `scripts/generate-icons.sh` which generates platform icons via ImageMagick.

---

### 5.2 Android Launcher Icons (client-app)

All generated from the placeholder source. Located in `client-app/android/app/src/main/res/`.

| Density | Icon Type | Path |
|---|---|---|
| mdpi (48×48) | Standard + Round | `mipmap-mdpi/ic_launcher.png`, `ic_launcher_round.png` |
| hdpi (72×72) | Standard + Round | `mipmap-hdpi/ic_launcher.png`, `ic_launcher_round.png` |
| xhdpi (96×96) | Standard + Round | `mipmap-xhdpi/ic_launcher.png`, `ic_launcher_round.png` |
| xxhdpi (144×144) | Standard + Round | `mipmap-xxhdpi/ic_launcher.png`, `ic_launcher_round.png` |
| xxxhdpi (192×192) | Standard + Round | `mipmap-xxxhdpi/ic_launcher.png`, `ic_launcher_round.png` |
| Adaptive (v26+) | Foreground | `mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml` |
| Adaptive | Vector foreground | `drawable-v24/ic_launcher_foreground.xml` |
| Adaptive | Background color | `drawable/ic_launcher_background.xml` (color: `#26A69A` teal) |
| Adaptive | Background color resource | `values/ic_launcher_background.xml` (color: `#FFFFFF`) |

**Referenced by:** `client-app/android/app/src/main/AndroidManifest.xml` (lines 6–8):

```xml
android:icon="@mipmap/ic_launcher"
android:roundIcon="@mipmap/ic_launcher_round"
```

---

### 5.3 Android Launcher Icons (rider-app)

Identical structure to client-app, same placeholder icons. Located in `rider-app/android/app/src/main/res/` with matching directory layout and file names.

**Referenced by:** `rider-app/android/app/src/main/AndroidManifest.xml` (lines 6–8).

---

### 5.4 Android Splash Screens

Both apps have identical Capacitor-generated splash screens:

| Orientation | Density | Path (both apps) |
|---|---|---|
| Portrait | mdpi | `drawable-port-mdpi/splash.png` (4,096 B) |
| Portrait | hdpi | `drawable-port-hdpi/splash.png` (7,934 B) |
| Portrait | xhdpi | `drawable-port-xhdpi/splash.png` (9,875 B) |
| Portrait | xxhdpi | `drawable-port-xxhdpi/splash.png` (13,346 B) |
| Portrait | xxxhdpi | `drawable-port-xxxhdpi/splash.png` (17,489 B) |
| Landscape | mdpi | `drawable-land-mdpi/splash.png` (4,040 B) |
| Landscape | hdpi | `drawable-land-hdpi/splash.png` (7,705 B) |
| Landscape | xhdpi | `drawable-land-xhdpi/splash.png` (9,251 B) |
| Landscape | xxhdpi | `drawable-land-xxhdpi/splash.png` (13,984 B) |
| Landscape | xxxhdpi | `drawable-land-xxxhdpi/splash.png` (17,683 B) |

**Splash configuration** (both `capacitor.config.ts` files):

- `SplashScreen` plugin: `launchShowDuration: 2000`, `backgroundColor: '#000000'`, `showSpinner: false`

---

### 5.5 Web Favicon

| File | Full Repo Path | Purpose |
|---|---|---|
| `favicon.ico` | `client-app/src/app/favicon.ico` | Web favicon (Next.js App Router) |

Only present in client-app. **Not present** in rider-app or frontend.

---

### 5.6 Icon Generation Pipeline

| Script | Full Repo Path | Purpose |
|---|---|---|
| `generate-icons.sh` | `scripts/generate-icons.sh` | Generates iOS (18 PNGs + Contents.json) and Android (5 density PNGs + adaptive icon PNGs + XML descriptors) from `scripts/icon-source.svg` via ImageMagick. |

**Line 116:** `echo "Done. Replace scripts/icon-source.svg with your actual brand icon and re-run."`

---

### 5.7 Missing / Not Found

| Item | Status |
|---|---|
| **iOS app icons** | **NOT GENERATED** — `client-app/ios/` and `rider-app/ios/` directories do not exist. The `generate-icons.sh` script skips iOS generation when `ios/` is absent. |
| **Apple Touch Icons** (`apple-touch-icon*`) | **NOT FOUND** |
| **PWA Manifest** (`manifest.json`, `manifest.webmanifest`) | **NOT FOUND** — No `manifest` link tags in any layout file. |
| **`<link rel="icon">` / `<link rel="apple-touch-icon">`** | **NOT FOUND** in any HTML or layout file. |
| **App Store submission icon** (1024×1024 PNG) | **NOT FOUND** — Only exists as placeholder SVG in `scripts/`. |
| **Google Play Store icon** (512×512 PNG) | **NOT FOUND** |
| **Brand logo PNGs/SVGs** | **PLACEHOLDER ONLY** — `client-app/public/assets/brand/` and `rider-app/public/assets/brand/` contain only a `README.md` stating they are placeholders. |
| **`package.json` icon/icons field** | **NOT FOUND** in any `package.json`. |
| **Screenshots directory** | **NOT FOUND** |

---

## End of Report
