TASK: Complete icon system overhaul for Vahnly — replace all emoji and
hand-written SVGs with Tabler Icons (static) + Lordicon (animated colorful).

═══════════════════════════════════════════════
PART A — SETUP & INSTALLATION
═══════════════════════════════════════════════

## Step A1 — Install packages in all 3 apps

Run these terminal commands:

# Driver App

  cd client-app
  npm install @tabler/icons-react @lordicon/react

# Rider App  

  cd rider-app
  npm install @tabler/icons-react @lordicon/react

# Admin Panel

  cd frontend
  npm install @tabler/icons-react

Do NOT proceed until all 3 installs succeed.

## Step A2 — Create Lordicon assets folder

Create these folders:
  client-app/src/assets/icons/animated/
  rider-app/src/assets/icons/animated/

Download these Lordicon JSON files from <https://lordicon.com>
(free tier, search by name, download "JSON for Lottie"):

  car.json          → vehicle/ride icon (colorful blue/orange)
  map-pin.json      → location/pin icon (colorful red)
  star.json         → rating star (colorful gold)
  bell.json         → notifications (colorful yellow)
  wallet.json       → payments/wallet (colorful green)
  shield.json       → safety/security (colorful blue)
  gift.json         → rewards/referral (colorful purple)
  trophy.json       → achievements (colorful gold)
  check.json        → success/confirmed (colorful green)
  warning.json      → alert/warning (colorful orange/red)
  empty-box.json    → empty states (colorful neutral)
  phone.json        → call action (colorful blue)
  chat.json         → message action (colorful teal)
  user.json         → profile (colorful blue)
  settings.json     → settings gear (colorful gray/blue)

Place ALL downloaded .json files into both:
  client-app/src/assets/icons/animated/
  rider-app/src/assets/icons/animated/

═══════════════════════════════════════════════
PART B — CREATE UNIFIED ICON COMPONENTS
═══════════════════════════════════════════════

## Step B1 — Replace client-app/src/components/ds/Icon.tsx

Replace entire file content with:

```tsx
/**
 * Icon.tsx — Vahnly Driver App Icon System
 * Static: @tabler/icons-react (stroke-based, currentColor, strokeWidth 1.8)
 * Animated: @lordicon/react (Lottie JSON, colorful, hover/loop triggers)
 */

import React, { useRef } from 'react';
import { Player } from '@lordicon/react';

// ─── TABLER STATIC ICONS (re-exported with Vahnly names) ───────────────────
export { IconPhone as PhoneIcon }           from '@tabler/icons-react';
export { IconMessageCircle as ChatIcon }    from '@tabler/icons-react';
export { IconNavigation as NavigateIcon }   from '@tabler/icons-react';
export { IconCash as CashIcon }             from '@tabler/icons-react';
export { IconCreditCard as CardIcon }       from '@tabler/icons-react';
export { IconShield as ShieldIcon }         from '@tabler/icons-react';
export { IconCar as CarIcon }               from '@tabler/icons-react';
export { IconAlertTriangle as AlertIcon }   from '@tabler/icons-react';
export { IconCheck as CheckIcon }           from '@tabler/icons-react';
export { IconBell as BellIcon }             from '@tabler/icons-react';
export { IconPlus as PlusIcon }             from '@tabler/icons-react';
export { IconParking as ParkingIcon }       from '@tabler/icons-react';
export { IconAlertOctagon as SirenIcon }    from '@tabler/icons-react';
export { IconCamera as CameraIcon }         from '@tabler/icons-react';
export { IconX as CrossIcon }               from '@tabler/icons-react';
export { IconRefresh as RefreshIcon }       from '@tabler/icons-react';
export { IconMenu2 as MenuIcon }            from '@tabler/icons-react';
export { IconWifi as SignalIcon }           from '@tabler/icons-react';
export { IconAlertOctagon as OctagonAlertIcon } from '@tabler/icons-react';
export { IconFlame as FlameIcon }           from '@tabler/icons-react';
export { IconPlayerPause as PauseIcon }     from '@tabler/icons-react';
export { IconTool as WrenchIcon }           from '@tabler/icons-react';
export { IconClock as ClockIcon }           from '@tabler/icons-react';
export { IconRoute as RouteIcon }           from '@tabler/icons-react';
export { IconHome as HomeIcon }             from '@tabler/icons-react';
export { IconWallet as PaymentIcon }        from '@tabler/icons-react';
export { IconMapPin as PinIcon }            from '@tabler/icons-react';
export { IconUser as UserIcon }             from '@tabler/icons-react';
export { IconSearch as SearchIcon }         from '@tabler/icons-react';
export { IconArrowLeft as BackIcon }        from '@tabler/icons-react';

// ─── NEW ICONS (emoji replacements) ────────────────────────────────────────
export { IconStar as StarIcon }             from '@tabler/icons-react';
export { IconWallet as WalletIcon }         from '@tabler/icons-react';
export { IconReceipt as BookingIcon }       from '@tabler/icons-react';
export { IconGift as GiftIcon }             from '@tabler/icons-react';
export { IconTrophy as TrophyIcon }         from '@tabler/icons-react';
export { IconMapPin as LocationIcon }       from '@tabler/icons-react';
export { IconHelp as SupportIcon }          from '@tabler/icons-react';
export { IconFile as DocumentIcon }         from '@tabler/icons-react';
export { IconBell as NotificationIcon }     from '@tabler/icons-react';
export { IconSettings as SettingsIcon }     from '@tabler/icons-react';
export { IconShare as ShareIcon }           from '@tabler/icons-react';
export { IconCamera as CameraOutlineIcon }  from '@tabler/icons-react';
export { IconInfoCircle as InfoIcon }       from '@tabler/icons-react';
export { IconLogout as LogoutIcon }         from '@tabler/icons-react';
export { IconAlertTriangle as WarningIcon } from '@tabler/icons-react';
export { IconCircleCheck as SuccessIcon }   from '@tabler/icons-react';
export { IconCircleX as ErrorIcon }         from '@tabler/icons-react';
export { IconBuildingSkyscraper as WorkIcon } from '@tabler/icons-react';
export { IconHome2 as HomeAddressIcon }     from '@tabler/icons-react';
export { IconDoor as LogoutDoorIcon }       from '@tabler/icons-react';
export { IconChevronRight as ChevronIcon }  from '@tabler/icons-react';
export { IconBus as VehicleIcon }           from '@tabler/icons-react';
export { IconLock as LockIcon }             from '@tabler/icons-react';
export { IconFlag as FlagIcon }             from '@tabler/icons-react';
export { IconEdit as EditIcon }             from '@tabler/icons-react';
export { IconDownload as DownloadIcon }     from '@tabler/icons-react';
export { IconExternalLink as LinkIcon }     from '@tabler/icons-react';
export { IconPhoto as PhotoIcon }           from '@tabler/icons-react';
export { IconBriefcase as WorkBriefcaseIcon } from '@tabler/icons-react';

// ─── ICON PROPS TYPE ────────────────────────────────────────────────────────
export interface IconProps {
  size?: number;
  color?: string;
  stroke?: number;
  className?: string;
}

// ─── ANIMATED ICON COMPONENT (Lordicon) ────────────────────────────────────
interface AnimatedIconProps {
  src: object;          // Lottie JSON object
  size?: number;        // default 48
  trigger?: 'in' | 'hover' | 'loop' | 'loop-on-hover' | 'click' | 'boomerang';
  colors?: string;      // e.g. "primary:#FF6B35,secondary:#1A73E8"
  className?: string;
  autoPlay?: boolean;
}

export const AnimatedIcon: React.FC<AnimatedIconProps> = ({
  src,
  size = 48,
  trigger = 'in',
  colors,
  className = '',
  autoPlay = true,
}) => {
  const playerRef = useRef<Player>(null);
  
  React.useEffect(() => {
    if (autoPlay) {
      playerRef.current?.playFromBeginning();
    }
  }, [autoPlay]);

  return (
    <Player
      ref={playerRef}
      icon={src}
      size={size}
      colorize={colors}
      className={className}
      onMouseEnter={() => trigger === 'hover' && playerRef.current?.playFromBeginning()}
    />
  );
};
```

## Step B2 — Create rider-app/src/components/ds/Icon.tsx

Exact same content as Step B1 above — copy it fully.

## Step B3 — Create animated icon index files

Create `client-app/src/assets/icons/animated/index.ts`:

```ts
export { default as AnimCar }          from './car.json';
export { default as AnimMapPin }       from './map-pin.json';
export { default as AnimStar }         from './star.json';
export { default as AnimBell }         from './bell.json';
export { default as AnimWallet }       from './wallet.json';
export { default as AnimShield }       from './shield.json';
export { default as AnimGift }         from './gift.json';
export { default as AnimTrophy }       from './trophy.json';
export { default as AnimCheck }        from './check.json';
export { default as AnimWarning }      from './warning.json';
export { default as AnimEmptyBox }     from './empty-box.json';
export { default as AnimPhone }        from './phone.json';
export { default as AnimChat }         from './chat.json';
export { default as AnimUser }         from './user.json';
export { default as AnimSettings }     from './settings.json';
```

Copy same file to `rider-app/src/assets/icons/animated/index.ts`

═══════════════════════════════════════════════
PART C — REPLACE EMOJI IN RIDER APP
═══════════════════════════════════════════════

## Target file 1: rider-app/app/(app)/account/page.tsx

Find the nav config array (lines ~11-24) with emoji icon strings.
Replace each entry:

BEFORE:
  { label: 'Profile',       icon: '👤',  href: '/account/profile' }
  { label: 'Rides',         icon: '🚗',  href: '/account/bookings' }
  { label: 'Receipts',      icon: '🧾',  href: '/account/bookings' }
  { label: 'Payments',      icon: '💳',  href: '/account/payments' }
  { label: 'Wallet',        icon: '👛',  href: '/account/wallet' }
  { label: 'Rewards',       icon: '🎁',  href: '/account/rewards' }
  { label: 'Promotions',    icon: '📣',  href: '/account/promotions' }
  { label: 'Places',        icon: '📍',  href: '/account/places' }
  { label: 'Safety',        icon: '🛡️', href: '/account/safety' }
  { label: 'Notifications', icon: '🔔',  href: '/account/notifications' }
  { label: 'Chat',          icon: '💬',  href: '/account/chat' }
  { label: 'Settings',      icon: '⚙️', href: '/account/settings' }
  { label: 'Documents',     icon: '📄',  href: '/account/documents' }

Change icon type from string to React.ReactNode.
AFTER: Replace each icon value with JSX:
  icon: <UserIcon size={20} />
  icon: <CarIcon size={20} />
  icon: <BookingIcon size={20} />
  icon: <CardIcon size={20} />
  icon: <WalletIcon size={20} />
  icon: <GiftIcon size={20} />
  icon: <FlagIcon size={20} />
  icon: <LocationIcon size={20} />
  icon: <ShieldIcon size={20} />
  icon: <NotificationIcon size={20} />
  icon: <ChatIcon size={20} />
  icon: <SettingsIcon size={20} />
  icon: <DocumentIcon size={20} />

Add import at top:
  import { UserIcon, CarIcon, BookingIcon, CardIcon, WalletIcon, GiftIcon,
           FlagIcon, LocationIcon, ShieldIcon, NotificationIcon, ChatIcon,
           SettingsIcon, DocumentIcon } from '@/components/ds/Icon';

## Target file 2: rider-app/components/account/States.tsx

BEFORE:
  <div className="text-5xl">📭</div>  (empty state)
  <div className="text-5xl">⚠️</div>  (error state)

AFTER — use animated icons:
  import { AnimatedIcon } from '@/components/ds/Icon';
  import { AnimEmptyBox } from '@/assets/icons/animated';
  import { AnimWarning }  from '@/assets/icons/animated';

  <AnimatedIcon src={AnimEmptyBox} size={80} trigger="in" />
  <AnimatedIcon src={AnimWarning}  size={80} trigger="loop"
                colors="primary:#FF6B35,secondary:#FFC107" />

## Target file 3: rider-app/components/trip/DriverCard.tsx

BEFORE (line ~109-118):
  { icon: "📞", label: "Call" }
  { icon: "💬", label: "Chat" }
  { icon: "📤", label: "Share" }

AFTER:
  { icon: <PhoneIcon size={20} />, label: "Call" }
  { icon: <ChatIcon  size={20} />, label: "Chat" }
  { icon: <ShareIcon size={20} />, label: "Share" }

Line ~72: Replace:
  <span>👤</span>
With:
  <UserIcon size={32} className="text-content-secondary" />

Line ~143: Replace:
  <span className="text-xl">✕</span>
With:
  <CrossIcon size={20} />

Line ~72: Replace star rating ★:
  <span>★ {rating}</span>
With:
  <span className="flex items-center gap-1">
    <StarIcon size={14} className="text-yellow-500 fill-yellow-500" />
    {rating}
  </span>

## Target file 4: rider-app/components/Toaster.tsx

BEFORE (lines 8-9):
  icon: '✓'
  icon: '✕'

AFTER:
  import { SuccessIcon, ErrorIcon } from '@/components/ds/Icon';
  icon: <SuccessIcon size={18} className="text-green-500" />
  icon: <ErrorIcon   size={18} className="text-red-500" />

## Target file 5: rider-app/app/(app)/account/places/page.tsx

BEFORE (lines 16-18):
  { value: "HOME",   icon: "🏠" }
  { value: "WORK",   icon: "💼" }
  { value: "CUSTOM", icon: "📍" }

AFTER:
  { value: "HOME",   icon: <HomeAddressIcon size={20} /> }
  { value: "WORK",   icon: <WorkBriefcaseIcon size={20} /> }
  { value: "CUSTOM", icon: <LocationIcon size={20} /> }

## Target file 6: rider-app/app/(app)/account/notifications/page.tsx

Replace: <EmptyState icon="🔔" ...>
With:    <EmptyState icon={<AnimatedIcon src={AnimBell} size={64} trigger="loop-on-hover" colors="primary:#F59E0B,secondary:#FCD34D" />} ...>

## Target file 7: rider-app/app/(app)/account/garage/page.tsx

Replace: icon="🚗"  →  icon={<AnimatedIcon src={AnimCar} size={64} trigger="in" colors="primary:#1A73E8,secondary:#FF6B35" />}
Replace: ★           →  <StarIcon size={14} className="text-yellow-500 fill-yellow-500" />
Replace: ⚠️          →  <WarningIcon size={16} className="text-amber-500" />

## Target file 8: rider-app/app/(app)/account/payments/page.tsx

Replace: <EmptyState icon="💳"  →  icon={<AnimatedIcon src={AnimWallet} size={64} trigger="in" colors="primary:#10B981,secondary:#34D399" />}

## Target file 9: rider-app/app/(app)/account/bookings/page.tsx

Replace: <EmptyState icon="🧾"  →  icon={<AnimatedIcon src={AnimEmptyBox} size={64} trigger="in" />}

## Target file 10: rider-app/app/page.tsx (landing features)

BEFORE:
  🛡️  Safety First
  ⚡  Fast Rides
  💰  Transparent Pricing

AFTER — use large animated icons for feature highlights:
  <AnimatedIcon src={AnimShield} size={64} trigger="loop-on-hover"
                colors="primary:#1A73E8,secondary:#4FC3F7" />
  <AnimatedIcon src={AnimCar}    size={64} trigger="loop-on-hover"
                colors="primary:#FF6B35,secondary:#FFB74D" />
  <AnimatedIcon src={AnimWallet} size={64} trigger="loop-on-hover"
                colors="primary:#10B981,secondary:#6EE7B7" />

═══════════════════════════════════════════════
PART D — REPLACE EMOJI IN DRIVER APP (client-app)
═══════════════════════════════════════════════

## Target file 1: client-app/app/driver-account/layout.tsx

BEFORE (lines 15-28) nav items with emoji:
  📱 → <PhotoIcon size={20} />
  👤 → <UserIcon size={20} />
  💳 → <CardIcon size={20} />
  📁 → <DocumentIcon size={20} />
  🏆 → <TrophyIcon size={20} />
  🚗 → <CarIcon size={20} />
  📊 → <BookingIcon size={20} />
  💼 → <WorkBriefcaseIcon size={20} />
  🔔 → <NotificationIcon size={20} />
  🎓 → <InfoIcon size={20} />
  🎁 → <GiftIcon size={20} />
  ⚙️ → <SettingsIcon size={20} />
  💬 → <ChatIcon size={20} />

Lines 47, 78, 91:
  👤 (avatar fallback)  → <UserIcon size={32} />
  ☰  (hamburger)        → <MenuIcon size={24} />
  🚪 Logout             → <LogoutIcon size={20} /> Logout

## Target file 2: client-app/app/account/layout.tsx

Same pattern as above. Map:
  🔑 → <LockIcon size={20} />
  🚗 → <CarIcon size={20} />
  📁 → <DocumentIcon size={20} />
  👤 → <UserIcon size={20} />
  💳 → <CardIcon size={20} />
  💼 → <WorkBriefcaseIcon size={20} />
  🎁 → <GiftIcon size={20} />
  🏆 → <TrophyIcon size={20} />
  📍 → <LocationIcon size={20} />
  🛡️ → <ShieldIcon size={20} />
  📄 → <DocumentIcon size={20} />
  🔔 → <NotificationIcon size={20} />
  ⚙️ → <SettingsIcon size={20} />
  💬 → <ChatIcon size={20} />
  ⚖️ → <InfoIcon size={20} />

## Target file 3: client-app/components/Toaster.tsx

Same as rider-app Toaster — replace ✓/✕ with SuccessIcon/ErrorIcon.

## Target file 4: client-app/components/ds/DriverCard.tsx

Replace: ★ {rating.toFixed(2)}
With:
  <span className="flex items-center gap-1">
    <StarIcon size={14} className="text-yellow-500 fill-yellow-500" />
    {rating.toFixed(2)}
  </span>

## Target file 5: client-app/app/rider/page.tsx

Replace inline emoji for feature highlights (🚗 🛡️ 📍) with:
  <AnimatedIcon src={AnimCar}    size={56} trigger="loop-on-hover"
                colors="primary:#1A73E8,secondary:#FF6B35" />
  <AnimatedIcon src={AnimShield} size={56} trigger="loop-on-hover"
                colors="primary:#1A73E8,secondary:#4FC3F7" />
  <AnimatedIcon src={AnimMapPin} size={56} trigger="loop-on-hover"
                colors="primary:#EF4444,secondary:#FCA5A5" />

## Target file 6: client-app/app/share/page.tsx

Replace: 👤 → <UserIcon size={40} />
Replace: 📍 → <LocationIcon size={16} className="text-blue-500" />
Replace: 🏁 → <FlagIcon size={16} className="text-green-500" />

═══════════════════════════════════════════════
PART E — ONBOARDING ANIMATED ICONS
═══════════════════════════════════════════════

## rider-app/app/(auth)/onboarding/page.tsx

Replace emoji used in step headers/illustrations:
  📷 → <AnimatedIcon src={AnimUser}     size={80} trigger="in" />
  📍 → <AnimatedIcon src={AnimMapPin}   size={80} trigger="in"
                     colors="primary:#EF4444,secondary:#FCA5A5" />
  🔔 → <AnimatedIcon src={AnimBell}     size={80} trigger="in"
                     colors="primary:#F59E0B,secondary:#FCD34D" />

## client-app/app/driver-onboarding/page.tsx

Replace step icons with animated equivalents:
  ⚙️ → <AnimatedIcon src={AnimSettings} size={48} trigger="in" />
  🕹️ → <AnimatedIcon src={AnimCar}      size={48} trigger="in" />
  ✔️ → <AnimatedIcon src={AnimCheck}    size={48} trigger="in"
                     colors="primary:#10B981,secondary:#6EE7B7" />

═══════════════════════════════════════════════
PART F — DO NOT TOUCH
═══════════════════════════════════════════════

- frontend/src/admin/ — admin panel is a separate phase
- Any emoji inside plain string alert/toast messages like
  "🚨 DANGER: ..." — these are text content, NOT icons
- scripts/icon-source.svg
- Any file in node_modules/

═══════════════════════════════════════════════
RULES
═══════════════════════════════════════════════

1. All Tabler icons use strokeWidth={1.8} by default — do not override unless needed
2. AnimatedIcon trigger="in" for page load icons, "loop-on-hover" for feature cards,
   "loop" for empty states
3. Lordicon color format: "primary:#HEXCODE,secondary:#HEXCODE" — use brand colors:
   - Blue (primary actions): #1A73E8
   - Orange (driver/ride):   #FF6B35  
   - Green (success/money):  #10B981
   - Red (safety/alerts):    #EF4444
   - Gold (stars/rewards):   #F59E0B
4. Every file changed must list: file path + what was replaced
5. If a Lordicon JSON file is missing from assets, fall back to Tabler static icon
6. Do NOT change any className, layout, colors, or non-icon code
7. TypeScript: update any icon prop types from string to React.ReactNode
