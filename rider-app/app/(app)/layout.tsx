"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useNotificationStore } from "@/lib/store/notificationStore";
import { useAuthStore } from "@/lib/store/authStore";

function HomeIcon({ active }: { active: boolean }) {
  const c = active ? "var(--accent-400)" : "var(--content-secondary)";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1v-9.5z" stroke={c} strokeWidth="1.5" fill={active ? "var(--surface-accent)" : "none"} />
      <path d="M9 21v-7h6v7" stroke={c} strokeWidth="1.5" />
    </svg>
  );
}

function TripsIcon({ active }: { active: boolean }) {
  const c = active ? "var(--accent-400)" : "var(--content-secondary)";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="5" cy="17" r="2" stroke={c} strokeWidth="1.5" fill={active ? "var(--surface-accent)" : "none"} />
      <circle cx="19" cy="17" r="2" stroke={c} strokeWidth="1.5" fill={active ? "var(--surface-accent)" : "none"} />
      <path d="M5 17H3V7a1 1 0 011-1h11l4 5v6h-2" stroke={c} strokeWidth="1.5" />
      <path d="M7 17h8" stroke={c} strokeWidth="1.5" />
    </svg>
  );
}

function WalletIcon({ active }: { active: boolean }) {
  const c = active ? "var(--accent-400)" : "var(--content-secondary)";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="6" width="20" height="14" rx="2" stroke={c} strokeWidth="1.5" fill={active ? "var(--surface-accent)" : "none"} />
      <path d="M2 10h20" stroke={c} strokeWidth="1.5" />
      <circle cx="17" cy="15" r="1.5" fill={c} />
    </svg>
  );
}

function AccountIcon({ active }: { active: boolean }) {
  const c = active ? "var(--accent-400)" : "var(--content-secondary)";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.5" fill={active ? "var(--surface-accent)" : "none"} />
      <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const NAV = [
  { href: "/home", label: "Home", Icon: HomeIcon },
  { href: "/account/bookings", label: "Trips", Icon: TripsIcon },
  { href: "/account/wallet", label: "Wallet", Icon: WalletIcon },
  { href: "/account", label: "Account", Icon: AccountIcon },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [authChecked, setAuthChecked] = useState(false);

  // Auth guard: no token → bounce to login. Render nothing until we've confirmed
  // a token exists, so the app shell never flashes for signed-out users.
  useEffect(() => {
    if (!token) {
      router.replace("/login");
    } else {
      setAuthChecked(true);
    }
  }, [token, router]);

  if (!authChecked) return null;

  return (
    <div className="min-h-screen bg-background-primary pb-[68px]">
      {children}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex h-[68px] items-center border-t border-border-opaque bg-background-secondary" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV.map((n) => {
          const active = pathname === n.href || (n.href !== "/account" && pathname.startsWith(n.href + "/"));
          const isAccount = n.href === "/account";
          const acctActive = isAccount && (pathname === "/account" || pathname.startsWith("/account/"));
          const isActive = isAccount ? acctActive : active;
          return (
            <Link
              key={n.href}
              href={n.href}
              className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
            >
              {isAccount && unreadCount > 0 && (
                <span className="absolute right-[calc(50%-14px)] top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-400 text-[9px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
              <n.Icon active={isActive} />
              <span className={`text-[10px] font-medium ${isActive ? "text-content-accent" : "text-content-secondary"}`}>
                {n.label}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-1/2 h-0.5 w-8 -translate-x-1/2 rounded-full bg-accent-400" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
