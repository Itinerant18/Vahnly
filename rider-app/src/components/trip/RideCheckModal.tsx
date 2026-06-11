"use client";

import { useEffect, useState } from "react";

interface RideCheckModalProps {
  message: string;
  onOk: () => void;
  onSOS: () => void;
}

export function RideCheckModal({ message, onOk, onSOS }: RideCheckModalProps) {
  const [secs, setSecs] = useState(60);

  useEffect(() => {
    if (secs === 0) { onSOS(); return; }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs, onSOS]);

  const pct = secs / 60;
  const r = 20;
  const circ = 2 * Math.PI * r;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/70">
      <div className="w-full rounded-t-3xl bg-[#141414] p-6">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Everything OK?</h2>
            <p className="mt-1 text-sm text-[#9CA3AF]">{message}</p>
          </div>
          {/* Countdown ring */}
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r={r} fill="none" stroke="#1E1E1E" strokeWidth="4" />
            <circle
              cx="26" cy="26" r={r}
              fill="none"
              stroke={secs <= 10 ? "#EF4444" : "#FF6B35"}
              strokeWidth="4"
              strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`}
              strokeLinecap="round"
              transform="rotate(-90 26 26)"
              style={{ transition: "stroke-dasharray 0.5s linear" }}
            />
            <text x="26" y="31" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">
              {secs}
            </text>
          </svg>
        </div>

        <p className="mb-5 text-xs text-[#9CA3AF]">
          Auto-SOS activates in {secs}s if no response
        </p>

        <div className="flex gap-3">
          <button
            onClick={onOk}
            className="flex-1 rounded-xl bg-[#22C55E]/10 py-4 text-sm font-bold text-[#22C55E] ring-1 ring-[#22C55E]/30"
          >
            Yes, I&apos;m fine ✓
          </button>
          <button
            onClick={onSOS}
            className="flex-1 rounded-xl bg-[#EF4444]/10 py-4 text-sm font-bold text-[#EF4444] ring-1 ring-[#EF4444]/30"
          >
            No, I need help 🆘
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}
