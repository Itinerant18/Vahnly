# DriveU Research Artifact Inventory & Reference Analysis

- **Date:** 2026-11-12
- **Audit Target:** DriveU Competitive Research Collections in Vahanly Repository
- **Locations Discovered:**
  1. `C:\workspace\Driver\client-app\DriveU_apk_for_rea\`
  2. `C:\workspace\Driver\rider-app\DriveUpartner_apk_for_rea\`
- **Auditor:** Senior Mobile Product Architect & Reverse Engineering Analyst

---

## 1. Discovered Research Repositories

Two dedicated research folders exist in this repository, both analyzing package `com.driveu.partner` (DriveU's Android application for driver partners):

```
C:\workspace\Driver\
├── client-app\
│   └── DriveU_apk_for_rea\                # Primary analysis & decompiled workspace
│       ├── DEEP_DIVE_REPORT.md            # Architecture, API auth, security observations
│       ├── FEATURE_FUNCTIONALITY.md       # Comprehensive feature map, native activities, background services
│       ├── analysis/                      # 46 API endpoints, 302 constants, deeplinks, permissions
│       ├── apk/                           # Original base.apk & split_config.arm64_v8a.apk
│       ├── decompiled/                    # Hermes JS bundle (27MB, 705k lines) + JADX Java sources
│       ├── device/                        # AAPT dumps, manifest xmltree, dumpsys, network security config
│       └── unpacked/                      # Resource tables, assets, Juspay checkout configs
└── rider-app\
    └── DriveUpartner_apk_for_rea\         # REA first-pass static evidence collection
        ├── README.md                      # Workspace manifest and APK hashes
        ├── reports/
        │   ├── static-findings.md         # Package structure, manifest hotspots, review limits
        │   ├── apk-inventory.json         # 3,477 ZIP entries with CRC-32 and SHA-256
        │   ├── component-index.json       # 119 manifest components (90 activities, 14 services)
        │   ├── dex-structure.json         # DEX class and method signatures
        │   └── dex-url-candidates.json    # Literal URL strings extracted from DEX
        ├── extracted/                     # Raw index.android.bundle & arm64 .so binaries
        └── installed_package/             # Exact copied APKs from physical device
```

---

## 2. Reference Target Metadata

| Attribute | Documented Value | Source Artifact |
|:---|:---|:---|
| **Package Name** | `com.driveu.partner` | `device/dumpsys_package.txt`, `reports/base-badging.txt` |
| **Application Name** | DriveU Partner | `reports/base-badging.txt` |
| **App Version** | `11.24.28` (versionCode `237`) | `analysis/config_constants.json`, `reports/static-findings.md` |
| **Source Device** | OnePlus `CPH2573` (Android 16 / API 36) | `reports/static-findings.md`, `device/getprop.txt` |
| **Capture Date** | 2026-11-12 UTC | `reports/static-findings.md`, `DEEP_DIVE_REPORT.md` |
| **APK Hashes** | Base: `f182d929...`, Split: `632c407b...` | `reports/static-findings.md` |
| **Target Architecture** | ARM64-v8a (`split_config.arm64_v8a.apk`) | `installed_package/` |
| **Runtime Architecture** | Hybrid: React Native (Hermes bytecode) + Native Kotlin (Jetpack Compose / Hilt) | `FEATURE_FUNCTIONALITY.md`, `DEEP_DIVE_REPORT.md` |
| **Signing Certificate** | `CN=Satish, OU=DriveU`, RSA 2048, SHA-256 `fbae5d92...` | `DEEP_DIVE_REPORT.md`, `reports/signing.txt` |

---

## 3. Normalized Reference Capabilities Inventory

The reverse engineering artifacts document 8 major functional areas across driver and rider workflows:

### 3.1 Authentication & Device Identity
- **Entry Point:** `MainActivity` → `Onboard` React Native screen.
- **Protocol:** `POST https://api.driveu.in/driver/login/`.
- **Payload:** Phone number + Passcode (OTP/PIN) enriched with device fingerprinting metadata:
  ```json
  {
    "mobile": "98XXXXXXXX",
    "passcode": "XXXX",
    "deviceName": "OnePlus CPH2573",
    "androidVersion": "16",
    "simOperator": "JIO",
    "networkType": "5G",
    "autoTime": true,
    "timeZoneName": "Asia/Kolkata",
    "currentDateTime": "2026-11-12T..."
  }
  ```
- **Transport Auth Model:** DriveU does **not** use Bearer tokens or Session Cookies for driver endpoints. Subsequent API calls pass credentials as query parameters or `FormData`:
  - `GET /driver/upcoming-bookings/?driver_id=<id>&imei=<imei>`
  - `POST` calls include `driver_id`, `imei`, `latitude`, `longitude`, `booking_id`.
- **Evidence Reference:** `DEEP_DIVE_REPORT.md` §2, `analysis/ctx_auth_header.txt`.

### 3.2 Duty Lifecycle & State Machine
The driver's operating state is managed via `dispatchBasedOnState(state)` which executes explicit backend transitions:

| State | Action Function | API Endpoint | Pre-Conditions / Gating |
|:---|:---|:---|:---|
| `login` | `signInDriver` | `driver/login/` | Phone + OTP verification |
| `free` | `freeDriver` | `driver/force-free/` | Duty reset |
| `on-duty` | `makeDriverOnDuty` | `driver/check-in/` | **Gated:** Battery ≥35%, Net ≥50 kbps, GPS On, No Mock GPS, No Fraud Apps |
| `reserved` | `reserveDriver` | `driver/reserve-booking/` | Scheduled booking acceptance |
| `at-point` | `makeDriverAtPoint` | `driver/update-state/` | Driver arrives at car pickup location |
| `trip-started` | `makeTripStart` | `driver/update-state/` | Odometer entered + OTP confirmed |
| `trip-ended` | `makeTripEnd` | `driver/driver-checkout-booking/` | Odometer entered + Fare computed |
| `logout` | `signOutDriver` | `driver/logout/` | Trip completed, check-out |

- **Evidence Reference:** `DEEP_DIVE_REPORT.md` §2, `FEATURE_FUNCTIONALITY.md` §5.2.

### 3.3 Booking Offer & Dispatch Matching
- **Notification Rail:** High-priority FCM push routed to `MyFirebaseMessagingService` with dedicated channel `notification_one` and custom sound.
- **UI Presentation:** Full-screen takeover activity (`IncomingActivity` / `NewIncomingActivity`).
- **Data Presented:** Pickup address, distance to pickup, vehicle transmission (Manual/Automatic), vehicle type, estimated earnings, trip duration.
- **Actions:**
  - Opt-in / Accept: `POST driver/opt-booking/v2/`
  - Reject: `POST driver/reject-booking/` with reason code (`b2cCancellationReason`, `reject_reason`)
  - Reservation: `POST driver/reserve-booking/` for future trips (`driver/future-bookings/v2/`)
- **Evidence Reference:** `FEATURE_FUNCTIONALITY.md` §1 & §5.3, `analysis/api_endpoints.txt`.

### 3.4 In-Trip Execution & Checklists
- **Navigation:** Native bridge launches external navigation (`openDeliveryAddress` / Google Maps intent).
- **Waiting Charges:** Driver check-in timer tracks waiting minutes at pickup point (`ALLOW_BOOKING_RESERVATION`, `EVT_CHECKED_IN`).
- **Trip Verification:** Start OTP entry, odometer validation, car plate confirmation.
- **Route / Time Modifications:** `BookingModificationActivity` allows adding stops or extending scheduled package duration (`driver/b2b-action/`).
- **Emergency / Concerns:** `DUDriverChatActivity`, `ticket/driver-on-trip-concern/`, and accident reporting (`openAccidentReporting`).
- **Evidence Reference:** `FEATURE_FUNCTIONALITY.md` §1 & §5.6.

### 3.5 Payments & Financial Settlement
- **Customer Fare Collection:** `payment/cash_payment/` (driver confirms cash received) or native **Juspay HyperSDK** (`JuspayCheckoutActivity`, UPI/cards/netbanking).
- **Fare Breakdown:** `app/receipt-items/v2/` displays itemized receipt: base fare, extra km, extra hours, night allowance, wait fee, tolls, taxes.
- **Driver Wallet:** `wallet/balance/driver/`, transaction logs (`wallet/txn-log/driver/`).
- **Instant Withdrawal:** `WithdrawMoneyActivity` allows instant payout to linked bank accounts.
- **Subscription Deductions:** `driver/deduct-subscription/` for platform partner fees.
- **Evidence Reference:** `DEEP_DIVE_REPORT.md` §5, `FEATURE_FUNCTIONALITY.md` §5.4.

### 3.6 Location Polling & Anti-Fraud Infrastructure
- **Continuous GPS Polling:** 4 dedicated background services (`LocationPollerService`, `LocationUpdateService`, `PersistLocationUpdateService`, `CheckInForegroundService`) push GPS fixes across 53 API calls.
- **Anti-Fraud Gating:** 
  - Mock location detection via `MockLocationEnableActivity`.
  - App scanning for GPS spoofing tools via native method `checkFraudApps`.
  - Device health verification via `EssentialServicesMonitor`.
- **Floating Overlay Bubble:** `BubbleService` (using Android `SYSTEM_ALERT_WINDOW`) draws an interactive floating status bubble over Google Maps/Waze during active trips.
- **Evidence Reference:** `FEATURE_FUNCTIONALITY.md` §2 & §4.

### 3.7 Driver KYC & Document Onboarding
- **Documents Collected:** Aadhaar, PAN card, Commercial Driving License (DL), eShram card, Police Verification certificate.
- **DigiLocker Integration:** Government KYC verification executed within `WebViewActivity` against whitelisted DigiLocker domains (`*.digilocker.gov.in`).
- **Selfie Verification:** `FrontCameraActivity` / CameraX capture with face graphic overlay to verify driver identity before duty.
- **Evidence Reference:** `FEATURE_FUNCTIONALITY.md` §1, `DEEP_DIVE_REPORT.md` §4 & §7b.

### 3.8 Aggregator & B2B Extensions
- **Rapido Driver Integration:** DriveU integrates with Rapido for driver dispatch (`driver/rapido-fare/`, `openRapidoBookingPage`, `openRapidoTrackingScreen`).
- **B2B Inspections:** `driver/b2b-checklist-poll/` and `UploadChecklistService` for corporate fleet inspections.
- **Evidence Reference:** `FEATURE_FUNCTIONALITY.md` §1 & §6.

---

## 4. Evidence Quality & Research Scope Assessment

### Evidence Strengths (High Confidence)
1. **Decompiled Hermes JavaScript Bundle:** Complete 27 MB decompile (`decompiled/hermes_decompiled.js`) capturing all React Native business logic, endpoint mappings, Redux actions, and operational thresholds.
2. **Decompiled JADX Java Sources:** 6,920 reconstructed Java classes detailing native services, receivers, Juspay checkout activities, and native method implementations.
3. **Exact Android Manifest & Resource Table:** Decoded permissions, activities, intent-filters, service declarations, and network security configs.

### Research Blind Spots & Missing Coverage
1. **No DriveU Consumer/Rider APK:** The repository does **not** contain a reverse-engineered package for the DriveU consumer application (`com.driveu.consumer`). All rider-side expectations must be derived from:
   - Backend endpoint contracts exposed to drivers (e.g., `app/receipt-items/v2/`, `payment/status/`, `driver/upcoming-bookings/`).
   - Vahanly's existing product specs (`DOC/DRIVER_APP_REDESIGN_PLAN.md`, `PRODUCT.md`).
   - Industry-standard ride-hailing UX (Uber, Ola, Drivers4Me).
2. **No Dynamic Network Traces (PCAP/HAR):** Research was performed purely via static APK deconstruction. Exact JSON request/response bodies for some minor endpoints remain unverified.
3. **Proprietary Backend Logic:** DriveU's internal dispatch algorithms, spatial indexing, driver ranking, and database schema are private to DriveU's servers and cannot be inferred from client bytecode.
