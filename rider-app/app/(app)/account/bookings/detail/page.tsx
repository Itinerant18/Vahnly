"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { Shimmer, ErrorState } from "@/components/account/States";
import { ordersApi } from "@/lib/api/orders";
import { FareDisplay } from "@/components/ds";
import type { Order } from "@/lib/api/types";

function DetailBody() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get("orderId") ?? "";

  const [order, setOrder] = useState<Order | null | "error">(null);

  const load = useCallback(() => {
    setOrder(null);
    ordersApi
      .history({ limit: 100 })
      .then((res) => setOrder(res.orders.find((o) => o.id === orderId) ?? "error"))
      .catch(() => setOrder("error"));
  }, [orderId]);

  useEffect(load, [load]);

  if (order === null) {
    return (
      <div className="space-y-3">
        <Shimmer className="h-40 w-full" />
        <Shimmer className="h-24 w-full" />
        <Shimmer className="h-24 w-full" />
      </div>
    );
  }
  if (order === "error") return <ErrorState message="Trip not found." onRetry={load} />;

  const date = new Date(order.created_at);
  const rated = order.rider_rating_for_driver != null;

  return (
    <div className="space-y-4">
      {/* Map snapshot placeholder */}
      <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-background-secondary">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 40%, var(--accent-400) 0, transparent 8px), radial-gradient(circle at 70% 70%, var(--positive-400) 0, transparent 8px)",
          }}
        />
        <span className="z-10 text-xs text-content-secondary">Route map</span>
      </div>

      {/* Timeline */}
      <div className="rounded-2xl bg-background-secondary p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">Timeline</p>
        <div className="space-y-3">
          <Point color="var(--positive-400)" label="Pickup" sub={`${order.pickup_lat.toFixed(4)}, ${order.pickup_lng.toFixed(4)}`} />
          {order.dropoff_lat != null && order.dropoff_lng != null && (
            <Point
              color="var(--negative-400)"
              label="Drop-off"
              sub={`${order.dropoff_lat.toFixed(4)}, ${order.dropoff_lng.toFixed(4)}`}
            />
          )}
        </div>
        <p className="mt-3 text-xs text-content-tertiary">
          {date.toLocaleString("en-IN")} · {order.status}
        </p>
      </div>

      {/* Bill */}
      <div className="rounded-2xl bg-background-secondary px-4">
        <p className="border-b border-border-opaque py-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">
          Bill
        </p>
        <Row label="Base fare" value={<FareDisplay amount={order.base_fare_paise} size="sm" />} />
        {order.promo_discount_paise > 0 && (
          <Row label="Promo discount" value={<>−<FareDisplay amount={order.promo_discount_paise} size="sm" /></>} accent />
        )}
        {order.rider_tip_paise > 0 && <Row label="Tip" value={<FareDisplay amount={order.rider_tip_paise} size="sm" />} />}
        <div className="border-t border-border-opaque">
          <Row
            label="Total"
            value={<FareDisplay amount={order.base_fare_paise - order.promo_discount_paise + order.rider_tip_paise} size="sm" />}
            bold
          />
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {order.status === "COMPLETED" && !rated && (
          <button
            onClick={() => router.push("/trip/rate")}
            className="w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text"
          >
            ⭐ Rate this trip
          </button>
        )}
        <button
          onClick={() => router.push(`/trip/receipt?orderId=${order.id}`)}
          className="w-full rounded-2xl bg-background-secondary py-3.5 text-sm font-semibold text-content-primary ring-1 ring-border-opaque"
        >
          Invoice & Receipt
        </button>
        <button
          onClick={() => router.push(`/account/support?orderId=${order.id}`)}
          className="w-full rounded-2xl bg-background-secondary py-3.5 text-sm font-semibold text-content-negative ring-1 ring-negative-400"
        >
          Report an Issue
        </button>
      </div>
    </div>
  );
}

function Point({ color, label, sub }: { color: string; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-1 h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div>
        <p className="text-sm text-content-primary">{label}</p>
        <p className="text-xs text-content-secondary">{sub}</p>
      </div>
    </div>
  );
}

function Row({ label, value, accent, bold }: { label: string; value: React.ReactNode; accent?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between py-2.5">
      <span className={`text-sm ${bold ? "font-semibold text-content-primary" : "text-content-secondary"}`}>{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-content-negative" : bold ? "text-content-accent" : "text-content-primary"}`}>
        {value}
      </span>
    </div>
  );
}

export default function BookingDetailPage() {
  return (
    <AccountScaffold title="Trip Detail">
      <Suspense fallback={<Shimmer className="h-40 w-full" />}>
        <DetailBody />
      </Suspense>
    </AccountScaffold>
  );
}
