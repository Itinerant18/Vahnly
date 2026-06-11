"use client";

import { useEffect, useState } from "react";
import { Share } from "@capacitor/share";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, ErrorState } from "@/components/account/States";
import { useAuthStore } from "@/lib/store/authStore";
import { accountApi } from "@/lib/api/account";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { RiderReferral } from "@/lib/api/types";

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

  const shareUrl = `https://driversforu.app/r/${code}`;
  const message = `Join Drivers-for-U with my code ${code} and we both earn ₹100! ${shareUrl}`;

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
      await Share.share({ title: "Drivers-for-U", text: message, url: shareUrl });
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
    <AccountScaffold title="Refer & Earn">
      {/* Code chip */}
      <div className="rounded-2xl bg-gradient-to-br from-[#FF6B35] to-[#E04A1F] p-5 text-center">
        <p className="text-xs text-white/80">Your referral code</p>
        <p className="my-2 text-3xl font-bold tracking-[0.3em] text-white">{code}</p>
        <button
          onClick={copy}
          className="rounded-xl bg-white/20 px-4 py-2 text-sm font-semibold text-white"
        >
          {copied ? "Copied!" : "Copy Code"}
        </button>
      </div>

      {/* Share row */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <ShareBtn icon="💬" label="WhatsApp" onClick={() => doShare("whatsapp")} />
        <ShareBtn icon="📱" label="SMS" onClick={() => doShare("sms")} />
        <ShareBtn icon="🔗" label="Copy" onClick={copy} />
        <ShareBtn icon="•••" label="More" onClick={() => doShare()} />
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Pending" value={stats.pending} />
        <Stat label="Joined" value={stats.joined} />
        <Stat label="Rewarded" value={stats.rewarded} />
      </div>

      {/* Earnings */}
      <div className="mt-3 rounded-2xl bg-[#141414] p-4 text-center">
        <p className="text-xs text-[#9CA3AF]">Total earned</p>
        <p className="mt-1 text-2xl font-bold text-[#22C55E]">{formatCurrency(earned)}</p>
      </div>

      {/* Referral list */}
      <h2 className="mb-3 mt-6 text-sm font-bold text-white">Your Referrals</h2>
      {error ? (
        <ErrorState onRetry={load} />
      ) : refs === null ? (
        <SkeletonList rows={3} height="h-14" />
      ) : refs.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#9CA3AF]">No referrals yet. Share your code!</p>
      ) : (
        <div className="space-y-2">
          {refs.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl bg-[#141414] p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FF6B35]/20 text-sm font-bold text-[#FF6B35]">
                {r.referral_code.slice(0, 2)}
              </div>
              <div className="flex-1">
                <p className="text-sm text-white">Referral {r.referral_code}</p>
                <p className="text-xs text-[#9CA3AF]">{r.status}</p>
              </div>
              {r.reward_amount_paise > 0 && (
                <span className="text-sm font-semibold text-[#22C55E]">
                  +{formatCurrency(r.reward_amount_paise)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </AccountScaffold>
  );
}

function ShareBtn({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-2xl bg-[#141414] py-3">
      <span className="text-xl">{icon}</span>
      <span className="text-[10px] text-[#9CA3AF]">{label}</span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[#141414] p-3 text-center">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs text-[#9CA3AF]">{label}</p>
    </div>
  );
}
