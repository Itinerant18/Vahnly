"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store/authStore";
import { ordersApi } from "@/lib/api/orders";
import { FareDisplay } from "@/components/ds";
import { Shimmer } from "@/components/account/States";
import { BlurFade } from "@/components/ui/blur-fade";
import { BorderBeam } from "@/components/ui/border-beam";
import { WordRotate } from "@/components/ui/word-rotate";

import {
  UserIcon,
  CarIcon,
  BookingIcon,
  CardIcon,
  WalletIcon,
  GiftIcon,
  FlagIcon,
  LocationIcon,
  SirenIcon,
  ShieldIcon,
  NotificationIcon,
  ChatIcon,
  SettingsIcon,
  DocumentIcon,
} from "@/components/ds/Icon";

const LINKS: { href: string; label: string; icon: React.ReactNode }[] = [
  { href: "/account/profile", label: "Profile", icon: <UserIcon size={20} /> },
  { href: "/account/garage", label: "My Garage", icon: <CarIcon size={20} /> },
  { href: "/account/bookings", label: "My Trips", icon: <BookingIcon size={20} /> },
  { href: "/account/payments", label: "Payments", icon: <CardIcon size={20} /> },
  { href: "/account/wallet", label: "Wallet", icon: <WalletIcon size={20} /> },
  { href: "/account/rewards", label: "Promos", icon: <GiftIcon size={20} /> },
  { href: "/account/refer", label: "Refer & Earn", icon: <FlagIcon size={20} /> },
  { href: "/account/places", label: "Saved Places", icon: <LocationIcon size={20} /> },
  { href: "/account/emergency", label: "Emergency", icon: <SirenIcon size={20} /> },
  { href: "/account/insurance", label: "D4M Care", icon: <ShieldIcon size={20} /> },
  { href: "/account/notifications", label: "Notifications", icon: <NotificationIcon size={20} /> },
  { href: "/account/support", label: "Support", icon: <ChatIcon size={20} /> },
  { href: "/account/settings", label: "Settings", icon: <SettingsIcon size={20} /> },
  { href: "/account/legal", label: "Legal", icon: <DocumentIcon size={20} /> },
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
        <BlurFade delay={0.1}>
          <h1 className="mb-4 text-2xl font-bold text-content-primary">
            <WordRotate words={["Account", "Profile", "You"]} duration={3000} className="text-2xl font-bold" />
          </h1>
        </BlurFade>

        {/* Profile card */}
        <BlurFade delay={0.15}>
          <div className="relative flex items-center gap-4 rounded-2xl bg-background-secondary p-4 overflow-hidden">
            <BorderBeam size={80} duration={8} colorFrom="#1a5cff" colorTo="rgba(26,92,255,0.1)" borderWidth={1.5} />
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
        </BlurFade>

        {/* Stats row */}
        <BlurFade delay={0.2}>
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
        </BlurFade>

        {/* Quick links grid */}
        <BlurFade delay={0.25}>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex flex-col items-center gap-2 rounded-2xl bg-background-secondary py-4 active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:bg-background-secondary/80"
              >
                <span className="text-2xl">{l.icon}</span>
                <span className="text-center text-xs text-content-secondary">{l.label}</span>
              </Link>
            ))}
          </div>
        </BlurFade>

        {/* Logout */}
        <BlurFade delay={0.3}>
          <button
            onClick={logout}
            className="mt-6 w-full rounded-2xl border border-border-opaque py-3.5 text-sm font-semibold text-content-negative active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          >
            Log Out
          </button>
        </BlurFade>
      </div>
    </main>
  );
}
