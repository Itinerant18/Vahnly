"use client";

import { useState } from "react";
import { useTripStore } from "@/lib/store/tripStore";

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width="12" height="12" viewBox="0 0 24 24" fill={n <= Math.round(rating) ? "#FF6B35" : "#1E1E1E"}>
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" stroke="#FF6B35" strokeWidth="1" />
        </svg>
      ))}
      <span className="ml-1 text-[10px] text-[#9CA3AF]">{rating.toFixed(1)}</span>
    </div>
  );
}

export function DriverCard({ onCall, onShare, onCancel }: {
  onCall?: () => void;
  onShare?: () => void;
  onCancel?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [chatToast, setChatToast] = useState(false);
  const eta = useTripStore((s) => s.driverETA);
  const status = useTripStore((s) => s.tripStatus);
  const driverInfo = useTripStore((s) => s.driverInfo);

  if (!status || status === "CREATED") return null;

  const etaLabel =
    status === "ARRIVED_AT_PICKUP" ? "Arrived" :
    status === "DELIVERING" ? "In trip" :
    eta != null ? `${eta} min` : "On the way";

  return (
    <div className="rounded-2xl bg-[#141414] ring-1 ring-white/10">
      {/* Collapsed strip — always visible */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 px-4 py-3"
      >
        {/* Avatar */}
        <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full bg-[#1E1E1E]">
          {driverInfo?.photo ? (
            <img src={driverInfo.photo} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-lg text-white">👤</div>
          )}
        </div>

        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-white">
            {driverInfo?.name ?? "Your driver"}
          </p>
          {driverInfo && <StarRating rating={driverInfo.rating} />}
        </div>

        {/* ETA pill */}
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          status === "ARRIVED_AT_PICKUP" ? "bg-[#22C55E]/20 text-[#22C55E]" :
          status === "DELIVERING" ? "bg-[#FF6B35]/20 text-[#FF6B35]" :
          "bg-[#3B82F6]/20 text-[#3B82F6]"
        }`}>
          {etaLabel}
        </span>

        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/6 px-4 pb-4">
          {/* Vehicle context */}
          {driverInfo?.vehicleContext && (
            <p className="py-2 text-xs text-[#9CA3AF]">{driverInfo.vehicleContext}</p>
          )}

          {/* Action icons */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={onCall}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-[#1E1E1E] py-3"
            >
              <span className="text-xl">📞</span>
              <span className="text-[10px] text-[#9CA3AF]">Call</span>
            </button>

            <button
              onClick={() => { setChatToast(true); setTimeout(() => setChatToast(false), 2000); }}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-[#1E1E1E] py-3"
            >
              <span className="text-xl">💬</span>
              <span className="text-[10px] text-[#9CA3AF]">Chat</span>
            </button>

            <button
              onClick={onShare}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-[#1E1E1E] py-3"
            >
              <span className="text-xl">📤</span>
              <span className="text-[10px] text-[#9CA3AF]">Share</span>
            </button>

            {(status === "ASSIGNED" || status === "EN_ROUTE_TO_PICKUP") && (
              <button
                onClick={onCancel}
                className="flex flex-1 flex-col items-center gap-1 rounded-xl bg-[#EF4444]/10 py-3"
              >
                <span className="text-xl">✕</span>
                <span className="text-[10px] text-[#EF4444]">Cancel</span>
              </button>
            )}
          </div>
        </div>
      )}

      {chatToast && (
        <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg bg-[#1E1E1E] px-3 py-2 text-xs text-[#9CA3AF]">
          Chat coming soon
        </div>
      )}
    </div>
  );
}
