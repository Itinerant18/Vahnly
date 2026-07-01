"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTripStore } from "@/lib/store/tripStore";
import { ordersApi } from "@/lib/api/orders";
import { useToastStore } from "@/lib/store/useToastStore";
import { friendlyError } from "@/lib/ui/errorMessage";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { BlurFade } from "@/components/ui/blur-fade";

const POSITIVE_TAGS = ["Polite", "Safe Driving", "Knew Routes", "Punctual", "Clean & Neat"];
const NEGATIVE_TAGS = ["Rash Driving", "Late", "Rude", "Wrong Route", "Car Damaged"];
const TIP_OPTIONS = [0, 2000, 5000, 10000]; // paise

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex gap-2">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          aria-label={`Rate ${s} star${s === 1 ? "" : "s"}`}
          className="h-12 w-12 text-4xl transition-transform active:scale-90"
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(s)}
        >
          <span className={(hover || value) >= s ? "text-content-accent" : "text-content-tertiary"}>★</span>
        </button>
      ))}
    </div>
  );
}

export default function RatePage() {
  const router = useRouter();
  const completedFare = useTripStore((s) => s.completedFare);
  const activeOrder = useTripStore((s) => s.activeOrder);

  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [tip, setTip] = useState(0);
  const [customTip, setCustomTip] = useState("");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(false);

  const orderId = completedFare?.orderId ?? activeOrder?.id ?? "";
  const allTags = stars >= 4 ? POSITIVE_TAGS : stars > 0 ? NEGATIVE_TAGS : [...POSITIVE_TAGS, ...NEGATIVE_TAGS];

  const toggleTag = (tag: string) => {
    setTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  };

  const tipPaise = customTip ? Math.round(parseFloat(customTip) * 100) : tip;

  const handleSubmit = async () => {
    if (submitting || !orderId || stars === 0) return;
    setSubmitting(true);
    try {
      await ordersApi.rate(orderId, {
        rating: stars,
        tags: Array.from(tags),
        comment,
        tip_paise: tipPaise,
      });
      setToast(true);
      setTimeout(() => router.replace("/home"), 1500);
    } catch (e) {
      useToastStore.getState().show(friendlyError(e), "error");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-4 pt-12">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-background-secondary active:scale-90 transition-transform"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-content-primary">Rate Your Driver</h1>
        </div>
        <button
          onClick={() => router.replace("/home")}
          className="min-h-[44px] flex items-center px-3 text-sm font-medium text-content-secondary"
        >
          Skip
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">
        {/* Stars */}
        <BlurFade delay={0.1} offset={8} className="flex flex-col items-center gap-3 rounded-2xl bg-background-secondary py-6">
          <StarRating value={stars} onChange={setStars} />
          <p className="text-sm text-content-secondary">
            {stars === 0 && "Tap to rate"}
            {stars === 1 && "Very poor"}
            {stars === 2 && "Poor"}
            {stars === 3 && "Okay"}
            {stars === 4 && "Good"}
            {stars === 5 && "Excellent!"}
          </p>
        </BlurFade>

        {/* Tags */}
        {stars > 0 && (
          <BlurFade delay={0.15} offset={8} className="rounded-2xl bg-background-secondary p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">
              {stars >= 4 ? "What went well?" : "What went wrong?"}
            </p>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${tags.has(tag)
                      ? "bg-accent-400 text-white"
                      : "bg-background-tertiary text-content-secondary ring-1 ring-border-opaque"
                    }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </BlurFade>
        )}

        {/* Tip */}
        <div className="rounded-2xl bg-background-secondary p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">Add a Tip</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {TIP_OPTIONS.map((t) => (
              <button
                key={t}
                onClick={() => { setTip(t); setCustomTip(""); }}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${tip === t && !customTip
                    ? "bg-accent-400 text-white"
                    : "bg-background-tertiary text-content-secondary ring-1 ring-border-opaque"
                  }`}
              >
                {t === 0 ? "No tip" : formatCurrency(t)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-background-tertiary px-3 ring-1 ring-border-opaque">
            <span className="text-sm text-content-secondary">₹</span>
            <input
              type="number"
              min="0"
              placeholder="Custom amount"
              value={customTip}
              onChange={(e) => { setCustomTip(e.target.value); setTip(0); }}
              className="flex-1 bg-transparent py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary"
            />
          </div>
        </div>

        {/* Comment */}
        <div className="rounded-2xl bg-background-secondary p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-content-secondary">Comments</p>
          <textarea
            maxLength={500}
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Anything else to share? (optional)"
            className="w-full resize-none bg-transparent text-sm text-content-primary outline-none placeholder:text-content-tertiary"
          />
          <p className="mt-1 text-right text-xs text-content-tertiary">{comment.length}/500</p>
        </div>
      </div>

      {/* Submit */}
      <div className="px-4 pb-8">
        <ShimmerButton
          type="button"
          onClick={handleSubmit}
          disabled={submitting || stars === 0}
          shimmerColor="rgba(255,255,255,0.3)"
          background="#1a1a1a"
          borderRadius="16px"
          className="w-full py-4 text-base font-bold shadow-elevation-2 disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Submit Rating"}
        </ShimmerButton>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className="fixed inset-x-4 top-16 z-50 rounded-2xl bg-positive-400 px-4 py-3 text-center text-sm font-semibold text-white shadow-lg animate-fade-in-up"
          role="status"
          aria-live="polite"
        >
          Thanks for your feedback!
        </div>
      )}
    </div>
  );
}
