"use client";

import { useState } from "react";
import { useTripStore } from "@/lib/store/tripStore";
import { BorderBeam } from "@/components/ui/border-beam";

import { PhoneIcon, ChatIcon, ShareIcon, UserIcon, CrossIcon } from "@/components/ds/Icon";

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill={n <= Math.round(rating) ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1"
          className={n <= Math.round(rating) ? "text-content-warning" : "text-border-opaque"}
        >
          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
        </svg>
      ))}
      <span className="ml-1 font-mono text-mono-small text-content-secondary tabular-nums">
        {rating.toFixed(1)}
      </span>
    </div>
  );
}

export function DriverCard({
  onCall,
  onShare,
  onCancel,
}: {
  onCall?: () => void;
  onShare?: () => void;
  onCancel?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [chatToast, setChatToast] = useState(false);
  const eta        = useTripStore((s) => s.driverETA);
  const status     = useTripStore((s) => s.tripStatus);
  const driverInfo = useTripStore((s) => s.driverInfo);

  if (!status || status === "CREATED") return null;

  const etaLabel =
    status === "ARRIVED_AT_PICKUP" ? "Arrived" :
    status === "DELIVERING"        ? "In trip"  :
    eta != null                    ? `${eta} min` : "On the way";

  const etaBadgeCls =
    status === "ARRIVED_AT_PICKUP" ? "badge badge-positive" :
    status === "DELIVERING"        ? "badge badge-accent"   :
                                     "badge badge-accent";

  return (
    <div className="relative rounded-md bg-background-primary border border-border-opaque shadow-elevation-2 overflow-hidden">
      <BorderBeam size={80} duration={8} colorFrom="#22c55e" colorTo="rgba(34,197,94,0.1)" borderWidth={1.5} delay={2} />
      {/* Collapsed strip */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-3 px-4 py-3 min-h-[56px]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 rounded-md"
      >
        {/* Avatar with pulse ring */}
        <div className="relative h-10 w-10 flex-shrink-0">
          <div className="absolute inset-0 rounded-pill bg-positive-400/30 animate-ping" />
          <div className="relative h-full w-full overflow-hidden rounded-pill bg-background-secondary border-2 border-positive-400">
            {driverInfo?.photo ? (
              <img src={driverInfo.photo} alt={driverInfo.name ?? "Driver"} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-content-secondary select-none">
                <UserIcon size={32} className="text-content-secondary" />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 text-left">
          <p className="text-label-medium text-content-primary">
            {driverInfo?.name ?? "Your driver"}
          </p>
          {driverInfo && <StarRating rating={driverInfo.rating} />}
        </div>

        <span className={etaBadgeCls}>{etaLabel}</span>

        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          className={`transition-transform text-content-tertiary ${expanded ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {/* Expanded details — spring reveal */}
      {expanded && (
        <div
          className="border-t border-border-opaque px-4 pb-4"
          style={{
            animation: "enterUp 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
        >
          {driverInfo?.vehicleContext && (
            <p className="py-2 text-paragraph-small text-content-secondary">
              {driverInfo.vehicleContext}
            </p>
          )}

          {/* Action grid */}
          <div className="flex gap-3 pt-2">
            {[
              { icon: <PhoneIcon size={20} />, label: "Call", onClick: onCall },
              {
                icon: <ChatIcon size={20} />,
                label: "Chat",
                onClick: () => {
                  setChatToast(true);
                  setTimeout(() => setChatToast(false), 2000);
                },
              },
              { icon: <ShareIcon size={20} />, label: "Share", onClick: onShare },
            ].map(({ icon, label, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-sm
                  bg-background-secondary border border-border-opaque py-3 min-h-[56px]
                  hover:bg-background-tertiary cursor-pointer
                  transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]
                  active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              >
                {icon}
                <span className="text-label-small text-content-secondary">{label}</span>
              </button>
            ))}

            {(status === "ASSIGNED" || status === "EN_ROUTE_TO_PICKUP") && (
              <button
                type="button"
                onClick={onCancel}
                className="flex flex-1 flex-col items-center gap-1.5 rounded-sm
                  bg-surface-negative border border-negative-200 py-3 min-h-[56px]
                  hover:opacity-80 transition-base cursor-pointer
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative-400"
              >
                <CrossIcon size={20} />
                <span className="text-label-small text-content-negative">Cancel</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Chat toast */}
      {chatToast && (
        <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-sm
          bg-background-secondary border border-border-opaque px-3 py-2 shadow-elevation-2">
          <p className="text-label-small text-content-secondary whitespace-nowrap">Chat coming soon</p>
        </div>
      )}
    </div>
  );
}
