"use client";

import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { ordersApi } from "@/lib/api/orders";

interface Offer {
  code: string;
  title: string;
  desc: string;
  expiresInDays: number;
}

const ACTIVE: Offer[] = [
  { code: "WELCOME50", title: "50% off first ride", desc: "Up to ₹100 off", expiresInDays: 5 },
  { code: "WEEKEND20", title: "20% weekend rides", desc: "Sat & Sun only", expiresInDays: 12 },
];
const EXPIRED: Offer[] = [
  { code: "DIWALI25", title: "Diwali 25% off", desc: "Festive offer", expiresInDays: -3 },
];

const TIERS = [
  { name: "Silver", min: 0, perks: ["Standard support", "Basic rewards"] },
  { name: "Gold", min: 5, perks: ["Priority matching", "5% wallet cashback"] },
  { name: "Platinum", min: 15, perks: ["24/7 concierge", "Free D4M Care", "10% cashback"] },
];

export default function RewardsPage() {
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [trips, setTrips] = useState(0);
  const [showExpired, setShowExpired] = useState(false);

  useEffect(() => {
    ordersApi
      .history({ status: "COMPLETED", limit: 1 })
      .then((r) => setTrips(r.total ?? 0))
      .catch(() => setTrips(0));
  }, []);

  const apply = () => {
    const found = ACTIVE.find((o) => o.code === code.trim().toUpperCase());
    if (!found) {
      setErr("Invalid or expired code");
      setApplied(null);
      return;
    }
    setApplied(found.code);
    setErr(null);
  };

  const tierIdx = trips >= 15 ? 2 : trips >= 5 ? 1 : 0;
  const tier = TIERS[tierIdx];
  const next = TIERS[tierIdx + 1];
  const progress = next ? Math.min(100, (trips / next.min) * 100) : 100;

  return (
    <AccountScaffold title="Promos & Offers">
      {/* Enter code */}
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Enter promo code"
          className="flex-1 rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm uppercase tracking-wider text-white outline-none placeholder:text-[#6B7280] placeholder:normal-case focus:ring-1 focus:ring-[#FF6B35]"
        />
        <button onClick={apply} className="rounded-xl bg-[#FF6B35] px-5 text-sm font-bold text-white">
          Apply
        </button>
      </div>
      {err && <p className="mt-1.5 text-xs text-[#EF4444]">{err}</p>}
      {applied && <p className="mt-1.5 text-xs text-[#22C55E]">✓ {applied} applied</p>}

      {/* Loyalty */}
      <div className="mt-6 rounded-2xl bg-[#141414] p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-bold text-white">{tier.name} Tier</span>
          <span className="text-xs text-[#9CA3AF]">{trips} trips</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#1E1E1E]">
          <div className="h-full rounded-full bg-[#FF6B35] transition-all" style={{ width: `${progress}%` }} />
        </div>
        {next ? (
          <p className="mt-2 text-xs text-[#9CA3AF]">
            {next.min - trips} more trips to {next.name}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[#FF6B35]">You&apos;re at the top tier! 🎉</p>
        )}
        <ul className="mt-3 space-y-1">
          {tier.perks.map((p) => (
            <li key={p} className="flex items-center gap-2 text-xs text-[#D1D5DB]">
              <span className="text-[#22C55E]">✓</span>
              {p}
            </li>
          ))}
        </ul>
      </div>

      {/* Active offers */}
      <h2 className="mb-3 mt-6 text-sm font-bold text-white">Active Offers</h2>
      <div className="space-y-3">
        {ACTIVE.map((o) => (
          <div key={o.code} className="rounded-2xl bg-[#141414] p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-white">{o.title}</p>
                <p className="text-xs text-[#9CA3AF]">{o.desc}</p>
              </div>
              <span className="rounded-lg bg-[#FF6B35]/15 px-2 py-1 font-mono text-xs font-bold text-[#FF6B35]">
                {o.code}
              </span>
            </div>
            <p className="mt-2 text-xs text-[#F59E0B]">⏳ Expires in {o.expiresInDays} days</p>
          </div>
        ))}
      </div>

      {/* Expired accordion */}
      <button
        onClick={() => setShowExpired((v) => !v)}
        className="mt-6 flex w-full items-center justify-between rounded-2xl bg-[#141414] p-4"
      >
        <span className="text-sm font-bold text-white">Expired Offers</span>
        <span className={`text-[#9CA3AF] transition-transform ${showExpired ? "rotate-180" : ""}`}>▾</span>
      </button>
      {showExpired && (
        <div className="mt-2 space-y-2">
          {EXPIRED.map((o) => (
            <div key={o.code} className="rounded-2xl bg-[#141414] p-4 opacity-50">
              <p className="text-sm font-semibold text-white">{o.title}</p>
              <p className="text-xs text-[#9CA3AF]">{o.desc} · Expired</p>
            </div>
          ))}
        </div>
      )}
    </AccountScaffold>
  );
}
