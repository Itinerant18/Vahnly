"use client";

import { useState } from "react";
import { useTripStore } from "@/lib/store/tripStore";

interface SOSModalProps {
  onClose: () => void;
}

export function SOSModal({ onClose }: SOSModalProps) {
  const [phase, setPhase] = useState<"confirm" | "active">("confirm");
  const [loading, setLoading] = useState(false);
  const triggerSOS = useTripStore((s) => s.triggerSOS);

  const activate = async () => {
    setLoading(true);
    try {
      await triggerSOS();
      setPhase("active");
    } finally {
      setLoading(false);
    }
  };

  if (phase === "active") {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#EF4444]/20 backdrop-blur-sm">
        <div className="mx-6 w-full max-w-sm rounded-2xl bg-[#141414] p-6 ring-2 ring-[#EF4444]">
          <div className="mb-4 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#EF4444]/20 ring-2 ring-[#EF4444] animate-pulse">
              <span className="text-3xl">🆘</span>
            </div>
          </div>
          <h2 className="text-center text-lg font-bold text-[#EF4444]">SOS Activated</h2>
          <p className="mt-2 text-center text-sm text-[#9CA3AF]">
            Help is on the way. Your emergency contacts and our support team have been alerted.
          </p>
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-xl bg-[#1E1E1E] py-3 text-sm font-medium text-[#9CA3AF]"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-[#141414] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-5 mt-3 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EF4444]/20">
            <span className="text-2xl">🆘</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Activate SOS?</h2>
            <p className="text-xs text-[#9CA3AF]">This cannot be undone</p>
          </div>
        </div>
        <p className="mb-5 text-sm text-[#9CA3AF]">
          This will immediately alert your emergency contacts and our 24/7 support team with your current location.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-[#1E1E1E] py-3.5 text-sm font-medium text-[#9CA3AF]"
          >
            Cancel
          </button>
          <button
            onClick={activate}
            disabled={loading}
            className="flex-1 rounded-xl bg-[#EF4444] py-3.5 text-sm font-bold text-white shadow-lg shadow-[#EF4444]/20 disabled:opacity-60"
          >
            {loading ? "Activating…" : "Activate SOS"}
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}
