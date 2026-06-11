"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ordersApi } from "@/lib/api/orders";
import { useTripStore } from "@/lib/store/tripStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";

function ReceiptContent() {
  const router = useRouter();
  const params = useSearchParams();
  const orderId = params.get("orderId") ?? "";

  const completedFare = useTripStore((s) => s.completedFare);
  const activeOrder = useTripStore((s) => s.activeOrder);

  const fare = completedFare;
  const order = activeOrder;

  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState<"pdf" | "email" | null>(null);

  const targetId = orderId || fare?.orderId || order?.id || "";

  const handleDownloadPDF = async () => {
    if (!targetId) return;
    setLoading("pdf");
    try {
      window.open(`/api/v1/rider/orders/${targetId}/invoice`, "_blank");
    } finally {
      setLoading(null);
    }
  };

  const handleEmailReceipt = async () => {
    if (!targetId) return;
    setLoading("email");
    try {
      await fetch(`/api/v1/rider/orders/${targetId}/send-receipt`, { method: "POST" });
      setEmailSent(true);
    } finally {
      setLoading(null);
    }
  };

  const handleReportProblem = () => {
    router.push(`/account/support?orderId=${targetId}`);
  };

  const breakdown = fare?.fareBreakdown;
  const total = fare?.totalFarePaise ?? order?.base_fare_paise ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#0A0A0A]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-12">
        <button onClick={() => router.back()} className="mr-1 text-[#9CA3AF]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-white">Trip Receipt</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {/* Order ID */}
        {targetId && (
          <div className="rounded-2xl bg-[#141414] px-4 py-3">
            <p className="text-xs text-[#9CA3AF]">Order ID</p>
            <p className="mt-0.5 font-mono text-sm text-white">{targetId}</p>
          </div>
        )}

        {/* Stats */}
        {fare && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#141414] p-4">
              <p className="text-xs text-[#9CA3AF]">Distance</p>
              <p className="mt-1 text-lg font-bold text-white">{fare.distanceKm.toFixed(1)} km</p>
            </div>
            <div className="rounded-2xl bg-[#141414] p-4">
              <p className="text-xs text-[#9CA3AF]">Duration</p>
              <p className="mt-1 text-lg font-bold text-white">{fare.durationMinutes} min</p>
            </div>
          </div>
        )}

        {/* Fare breakdown */}
        <div className="rounded-2xl bg-[#141414] px-4">
          <p className="border-b border-white/6 py-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
            Fare Details
          </p>
          {breakdown ? (
            <>
              <div className="flex justify-between py-2.5">
                <span className="text-sm text-[#9CA3AF]">Base fare</span>
                <span className="text-sm text-white">{formatCurrency(breakdown.base_fare_paise)}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-sm text-[#9CA3AF]">Distance charge</span>
                <span className="text-sm text-white">{formatCurrency(breakdown.distance_charge_paise)}</span>
              </div>
              {breakdown.night_charge_paise > 0 && (
                <div className="flex justify-between py-2.5">
                  <span className="text-sm text-[#9CA3AF]">Night charge</span>
                  <span className="text-sm text-white">{formatCurrency(breakdown.night_charge_paise)}</span>
                </div>
              )}
              {breakdown.promo_discount_paise > 0 && (
                <div className="flex justify-between py-2.5">
                  <span className="text-sm text-[#9CA3AF]">Promo discount</span>
                  <span className="text-sm text-[#EF4444]">−{formatCurrency(breakdown.promo_discount_paise)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-white/6 py-3">
                <span className="text-sm font-semibold text-white">Total Paid</span>
                <span className="text-sm font-bold text-[#FF6B35]">{formatCurrency(total)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between py-3">
              <span className="text-sm font-semibold text-white">Total</span>
              <span className="text-sm font-bold text-[#FF6B35]">{formatCurrency(total)}</span>
            </div>
          )}
        </div>

        {/* Timeline */}
        {order && (
          <div className="rounded-2xl bg-[#141414] px-4 py-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">Timeline</p>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#22C55E]">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                </div>
                <div>
                  <p className="text-sm text-white">Pickup</p>
                  <p className="text-xs text-[#9CA3AF]">
                    {order.pickup_lat.toFixed(4)}, {order.pickup_lng.toFixed(4)}
                  </p>
                </div>
              </div>
              {order.dropoff_lat != null && order.dropoff_lng != null && (
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[#EF4444]">
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  </div>
                  <div>
                    <p className="text-sm text-white">Drop-off</p>
                    <p className="text-xs text-[#9CA3AF]">
                      {order.dropoff_lat.toFixed(4)}, {order.dropoff_lng.toFixed(4)}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={handleDownloadPDF}
            disabled={loading === "pdf"}
            className="flex w-full items-center gap-3 rounded-2xl bg-[#141414] px-4 py-4 text-left ring-1 ring-white/8 active:bg-[#1E1E1E] disabled:opacity-60"
          >
            <span className="text-xl">📄</span>
            <div>
              <p className="text-sm font-semibold text-white">Download PDF</p>
              <p className="text-xs text-[#9CA3AF]">Save receipt to device</p>
            </div>
          </button>

          <button
            onClick={handleEmailReceipt}
            disabled={loading === "email" || emailSent}
            className="flex w-full items-center gap-3 rounded-2xl bg-[#141414] px-4 py-4 text-left ring-1 ring-white/8 active:bg-[#1E1E1E] disabled:opacity-60"
          >
            <span className="text-xl">{emailSent ? "✅" : "📧"}</span>
            <div>
              <p className="text-sm font-semibold text-white">
                {emailSent ? "Receipt Sent!" : "Email Receipt"}
              </p>
              <p className="text-xs text-[#9CA3AF]">
                {emailSent ? "Check your inbox" : "Send to registered email"}
              </p>
            </div>
          </button>

          <button
            onClick={handleReportProblem}
            className="flex w-full items-center gap-3 rounded-2xl bg-[#141414] px-4 py-4 text-left ring-1 ring-[#EF4444]/20 active:bg-[#1E1E1E]"
          >
            <span className="text-xl">🚩</span>
            <div>
              <p className="text-sm font-semibold text-[#EF4444]">Report a Problem</p>
              <p className="text-xs text-[#9CA3AF]">Something went wrong with this trip</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0A0A]" />}>
      <ReceiptContent />
    </Suspense>
  );
}
