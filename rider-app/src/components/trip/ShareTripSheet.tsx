"use client";

import { useTripStore } from "@/lib/store/tripStore";

interface ShareTripSheetProps {
  onClose: () => void;
}

export function ShareTripSheet({ onClose }: ShareTripSheetProps) {
  const activeOrder = useTripStore((s) => s.activeOrder);
  const shareToken = activeOrder?.trip_share_token;
  const shareUrl = shareToken
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${shareToken}`
    : "";

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {}
    onClose();
  };

  const shareNative = async (target?: "whatsapp" | "sms") => {
    if (!shareUrl) return;
    const text = `Track my trip: ${shareUrl}`;
    if (target === "whatsapp") {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
    } else if (target === "sms") {
      window.open(`sms:?body=${encodeURIComponent(text)}`, "_blank");
    } else if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Track my trip", url: shareUrl });
      } catch {}
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-[#141414] p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h3 className="mb-1 text-base font-semibold text-white">Share Trip</h3>
        {shareUrl && (
          <p className="mb-4 truncate rounded-xl bg-[#1E1E1E] px-3 py-2 text-xs text-[#9CA3AF]">
            {shareUrl}
          </p>
        )}
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => shareNative("whatsapp")}
            className="flex flex-col items-center gap-2 rounded-xl bg-[#1E1E1E] py-4"
          >
            <span className="text-2xl">💬</span>
            <span className="text-[11px] text-[#9CA3AF]">WhatsApp</span>
          </button>
          <button
            onClick={() => shareNative("sms")}
            className="flex flex-col items-center gap-2 rounded-xl bg-[#1E1E1E] py-4"
          >
            <span className="text-2xl">📱</span>
            <span className="text-[11px] text-[#9CA3AF]">SMS</span>
          </button>
          <button
            onClick={copyLink}
            className="flex flex-col items-center gap-2 rounded-xl bg-[#1E1E1E] py-4"
          >
            <span className="text-2xl">🔗</span>
            <span className="text-[11px] text-[#9CA3AF]">Copy Link</span>
          </button>
        </div>
        <div className="h-6" />
      </div>
    </div>
  );
}
