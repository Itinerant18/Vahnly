'use client';
import React from 'react';

// Shared inline-SVG icon set for the rider app.
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

// --- Newly added Eva Icons ---

export const HomeIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M12.715 2.28875L20.424 10.1728C20.79 10.5488 21 11.0728 21 11.6117V19.9877C21 21.0907 20.152 21.9877 19.111 21.9877H15H9H4.888C3.847 21.9877 3 21.0907 3 19.9877V11.6117C3 11.0728 3.21 10.5487 3.575 10.1737L11.285 2.28875C11.662 1.90375 12.338 1.90375 12.715 2.28875ZM18.99 19.9877H16V12.9878C16 12.4347 15.552 11.9878 15 11.9878H9C8.447 11.9878 8 12.4347 8 12.9878V19.9877H5L5.006 11.5708L11.998 4.41975L19 11.6117L18.99 19.9877ZM10 19.9877H14V13.9878H10V19.9877Z" />
  </svg>
);

export const PaymentIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M5 5H19C20.654 5 22 6.346 22 8V16C22 17.654 20.654 19 19 19H5C3.346 19 2 17.654 2 16V8C2 6.346 3.346 5 5 5ZM4 8C4 7.449 4.448 7 5 7H19C19.552 7 20 7.449 20 8V9H4V8ZM19 17C19.552 17 20 16.551 20 16V11H4V16C4 16.551 4.448 17 5 17H19ZM7 15H11C11.55 15 12 14.55 12 14C12 13.45 11.55 13 11 13H7C6.45 13 6 13.45 6 14C6 14.55 6.45 15 7 15ZM15 15H17C17.55 15 18 14.55 18 14C18 13.45 17.55 13 17 13H15C14.45 13 14 13.45 14 14C14 14.55 14.45 15 15 15Z" />
  </svg>
);

export const PinIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M4 9.922C4 5.553 7.589 2 12 2C16.411 2 20 5.553 20 9.922C20 15.397 12.951 21.501 12.651 21.758C12.463 21.919 12.232 22 12 22C11.768 22 11.537 21.919 11.349 21.758C11.049 21.501 4 15.397 4 9.922ZM12 19.646C10.325 18.062 6 13.615 6 9.922C6 6.657 8.691 4 12 4C15.309 4 18 6.657 18 9.922C18 13.615 13.675 18.062 12 19.646ZM8.5 9.4995C8.5 7.5695 10.07 5.9995 12 5.9995C13.93 5.9995 15.5 7.5695 15.5 9.4995C15.5 11.4295 13.93 12.9995 12 12.9995C10.07 12.9995 8.5 11.4295 8.5 9.4995ZM10.5 9.4995C10.5 10.3265 11.173 10.9995 12 10.9995C12.827 10.9995 13.5 10.3265 13.5 9.4995C13.5 8.6725 12.827 7.9995 12 7.9995C11.173 7.9995 10.5 8.6725 10.5 9.4995Z" />
  </svg>
);

export const UserIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M16 7C16 9.206 14.206 11 12 11C9.794 11 8 9.206 8 7C8 4.794 9.794 3 12 3C14.206 3 16 4.794 16 7ZM12 5C13.103 5 14 5.897 14 7C14 8.103 13.103 9 12 9C10.897 9 10 8.103 10 7C10 5.897 10.897 5 12 5ZM19 20C19 20.552 18.553 21 18 21C17.447 21 17 20.552 17 20C17 17.243 14.757 15 12 15C9.243 15 7 17.243 7 20C7 20.552 6.553 21 6 21C5.447 21 5 20.552 5 20C5 16.14 8.141 13 12 13C15.859 13 19 16.14 19 20Z" />
  </svg>
);

export const SearchIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M17.312 15.897L20.707 19.293C21.098 19.684 21.098 20.316 20.707 20.707C20.512 20.902 20.256 21 20 21C19.744 21 19.488 20.902 19.293 20.707L15.897 17.312C14.543 18.365 12.846 19 11 19C6.589 19 3 15.411 3 11C3 6.589 6.589 3 11 3C15.411 3 19 6.589 19 11C19 12.846 18.365 14.543 17.312 15.897ZM11 5C7.691 5 5 7.691 5 11C5 14.309 7.691 17 11 17C14.309 17 17 14.309 17 11C17 7.691 14.309 5 11 5Z" />
  </svg>
);

export const BackIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} fill="currentColor">
    <path d="M13.8287 19C13.5367 19 13.2467 18.873 13.0487 18.627L8.22066 12.627C7.92266 12.256 7.92666 11.726 8.23166 11.36L13.2317 5.35998C13.5847 4.93598 14.2157 4.87898 14.6407 5.23198C15.0647 5.58498 15.1217 6.21598 14.7677 6.63998L10.2927 12.011L14.6077 17.373C14.9537 17.803 14.8857 18.433 14.4547 18.779C14.2707 18.928 14.0487 19 13.8287 19Z" />
  </svg>
);
