"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useNotificationStore } from "@/lib/store/notificationStore";
import { useTripStore } from "@/lib/store/tripStore";
import { BellIcon } from "@/components/ds/Icon";

const CITIES = ["KOL", "BLR"];

export function TopBar() {
  const router = useRouter();
  const [city, setCity] = useState("KOL");
  const [cityOpen, setCityOpen] = useState(false);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const activeOrder = useTripStore((s) => s.activeOrder);

  return (
    <div className="flex items-center justify-between px-4 py-3">
      {/* City selector */}
      <div className="relative">
        <button
          onClick={() => setCityOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-full bg-background-tertiary px-3 py-1.5 text-sm font-semibold text-content-primary"
        >
          <span className="h-2 w-2 rounded-full bg-positive-400" />
          {city}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="var(--content-secondary)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {cityOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 overflow-hidden rounded-xl bg-background-tertiary shadow-lg">
            {CITIES.map((c) => (
              <button
                key={c}
                onClick={() => { setCity(c); setCityOpen(false); }}
                className={`block w-full px-4 py-2.5 text-left text-sm ${c === city ? "text-content-accent" : "text-content-primary"}`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <div className="relative">
          <button onClick={() => router.push("/account/notifications")} aria-label="Notifications" className="flex h-10 w-10 items-center justify-center rounded-full bg-background-tertiary">
            <BellIcon size={20} className="text-content-primary" />
          </button>
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-400 text-[9px] font-bold text-content-primary">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>

        {/* SOS button — pulsing when active order exists */}
        <button
          onClick={() => { if (activeOrder) router.push("/trip/live"); }}
          disabled={!activeOrder}
          className={`flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-content-primary transition-opacity ${
            activeOrder ? "animate-pulse bg-negative-400" : "bg-surface-negative opacity-60"
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 5a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 01-3 0v-5A1.5 1.5 0 0112 7zm0 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
          </svg>
          SOS
        </button>
      </div>
    </div>
  );
}
