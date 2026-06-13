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
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface-negative backdrop-blur-sm">
        <div className="mx-6 w-full max-w-sm rounded-2xl bg-background-secondary p-6 ring-2 ring-negative-400">
          <div className="mb-4 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-negative ring-2 ring-negative-400 animate-pulse">
              <span className="text-3xl">🆘</span>
            </div>
          </div>
          <h2 className="text-center text-lg font-bold text-content-negative">SOS Activated</h2>
          <p className="mt-2 text-center text-sm text-content-secondary">
            Help is on the way. Your emergency contacts and our support team have been alerted.
          </p>
          <button
            onClick={onClose}
            className="mt-4 w-full rounded-xl bg-background-tertiary py-3 text-sm font-medium text-content-secondary"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-background-secondary p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-white/20" />
        <div className="mb-5 mt-3 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-negative">
            <span className="text-2xl">🆘</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-content-primary">Activate SOS?</h2>
            <p className="text-xs text-content-secondary">This cannot be undone</p>
          </div>
        </div>
        <p className="mb-5 text-sm text-content-secondary">
          This will immediately alert your emergency contacts and our 24/7 support team with your current location.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-background-tertiary py-3.5 text-sm font-medium text-content-secondary"
          >
            Cancel
          </button>
          <button
            onClick={activate}
            disabled={loading}
            className="flex-1 rounded-xl bg-negative-400 py-3.5 text-sm font-bold text-content-primary shadow-elevation-2 disabled:opacity-60"
          >
            {loading ? "Activating…" : "Activate SOS"}
          </button>
        </div>
        <div className="h-4" />
      </div>
    </div>
  );
}
