"use client";

import type { Order } from "@/lib/api/types";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export function TripHistoryCard({ order }: { order: Order }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-background-secondary p-4">
      <div>
        <p className="text-sm font-semibold">{order.status}</p>
        <p className="text-xs text-content-secondary">
          {new Date(order.created_at).toLocaleDateString("en-IN")}
        </p>
      </div>
      <p className="text-sm font-semibold">{formatCurrency(order.base_fare_paise)}</p>
    </div>
  );
}
