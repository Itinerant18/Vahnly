"use client";

import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { ordersApi } from "@/lib/api/orders";
import { BlurFade } from "@/components/ui/blur-fade";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BorderBeam } from "@/components/ui/border-beam";
import { HyperText } from "@/components/ui/hyper-text";
import { ShineBorder } from "@/components/ui/shine-border";
import { WordRotate } from "@/components/ui/word-rotate";
import Text3DFlip from "@/components/ui/text-3d-flip";
import { SparklesText } from "@/components/ui/sparkles-text";
import { DiaTextReveal } from "@/components/ui/dia-text-reveal";

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

const PROMO_STORAGE_KEY = "dfu_promo_code";

export default function RewardsPage() {
  const [code, setCode] = useState("");
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [trips, setTrips] = useState(0);
  const [showExpired, setShowExpired] = useState(false);
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);

  useEffect(() => {
    ordersApi
      .history({ status: "COMPLETED", limit: 1 })
      .then((r) => setTrips(r.total ?? 0))
      .catch(() => setTrips(0));

    try {
      const stored = localStorage.getItem(PROMO_STORAGE_KEY);
      if (stored) {
        setSavedCode(stored);
        setCode(stored);
      }
    } catch {
      // localStorage unavailable — ignore.
    }
  }, []);

  // Promo codes are validated by fare-estimate at checkout, not here.
  // We just remember the rider's chosen code so booking can pre-fill it.
  const saveCode = () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    try {
      localStorage.setItem(PROMO_STORAGE_KEY, trimmed);
    } catch {
      // Ignore storage failures.
    }
    setSavedCode(trimmed);
    setCode(trimmed);
  };

  const clearCode = () => {
    try {
      localStorage.removeItem(PROMO_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    setSavedCode(null);
    setCode("");
  };

  const tierIdx = trips >= 15 ? 2 : trips >= 5 ? 1 : 0;
  const tier = TIERS[tierIdx];
  const next = TIERS[tierIdx + 1];
  const progress = next ? Math.min(100, (trips / next.min) * 100) : 100;

  return (
    <AccountScaffold title={<WordRotate words={["Promos & Offers", "Rewards", "Deals"]} duration={3000} />}>
      {/* Enter code */}
      <BlurFade delay={0.1}>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Enter promo code"
            className="flex-1 rounded-xl bg-background-tertiary px-4 py-3 text-sm uppercase tracking-wider text-content-primary outline-none placeholder:text-content-tertiary placeholder:normal-case focus:ring-1 focus:ring-border-accent"
          />
          <ShimmerButton
            type="button"
            disabled={!code.trim() || code.trim().toUpperCase() === savedCode}
            onClick={saveCode}
            shimmerColor="rgba(255,255,255,0.3)"
            background="#1a5cff"
            borderRadius="12px"
            className="px-5 text-sm font-bold disabled:opacity-40"
          >
            Save
          </ShimmerButton>
        </div>
        {savedCode ? (
          <div className="mt-1.5 flex items-center justify-between">
            <HyperText
              as="p"
              className="text-xs text-content-positive"
              duration={600}
              delay={200}
              animateOnHover={false}
              startOnView={false}
            >
              {`✓ ${savedCode} saved — applied at checkout`}
            </HyperText>
            <button onClick={clearCode} className="text-xs font-semibold text-content-secondary active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
              Remove
            </button>
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-content-tertiary">
            Codes are validated and applied when you book your next ride.
          </p>
        )}
      </BlurFade>

      {/* Loyalty */}
      <BlurFade delay={0.15}>
        <div className="mt-6 rounded-2xl bg-background-secondary p-4">
          <div className="mb-2 flex items-center justify-between">
            <DiaTextReveal
              text={`${tier.name} Tier`}
              textColor="var(--content-primary)"
              duration={1.5}
              delay={0.3}
              className="text-sm font-bold"
              colors={["#1a5cff", "#4A6FA5", "#6B8EC4", "#8BADD5"]}
            />
            <span className="text-xs text-content-secondary">{trips} trips</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-background-tertiary">
            <div className="h-full rounded-full bg-accent-400 transition-all" style={{ width: `${progress}%` }} />
          </div>
          {next ? (
            <p className="mt-2 text-xs text-content-secondary">
              {next.min - trips} more trips to {next.name}
            </p>
          ) : (
            <p className="mt-2 text-xs text-content-accent">You&apos;re at the top tier! 🎉</p>
          )}
          <ul className="mt-3 space-y-1">
            {tier.perks.map((p) => (
              <li key={p} className="flex items-center gap-2 text-xs text-content-secondary">
                <span className="text-content-positive">✓</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </BlurFade>

      {/* Active offers */}
      <BlurFade delay={0.2}>
        <Text3DFlip as="h2" className="mb-3 mt-6 text-sm font-bold text-content-primary" staggerDuration={0.03} rotateDirection="top">
          Active Offers
        </Text3DFlip>
        <div className="space-y-3">
          {ACTIVE.map((o, idx) => (
            <div key={o.code}
              className="relative rounded-2xl bg-background-secondary p-4 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.01]"
              onMouseEnter={() => setHoveredCode(o.code)}
              onMouseLeave={() => setHoveredCode(null)}
            >
              <BorderBeam size={60} duration={6} colorFrom="#1a5cff" colorTo="rgba(26,92,255,0.05)" borderWidth={1.5} delay={idx * 0.3} />
              {hoveredCode === o.code && <ShineBorder borderWidth={1} duration={8} shineColor="#1a5cff" />}
              <div className="flex items-start justify-between">
                <div>
                  <SparklesText className="text-sm font-bold text-content-primary" sparklesCount={6} colors={{ first: "#1a5cff", second: "#4A6FA5" }}>
                    {o.title}
                  </SparklesText>
                  <p className="text-xs text-content-secondary">{o.desc}</p>
                </div>
                <span className="rounded-lg bg-surface-accent px-2 py-1 font-mono text-xs font-bold text-content-accent">
                  {o.code}
                </span>
              </div>
              <p className="mt-2 text-xs text-content-warning">⏳ Expires in {o.expiresInDays} days</p>
            </div>
          ))}
        </div>
      </BlurFade>

      {/* Expired accordion */}
      <BlurFade delay={0.25}>
        <button
          onClick={() => setShowExpired((v) => !v)}
          className="mt-6 flex w-full items-center justify-between rounded-2xl bg-background-secondary p-4 active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        >
          <span className="text-sm font-bold text-content-primary">Expired Offers</span>
          <span className={`text-content-secondary transition-transform ${showExpired ? "rotate-180" : ""}`}>▾</span>
        </button>
      </BlurFade>
      {showExpired && (
        <div className="mt-2 space-y-2">
          {EXPIRED.map((o) => (
            <div key={o.code} className="rounded-2xl bg-background-secondary p-4 opacity-50">
              <p className="text-sm font-semibold text-content-primary">{o.title}</p>
              <p className="text-xs text-content-secondary">{o.desc} · Expired</p>
            </div>
          ))}
        </div>
      )}
    </AccountScaffold>
  );
}
