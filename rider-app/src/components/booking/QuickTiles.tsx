"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ordersApi } from "@/lib/api/orders";
import { useBookingStore } from "@/lib/store/bookingStore";
import type { Order } from "@/lib/api/types";

const TILES = [
  {
    id: "garage",
    label: "My Garage",
    href: "/account/garage",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"
          stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 21v-6h6v6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: "offers",
    label: "Offers",
    href: "/account/rewards",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"
          stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    id: "refer",
    label: "Refer",
    href: "/account/refer",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 20c0-3.314 2.686-6 6-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M16 11l4 4-4 4M20 15h-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    badge: "₹100",
  },
];

function RebookTile({ lastOrder }: { lastOrder: Order | null }) {
  const setPickup  = useBookingStore((s) => s.setPickup);
  const setDropoff = useBookingStore((s) => s.setDropoff);

  const handleRebook = () => {
    if (!lastOrder) return;
    setPickup({ lat: lastOrder.pickup_lat, lng: lastOrder.pickup_lng, address: "Last pickup" });
    if (lastOrder.dropoff_lat && lastOrder.dropoff_lng) {
      setDropoff({ lat: lastOrder.dropoff_lat, lng: lastOrder.dropoff_lng, address: "Last drop" });
    }
  };

  return (
    <button
      type="button"
      onClick={handleRebook}
      disabled={!lastOrder}
      className="flex flex-1 flex-col items-center gap-1.5 rounded-md bg-background-secondary
        border border-border-opaque py-3 px-2 min-h-[72px]
        disabled:opacity-40 hover:bg-background-tertiary transition-base
        cursor-pointer disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-content-accent">
        <path d="M1 4v6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.51 15a9 9 0 102.13-9.36L1 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-label-small text-content-secondary">Rebook</span>
    </button>
  );
}

export function QuickTiles() {
  const [lastOrder, setLastOrder] = useState<Order | null>(null);

  useEffect(() => {
    ordersApi
      .history({ status: "COMPLETED", limit: 1 })
      .then((r) => setLastOrder(r.orders[0] ?? null))
      .catch(() => {});
  }, []);

  return (
    <div className="flex gap-2 px-4 py-3">
      <RebookTile lastOrder={lastOrder} />
      {TILES.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          className="relative flex flex-1 flex-col items-center gap-1.5 rounded-md
            bg-background-secondary border border-border-opaque py-3 px-2 min-h-[72px]
            hover:bg-background-tertiary transition-base
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
        >
          <span className="text-content-accent">{t.icon}</span>
          <span className="text-label-small text-content-secondary">{t.label}</span>
          {"badge" in t && t.badge && (
            <span className="absolute -top-1.5 -right-1 rounded-pill bg-positive-400 px-1.5 py-0.5 text-[9px] font-medium text-white">
              {t.badge}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
