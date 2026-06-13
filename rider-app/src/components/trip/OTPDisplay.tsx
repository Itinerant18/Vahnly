"use client";

import { useTripStore } from "@/lib/store/tripStore";

export function OTPDisplay() {
  const status = useTripStore((s) => s.tripStatus);
  const otp    = useTripStore((s) => s.otp);
  const show   = status === "ARRIVED_AT_PICKUP";
  if (!show) return null;

  const digits = (otp ?? "----").padEnd(4, "-").slice(0, 4).split("");

  const copyAll = async () => {
    if (!otp) return;
    try {
      await navigator.clipboard.writeText(otp);
    } catch {
      // Capacitor clipboard fallback — handled natively
    }
  };

  return (
    <div className="rounded-md bg-background-primary border border-positive-400/30 p-4 text-center shadow-elevation-1">
      <p className="text-label-medium text-content-positive mb-1">
        Share this code with your driver
      </p>
      <p className="text-paragraph-small text-content-secondary mb-3">
        to start the trip
      </p>

      {/* 4 large digit boxes */}
      <div className="flex justify-center gap-3 mb-4">
        {digits.map((d, i) => (
          <span
            key={i}
            style={{ userSelect: "none", WebkitUserSelect: "none" }}
            className="flex h-20 w-16 items-center justify-center rounded-md
              bg-background-secondary border border-border-opaque
              font-mono text-display-large text-content-primary"
          >
            {d}
          </span>
        ))}
      </div>

      {/* Copy button */}
      <button
        type="button"
        onClick={copyAll}
        className="inline-flex items-center gap-1.5 rounded-sm
          bg-background-secondary border border-border-opaque
          px-4 py-2 text-label-small text-content-secondary
          hover:bg-background-tertiary transition-base cursor-pointer
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        Copy OTP
      </button>
    </div>
  );
}
