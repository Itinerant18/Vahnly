"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store/authStore";
import { ordersApi } from "@/lib/api/orders";
import { FareDisplay } from "@/components/ds";
import { Shimmer } from "@/components/account/States";

const LINKS: { href: string; label: string; icon: string }[] = [
  { href: "/account/profile", label: "Profile", icon: "👤" },
  { href: "/account/garage", label: "My Garage", icon: "🚗" },
  { href: "/account/bookings", label: "My Trips", icon: "🧾" },
  { href: "/account/payments", label: "Payments", icon: "💳" },
  { href: "/account/wallet", label: "Wallet", icon: "👛" },
  { href: "/account/rewards", label: "Promos", icon: "🎁" },
  { href: "/account/refer", label: "Refer & Earn", icon: "📣" },
  { href: "/account/places", label: "Saved Places", icon: "📍" },
  { href: "/account/emergency", label: "Emergency", icon: "🆘" },
  { href: "/account/insurance", label: "D4M Care", icon: "🛡️" },
  { href: "/account/notifications", label: "Notifications", icon: "🔔" },
  { href: "/account/support", label: "Support", icon: "💬" },
  { href: "/account/settings", label: "Settings", icon: "⚙️" },
  { href: "/account/legal", label: "Legal", icon: "📄" },
];

function loyaltyTier(trips: number): { name: string; color: string } {
  if (trips >= 15) return { name: "Platinum", color: "text-content-secondary" };
  if (trips >= 5) return { name: "Gold", color: "text-content-warning" };
  return { name: "Silver", color: "text-content-secondary" };
}

export default function AccountPage() {
  const rider = useAuthStore((s) => s.rider);
  const logout = useAuthStore((s) => s.logout);

  const [stats, setStats] = useState<{ trips: number; spent: number } | null>(null);

  useEffect(() => {
    let alive = true;
    ordersApi
      .history({ status: "COMPLETED", limit: 100 })
      .then((res) => {
        if (!alive) return;
        const spent = res.orders.reduce((acc, o) => acc + o.base_fare_paise, 0);
        setStats({ trips: res.total ?? res.orders.length, spent });
      })
      .catch(() => alive && setStats({ trips: 0, spent: 0 }));
    return () => {
      alive = false;
    };
  }, []);

  const tier = loyaltyTier(stats?.trips ?? 0);
  const initials = (rider?.name ?? "?").trim().slice(0, 1).toUpperCase();

  return (
    <main className="min-h-screen bg-background-primary pb-24">
      <div className="px-4 pt-12">
        <h1 className="mb-4 text-2xl font-bold text-content-primary">Account</h1>

        {/* Profile card */}
        <div className="flex items-center gap-4 rounded-2xl bg-background-secondary p-4">
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-accent text-2xl font-bold text-content-accent">
            {rider?.profile_photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={rider.profile_photo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-content-primary">{rider?.name ?? "Add your name"}</p>
            <p className="text-sm text-content-secondary">{rider?.phone ?? ""}</p>
          </div>
          <span
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
              rider?.kyc_level && rider.kyc_level !== "NONE"
                ? "bg-surface-positive text-content-positive"
                : "bg-surface-neutral text-content-secondary"
            }`}
          >
            {rider?.kyc_level && rider.kyc_level !== "NONE" ? "✓ KYC" : "Unverified"}
          </span>
        </div>

        {/* Stats row */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-2xl bg-background-secondary p-3 text-center">
            <p className="text-xs text-content-secondary">Trips</p>
            {stats ? (
              <p className="mt-1 text-lg font-bold text-content-primary">{stats.trips}</p>
            ) : (
              <Shimmer className="mx-auto mt-1 h-6 w-10" />
            )}
          </div>
          <div className="rounded-2xl bg-background-secondary p-3 text-center">
            <p className="text-xs text-content-secondary">Spent</p>
            {stats ? (
              <FareDisplay amount={stats.spent} size="md" className="mt-1 block font-bold text-content-primary" />
            ) : (
              <Shimmer className="mx-auto mt-1 h-6 w-14" />
            )}
          </div>
          <div className="rounded-2xl bg-background-secondary p-3 text-center">
            <p className="text-xs text-content-secondary">Tier</p>
            <p className={`mt-1 text-lg font-bold ${tier.color}`}>{tier.name}</p>
          </div>
        </div>

        {/* Quick links grid */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex flex-col items-center gap-2 rounded-2xl bg-background-secondary py-4 active:bg-background-tertiary"
            >
              <span className="text-2xl">{l.icon}</span>
              <span className="text-center text-xs text-content-secondary">{l.label}</span>
            </Link>
          ))}
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          className="mt-6 w-full rounded-2xl border border-border-opaque py-3.5 text-sm font-semibold text-content-negative active:bg-surface-negative"
        >
          Log Out
        </button>
      </div>
    </main>
  );
}
