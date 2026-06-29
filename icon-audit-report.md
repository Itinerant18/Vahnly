# Icon Audit Report — Vahnly

**Generated:** 2026-06-30
**Repo:** https://github.com/Itinerant18/Vahnly
**Scope:** Full monorepo read-only scan

---

## Section 1: All Icon Definition Files

### 1.1 `SidebarIcons.tsx`
- **Path:** `frontend/src/admin/components/SidebarIcons.tsx`
- **System:** Inline SVG (`fill="currentColor"`, `fill="none"`, custom paths)
- **Total icons defined:** 36
- **Exports:**
  - `IconAIIntelligence`, `IconAdminTools`, `IconAnalytics`, `IconAudit`, `IconCarbonESG`, `IconComms`, `IconCompliance`, `IconSettings`, `IconContent`, `IconCorporate`, `IconDashboard`, `IconAPI`, `IconDispatch`, `IconDocuments`, `IconDriverOps`, `IconDrivers`, `IconFranchise`, `IconLiveOperations`, `IconMarketing`, `IconNotifications`, `IconPayments`, `IconPayouts`, `IconPlatformHealth`, `IconPricing`, `IconPromotions`, `IconRiders`, `IconSafety`, `IconSupport`, `IconTeam`, `IconTrips`, `IconVehicles`, `IconSearch`, `IconBell`, `IconPlus`, `IconChevron`, `IconLogout`
  - Also exports `IconProps` interface

### 1.2 `Icon.tsx` (rider-app)
- **Path:** `rider-app/src/components/ds/Icon.tsx`
- **System:** `@tabler/icons-react` (61 re-exports) + `@lordicon/react` (1 animated component)
- **Total icons defined:** 62
- **Exports:**
  - `AnimatedIcon` (wraps `<Player>` from `@lordicon/react`)
  - Aliased Tabler re-exports: `PhoneIcon`, `ChatIcon`, `NavigateIcon`, `CashIcon`, `CardIcon`, `ShieldIcon`, `CarIcon`, `AlertIcon`, `CheckIcon`, `BellIcon`, `PlusIcon`, `ParkingIcon`, `SirenIcon`, `CameraIcon`, `CrossIcon`, `RefreshIcon`, `MenuIcon`, `SignalIcon`, `OctagonAlertIcon`, `FlameIcon`, `PauseIcon`, `WrenchIcon`, `ClockIcon`, `RouteIcon`, `HomeIcon`, `PaymentIcon`, `PinIcon`, `UserIcon`, `SearchIcon`, `BackIcon`, `StarIcon`, `WalletIcon`, `BookingIcon`, `GiftIcon`, `TrophyIcon`, `LocationIcon`, `SupportIcon`, `DocumentIcon`, `NotificationIcon`, `SettingsIcon`, `ShareIcon`, `CameraOutlineIcon`, `InfoIcon`, `LogoutIcon`, `WarningIcon`, `SuccessIcon`, `ErrorIcon`, `WorkIcon`, `HomeAddressIcon`, `LogoutDoorIcon`, `ChevronIcon`, `VehicleIcon`, `LockIcon`, `FlagIcon`, `EditIcon`, `DownloadIcon`, `LinkIcon`, `PhotoIcon`, `WorkBriefcaseIcon`
  - Also exports `IconProps` interface

### 1.3 `Icon.tsx` (client-app)
- **Path:** `client-app/src/components/ds/Icon.tsx`
- **System:** `@tabler/icons-react` (61 re-exports) + `@lordicon/react` (1 animated component)
- **Total icons defined:** 62
- **Exports:** Identical to rider-app `Icon.tsx` — same 61 Tabler aliases + `AnimatedIcon` + `IconProps`

### 1.4 `AdminShell.tsx` (local icon map)
- **Path:** `frontend/src/admin/AdminShell.tsx`
- **System:** Runtime lookup map referencing components from `SidebarIcons.tsx`
- **Total mapped:** 31 entries in local `iconMap` constant (not exported)
- **Map keys:** `Dashboard`, `LiveOperations`, `Map`, `Trips`, `Riders`, `Drivers`, `Vehicles`, `Dispatch`, `Pricing`, `Promotions`, `Payments`, `Payouts`, `Support`, `Safety`, `Marketing`, `Comms`, `Content`, `Analytics`, `Compliance`, `Documents`, `Settings`, `Audit`, `API`, `Team`, `Bell`, `Corporate`, `AIIntelligence`, `DriverOps`, `PlatformHealth`, `CarbonESG`, `Franchise`, `AdminTools`, `Notifications`
- Additionally imports but uses directly (not in map): `IconSearch`, `IconBell`, `IconPlus`, `IconChevron`, `IconLogout`

### 1.5 `client-app/src/components/ds/index.ts` (barrel)
- **Path:** `client-app/src/components/ds/index.ts`
- **System:** `@tabler/icons-react` (re-exported from `./Icon.tsx`)
- **Total re-exported:** 22
- **Exports:** `PhoneIcon`, `ChatIcon`, `NavigateIcon`, `CashIcon`, `CardIcon`, `ShieldIcon`, `CarIcon`, `AlertIcon`, `CheckIcon`, `BellIcon`, `PlusIcon`, `ParkingIcon`, `SirenIcon`, `CameraIcon`, `CrossIcon`, `RefreshIcon`, `MenuIcon`, `SignalIcon`, `RouteIcon`, `ClockIcon`, `OctagonAlertIcon`, `FlameIcon`, `PauseIcon`, `WrenchIcon`

### 1.6 `rider-app/app/(app)/trip/bill/page.tsx` (local payment icon map)
- **Path:** `rider-app/app/(app)/trip/bill/page.tsx`
- **System:** Inline SVG (3 inline SVGs + 1 component reference)
- **Total icons defined:** 4 (local `PAYMENT_ICONS` constant, not exported)
- **Entries:** `CASH` (inline SVG paths), `UPI` (inline SVG paths), `CARD` (inline SVG paths), `WALLET` (references `<WalletIcon>`)

### 1.7 `CMSDashboard.tsx` (local emoji icon map)
- **Path:** `frontend/src/admin/pages/CMSDashboard.tsx`
- **System:** Emoji strings in lookup table
- **Total mapped:** 6 (local `PAGE_TYPE_ICONS` constant, not exported)
- **Entries:** `POLICY` → `📜`, `FAQ` → `❓`, `HELP_ARTICLE` → `💡`, `ONBOARDING` → `👋`, `BANNER` → `📢`, `SPLASH` → `🎨`

### 1.8 `DocumentsVaultDashboard.tsx` (local emoji icon map)
- **Path:** `frontend/src/admin/pages/DocumentsVaultDashboard.tsx`
- **System:** Emoji strings in lookup table
- **Total mapped:** 4 (local `MIME_ICONS` constant, not exported)
- **Entries:** `application/pdf` → `📄`, `image/jpeg` → `🖼`, `image/png` → `🖼`, `image/jpg` → `🖼`

### 1.9 `NotificationsDashboard.tsx` (local emoji icon map)
- **Path:** `frontend/src/admin/pages/NotificationsDashboard.tsx`
- **System:** Emoji strings in lookup table
- **Total mapped:** 6 (local `ALERT_ICONS` constant, not exported)
- **Entries:** `SOS` → `🆘`, `HIGH_CANCELLATION` → `📉`, `SURGE_CAP` → `⚡`, `PAYMENT_GW_DOWN` → `💳`, `KYC_BACKLOG_SLA` → `📋`, `PAYOUT_FAILURE` → `💸`

### 1.10 `AnalyticsExtendedDashboard.tsx` (local emoji icon map)
- **Path:** `frontend/src/admin/pages/AnalyticsExtendedDashboard.tsx`
- **System:** Emoji strings in lookup table
- **Total mapped:** 6 (local `DASHBOARD_ICONS` constant, not exported)
- **Entries:** `operations` → `🗺`, `growth` → `📈`, `finance` → `💰`, `driver-supply` → `🚗`, `marketing` → `📣`, `safety` → `🛡`

### 1.11 `client-app/src/assets/icons/animated/index.ts`
- **Path:** `client-app/src/assets/icons/animated/index.ts`
- **System:** Lottie JSON animated icon assets (re-exported)
- **Total defined:** 15
- **Exports:** `AnimCar`, `AnimMapPin`, `AnimStar`, `AnimBell`, `AnimWallet`, `AnimShield`, `AnimGift`, `AnimTrophy`, `AnimCheck`, `AnimWarning`, `AnimEmptyBox`, `AnimPhone`, `AnimChat`, `AnimUser`, `AnimSettings`

---

## Section 2: Raw SVG Files Used as Icons

### 2.1 Root `icon/` folder (~300 SVGs)
- **Path:** `icon/` at repo root
- **Contents:** 632 entries (SVG + PNG) — a static icon sprite library
- **Fill colors:** Hardcoded `#383B46` (outline icons) or `black` (`_t` variant icons)
- **`currentColor`:** None use `currentColor`
- **Referenced in code:** NO — zero `.svg` imports found in any `.tsx`/`.ts`/`.jsx` file

### 2.2 `icon/Admin-icon/` (32 SVGs)
| File | Path | Hardcoded Fill | currentColor | Referenced? |
|------|------|---------------|-------------|-------------|
| `Admin Tools.svg` | `icon/Admin-icon/Admin Tools.svg` | `black` | No | No |
| `AI intelligence.svg` | `icon/Admin-icon/AI intelligence.svg` | `black` | No | No |
| `Analytics and report.svg` | `icon/Admin-icon/Analytics and report.svg` | `black` | No | No |
| `Audit Logs.svg` | `icon/Admin-icon/Audit Logs.svg` | `black` | No | No |
| `carbon and ecg.svg` | `icon/Admin-icon/carbon and ecg.svg` | `black` | No | No |
| `communications.svg` | `icon/Admin-icon/communications.svg` | `black` | No | No |
| `Compilance and KYC.svg` | `icon/Admin-icon/Compilance and KYC.svg` | `black` | No | No |
| `Configuration.svg` | `icon/Admin-icon/Configuration.svg` | `black` | No | No |
| `Content.svg` | `icon/Admin-icon/Content.svg` | `black` | No | No |
| `Corporate B2B.svg` | `icon/Admin-icon/Corporate B2B.svg` | `black` | No | No |
| `Dashboard.svg` | `icon/Admin-icon/Dashboard.svg` | `black`, `white` | No | No |
| `Developer_api.svg` | `icon/Admin-icon/Developer_api.svg` | `black`, `white` | No | No |
| `Dispatch and zones.svg` | `icon/Admin-icon/Dispatch and zones.svg` | `black` | No | No |
| `Document and vault.svg` | `icon/Admin-icon/Document and vault.svg` | `black`, `white` | No | No |
| `Driver ops.svg` | `icon/Admin-icon/Driver ops.svg` | `black` | No | No |
| `driver.svg` | `icon/Admin-icon/driver.svg` | `black` | No | No |
| `Franchies Multi-Tenant.svg` | `icon/Admin-icon/Franchies Multi-Tenant.svg` | `black` | No | No |
| `Live operations.svg` | `icon/Admin-icon/Live operations.svg` | `black` | No | No |
| `Marketing and campaign.svg` | `icon/Admin-icon/Marketing and campaign.svg` | `black` | No | No |
| `Marketing and campain.svg` | `icon/Admin-icon/Marketing and campain.svg` | `black` | No | No |
| `notifications.svg` | `icon/Admin-icon/notifications.svg` | `black` | No | No |
| `Payment and Finance.svg` | `icon/Admin-icon/Payment and Finance.svg` | `black` | No | No |
| `Payout.svg` | `icon/Admin-icon/Payout.svg` | `black` | No | No |
| `platform health.svg` | `icon/Admin-icon/platform health.svg` | `black` | No | No |
| `Pricing and surge.svg` | `icon/Admin-icon/Pricing and surge.svg` | `black` | No | No |
| `Promotions.svg` | `icon/Admin-icon/Promotions.svg` | `black` | No | No |
| `riders.svg` | `icon/Admin-icon/riders.svg` | `black` | No | No |
| `Safety and incident.svg` | `icon/Admin-icon/Safety and incident.svg` | `black` | No | No |
| `Support and Ticket.svg` | `icon/Admin-icon/Support and Ticket.svg` | `black` | No | No |
| `Team and Roles.svg` | `icon/Admin-icon/Team and Roles.svg` | `black` | No | No |
| `Trip.svg` | `icon/Admin-icon/Trip.svg` | `black` | No | No |
| `vehicles.svg` | `icon/Admin-icon/vehicles.svg` | `black` | No | No |

### 2.3 `client-app/public/` (5 SVGs — Next.js boilerplate)
| File | Path | Hardcoded Fill | currentColor | Referenced? |
|------|------|---------------|-------------|-------------|
| `file.svg` | `client-app/public/file.svg` | `#666` | No | No |
| `globe.svg` | `client-app/public/globe.svg` | `#666`, `#fff` | No | No |
| `next.svg` | `client-app/public/next.svg` | `#000` | No | No |
| `vercel.svg` | `client-app/public/vercel.svg` | `#fff` | No | No |
| `window.svg` | `client-app/public/window.svg` | `#666` | No | No |

### 2.4 `scripts/icon-source.svg`
- **Path:** `scripts/icon-source.svg`
- **Hardcoded fill:** Yes — `#0073E6` (bg), `white` (stroke), `none`
- **currentColor:** No
- **Referenced:** Yes — by `scripts/generate-icons.sh` (lines 2, 9, 116)

### Key finding
- ~340 raw SVG files exist across the repo
- **Zero** `.svg` files are imported in any `.tsx`/`.ts`/`.jsx` source code
- The `icon/` folder is completely disconnected from the running application
- `SidebarIcons.tsx` has inline SVG components with conceptually matching names to `icon/Admin-icon/` SVG files but are independent implementations

---

## Section 3: Emoji Used as Icon Substitutes

### 3.1 Admin Panel (`frontend/src/admin/`)

#### `ConfigDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 58 | ⚙️ | `icon: '⚙️'` in NAV array (Global Settings) |
| 59 | 🚩 | `icon: '🚩'` in NAV array (Feature Flags) |
| 60 | 📱 | `icon: '📱'` in NAV array (App Versions) |
| 61 | 🔌 | `icon: '🔌'` in NAV array (Integrations) |
| 62 | ✉️ | `icon: '✉️'` in NAV array (Notification Templates) |
| 63 | 🚫 | `icon: '🚫'` in NAV array (Cancellation Rules) |
| 64 | ⭐ | `icon: '⭐'` in NAV array (Rating Thresholds) |

#### `DeveloperDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 66 | 🔑 | `icon: '🔑'` in TABS array (API Keys) |
| 67 | 🪝 | `icon: '🪝'` in TABS array (Webhooks) |
| 68 | 📋 | `icon: '📋'` in TABS array (API Logs) |
| 69 | 🧪 | `icon: '🧪'` in TABS array (Sandbox) |
| 70 | 📡 | `icon: '📡'` in TABS array (Status Page) |

#### `NotificationsDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 66 | 🆘 | `ALERT_ICONS` value for `SOS` |
| 67 | 📉 | `ALERT_ICONS` value for `HIGH_CANCELLATION` |
| 68 | ⚡ | `ALERT_ICONS` value for `SURGE_CAP` |
| 69 | 💳 | `ALERT_ICONS` value for `PAYMENT_GW_DOWN` |
| 70 | 📋 | `ALERT_ICONS` value for `KYC_BACKLOG_SLA` |
| 71 | 💸 | `ALERT_ICONS` value for `PAYOUT_FAILURE` |
| 356 | 🔔 | Fallback in alert row icon display |
| 374 | 🔔 | Empty state icon `<span>` |
| 607 | 📧, 💬, 📱 | `channelLabels` dict for `EMAIL`, `SLACK`, `SMS` |

#### `CMSDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 63 | 📜, ❓, 💡, 👋, 📢, 🎨 | `PAGE_TYPE_ICONS` map values |
| 258 | 📄 | Fallback in page type icon display |

#### `DocumentsVaultDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 31 | 📄, 🖼 | `MIME_ICONS` map for PDF, JPEG, PNG |
| 64 | 📁 | Fallback for unknown MIME types |
| 298 | 🗄 | Empty state icon |

#### `SafetyDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 461 | 🔴 | Conditional label in SOS case review |
| 537 | 📞 | Button text: `📞 Call Rider` |
| 543 | 📞 | Button text: `📞 Call Driver` |
| 550 | 🚨 | Button text: `🚨 Dispatch Police` |
| 557 | ✉️ | Button text: `✉️ Alert Contacts` |
| 580 | ✅ | Button text: `✅ Resolve Alert` |
| 601 | 🛡️ | Icon display in empty state |
| 733 | 🛡️ | Section heading |
| 763 | 🔴 | `<option>` label: `🔴 Global Ban` |

#### `MarketingDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 935 | 🚀 | Button text: `🚀 Register Campaign` |
| 951 | 📲 | Button text: `📲 Send Push to Segment` |
| 992 | 📊 | Button text: `Hide/View Metrics 📊` |
| 1193 | 💾 | Button text: `💾 Save Segment` |
| 1366 | 🚀 | Button text: `🚀 Publish Banner Card` |
| 1698 | 🔍 | Button text: `🔍 Verify DNS TXT Records` |
| 1768 | 📲 | Button text: `📲 Send Push` |

#### `SupportDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 949 | ⚠️ / ⏱ | SLA status icon |
| 1202 | 🔒 | Internal note label |

#### `ComplianceExtendedDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 442 | 🚗 | `icon: '🚗'` in compliance card (RTO Submission) |
| 443 | 🔍 | `icon: '🔍'` (AML/Sanctions Screening) |
| 444 | 🧾 | `icon: '🧾'` (e-Invoice Compliance) |
| 445 | 🛡 | `icon: '🛡'` (Insurance Policy) |
| 446 | 📋 | `icon: '📋'` (Background Check) |
| 447 | 🌐 | `icon: '🌐'` (DPDP Act Consent) |

#### `AnalyticsExtendedDashboard.tsx`
| Line | Emoji | Context |
|------|-------|---------|
| 17 | 🗺, 📈, 💰, 🚗, 📣, 🛡 | `DASHBOARD_ICONS` map values |

#### Additional files with emoji: `PricingDashboard.tsx` (⏱, ✕), `PayoutsDashboard.tsx` (✕), `VehiclesList.tsx` (✉), `TripsList.tsx` (★), `RidersList.tsx` (★), `RiderDetail.tsx` (★), `DriversList.tsx` (★), `DriverDetail.tsx` (⚠️), `DriverOnboardingQueue.tsx` (✓, ✗), `DashboardHome.tsx` (★), `SettingsDashboard.tsx` (✓), `VehicleProfilesMatrix.tsx` (✓, ▲, ●), `DriverVerificationQueue.tsx` (✓, ▲, ●), `MarketplaceOrchestrator.tsx` (🟢, 🔴, 🖱️, ✋)

### 3.2 Client-App (`client-app/`)

`OfferPopup.tsx` (★), `DriverTripManager.tsx` (★), `auth/PhoneVerifyScreen.tsx` (🇮🇳), `onboarding/page.tsx` (✔️), `driver-onboarding/page.tsx` (✔️, ✓), `driver-account/vehicles/page.tsx` (✓, ⚠, ✗), `driver-account/trip-history/page.tsx` (➔, ⏸️, ▶️), `driver-account/settings/page.tsx` (✓, ⚠), `driver-account/earnings/page.tsx` (➔), `account/settings/page.tsx` (🚨), `account/payments/page.tsx` (🚨)

### 3.3 Rider-App (`rider-app/`)

`app/(auth)/login/page.tsx` (🇮🇳), `app/(auth)/onboarding/page.tsx` (✓), `app/(app)/trip/rate/page.tsx` (★), `app/(app)/account/page.tsx` (✓)

### 3.4 Icon System Files (comments about emoji migration)

| File | Line | Content |
|------|------|---------|
| `client-app/src/components/ds/Icon.tsx` | 42 | `// ─── NEW ICONS (emoji replacements) ───────────────` |
| `rider-app/src/components/ds/Icon.tsx` | 42 | `// ─── NEW ICONS (emoji replacements) ───────────────` |

---

## Section 4: All Icon Import/Usage Sites

### 4.1 client-app (33 files using icon components)

#### `client-app/src/app/driver-account/layout.tsx`
- **Import (line 8-14):** `import { IconDeviceMobile as DeviceMobileIcon, IconCurrencyRupee as CurrencyRupeeIcon, IconFolder as FolderIcon, IconChartBar as ChartBarIcon, IconSchool as SchoolIcon } from '@tabler/icons-react';`
- **Import (line 15-27):** `import { UserIcon, CardIcon, TrophyIcon, CarIcon, WalletIcon, NotificationIcon, GiftIcon, SettingsIcon, ChatIcon, LogoutDoorIcon, MenuIcon } from '@/components/ds/Icon';`
- **JSX usage:** `<DeviceMobileIcon>` (36), `<UserIcon>` (37, 68, 173), `<CurrencyRupeeIcon>` (38), `<CardIcon>` (39), `<FolderIcon>` (40), `<TrophyIcon>` (41), `<CarIcon>` (42), `<ChartBarIcon>` (43), `<WalletIcon>` (44), `<NotificationIcon>` (45), `<SchoolIcon>` (46), `<GiftIcon>` (47), `<SettingsIcon>` (48), `<ChatIcon>` (49), `<LogoutDoorIcon>` (99, 160, 208), `<MenuIcon>` (112), `<SuccessIcon>` (100, 179)

#### `client-app/src/app/account/layout.tsx`
- **Import (line 8-10):** `import { IconFolder as FolderIcon } from '@tabler/icons-react';`
- **Import (line 11-28):** `import { CarIcon, UserIcon, CardIcon, WalletIcon, GiftIcon, TrophyIcon, LocationIcon, SirenIcon, ShieldIcon, NotificationIcon, SettingsIcon, ChatIcon, DocumentIcon, LogoutDoorIcon, MenuIcon, SuccessIcon } from '@/components/ds/Icon';`
- **JSX usage:** `<CarIcon>` (55), `<FolderIcon>` (56), `<UserIcon>` (57), `<CardIcon>` (58), `<WalletIcon>` (59), `<GiftIcon>` (60), `<TrophyIcon>` (61), `<LocationIcon>` (62), `<SirenIcon>` (63), `<ShieldIcon>` (64), `<NotificationIcon>` (65), `<SettingsIcon>` (66), `<ChatIcon>` (67), `<DocumentIcon>` (68), `<SuccessIcon>` (100, 179), `<LogoutDoorIcon>` (129, 208), `<MenuIcon>` (142)

#### `client-app/src/app/page.tsx`
- **Import (line 7):** `import { CarIcon, ShieldIcon, LocationIcon } from '@/components/ds/Icon';`
- **JSX usage:** `<CarIcon>`, `<ShieldIcon>`, `<LocationIcon>` in feature cards

#### `client-app/src/app/onboarding/page.tsx`
- **Import (line 5):** `import { AnimatedIcon, HomeAddressIcon, WorkIcon, WarningIcon, ChevronIcon } from "@/components/ds/Icon";`
- **Import (line 6):** `import { AnimMapPin } from "@/assets/icons/animated";`
- **JSX usage:** `<WarningIcon>` (212), `<ChevronIcon>` (297), `<HomeAddressIcon>` (393), `<WorkIcon>` (403), `<AnimatedIcon src={AnimMapPin}>` (515)

#### `client-app/src/app/driver-onboarding/page.tsx`
- **Import (line 8):** `import { AnimatedIcon } from '@/components/ds/Icon';`
- **Import (line 9):** `import { AnimSettings, AnimCar, AnimCheck } from '@/assets/icons/animated';`
- **JSX usage:** `<AnimatedIcon src={AnimSettings}>` (512), `<AnimatedIcon src={AnimCar}>` (523), `<AnimatedIcon src={AnimCheck}>` (575)

#### `client-app/src/app/driver/page.tsx`
- **Import (line 54):** `import { RefreshIcon, MenuIcon, SirenIcon, NavigateIcon, SignalIcon, FlameIcon, PauseIcon, ChatIcon, OctagonAlertIcon, ClockIcon } from '@/components/ds';`

#### `client-app/src/app/driver-account/profile/page.tsx`
- **Import (line 13):** `import { UserIcon, EditIcon, StarIcon, SettingsIcon, VehicleIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver-account/support/page.tsx`
- **Import (line 13):** `import { CarIcon, CardIcon, WrenchIcon, UserIcon, ShieldIcon, InfoIcon, PhoneIcon, SuccessIcon, PhotoIcon, BackIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver-account/wallet/page.tsx`
- **Import (line 8):** `import { RouteIcon, ParkingIcon, FlameIcon, GiftIcon, PlusIcon, CashIcon } from '@/components/ds/Icon';`
- **JSX usage:** `<RouteIcon>` (14), `<ParkingIcon>` (15), `<FlameIcon>` (16), `<GiftIcon>` (17), `<PlusIcon>` (18), `<CashIcon>` (18)

#### `client-app/src/app/driver-account/vehicles/page.tsx`
- **Import (line 7):** `import { PlusIcon, WarningIcon, OctagonAlertIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver-account/payouts/page.tsx`
- **Import (line 11):** `import { CheckIcon, WarningIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver-account/performance/page.tsx`
- **Import (line 7):** `import { StarIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver-account/trip-history/page.tsx`
- **Import (line 9):** `import { LocationIcon, FlagIcon, StarIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver-account/trip-history/[tripId]/TripDetailClient.tsx`
- **Import (line 10):** `import { StarIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver/trip/live/TripInProgressPane.tsx`
- **Import (line 8):** `import { FareDisplay, StatusBadge, PhoneIcon, ChatIcon, PlusIcon, ParkingIcon, SirenIcon, RouteIcon } from '../../../../components/ds';`
- **Import (line 9):** `import { StarIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/driver/trip/live/ArrivedVerificationPane.tsx`
- **Import (line 6):** `import { FareDisplay, CheckIcon, SirenIcon, ClockIcon, CrossIcon, CameraIcon } from '@/components/ds';`

#### `client-app/src/app/driver/trip/bill/page.tsx`
- **Import (line 7):** `import { FareDisplay, ClockIcon, WrenchIcon, CheckIcon, PhoneIcon, CashIcon } from '@/components/ds';`

#### `client-app/src/app/driver/trip/rate/page.tsx`
- **Import (line 11):** `import { CheckIcon } from '@/components/ds';`
- **Import (line 12):** `import { StarIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/account/profile/page.tsx`
- **Import (line 5):** `import { UserIcon, SuccessIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/account/bookings/page.tsx`
- **Import (line 5):** `import { LocationIcon, FlagIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/account/support/page.tsx`
- **Import (line 4):** `import { CameraIcon, CrossIcon, ChevronIcon, SirenIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/account/legal/page.tsx`
- **Import (line 4):** `import { InfoIcon, DownloadIcon, SearchIcon, ChatIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/account/payments/page.tsx`
- **Import (line 5):** `import { CardIcon } from '@/components/ds/Icon';`

#### `client-app/src/app/share/page.tsx`
- **Import (line 6):** `import { UserIcon, LocationIcon, FlagIcon, StarIcon } from '@/components/ds/Icon';`

#### `client-app/src/components/DriverDrawer.tsx`
- **Import (line 6-9):** `import { UserIcon, ClockIcon, FlameIcon, PaymentIcon, CheckIcon, CarIcon, RouteIcon, CashIcon, BellIcon, ChatIcon, ShieldIcon, WrenchIcon, CrossIcon, StarIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<UserIcon>` (27, 55), `<ClockIcon>` (28), `<FlameIcon>` (29), `<PaymentIcon>` (30), `<CheckIcon>` (31), `<CarIcon>` (32), `<RouteIcon>` (33), `<CashIcon>` (34), `<BellIcon>` (35), `<ChatIcon>` (36), `<ShieldIcon>` (37), `<WrenchIcon>` (38), `<StarIcon>` (60), `<CrossIcon>` (101)

#### `client-app/src/components/DriverTripManager.tsx`
- **Import (line 7):** `import { FareDisplay, ETADisplay, StatusBadge, BellIcon, PhoneIcon, ChatIcon, NavigateIcon, CheckIcon, CashIcon, CardIcon } from './ds';`
- **JSX usage:** `<BellIcon>` (163), `<PhoneIcon>` (243), `<ChatIcon>` (253), `<NavigateIcon>` (263), `<CheckIcon>` (277), `<CashIcon>` (426), `<CardIcon>` (437)

#### `client-app/src/components/Toaster.tsx`
- **Import (line 7):** `import { SuccessIcon, ErrorIcon, InfoIcon } from '@/components/ds/Icon';`
- **JSX usage:** `<SuccessIcon>` (10), `<ErrorIcon>` (11), `<InfoIcon>` (12)

#### `client-app/src/components/SosModal.tsx`
- **Import (line 5):** `import { SirenIcon } from "@/components/ds";`
- **JSX usage:** `<SirenIcon>` (35)

#### `client-app/src/components/OfferPopup.tsx`
- **Import (line 8):** `import { FareDisplay, ShieldIcon, AlertIcon, CarIcon } from '@/components/ds';`
- **JSX usage:** `<ShieldIcon>` (222), `<AlertIcon>` (244), `<CarIcon>` (254)

#### `client-app/src/components/auth/PhoneVerifyScreen.tsx`
- **Import (line 14):** `import { BackIcon } from '@/components/ds/Icon';`
- **JSX usage:** `<BackIcon>` (233, 276)

#### `client-app/src/components/ds/DriverCard.tsx`
- **Import (line 5):** `import { StarIcon } from './Icon';`
- **JSX usage:** `<StarIcon>` (52)

### 4.2 rider-app (15 files using icon components)

#### `rider-app/src/components/ds/DriverCard.tsx`
- **Import (line 5):** `import { StarIcon } from './Icon';`
- **JSX usage:** `<StarIcon>` (52)

#### `rider-app/src/components/layout/TopBar.tsx`
- **Import (line 7):** `import { BellIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<BellIcon>` (52)

#### `rider-app/src/components/Toaster.tsx`
- **Import (line 7):** `import { SuccessIcon, ErrorIcon, InfoIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<SuccessIcon>` (10), `<ErrorIcon>` (11), `<InfoIcon>` (12)

#### `rider-app/src/components/trip/DriverCard.tsx`
- **Import (line 6):** `import { PhoneIcon, ChatIcon, ShareIcon, UserIcon, CrossIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<UserIcon>` (74), `<PhoneIcon>` (111), `<ChatIcon>` (113), `<ShareIcon>` (120), `<CrossIcon>` (145)

#### `rider-app/src/components/trip/ShareTripSheet.tsx`
- **Import (line 4):** `import { ChatIcon, PhoneIcon, LinkIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<ChatIcon>` (55), `<PhoneIcon>` (62), `<LinkIcon>` (69)

#### `rider-app/src/components/trip/SOSModal.tsx`
- **Import (line 5):** `import { SirenIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<SirenIcon>` (32, 56)

#### `rider-app/src/components/booking/BookingSheet.tsx`
- **Import (line 13):** `import { CrossIcon, PinIcon, CarIcon, FlameIcon, CheckIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<CrossIcon>` (211), `<PinIcon>` (228, 445), `<CarIcon>` (552, 700), `<FlameIcon>` (624), `<CheckIcon>` (728)

#### `rider-app/src/components/booking/QuickTiles.tsx`
- **Import (line 7):** `import { HomeIcon } from "@/components/ds/Icon";`
- **JSX usage:** `<HomeIcon>` (15)

#### `rider-app/src/components/account/States.tsx`
- **Import (line 5):** `import { AnimatedIcon } from "@/components/ds/Icon";`
- **Import (line 6):** `import { AnimEmptyBox, AnimWarning } from "@/assets/icons/animated";`
- **JSX usage:** `<AnimatedIcon src={AnimEmptyBox}>` (34), `<AnimatedIcon src={AnimWarning}>` (48)

#### `rider-app/app/page.tsx`
- **Import (line 8):** `import { AnimatedIcon } from "@/components/ds/Icon";`
- **Import (line 9):** `import { AnimShield, AnimCar, AnimWallet } from "@/assets/icons/animated";`
- **JSX usage:** `<AnimatedIcon src={AnimShield}>` (138), `<AnimatedIcon src={AnimCar}>` (148), `<AnimatedIcon src={AnimWallet}>` (158)

#### `rider-app/app/(auth)/onboarding/page.tsx`
- **Import (line 14):** `import { AnimatedIcon, HomeAddressIcon, WorkBriefcaseIcon, PinIcon } from "@/components/ds/Icon";`
- **Import (line 15):** `import { AnimUser, AnimMapPin, AnimBell } from "@/assets/icons/animated";`
- **JSX usage:** `<AnimatedIcon src={AnimUser}>` (399), `<HomeAddressIcon>` (589), `<PinIcon>` (601, 619), `<WorkBriefcaseIcon>` (607), `<AnimatedIcon src={AnimBell}>` (708), `<AnimatedIcon src={AnimMapPin}>` (752)

#### `rider-app/app/(app)/account/payments/page.tsx`
- **Import (line 8):** `import { AnimatedIcon, CardIcon, PaymentIcon } from "@/components/ds/Icon";`
- **Import (line 9):** `import { AnimWallet } from "@/assets/icons/animated";`
- **JSX usage:** `<AnimatedIcon src={AnimWallet}>` (224), `<CardIcon>` (231), `<PaymentIcon>` (341)

#### `rider-app/app/(app)/account/notifications/page.tsx`
- **Import (line 10):** `import { AnimatedIcon } from "@/components/ds/Icon";`
- **Import (line 11):** `import { AnimBell } from "@/assets/icons/animated";`
- **JSX usage:** `<AnimatedIcon src={AnimBell}>` (70)

#### `rider-app/app/(app)/account/garage/page.tsx`
- **Import (line 6):** `import { SuccessIcon, CameraIcon } from "@/components/ds/Icon";`
- **Import (line 11):** `import { AnimatedIcon, StarIcon, WarningIcon, CarIcon } from "@/components/ds/Icon";`
- **Import (line 12):** `import { AnimCar } from "@/assets/icons/animated";`
- **JSX usage:** `<CarIcon>` (65), `<StarIcon>` (77), `<WarningIcon>` (84), `<AnimatedIcon src={AnimCar}>` (167), `<SuccessIcon>` (354), `<CameraIcon>` (354)

#### `rider-app/app/(app)/account/bookings/page.tsx`
- **Import (line 7):** `import { AnimatedIcon } from "@/components/ds/Icon";`
- **Import (line 8):** `import { AnimEmptyBox } from "@/assets/icons/animated";`
- **JSX usage:** `<AnimatedIcon src={AnimEmptyBox}>` (211)

### 4.3 frontend (0 files using Tabler icons)
The `@tabler/icons-react` dependency is declared in `frontend/package.json` but no `.tsx`/`.ts` file imports it. The frontend uses only `SidebarIcons.tsx` inline SVG components.

---

## Section 5: App Store / Build Icons

### 5.1 Master Icon Source
| File | Path | Purpose | TODOs / Placeholders |
|------|------|---------|---------------------|
| `icon-source.svg` | `scripts/icon-source.svg` | Master 1024×1024 app icon, source for `generate-icons.sh` | **Line 2:** `<!-- PLACEHOLDER — replace with actual brand icon before app store submission -->`. Contains a steering-wheel placeholder shape. |

### 5.2 Icon Generation Script
| File | Path | Purpose | TODOs / Placeholders |
|------|------|---------|---------------------|
| `generate-icons.sh` | `scripts/generate-icons.sh` | Shell script generating iOS and Android icons from `icon-source.svg` (uses ImageMagick) | **Line 116:** `echo "Done. Replace scripts/icon-source.svg with your actual brand icon and re-run."` |
| `ios-post-setup.sh` | `scripts/ios-post-setup.sh` | iOS post-setup script mentioning icon generation | **Line 139:** `echo "  4. Replace placeholder icons: ./scripts/generate-icons.sh $APP_DIR"` |
| `android-post-setup.sh` | `scripts/android-post-setup.sh` | Android post-setup script mentioning icon generation | **Line 127:** `echo "  2. Run: ./scripts/generate-icons.sh $APP_DIR   (launcher icons)"` |

### 5.3 Android Launcher Icons — client-app (Driver)
- **Path:** `client-app/android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/`
- **Files:** `ic_launcher.png`, `ic_launcher_round.png`, `ic_launcher_foreground.png` (15 PNGs across 5 densities)
- **Foreground vector:** `drawable-v24/ic_launcher_foreground.xml` (generic smiley-face placeholder shape)
- **Adaptive icon configs:** `mipmap-anydpi-v26/ic_launcher.xml`, `mipmap-anydpi-v26/ic_launcher_round.xml`
- **Background:** `values/ic_launcher_background.xml` (white), `drawable/ic_launcher_background.xml`
- **All PNGs are generated artifacts from the placeholder SVG**

### 5.4 Android Launcher Icons — rider-app (Rider)
- Identical structure to client-app (same 15 PNGs + XML configs at parallel paths under `rider-app/android/`)

### 5.5 Android Splash Screens — client-app (11 PNGs)
- **Path:** `client-app/android/app/src/main/res/drawable{-land,-port}-{hdpi,mdpi,xhdpi,xxhdpi,xxxhdpi}/splash.png`
- Default Capacitor splash images, not customized with brand

### 5.6 Android Splash Screens — rider-app (11 PNGs)
- Identical structure to client-app at `rider-app/android/app/src/main/res/...`

### 5.7 iOS App Icons (NOT GENERATED)
- The `ios/` directory does **not exist** for either app
- iOS icons would be generated by `generate-icons.sh` after `npx cap add ios`
- Expected at: `{app}/ios/App/App/Assets.xcassets/AppIcon.appiconset/`
- Expected sizes: `Icon-20.png` through `Icon-1024.png` (15 files)
- **None are currently present in the repo**

### 5.8 Favicon
| File | Path | App | Notes |
|------|------|-----|-------|
| `favicon.ico` | `client-app/src/app/favicon.ico` | Driver app | Present |
| — | `rider-app/` | Rider app | **Missing** — no favicon file |
| — | `frontend/index.html` | Admin frontend | **Missing** — no `<link rel="icon">` tag |

### 5.9 PWA Manifest
- No `manifest.json` or `.webmanifest` found anywhere in the repo
- Apps use Capacitor native wrapping, not PWA install

### 5.10 Apple Touch Icons
- No `apple-touch-icon` files found anywhere
- No `<link rel="apple-touch-icon">` tags in any HTML file

### 5.11 Brand Logo Placeholder Directories
| File | Path | TODOs / Placeholders |
|------|------|---------------------|
| `README.md` | `rider-app/public/assets/brand/README.md` | `# Placeholder for rider-app brand logo assets... Standard sizes: - Header: Height 32px - 48px - Splash/Login: Height 120px - 180px` |
| `README.md` | `client-app/public/assets/brand/README.md` | Same placeholder content for client-app |
| `README.md` | `frontend/public/assets/brand/README.md` | Same placeholder content for frontend |

### 5.12 Capacitor Configs
- `client-app/capacitor.config.ts` — references `SplashScreen` plugin
- `rider-app/capacitor.config.ts` — references `SplashScreen` plugin

### 5.13 Store Listing Graphics
- **No** app store screenshots, feature graphics, or store listing images found

---

## Summary of Key Findings

| Metric | Count |
|--------|-------|
| Icon definition files (Section 1) | 11 (4 component files + 4 emoji maps + 2 barrel/index files + 1 animated icons barrel) |
| Icon definitions total | ~250 (36 inline SVG + 124 Tabler re-exports + 15 animated + 31 map entries + various emoji maps) |
| Raw SVG files (Section 2) | ~340 files across `icon/`, `icon/Admin-icon/`, `public/`, `scripts/` |
| SVG files imported in code | 0 — zero `.svg` imports in any source file |
| SVG files using `currentColor` | 0 — all use hardcoded fills |
| Files using emoji as icons (Section 3) | ~40 files with ~60+ unique emoji characters |
| Files importing icon components (Section 4) | 48 files (33 client-app + 15 rider-app + 0 frontend) |
| Icon libraries used | `@tabler/icons-react` (rider-app, client-app), `@lordicon/react` (animated, rider-app, client-app) |
| Android launcher icons | Present in both apps but generated from placeholder |
| iOS app icons | **Not generated** — `ios/` directory missing for both apps |
| Favicon | Only `client-app` has one |
| PWA manifest | **None** |
| Apple touch icons | **None** |
| App store graphics | **None** |
| Brand logo assets | All three apps have placeholder directories only |
| `icon/` SVG asset library | **Completely disconnected** from running application code |
