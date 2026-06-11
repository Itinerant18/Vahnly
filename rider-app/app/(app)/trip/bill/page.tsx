"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTripStore } from "@/lib/store/tripStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { PaymentMethod } from "@/lib/api/types";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "💵 Cash",
  UPI: "📱 UPI",
  CARD: "💳 Card",
  WALLET: "👛 Wallet",
};

function CheckmarkAnimation({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="flex flex-col items-center gap-4">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="#22C55E" opacity="0.2" />
          <circle cx="40" cy="40" r="28" fill="#22C55E" />
          <polyline
            points="26,40 36,52 54,30"
            stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <p className="text-lg font-bold text-white">Payment Successful</p>
      </div>
    </div>
  );
}

function RowItem({ label, value, accent, bold }: { label: string; value: string; accent?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className={`text-sm ${bold ? "text-white font-semibold" : "text-[#9CA3AF]"}`}>{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-[#EF4444]" : bold ? "text-[#FF6B35]" : "text-white"}`}>
        {value}
      </span>
    </div>
  );
}

export default function BillPage() {
  const router = useRouter();
  const completedFare = useTripStore((s) => s.completedFare);
  const activeOrder = useTripStore((s) => s.activeOrder);

  const [method, setMethod] = useState<PaymentMethod>(
    (activeOrder?.payment_method as PaymentMethod) ?? "CASH",
  );
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [walletAnim, setWalletAnim] = useState(false);

  const clientTotal = useMemo(() => {
    if (!completedFare) return 0;
    const b = completedFare.fareBreakdown;
    return (
      b.base_fare_paise +
      b.distance_charge_paise +
      b.night_charge_paise +
      b.d4m_care_paise -
      b.promo_discount_paise
    );
  }, [completedFare]);

  // Use server total as authoritative; log mismatch in dev
  const displayTotal = completedFare?.totalFarePaise ?? clientTotal ?? activeOrder?.base_fare_paise ?? 0;

  const fare = completedFare;
  const breakdown = fare?.fareBreakdown;

  const handlePay = async () => {
    if (paying) return;
    setPaying(true);
    if (method === "CASH") {
      setPaid(true);
    } else if (method === "UPI") {
      const orderId = fare?.orderId ?? activeOrder?.id ?? "";
      const amount = (displayTotal / 100).toFixed(2);
      const upiUrl = `upi://pay?pa=d4m@ybl&pn=DriverforU&am=${amount}&tn=Order+${orderId}&cu=INR`;
      window.open(upiUrl, "_self");
      setTimeout(() => setPaid(true), 800);
    } else if (method === "WALLET") {
      setWalletAnim(true);
      await new Promise((r) => setTimeout(r, 1200));
      setWalletAnim(false);
      setPaid(true);
    } else {
      setPaid(true);
    }
    setPaying(false);
  };

  if (!completedFare && !activeOrder) {
    if (typeof window !== "undefined") router.replace("/home");
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0A0A0A]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-12">
        <h1 className="text-xl font-bold text-white">Trip Summary</h1>
        {fare && (
          <span className="ml-auto rounded-lg bg-[#22C55E]/10 px-2.5 py-1 text-xs font-semibold text-[#22C55E]">
            Completed
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {/* Trip stats */}
        {fare && (
          <div className="mb-4 grid grid-cols-2 gap-3">
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
        <div className="mb-4 rounded-2xl bg-[#141414] px-4">
          <p className="border-b border-white/6 py-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">
            Fare Breakdown
          </p>
          {breakdown ? (
            <>
              <RowItem label="Base fare" value={formatCurrency(breakdown.base_fare_paise)} />
              <RowItem label="Distance charge" value={formatCurrency(breakdown.distance_charge_paise)} />
              {breakdown.night_charge_paise > 0 && (
                <RowItem label="Night charge" value={formatCurrency(breakdown.night_charge_paise)} />
              )}
              {breakdown.d4m_care_paise > 0 && (
                <RowItem label="D4M Care" value={formatCurrency(breakdown.d4m_care_paise)} />
              )}
              {breakdown.surge_multiplier > 1 && (
                <RowItem label={`Surge (${breakdown.surge_multiplier}×)`} value="included" />
              )}
              {breakdown.promo_discount_paise > 0 && (
                <RowItem
                  label="Promo discount"
                  value={`−${formatCurrency(breakdown.promo_discount_paise)}`}
                  accent
                />
              )}
              <div className="border-t border-white/6">
                <RowItem label="Total" value={formatCurrency(displayTotal)} bold />
              </div>
            </>
          ) : (
            <RowItem label="Estimated fare" value={formatCurrency(displayTotal)} bold />
          )}
        </div>

        {/* Payment method */}
        <div className="mb-4 rounded-2xl bg-[#141414] p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#9CA3AF]">Payment Method</p>
          <div className="flex flex-wrap gap-2">
            {(["CASH", "UPI", "WALLET", "CARD"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  method === m
                    ? "bg-[#FF6B35] text-white"
                    : "bg-[#1E1E1E] text-[#9CA3AF] ring-1 ring-white/10"
                }`}
              >
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {walletAnim && (
          <div className="mb-4 flex items-center justify-center gap-3 rounded-2xl bg-[#141414] p-6">
            <span className="animate-bounce text-3xl">👛</span>
            <span className="text-sm font-medium text-[#9CA3AF]">Processing wallet payment…</span>
          </div>
        )}
      </div>

      {/* Pay CTA */}
      <div className="px-4 pb-8">
        <button
          onClick={handlePay}
          disabled={paying}
          className="w-full rounded-2xl bg-[#FF6B35] py-4 text-base font-bold text-white shadow-lg shadow-[#FF6B35]/20 transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {method === "CASH" ? "Mark as Paid" : `Pay ${formatCurrency(displayTotal)}`}
        </button>
      </div>

      {paid && <CheckmarkAnimation onDone={() => router.replace("/trip/rate")} />}
    </div>
  );
}
