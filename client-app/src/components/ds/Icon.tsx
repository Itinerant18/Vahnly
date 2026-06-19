'use client';
import React from 'react';

// Shared inline-SVG icon set for the driver app.
// Replaces emoji glyphs with token-colored vectors (currentColor, strokeWidth 1.5).
// Decorative by default (aria-hidden); pass a label via the surrounding element.

export type IconProps = { size?: number; className?: string };

const base = (size: number) =>
  ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true }) as const;
const stroke = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const PhoneIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 005 5l1.5-2 4 1.5v3a2 2 0 01-2 2A16 16 0 014.5 6a2 2 0 012-2z" {...stroke} />
  </svg>
);

export const ChatIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M21 12a8 8 0 01-11.5 7.2L4 20l1.2-4.2A8 8 0 1121 12z" {...stroke} />
  </svg>
);

export const NavigateIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 11l18-8-8 18-2-7-8-3z" {...stroke} />
  </svg>
);

export const CashIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="6" width="20" height="12" rx="2" {...stroke} />
    <circle cx="12" cy="12" r="2.5" {...stroke} />
  </svg>
);

export const CardIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="2" y="5" width="20" height="14" rx="2" {...stroke} />
    <path d="M2 10h20" {...stroke} />
  </svg>
);

export const ShieldIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l7 3v5c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6l7-3z" {...stroke} />
  </svg>
);

export const CarIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 17l1.5-4.5L7 8h10l2.5 4.5L21 17H3z" {...stroke} />
    <circle cx="7.5" cy="17.5" r="1.5" {...stroke} />
    <circle cx="16.5" cy="17.5" r="1.5" {...stroke} />
  </svg>
);

export const AlertIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l9 16H3L12 3z" {...stroke} />
    <path d="M12 10v4M12 17h.01" {...stroke} />
  </svg>
);

export const CheckIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12l5 5L20 7" {...stroke} strokeWidth={2} />
  </svg>
);

export const BellIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" {...stroke} />
    <path d="M10 20a2 2 0 004 0" {...stroke} />
  </svg>
);

export const PlusIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" {...stroke} strokeWidth={2} />
  </svg>
);

export const ParkingIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <rect x="4" y="3" width="16" height="18" rx="2" {...stroke} />
    <path d="M9 17V8h3.5a2.5 2.5 0 010 5H9" {...stroke} />
  </svg>
);

export const SirenIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 2l8.5 15a1 1 0 01-.87 1.5H4.37A1 1 0 013.5 17L12 2z" {...stroke} />
    <path d="M12 9v4M12 16h.01" {...stroke} />
  </svg>
);

export const CameraIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" {...stroke} />
    <circle cx="12" cy="13" r="3.5" {...stroke} />
  </svg>
);

export const CrossIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6L6 18" {...stroke} />
  </svg>
);

export const RefreshIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12a8 8 0 0114-5.3L20 8M20 4v4h-4" {...stroke} />
    <path d="M20 12a8 8 0 01-14 5.3L4 16M4 20v-4h4" {...stroke} />
  </svg>
);

export const MenuIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" {...stroke} />
  </svg>
);

export const SignalIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M5 13a9 9 0 0114 0M8 16a5 5 0 018 0" {...stroke} />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" />
  </svg>
);

export const OctagonAlertIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M7.5 3h9L21 7.5v9L16.5 21h-9L3 16.5v-9L7.5 3z" {...stroke} />
    <path d="M12 8v4M12 16h.01" {...stroke} />
  </svg>
);

export const FlameIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <path d="M12 3c2 3 5 5 5 9a5 5 0 11-10 0c0-2 1-3 2-4 .5 1 1.5 1.5 2 1 .5-1.5-1-3.5 1-6z" />
  </svg>
);

export const PauseIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <rect x="7" y="5" width="3.5" height="14" rx="1" />
    <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
  </svg>
);

export const WrenchIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M14.7 6.3a4 4 0 00-5.4 5L4 16.6V20h3.4l5.3-5.3a4 4 0 005-5.4l-2.6 2.6-2.3-.6-.6-2.3 2.5-2.7z" {...stroke} />
  </svg>
);

export const ClockIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" {...stroke} />
    <path d="M12 7v5l3 2" {...stroke} />
  </svg>
);

export const RouteIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="6" cy="18" r="2.5" {...stroke} />
    <circle cx="18" cy="6" r="2.5" {...stroke} />
    <path d="M8.5 18H14a3.5 3.5 0 000-7H10a3.5 3.5 0 010-7h5.5" {...stroke} />
  </svg>
);
