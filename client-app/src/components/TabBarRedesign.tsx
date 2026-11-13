'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// ─── Icons (inline SVGs for zero dependency) ──────────────────────────────────

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-4v-6h-4v6H5a1 1 0 01-1-1V10.5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        opacity={active ? 0.15 : 1}
      />
    </svg>
  );
}

function JobsIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.8"
        fill={active ? 'currentColor' : 'none'} opacity={active ? 0.15 : 1} />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EarnIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"
        fill={active ? 'currentColor' : 'none'} opacity={active ? 0.15 : 1} />
      <path d="M12 7v10M9 9.5c0-1 .9-1.5 3-1.5s3 .5 3 1.5-1 1.5-3 2-3 1-3 2 .9 1.5 3 1.5 3-.5 3-1.5"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MeIcon({ active }: { active: boolean }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"
        fill={active ? 'currentColor' : 'none'} opacity={active ? 0.15 : 1} />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// ─── Tab Configuration ─────────────────────────────────────────────────────────
// Tab 2: Trips (unified upcoming scheduled planner + trip history)
// Accent color for active state (--accent-400 / forest-400)

const TABS = [
  { label: 'Home', href: '/driver', icon: HomeIcon, match: /^\/driver\/?$/ },
  { label: 'Trips', href: '/driver/trips', icon: JobsIcon, match: /^\/driver\/(trips|jobs)/ },
  { label: 'Earn', href: '/driver/earnings', icon: EarnIcon, match: /^\/driver\/earnings/ },
  { label: 'Me', href: '/driver-account/profile', icon: MeIcon, match: /^\/driver-account/ },
] as const;

// ─── Tab Bar Component ─────────────────────────────────────────────────────────
// Fixed bottom, 56px + safe area. Hidden during active job flow.
// Minimum 48×48px tap targets per WCAG 2.5.8.

export function TabBarRedesign() {
  const pathname = usePathname() || '';

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-0 inset-x-0 z-40 bg-background-primary
        border-t border-border-opaque pb-[env(safe-area-inset-bottom)]"
    >
      <div className="max-w-lg mx-auto grid grid-cols-4 h-14">
        {TABS.map((tab) => {
          const active = tab.match.test(pathname);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 min-h-[48px] min-w-[48px]
                transition-base focus-visible:outline-none focus-visible:ring-2
                focus-visible:ring-accent-400 focus-visible:ring-offset-2
                ${active
                  ? 'text-accent-500'
                  : 'text-content-tertiary hover:text-content-secondary'
                }`}
            >
              <Icon active={active} />
              <span className={`text-[10px] font-mono uppercase tracking-wider
                ${active ? 'font-bold text-accent-600' : 'font-medium'}`}>
                {tab.label}
              </span>
              {/* Active indicator bar */}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 
                  bg-accent-400 rounded-b-full" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
