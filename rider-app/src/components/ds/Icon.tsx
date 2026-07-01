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
export { IconArrowRight as ForwardIcon }    from '@tabler/icons-react';

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
export { IconBolt as BoltIcon }             from '@tabler/icons-react';
export { IconHeadset as HeadsetIcon }       from '@tabler/icons-react';

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
    <span
      className={className}
      style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseEnter={() => (trigger === 'hover' || trigger === 'loop-on-hover') && playerRef.current?.playFromBeginning()}
    >
      <Player
        ref={playerRef}
        icon={src}
        size={size}
        colorize={colors}
      />
    </span>
  );
};
