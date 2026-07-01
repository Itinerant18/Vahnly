"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTripStore } from "@/lib/store/tripStore";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { FareDisplay } from "@/components/ds";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { WordRotate } from "@/components/ui/word-rotate";
import { TypingAnimation } from "@/components/ui/typing-animation";
import type { PaymentMethod } from "@/lib/api/types";

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  WALLET: "Wallet",
};

const WalletIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v1h1a1 1 0 011 1v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="17" cy="13" r="1.2" fill="currentColor" />
  </svg>
);

const PAYMENT_ICONS: Record<PaymentMethod, ReactNode> = {
  CASH: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="20" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  UPI: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="3" width="12" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M11 18h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  CARD: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  WALLET: WalletIcon,
};

function CheckmarkAnimation({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="flex flex-col items-center gap-4">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="var(--positive-400)" opacity="0.2" />
          <circle cx="40" cy="40" r="28" fill="var(--positive-400)" />
          <polyline
            points="26,40 36,52 54,30"
            stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <p className="text-lg font-bold text-content-primary">Payment Successful</p>
      </div>
    </div>
  );
}

function RowItem({ label, value, accent, bold }: { label: string; value: React.ReactNode; accent?: boolean; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className={`text-sm ${bold ? "text-content-primary font-semibold" : "text-content-secondary"}`}>{label}</span>
      <span className={`text-sm font-semibold ${accent ? "text-content-negative" : bold ? "text-content-accent" : "text-content-primary"}`}>
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
    <div className="flex min-h-screen flex-col bg-background-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pb-4 pt-12">
        <h1 className="text-xl font-bold text-content-primary">
          <WordRotate words={["Trip Summary", "Your Ride", "Journey Complete"]} duration={3000} className="text-xl font-bold" />
        </h1>
        {fare && (
          <span className="ml-auto rounded-lg bg-surface-positive px-2.5 py-1 text-xs font-semibold text-content-positive">
            Completed
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {/* Trip stats */}
        {fare && (
          <div className="mb-4 grid grid-cols-2 gap-3">
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
        <div className="mb-4 rounded-2xl bg-background-secondary px-4">
          <p className="border-b border-border-opaque py-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">
            Fare Breakdown
          </p>
          {breakdown ? (
            <>
              <RowItem label="Base fare" value={<FareDisplay amount={breakdown.base_fare_paise} size="sm" />} />
              <RowItem label="Distance charge" value={<FareDisplay amount={breakdown.distance_charge_paise} size="sm" />} />
              {breakdown.night_charge_paise > 0 && (
                <RowItem label="Night charge" value={<FareDisplay amount={breakdown.night_charge_paise} size="sm" />} />
              )}
              {breakdown.d4m_care_paise > 0 && (
                <RowItem label="D4M Care" value={<FareDisplay amount={breakdown.d4m_care_paise} size="sm" />} />
              )}
              {breakdown.surge_multiplier > 1 && (
                <RowItem label={`Surge (${breakdown.surge_multiplier}×)`} value="included" />
              )}
              {breakdown.promo_discount_paise > 0 && (
                <RowItem
                  label="Promo discount"
                  value={<>−<FareDisplay amount={breakdown.promo_discount_paise} size="sm" /></>}
                  accent
                />
              )}
              <div className="border-t border-border-opaque">
                <RowItem label="Total" value={<FareDisplay amount={displayTotal} size="sm" />} bold />
              </div>
            </>
          ) : (
            <RowItem label="Estimated fare" value={<FareDisplay amount={displayTotal} size="sm" />} bold />
          )}
        </div>

        {/* Payment method */}
        <div className="mb-4 rounded-2xl bg-background-secondary p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">Payment Method</p>
          <div className="flex flex-wrap gap-2">
            {(["CASH", "UPI", "WALLET", "CARD"] as PaymentMethod[]).map((m) => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                  method === m
                    ? "bg-accent-400 text-white"
                    : "bg-background-tertiary text-content-secondary ring-1 ring-border-opaque"
                }`}
              >
                <span className="flex items-center gap-2">
                  {PAYMENT_ICONS[m]}
                  {PAYMENT_LABELS[m]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {walletAnim && (
          <div className="mb-4 flex items-center justify-center gap-3 rounded-2xl bg-background-secondary p-6">
            <span className="flex animate-bounce text-content-secondary">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 7a2 2 0 012-2h12a2 2 0 012 2v1h1a1 1 0 011 1v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <circle cx="17" cy="13" r="1.4" fill="currentColor" />
              </svg>
            </span>
            <TypingAnimation className="text-sm font-medium text-content-secondary" duration={30} delay={100} startOnView={false}>
              Processing wallet payment…
            </TypingAnimation>
          </div>
        )}
      </div>

      {/* Pay CTA */}
      <div className="px-4 pb-8">
        <ShimmerButton
          type="button"
          disabled={paying}
          onClick={handlePay}
          shimmerColor="rgba(255,255,255,0.3)"
          background="#1a5cff"
          borderRadius="16px"
          className="w-full py-4 text-base font-bold shadow-elevation-2 disabled:opacity-60"
        >
          {method === "CASH" ? "Mark as Paid" : `Pay ${formatCurrency(displayTotal)}`}
        </ShimmerButton>
      </div>

      {paid && <CheckmarkAnimation onDone={() => router.replace("/trip/rate")} />}
    </div>
  );
}
