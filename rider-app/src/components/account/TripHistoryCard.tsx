"use client";

import type { Order } from "@/lib/api/types";
import { FareDisplay } from "@/components/ds";

export function TripHistoryCard({ order }: { order: Order }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-background-secondary p-4">
      <div>
        <p className="text-sm font-semibold">{order.status}</p>
        <p className="text-xs text-content-secondary">
          {new Date(order.created_at).toLocaleDateString("en-IN")}
        </p>
      </div>
      <FareDisplay amount={order.base_fare_paise} size="md" className="font-semibold" />
    </div>
  );
}
