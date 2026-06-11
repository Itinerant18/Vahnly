"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { ordersApi } from "@/lib/api/orders";
import { useBookingStore } from "@/lib/store/bookingStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { Order, TripStatus } from "@/lib/api/types";

type Tab = "Upcoming" | "Completed" | "Cancelled";
const TABS: Tab[] = ["Upcoming", "Completed", "Cancelled"];

const UPCOMING: TripStatus[] = [
  "CREATED",
  "ASSIGNED",
  "EN_ROUTE_TO_PICKUP",
  "ARRIVED_AT_PICKUP",
  "DELIVERING",
];

const STATUS_CHIP: Partial<Record<TripStatus, string>> = {
  COMPLETED: "bg-[#22C55E]/10 text-[#22C55E]",
  CANCELLED: "bg-[#EF4444]/10 text-[#EF4444]",
  DELIVERING: "bg-[#FF6B35]/10 text-[#FF6B35]",
  ASSIGNED: "bg-[#3B82F6]/10 text-[#3B82F6]",
};

function bucket(status: TripStatus): Tab {
  if (status === "COMPLETED") return "Completed";
  if (status === "CANCELLED") return "Cancelled";
  return "Upcoming";
}

function TripCard({ order, onRebook }: { order: Order; onRebook: () => void }) {
  const router = useRouter();
  const date = new Date(order.created_at);
  return (
    <div className="rounded-2xl bg-[#141414] p-4">
      <button
        onClick={() => router.push(`/account/bookings/detail?orderId=${order.id}`)}
        className="block w-full text-left"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
            <span className="text-xs text-[#9CA3AF]">
              {date.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
              {date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <span className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${STATUS_CHIP[order.status] ?? "bg-[#9CA3AF]/10 text-[#9CA3AF]"}`}>
            {order.status}
          </span>
        </div>
        <p className="text-sm text-white">
          {order.pickup_lat.toFixed(3)}, {order.pickup_lng.toFixed(3)}
          {order.dropoff_lat != null && (
            <span className="text-[#9CA3AF]">
              {" → "}
              {order.dropoff_lat.toFixed(3)}, {order.dropoff_lng?.toFixed(3)}
            </span>
          )}
        </p>
        <p className="mt-2 text-base font-bold text-[#FF6B35]">
          {formatCurrency(order.base_fare_paise)}
        </p>
      </button>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onRebook}
          className="flex-1 rounded-xl bg-[#1E1E1E] py-2.5 text-xs font-semibold text-[#FF6B35]"
        >
          Rebook
        </button>
        <button
          onClick={() => router.push(`/account/bookings/detail?orderId=${order.id}`)}
          className="flex-1 rounded-xl bg-[#1E1E1E] py-2.5 text-xs font-semibold text-white"
        >
          Details
        </button>
      </div>
    </div>
  );
}

export default function BookingsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("Upcoming");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState(false);
  const setPickup = useBookingStore((s) => s.setPickup);
  const setDropoff = useBookingStore((s) => s.setDropoff);

  const load = useCallback(() => {
    setError(false);
    setOrders(null);
    ordersApi
      .history({ limit: 100 })
      .then((res) => setOrders(res.orders))
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  const filtered = useMemo(
    () => (orders ?? []).filter((o) => bucket(o.status) === tab),
    [orders, tab],
  );

  const rebook = (order: Order) => {
    setPickup({ lat: order.pickup_lat, lng: order.pickup_lng, address: "Previous pickup" });
    if (order.dropoff_lat != null && order.dropoff_lng != null) {
      setDropoff({ lat: order.dropoff_lat, lng: order.dropoff_lng, address: "Previous drop" });
    }
    router.push("/home");
  };

  return (
    <AccountScaffold title="My Trips">
      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-xl bg-[#141414] p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              tab === t ? "bg-[#FF6B35] text-white" : "text-[#9CA3AF]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState onRetry={load} />
      ) : orders === null ? (
        <SkeletonList rows={4} height="h-28" />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🧾" title={`No ${tab.toLowerCase()} trips`} message="Your trips will show up here." />
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <TripCard key={o.id} order={o} onRebook={() => rebook(o)} />
          ))}
        </div>
      )}
    </AccountScaffold>
  );
}
