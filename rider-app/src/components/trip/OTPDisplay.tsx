"use client";

import { useTripStore } from "@/lib/store/tripStore";

export function OTPDisplay() {
  const status = useTripStore((s) => s.tripStatus);
  const otp = useTripStore((s) => s.otp);
  const show = status === "ARRIVED_AT_PICKUP";
  if (!show) return null;

  const digits = (otp ?? "----").padEnd(4, "-").slice(0, 4).split("");

  const copyAll = async () => {
    if (!otp) return;
    try {
      await navigator.clipboard.writeText(otp);
    } catch {
      // Capacitor clipboard fallback — already handled natively
    }
  };

  return (
    <div className="rounded-2xl bg-[#141414] p-4 ring-1 ring-[#22C55E]/30 text-center">
      <p className="text-xs font-medium text-[#22C55E]">Share this code with your driver</p>
      <div className="my-3 flex justify-center gap-3">
        {digits.map((d, i) => (
          <span
            key={i}
            // spec: unselectable individually
            style={{ userSelect: "none", WebkitUserSelect: "none" }}
            className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#1E1E1E] text-2xl font-bold tracking-widest text-white ring-1 ring-white/10"
          >
            {d}
          </span>
        ))}
      </div>
      <button
        onClick={copyAll}
        className="flex items-center gap-1.5 mx-auto rounded-lg bg-[#22C55E]/10 px-4 py-2 text-xs font-semibold text-[#22C55E]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="13" height="13" rx="2" stroke="#22C55E" strokeWidth="1.5" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="#22C55E" strokeWidth="1.5" />
        </svg>
        Copy OTP
      </button>
    </div>
  );
}
