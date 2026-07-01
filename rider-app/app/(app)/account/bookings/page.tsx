"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { AnimatedIcon } from "@/components/ds/Icon";
import { AnimEmptyBox } from "@/assets/icons/animated";
import { ordersApi } from "@/lib/api/orders";
import { useBookingStore } from "@/lib/store/bookingStore";
import { FareDisplay } from "@/components/ds";
import type { Order, TripStatus } from "@/lib/api/types";
import { BlurFade } from "@/components/ui/blur-fade";
import { WordRotate } from "@/components/ui/word-rotate";
import { ShineBorder } from "@/components/ui/shine-border";
import { AnimatedList, AnimatedListItem } from "@/components/ui/animated-list";

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
  COMPLETED: "bg-surface-positive text-content-positive",
  CANCELLED: "bg-surface-negative text-content-negative",
  DELIVERING: "bg-surface-accent text-content-accent",
  ASSIGNED: "bg-surface-accent text-content-accent",
};

function bucket(status: TripStatus): Tab {
  if (status === "COMPLETED") return "Completed";
  if (status === "CANCELLED") return "Cancelled";
  return "Upcoming";
}

function TripCard({ order, onRebook, onCancel }: { order: Order; onRebook: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isScheduled = !!order.scheduled_at;
  const terminal = order.status === "COMPLETED" || order.status === "CANCELLED";
  // Scheduled bookings show their real future pickup time; past trips show the
  // trip date; live instant trips show no time. Never use created_at as a stand-in
  // for a scheduled time.
  const when = isScheduled
    ? new Date(order.scheduled_at as string)
    : terminal
      ? new Date(order.created_at)
      : null;
  return (
    <div className="relative rounded-2xl bg-background-secondary p-4 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.01]"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && <ShineBorder borderWidth={1} duration={8} shineColor="#4A6FA5" />}
      <button
        onClick={() => router.push(`/account/bookings/detail?orderId=${order.id}`)}
        className="block w-full text-left"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          {when ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-positive-400" />
              <span className="text-xs text-content-secondary">
                {isScheduled ? "Pickup " : ""}
                {when.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} ·{" "}
                {when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ) : (
            <span />
          )}
          <span className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold ${isScheduled ? "bg-surface-accent text-content-accent" : STATUS_CHIP[order.status] ?? "bg-surface-neutral text-content-secondary"}`}>
            {isScheduled ? "Scheduled" : order.status}
          </span>
        </div>
        <p className="text-sm text-content-primary">
          {order.pickup_lat.toFixed(3)}, {order.pickup_lng.toFixed(3)}
          {order.dropoff_lat != null && (
            <span className="text-content-secondary">
              {" → "}
              {order.dropoff_lat.toFixed(3)}, {order.dropoff_lng?.toFixed(3)}
            </span>
          )}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <FareDisplay amount={order.base_fare_paise} size="md" className="font-bold text-content-accent" />
          {order.trip_type && (
            <span className="rounded-pill bg-surface-neutral px-2 py-0.5 text-[10px] font-medium text-content-secondary">
              {order.trip_type}
            </span>
          )}
        </div>
      </button>

      {confirming ? (
        <div className="mt-3 rounded-xl bg-surface-negative p-3" role="alertdialog" aria-label="Confirm cancel booking">
          <p className="text-xs text-content-negative">
            Cancel this booking? No fee applies before a driver is dispatched.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 rounded-xl bg-background-tertiary py-2 text-xs font-semibold text-content-primary min-h-[44px] active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Keep booking
            </button>
            <button
              onClick={() => { setConfirming(false); onCancel?.(); }}
              className="flex-1 rounded-xl bg-negative-400 py-2 text-xs font-semibold text-white min-h-[44px] active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Cancel booking
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onRebook}
            className="flex-1 rounded-xl bg-background-tertiary py-2.5 text-xs font-semibold text-content-accent min-h-[44px] active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          >
            Rebook
          </button>
          {onCancel ? (
            <button
              onClick={() => setConfirming(true)}
              className="flex-1 rounded-xl bg-background-tertiary py-2.5 text-xs font-semibold text-content-negative min-h-[44px] active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => router.push(`/account/bookings/detail?orderId=${order.id}`)}
              className="flex-1 rounded-xl bg-background-tertiary py-2.5 text-xs font-semibold text-content-primary min-h-[44px] active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Details
            </button>
          )}
        </div>
      )}
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

  const filtered = useMemo(() => {
    const list = (orders ?? []).filter((o) => bucket(o.status) === tab);
    if (tab === "Upcoming") {
      // Soonest first — scheduled pickup time when present, else creation time.
      return [...list].sort(
        (a, b) =>
          new Date(a.scheduled_at ?? a.created_at).getTime() -
          new Date(b.scheduled_at ?? b.created_at).getTime(),
      );
    }
    return list;
  }, [orders, tab]);

  const cancelBooking = (order: Order) => {
    ordersApi
      .cancel(order.id, "RIDER_CANCELLED_SCHEDULED")
      .then(load)
      .catch(() => setError(true));
  };

  const rebook = (order: Order) => {
    setPickup({ lat: order.pickup_lat, lng: order.pickup_lng, address: "Previous pickup" });
    if (order.dropoff_lat != null && order.dropoff_lng != null) {
      setDropoff({ lat: order.dropoff_lat, lng: order.dropoff_lng, address: "Previous drop" });
    }
    router.push("/home");
  };

  return (
    <AccountScaffold title={<WordRotate words={["My Trips", "Ride History", "Your Journeys"]} duration={3000} />}>
      {/* Tabs */}
      <BlurFade delay={0.1}>
        <div className="mb-4 flex gap-1 rounded-xl bg-background-secondary p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-95 ${
                tab === t ? "bg-accent-400 text-content-primary" : "text-content-secondary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </BlurFade>

      {error ? (
        <ErrorState onRetry={load} />
      ) : orders === null ? (
        <SkeletonList rows={4} height="h-28" />
      ) : filtered.length === 0 ? (
        <BlurFade delay={0.2}>
          <EmptyState icon={<AnimatedIcon src={AnimEmptyBox} size={64} trigger="in" />} title={`No ${tab.toLowerCase()} trips`} message="Your trips will show up here." />
        </BlurFade>
      ) : (
        <AnimatedList delay={500} className="space-y-3">
          {filtered.map((o) => (
            <AnimatedListItem key={o.id}>
              <TripCard
                order={o}
                onRebook={() => rebook(o)}
                onCancel={
                  tab === "Upcoming" && (o.status === "CREATED" || o.status === "ASSIGNED")
                    ? () => cancelBooking(o)
                    : undefined
                }
              />
            </AnimatedListItem>
          ))}
        </AnimatedList>
      )}
    </AccountScaffold>
  );
}
