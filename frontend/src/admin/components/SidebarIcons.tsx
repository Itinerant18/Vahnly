import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const defaults: IconProps = { size: 20, className: '' };

export const IconDashboard: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="2" width="7" height="8" rx="1.5" />
    <rect x="11" y="2" width="7" height="5" rx="1.5" />
    <rect x="2" y="12" width="7" height="6" rx="1.5" />
    <rect x="11" y="9" width="7" height="9" rx="1.5" />
  </svg>
);

export const IconMap: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2 4.5L7 2.5L13 4.5L18 2.5V15.5L13 17.5L7 15.5L2 17.5V4.5Z" />
    <line x1="7" y1="2.5" x2="7" y2="15.5" />
    <line x1="13" y1="4.5" x2="13" y2="17.5" />
  </svg>
);

export const IconTrips: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="5" cy="5" r="2.5" />
    <circle cx="15" cy="15" r="2.5" />
    <path d="M7 5H12C14.2 5 16 6.8 16 9V12.5" />
  </svg>
);

export const IconRiders: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="10" cy="6" r="3.5" />
    <path d="M3 18C3 14.134 6.134 11 10 11C13.866 11 17 14.134 17 18" />
  </svg>
);

export const IconDrivers: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="10" cy="6" r="3.5" />
    <path d="M3 18C3 14.134 6.134 11 10 11C13.866 11 17 14.134 17 18" />
    <path d="M14 3L17 6" />
  </svg>
);

export const IconVehicles: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="1" y="8" width="18" height="7" rx="2" />
    <path d="M4 8L6 4H14L16 8" />
    <circle cx="5" cy="15" r="1.5" />
    <circle cx="15" cy="15" r="1.5" />
  </svg>
);

export const IconDispatch: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="2" width="16" height="16" rx="2" />
    <line x1="2" y1="7" x2="18" y2="7" />
    <line x1="2" y1="12" x2="18" y2="12" />
    <line x1="7" y1="2" x2="7" y2="18" />
    <line x1="13" y1="2" x2="13" y2="18" />
  </svg>
);

export const IconPricing: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <line x1="10" y1="2" x2="10" y2="18" />
    <path d="M14 5H8C6.343 5 5 6.343 5 8C5 9.657 6.343 11 8 11H12C13.657 11 15 12.343 15 14C15 15.657 13.657 17 12 17H6" />
  </svg>
);

export const IconPromotions: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 10L10 3L17 10" />
    <path d="M7 6L10 3L13 6" />
    <rect x="5" y="10" width="10" height="8" rx="1" />
    <line x1="10" y1="13" x2="10" y2="15" />
  </svg>
);

export const IconPayments: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="4" width="16" height="12" rx="2" />
    <line x1="2" y1="9" x2="18" y2="9" />
    <line x1="6" y1="13" x2="10" y2="13" />
  </svg>
);

export const IconPayouts: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="3" width="14" height="14" rx="2" />
    <path d="M10 7V13M10 13L7 10M10 13L13 10" />
  </svg>
);

export const IconSupport: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 14L3 10C3 6.134 6.134 3 10 3C13.866 3 17 6.134 17 10V14" />
    <rect x="1" y="12" width="4" height="5" rx="1" />
    <rect x="15" y="12" width="4" height="5" rx="1" />
  </svg>
);

export const IconSafety: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10 2L3 6V10C3 14.418 6.134 18 10 18C13.866 18 17 14.418 17 10V6L10 2Z" />
    <path d="M7 10L9 12L13 8" />
  </svg>
);

export const IconMarketing: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M3 15V10L10 6L17 10V15" />
    <rect x="7" y="12" width="6" height="6" rx="1" />
  </svg>
);

export const IconComms: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 4H16C17.1 4 18 4.9 18 6V14C18 15.1 17.1 16 16 16H4C2.9 16 2 15.1 2 14V6C2 4.9 2.9 4 4 4Z" />
    <path d="M18 6L10 11L2 6" />
  </svg>
);

export const IconContent: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="2" width="14" height="16" rx="1.5" />
    <line x1="6" y1="6" x2="14" y2="6" />
    <line x1="6" y1="9" x2="14" y2="9" />
    <line x1="6" y1="12" x2="10" y2="12" />
  </svg>
);

export const IconAnalytics: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="2" y="12" width="3" height="6" rx="0.5" />
    <rect x="7" y="8" width="3" height="10" rx="0.5" />
    <rect x="12" y="4" width="3" height="14" rx="0.5" />
    <line x1="2" y1="2" x2="18" y2="2" strokeDasharray="2 2" />
  </svg>
);

export const IconCompliance: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="2" width="14" height="16" rx="1.5" />
    <path d="M7 7L9 9L13 5" />
    <line x1="7" y1="13" x2="13" y2="13" />
  </svg>
);

export const IconDocuments: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 2H12L16 6V18H4V2Z" />
    <path d="M12 2V6H16" />
    <line x1="7" y1="10" x2="13" y2="10" />
    <line x1="7" y1="13" x2="13" y2="13" />
  </svg>
);

export const IconSettings: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="10" cy="10" r="3" />
    <path d="M10 1.5V4M10 16V18.5M18.5 10H16M4 10H1.5M16 4L14.2 5.8M5.8 14.2L4 16M16 16L14.2 14.2M5.8 5.8L4 4" />
  </svg>
);

export const IconAudit: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="3" y="2" width="14" height="16" rx="1.5" />
    <line x1="7" y1="6" x2="13" y2="6" />
    <line x1="7" y1="9" x2="13" y2="9" />
    <line x1="7" y1="12" x2="13" y2="12" />
    <line x1="7" y1="15" x2="10" y2="15" />
  </svg>
);

export const IconAPI: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M6 7L2 10L6 13" />
    <path d="M14 7L18 10L14 13" />
    <line x1="12" y1="4" x2="8" y2="16" />
  </svg>
);

export const IconTeam: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="7" cy="6" r="2.5" />
    <circle cx="14" cy="6" r="2.5" />
    <path d="M1 16C1 13.239 3.239 11 6 11H8C10.761 11 13 13.239 13 16" />
    <path d="M12 16C12 13.239 14.239 11 17 11" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <line x1="13" y1="13" x2="18" y2="18" />
  </svg>
);

export const IconBell: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10 2C7.239 2 5 4.239 5 7V11L3 14H17L15 11V7C15 4.239 12.761 2 10 2Z" />
    <path d="M8 14V15C8 16.105 8.895 17 10 17C11.105 17 12 16.105 12 15V14" />
  </svg>
);

export const IconPlus: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
    <line x1="10" y1="4" x2="10" y2="16" />
    <line x1="4" y1="10" x2="16" y2="10" />
  </svg>
);

export const IconChevron: React.FC<IconProps & { direction?: 'left' | 'right' }> = ({ size = defaults.size, className, direction = 'left' }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} style={direction === 'right' ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="M13 4L7 10L13 16" />
  </svg>
);

export const IconLogout: React.FC<IconProps> = ({ size = defaults.size, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M7 3H4C3.448 3 3 3.448 3 4V16C3 16.552 3.448 17 4 17H7" />
    <path d="M10 10H18M18 10L15 7M18 10L15 13" />
  </svg>
);
