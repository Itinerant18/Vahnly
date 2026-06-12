"use client";

import { useCallback, useEffect, useState } from "react";

import { AccountScaffold } from "@/components/account/AccountScaffold";
import { EmptyState, SkeletonList } from "@/components/account/States";
import { insuranceApi, type FileClaimInput } from "@/lib/api/insurance";
import { ordersApi } from "@/lib/api/orders";
import type { InsuranceClaim, Order } from "@/lib/api/types";

type ClaimType = FileClaimInput["claim_type"];

const CLAIM_TYPE_OPTIONS: { value: ClaimType; label: string }[] = [
  { value: "ACCIDENT", label: "Accident" },
  { value: "PROPERTY_DAMAGE", label: "Property Damage" },
  { value: "OTHER", label: "Other" },
];

const STATUS_CHIP: Record<InsuranceClaim["status"], { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-[#FF6B35]/10 text-[#FF6B35]" },
  UNDER_REVIEW: { label: "Under review", className: "bg-[#F59E0B]/10 text-[#F59E0B]" },
  APPROVED: { label: "Approved", className: "bg-[#22C55E]/10 text-[#22C55E]" },
  REJECTED: { label: "Rejected", className: "bg-[#EF4444]/10 text-[#EF4444]" },
};

const MAX_PHOTOS = 3;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function StatusChip({ status }: { status: InsuranceClaim["status"] }) {
  const chip = STATUS_CHIP[status];
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${chip.className}`}>
      {chip.label}
    </span>
  );
}

function ClaimCard({ claim }: { claim: InsuranceClaim }) {
  return (
    <div className="rounded-2xl bg-[#141414] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">{formatDate(claim.created_at)}</p>
          <p className="mt-0.5 text-xs text-[#6B7280]">Trip #{claim.order_id.slice(0, 8)}</p>
        </div>
        <StatusChip status={claim.status} />
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-[#9CA3AF]">{claim.description}</p>
      {typeof claim.amount_paise === "number" && (
        <p className="mt-2 text-sm font-semibold text-white">{formatPaise(claim.amount_paise)}</p>
      )}
    </div>
  );
}

function FileClaimSheet({
  onClose,
  onFiled,
}: {
  onClose: () => void;
  onFiled: (claim: InsuranceClaim) => void;
}) {
  const [trips, setTrips] = useState<Order[]>([]);
  const [tripsLoading, setTripsLoading] = useState(true);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [claimType, setClaimType] = useState<ClaimType | null>(null);
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ordersApi.history({ status: "COMPLETED", limit: 20 });
        if (!cancelled) setTrips(res.orders ?? []);
      } catch {
        if (!cancelled) setTrips([]);
      } finally {
        if (!cancelled) setTripsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePhotos(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return;
    const picked = Array.from(fileList).slice(0, room);
    try {
      const urls = await Promise.all(picked.map(readFileAsDataUrl));
      setPhotos((prev) => [...prev, ...urls.filter(Boolean)].slice(0, MAX_PHOTOS));
    } catch {
      setError("Could not read one of the photos. Please try again.");
    }
  }

  const canSubmit =
    !!orderId && !!claimType && description.trim().length >= 10 && !submitting;

  async function handleSubmit() {
    if (!orderId || !claimType) return;
    setSubmitting(true);
    setError(null);
    try {
      const claim = await insuranceApi.fileClaim({
        order_id: orderId,
        claim_type: claimType,
        description: description.trim(),
        photos,
      });
      onFiled(claim);
    } catch {
      setError("We couldn't file your claim right now. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div className="relative max-h-[90vh] overflow-y-auto rounded-t-3xl bg-[#141414] p-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">File a Claim</h2>
          <button onClick={onClose} className="text-sm font-semibold text-[#9CA3AF]">
            Cancel
          </button>
        </div>

        <h3 className="text-sm font-bold text-white mb-3">Select trip</h3>
        {tripsLoading ? (
          <SkeletonList rows={2} height="h-14" />
        ) : trips.length === 0 ? (
          <p className="rounded-xl bg-[#1E1E1E] p-3 text-sm text-[#9CA3AF]">
            No completed trips found.
          </p>
        ) : (
          <div className="space-y-2">
            {trips.map((t) => {
              const selected = orderId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setOrderId(t.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left ${
                    selected ? "bg-[#FF6B35]/10 ring-1 ring-[#FF6B35]" : "bg-[#1E1E1E]"
                  }`}
                >
                  <span className="text-sm font-medium text-white">#{t.id.slice(0, 8)}</span>
                  <span className="text-xs text-[#9CA3AF]">{formatDate(t.created_at)}</span>
                </button>
              );
            })}
          </div>
        )}

        <h3 className="mt-5 text-sm font-bold text-white mb-3">Claim type</h3>
        <div className="flex flex-wrap gap-2">
          {CLAIM_TYPE_OPTIONS.map((opt) => {
            const selected = claimType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setClaimType(opt.value)}
                className={`rounded-xl px-4 py-2 text-sm font-medium ${
                  selected
                    ? "bg-[#FF6B35] text-white"
                    : "bg-[#1E1E1E] text-[#D1D5DB]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <h3 className="mt-5 text-sm font-bold text-white mb-3">Description</h3>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Tell us what happened (min 10 characters)…"
          className="w-full resize-none rounded-xl bg-[#1E1E1E] p-3 text-sm text-white placeholder:text-[#6B7280] focus:outline-none focus:ring-1 focus:ring-[#FF6B35]"
        />

        <div className="mt-5 mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Photos</h3>
          <span className="text-xs text-[#9CA3AF]">{photos.length}/{MAX_PHOTOS}</span>
        </div>
        {photos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {photos.map((src, i) => (
              <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl bg-[#1E1E1E]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {photos.length < MAX_PHOTOS && (
          <label className="flex cursor-pointer items-center justify-center rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm font-medium text-[#9CA3AF]">
            + Add photos
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void handlePhotos(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}

        {error && <p className="mt-4 text-sm font-medium text-[#EF4444]">{error}</p>}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="mt-5 w-full rounded-xl bg-[#FF6B35] py-3.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Submit claim"}
        </button>
      </div>
    </div>
  );
}

export default function InsurancePage() {
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await insuranceApi.listClaims();
      setClaims(Array.isArray(res) ? res : []);
    } catch {
      setFailed(true);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  function handleFiled(claim: InsuranceClaim) {
    setClaims((prev) => [claim, ...prev]);
    setFailed(false);
    setSheetOpen(false);
  }

  const showEmpty = !loading && (failed || claims.length === 0);

  return (
    <AccountScaffold title="Insurance & Care">
      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-bold text-white mb-3">D4M Care</h2>
          <div className="rounded-2xl bg-[#141414] p-4">
            <p className="text-sm text-[#9CA3AF]">
              Per-trip opt-in is <span className="font-semibold text-white">₹49</span> at booking.
            </p>
            <p className="mt-3 rounded-xl bg-[#FF6B35]/10 px-4 py-3 text-sm font-semibold text-[#FF6B35]">
              Your next trip is covered with D4M Care when you toggle it at booking.
            </p>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[#1E1E1E] px-4 py-3 opacity-60">
              <span className="text-sm font-medium text-[#9CA3AF]">Monthly plan</span>
              <span className="text-xs font-medium text-[#6B7280]">Coming soon</span>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Past claims</h2>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="rounded-xl bg-[#FF6B35] px-4 py-2 text-sm font-bold text-white"
            >
              File a Claim
            </button>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : showEmpty ? (
            <EmptyState
              icon="🛡️"
              title="No claims yet"
              message="File a claim for a covered trip and track its status here."
            />
          ) : (
            <div className="space-y-3">
              {claims.map((c) => (
                <ClaimCard key={c.id} claim={c} />
              ))}
            </div>
          )}
        </section>
      </div>

      {sheetOpen && (
        <FileClaimSheet onClose={() => setSheetOpen(false)} onFiled={handleFiled} />
      )}
    </AccountScaffold>
  );
}
