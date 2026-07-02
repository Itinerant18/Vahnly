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
      {/* City selector — floating glass chip over the map */}
      <div className="relative">
        <button
          onClick={() => setCityOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Escape") setCityOpen(false); }}
          aria-expanded={cityOpen}
          aria-haspopup="listbox"
          aria-controls="city-listbox"
          className="glass-tile flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-content-primary active:scale-95 transition-transform"
        >
          <span className="h-2 w-2 rounded-full bg-status-online" />
          {city}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className={cityOpen ? "rotate-180 transition-transform" : "transition-transform"}>
            <path d="M6 9l6 6 6-6" stroke="var(--content-secondary)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        {cityOpen && (
          <div id="city-listbox" role="listbox" className="absolute left-0 top-full z-50 mt-1 overflow-hidden rounded-xl bg-background-tertiary shadow-lg">
            {CITIES.map((c) => (
              <button
                key={c}
                role="option"
                aria-selected={c === city}
                onClick={() => { setCity(c); setCityOpen(false); }}
                className={`block w-full whitespace-nowrap px-4 py-2.5 text-left text-sm transition-colors hover:bg-background-secondary ${c === city ? "text-content-accent font-semibold" : "text-content-primary"
                  }`}
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
          <button onClick={() => router.push("/account/notifications")} aria-label="Notifications" className="glass-tile flex h-11 w-11 items-center justify-center rounded-full active:scale-90 transition-transform">
            <BellIcon size={20} className="text-content-primary" />
          </button>
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-status-active px-1 text-[10px] font-bold text-white leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>

        {/* SOS button — pulsing when active order exists */}
        <button
          onClick={() => { if (activeOrder) router.push("/trip/live"); }}
          disabled={!activeOrder}
          aria-label={activeOrder ? "Go to current trip" : "No active trip"}
          className={`flex h-11 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-white transition-all active:scale-90 ${activeOrder
              ? "animate-pulse bg-status-negative shadow-sm"
              : "bg-surface-negative opacity-60"
            }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 5a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 01-3 0v-5A1.5 1.5 0 0112 7zm0 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
          </svg>
          SOS
        </button>
      </div>
    </div>
  );
}
