"use client";

import React, { useState, useEffect } from "react";
import { useSafetyStore } from "@/store/useSafetyStore";

export const SosModal: React.FC = () => {
  const { isEmergencyActive, shareLink, cancelSOS } = useSafetyStore();
  const [countdown, setCountdown] = useState(5);
  const [isConfirmed, setIsConfirmed] = useState(false);

  useEffect(() => {
    if (!isEmergencyActive) {
      setCountdown(5);
      setIsConfirmed(false);
      return;
    }

    if (countdown > 0 && !isConfirmed) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }

    if (countdown === 0 && !isConfirmed) {
      setIsConfirmed(true);
    }
  }, [isEmergencyActive, countdown, isConfirmed]);

  if (!isEmergencyActive) return null;

  return (
    <div className="fixed inset-0 z-[1000000] flex items-center justify-center bg-red-950/90 backdrop-blur-md p-6 text-white text-center font-mono">
      <div className="max-w-sm w-full bg-zinc-950 border border-red-900 rounded-2xl p-6 shadow-2xl space-y-6">
        <div className="h-20 w-20 bg-red-950/40 border border-red-800 rounded-full flex items-center justify-center text-4xl font-black mx-auto animate-pulse shadow-lg">
          🚨
        </div>

        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-red-500">Emergency Protocol</h2>
          <p className="text-[10px] text-zinc-400">
            {!isConfirmed 
              ? `Broadcasting vehicle coordinates to control room in ${countdown}s...` 
              : "Live monitoring active. Support team and nearest dispatch mesh alerted."}
          </p>
        </div>

        {isConfirmed && shareLink && (
          <div className="bg-zinc-900/40 p-3 rounded-lg border border-red-950 text-left space-y-1">
            <span className="text-[8px] uppercase font-bold text-red-400">Live Tracking Link</span>
            <p className="text-[10px] font-mono select-all truncate bg-black p-2 rounded border border-zinc-900">{shareLink}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={cancelSOS}
            className="w-full bg-white text-black py-3 rounded-xl font-bold text-[10px] tracking-wider uppercase shadow hover:bg-zinc-200 active:scale-95 transition-all cursor-pointer"
          >
            {!isConfirmed ? "CANCEL DISPATCH" : "FALSE ALARM (RESOLVE)"}
          </button>
        </div>
      </div>
    </div>
  );
};
