"use client";

import React, { useEffect, useState } from "react";
import { ChatIcon, PhoneIcon, LinkIcon } from "@/components/ds/Icon";
import { Share } from "@capacitor/share";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, ErrorState } from "@/components/account/States";
import { useAuthStore } from "@/lib/store/authStore";
import { accountApi } from "@/lib/api/account";
import { FareDisplay } from "@/components/ds";
import type { RiderReferral } from "@/lib/api/types";
import { BlurFade } from "@/components/ui/blur-fade";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BorderBeam } from "@/components/ui/border-beam";
import { WordRotate } from "@/components/ui/word-rotate";
import { TypingAnimation } from "@/components/ui/typing-animation";
import { HyperText } from "@/components/ui/hyper-text";
import { ShineBorder } from "@/components/ui/shine-border";
import { KineticText } from "@/components/ui/kinetic-text";

export default function ReferPage() {
  const rider = useAuthStore((s) => s.rider);
  const code = rider?.referral_code ?? "—";

  const [refs, setRefs] = useState<RiderReferral[] | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    setError(false);
    setRefs(null);
    accountApi.referral().then(setRefs).catch(() => setError(true));
  };
  useEffect(load, []);

  const shareUrl = `https://vahnly.app/r/${code}`;
  const message = `Join Vahnly with my code ${code} and we both earn ₹100! ${shareUrl}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const doShare = async (channel?: "whatsapp" | "sms") => {
    if (channel === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
      return;
    }
    if (channel === "sms") {
      window.open(`sms:?body=${encodeURIComponent(message)}`, "_blank");
      return;
    }
    try {
      await Share.share({ title: "Vahnly", text: message, url: shareUrl });
    } catch {
      try {
        await navigator.clipboard.writeText(message);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* ignore */
      }
    }
  };

  const stats = {
    pending: refs?.filter((r) => r.status === "PENDING").length ?? 0,
    joined: refs?.filter((r) => r.status === "JOINED").length ?? 0,
    rewarded: refs?.filter((r) => r.status === "REWARDED").length ?? 0,
  };
  const earned = (refs ?? [])
    .filter((r) => r.status === "REWARDED")
    .reduce((acc, r) => acc + r.reward_amount_paise, 0);

  return (
    <AccountScaffold title={<WordRotate words={["Refer & Earn", "Invite Friends", "Share & Get Rewarded"]} duration={3000} />}>
      {/* Code chip */}
      <BlurFade delay={0.1}>
        <div className="relative rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 p-5 text-center overflow-hidden">
          <BorderBeam size={100} duration={6} colorFrom="#ffffff" colorTo="rgba(255,255,255,0.1)" borderWidth={2} />
          <p className="text-xs text-white/80">Your referral code</p>
          <HyperText
            as="span"
            className="my-2 text-3xl font-bold tracking-[0.3em] text-content-primary"
            duration={1000}
            delay={300}
            animateOnHover={false}
            startOnView={false}
          >
            {`${code}`}
          </HyperText>
          <ShimmerButton
            type="button"
            onClick={copy}
            shimmerColor="rgba(255,255,255,0.4)"
            background="rgba(255,255,255,0.2)"
            borderRadius="12px"
            className="px-4 py-2 text-sm font-semibold"
          >
            {copied ? "Copied!" : "Copy Code"}
          </ShimmerButton>
        </div>
      </BlurFade>

      {/* Share row */}
      <BlurFade delay={0.15}>
        <div className="mt-4 grid grid-cols-4 gap-2">
          <ShareBtn icon={<ChatIcon size={22} />} label="WhatsApp" onClick={() => doShare("whatsapp")} />
          <ShareBtn icon={<PhoneIcon size={22} />} label="SMS" onClick={() => doShare("sms")} />
          <ShareBtn icon={<LinkIcon size={22} />} label="Copy" onClick={copy} />
          <ShareBtn icon="•••" label="More" onClick={() => doShare()} />
        </div>
      </BlurFade>

      {/* Stats */}
      <BlurFade delay={0.2}>
        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="Pending" value={stats.pending} />
          <Stat label="Joined" value={stats.joined} />
          <Stat label="Rewarded" value={stats.rewarded} />
        </div>
      </BlurFade>

      {/* Earnings */}
      <BlurFade delay={0.25}>
        <div className="mt-3 rounded-2xl bg-background-secondary p-4 text-center">
          <p className="text-xs text-content-secondary">Total earned</p>
          <FareDisplay amount={earned} size="lg" className="mt-1 block font-bold text-content-positive" />
        </div>
      </BlurFade>

      {/* Referral list */}
      <BlurFade delay={0.3}>
        <KineticText as="h2" text="Your Referrals" className="mb-3 mt-6 text-sm font-bold text-content-primary" />
      </BlurFade>
      {error ? (
        <ErrorState onRetry={load} />
      ) : refs === null ? (
        <SkeletonList rows={3} height="h-14" />
      ) : refs.length === 0 ? (
        <TypingAnimation className="py-8 text-center text-sm text-content-secondary block" duration={30} delay={400} startOnView={true}>
          No referrals yet. Share your code!
        </TypingAnimation>
      ) : (
        <div className="space-y-2">
          {refs.map((r) => (
            <BlurFade key={r.id} delay={0.1}>
              <ReferralItem code={r.referral_code} status={r.status} rewardPaise={r.reward_amount_paise} />
            </BlurFade>
          ))}
        </div>
      )}
    </AccountScaffold>
  );
}

function ReferralItem({
  code,
  status,
  rewardPaise,
}: {
  code: string;
  status: string;
  rewardPaise: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="group relative flex items-center gap-3 rounded-xl bg-background-secondary p-3 overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.01]"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && <ShineBorder borderWidth={1} duration={6} shineColor="#4A6FA5" />}
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-accent text-sm font-bold text-content-accent">
        {code.slice(0, 2)}
      </div>
      <div className="flex-1">
        <p className="text-sm text-content-primary">Referral {code}</p>
        <p className="text-xs text-content-secondary">{status}</p>
      </div>
      {rewardPaise > 0 && (
        <span className="text-sm font-semibold text-content-positive">
          +<FareDisplay amount={rewardPaise} size="sm" />
        </span>
      )}
    </div>
  );
}

function ShareBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-2xl bg-background-secondary py-3 active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
      <span className="text-xl">{icon}</span>
      <span className="text-[10px] text-content-secondary">{label}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-background-secondary p-3 text-center">
      <p className="text-lg font-bold text-content-primary">{value}</p>
      <p className="text-xs text-content-secondary">{label}</p>
    </div>
  );
}
