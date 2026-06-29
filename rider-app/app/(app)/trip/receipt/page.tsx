"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TOKEN_STORAGE_KEY } from "@/lib/api/client";
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

  const targetId = orderId || fare?.orderId || order?.id || "";

  // Fetch the server-generated invoice PDF and trigger a download.
  // Falls back to browser print-to-PDF if the request fails.
  const handleDownloadPDF = async () => {
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem(TOKEN_STORAGE_KEY)
        : null;
    if (!targetId || !token) {
      window.print();
      return;
    }

    try {
      const blob = await ordersApi.getInvoice(targetId);
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `invoice-${targetId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.print();
    }
  };

  const handleReportProblem = () => {
    router.push(`/account/support?orderId=${targetId}`);
  };

  const breakdown = fare?.fareBreakdown;
  const total = fare?.totalFarePaise ?? order?.base_fare_paise ?? 0;

  return (
    <div className="flex min-h-screen flex-col bg-background-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-12">
        <button onClick={() => router.back()} aria-label="Back" className="mr-1 text-content-secondary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-content-primary">Trip Receipt</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {/* Order ID */}
        {targetId && (
          <div className="rounded-2xl bg-background-secondary px-4 py-3">
            <p className="text-xs text-content-secondary">Order ID</p>
            <p className="mt-0.5 font-mono text-sm text-content-primary">{targetId}</p>
          </div>
        )}

        {/* Stats */}
        {fare && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-background-secondary p-4">
              <p className="text-xs text-content-secondary">Distance</p>
              <p className="mt-1 text-lg font-bold text-content-primary">{fare.distanceKm.toFixed(1)} km</p>
            </div>
            <div className="rounded-2xl bg-background-secondary p-4">
              <p className="text-xs text-content-secondary">Duration</p>
              <p className="mt-1 text-lg font-bold text-content-primary">{fare.durationMinutes} min</p>
            </div>
          </div>
        )}

        {/* Fare breakdown */}
        <div className="rounded-2xl bg-background-secondary px-4">
          <p className="border-b border-border-opaque py-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">
            Fare Details
          </p>
          {breakdown ? (
            <>
              <div className="flex justify-between py-2.5">
                <span className="text-sm text-content-secondary">Base fare</span>
                <span className="text-sm text-content-primary">{formatCurrency(breakdown.base_fare_paise)}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-sm text-content-secondary">Distance charge</span>
                <span className="text-sm text-content-primary">{formatCurrency(breakdown.distance_charge_paise)}</span>
              </div>
              {breakdown.night_charge_paise > 0 && (
                <div className="flex justify-between py-2.5">
                  <span className="text-sm text-content-secondary">Night charge</span>
                  <span className="text-sm text-content-primary">{formatCurrency(breakdown.night_charge_paise)}</span>
                </div>
              )}
              {breakdown.promo_discount_paise > 0 && (
                <div className="flex justify-between py-2.5">
                  <span className="text-sm text-content-secondary">Promo discount</span>
                  <span className="text-sm text-content-negative">−{formatCurrency(breakdown.promo_discount_paise)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border-opaque py-3">
                <span className="text-sm font-semibold text-content-primary">Total Paid</span>
                <span className="text-sm font-bold text-content-accent">{formatCurrency(total)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between py-3">
              <span className="text-sm font-semibold text-content-primary">Total</span>
              <span className="text-sm font-bold text-content-accent">{formatCurrency(total)}</span>
            </div>
          )}
        </div>

        {/* Timeline */}
        {order && (
          <div className="rounded-2xl bg-background-secondary px-4 py-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">Timeline</p>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-positive-400">
                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                </div>
                <div>
                  <p className="text-sm text-content-primary">Pickup</p>
                  <p className="text-xs text-content-secondary">
                    {order.pickup_lat.toFixed(4)}, {order.pickup_lng.toFixed(4)}
                  </p>
                </div>
              </div>
              {order.dropoff_lat != null && order.dropoff_lng != null && (
                <div className="flex items-start gap-3">
                  <div className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-negative-400">
                    <div className="h-1.5 w-1.5 rounded-full bg-white" />
                  </div>
                  <div>
                    <p className="text-sm text-content-primary">Drop-off</p>
                    <p className="text-xs text-content-secondary">
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
            className="flex w-full items-center gap-3 rounded-2xl bg-background-secondary px-4 py-4 text-left ring-1 ring-border-opaque active:bg-background-tertiary"
          >
            <span className="flex h-5 w-5 items-center justify-center text-content-secondary">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <path d="M14 3v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold text-content-primary">Download PDF</p>
              <p className="text-xs text-content-secondary">Print or save receipt to device</p>
            </div>
          </button>

          <button
            disabled
            className="flex w-full cursor-not-allowed items-center gap-3 rounded-2xl bg-background-secondary px-4 py-4 text-left ring-1 ring-border-opaque opacity-50"
          >
            <span className="flex h-5 w-5 items-center justify-center text-content-secondary">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 7l8 6 8-6" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-content-primary">Email Receipt</p>
              <p className="text-xs text-content-secondary">Send to registered email</p>
            </div>
            <span className="text-xs text-content-tertiary">Coming soon</span>
          </button>

          <button
            onClick={handleReportProblem}
            className="flex w-full items-center gap-3 rounded-2xl bg-background-secondary px-4 py-4 text-left ring-1 ring-negative-400 active:bg-background-tertiary"
          >
            <span className="flex h-5 w-5 items-center justify-center text-content-negative">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 21V4M5 4h11l-2 4 2 4H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold text-content-negative">Report a Problem</p>
              <p className="text-xs text-content-secondary">Something went wrong with this trip</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background-primary" />}>
      <ReceiptContent />
    </Suspense>
  );
}
