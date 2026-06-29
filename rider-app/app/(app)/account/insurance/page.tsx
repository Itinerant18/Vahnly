"use client";

import { useCallback, useEffect, useState } from "react";

import { AccountScaffold } from "@/components/account/AccountScaffold";
import { EmptyState, SkeletonList } from "@/components/account/States";
import { ShieldIcon } from "@/components/ds/Icon";
import { insuranceApi, type FileClaimInput } from "@/lib/api/insurance";
import { ordersApi } from "@/lib/api/orders";
import type { InsuranceClaim, InsuranceCoverage, Order } from "@/lib/api/types";
import { formatRupeesWhole } from "@/lib/utils/formatCurrency";

type ClaimType = FileClaimInput["claim_type"];

const CLAIM_TYPE_OPTIONS: { value: ClaimType; label: string }[] = [
  { value: "ACCIDENT", label: "Accident" },
  { value: "PROPERTY_DAMAGE", label: "Property Damage" },
  { value: "OTHER", label: "Other" },
];

const STATUS_CHIP: Record<InsuranceClaim["status"], { label: string; className: string }> = {
  OPEN: { label: "Open", className: "bg-surface-accent text-content-accent" },
  UNDER_REVIEW: { label: "Under review", className: "bg-surface-warning text-content-warning" },
  APPROVED: { label: "Approved", className: "bg-surface-positive text-content-positive" },
  REJECTED: { label: "Rejected", className: "bg-surface-negative text-content-negative" },
};

const MAX_PHOTOS = 3;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
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
    <div className="rounded-2xl bg-background-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-content-primary">{formatDate(claim.created_at)}</p>
          <p className="mt-0.5 text-xs text-content-tertiary">Trip #{claim.order_id.slice(0, 8)}</p>
        </div>
        <StatusChip status={claim.status} />
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-content-secondary">{claim.description}</p>
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
  const [coverage, setCoverage] = useState<InsuranceCoverage | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
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

  useEffect(() => {
    if (!orderId) {
      setCoverage(null);
      return;
    }
    let cancelled = false;
    setCoverageLoading(true);
    (async () => {
      try {
        const res = await insuranceApi.coverage(orderId);
        if (!cancelled) setCoverage(res);
      } catch {
        if (!cancelled) setCoverage(null);
      } finally {
        if (!cancelled) setCoverageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

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
        photos: photos.length > 0 ? photos : undefined,
      });
      onFiled(claim);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't file your claim right now. Please try again.");
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
      <div className="relative max-h-[90vh] overflow-y-auto rounded-t-3xl bg-background-secondary p-5">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-content-primary">File a Claim</h2>
          <button onClick={onClose} className="text-sm font-semibold text-content-secondary">
            Cancel
          </button>
        </div>

        <h3 className="text-sm font-bold text-content-primary mb-3">Select trip</h3>
        {tripsLoading ? (
          <SkeletonList rows={2} height="h-14" />
        ) : trips.length === 0 ? (
          <p className="rounded-xl bg-background-tertiary p-3 text-sm text-content-secondary">
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
                    selected ? "bg-surface-accent ring-1 ring-border-accent" : "bg-background-tertiary"
                  }`}
                >
                  <span className="text-sm font-medium text-content-primary">#{t.id.slice(0, 8)}</span>
                  <span className="text-xs text-content-secondary">{formatDate(t.created_at)}</span>
                </button>
              );
            })}
          </div>
        )}

        {orderId &&
          (coverageLoading ? (
            <div className="mt-3 h-12 animate-pulse rounded-xl bg-background-tertiary" />
          ) : coverage ? (
            <div
              className={`mt-3 rounded-xl px-4 py-3 text-sm ${
                coverage.covered
                  ? "bg-surface-positive text-content-positive"
                  : "bg-surface-warning text-content-warning"
              }`}
            >
              {coverage.covered ? (
                <span className="font-semibold">
                  Covered{coverage.plan ? ` · ${coverage.plan}` : ""}
                  {typeof coverage.coverage_amount_paise === "number"
                    ? ` · up to ${formatRupeesWhole(coverage.coverage_amount_paise)}`
                    : ""}
                </span>
              ) : (
                <span className="font-semibold">This trip isn&apos;t covered by D4M Care.</span>
              )}
            </div>
          ) : null)}

        <h3 className="mt-5 text-sm font-bold text-content-primary mb-3">Claim type</h3>
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
                    ? "bg-accent-400 text-content-primary"
                    : "bg-background-tertiary text-content-secondary"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <h3 className="mt-5 text-sm font-bold text-content-primary mb-3">Description</h3>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Tell us what happened (min 10 characters)…"
          className="w-full resize-none rounded-xl bg-background-tertiary p-3 text-sm text-content-primary placeholder:text-content-tertiary focus:outline-none focus:ring-1 focus:ring-border-accent"
        />

        <div className="mt-5 mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-content-primary">Photos</h3>
          <span className="text-xs text-content-secondary">{photos.length}/{MAX_PHOTOS}</span>
        </div>
        {photos.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {photos.map((src, i) => (
              <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl bg-background-tertiary">
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
          <label className="flex cursor-pointer items-center justify-center rounded-xl bg-background-tertiary px-4 py-3 text-sm font-medium text-content-secondary">
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

        {error && <p className="mt-4 text-sm font-medium text-content-negative">{error}</p>}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="mt-5 w-full rounded-xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text disabled:opacity-40"
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
          <h2 className="text-sm font-bold text-content-primary mb-3">D4M Care</h2>
          <div className="rounded-2xl bg-background-secondary p-4">
            <p className="text-sm text-content-secondary">
              Per-trip opt-in is <span className="font-semibold text-content-primary">₹49</span> at booking.
            </p>
            <p className="mt-3 rounded-xl bg-surface-accent px-4 py-3 text-sm font-semibold text-content-accent">
              Your next trip is covered with D4M Care when you toggle it at booking.
            </p>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-background-tertiary px-4 py-3 opacity-60">
              <span className="text-sm font-medium text-content-secondary">Monthly plan</span>
              <span className="text-xs font-medium text-content-tertiary">Coming soon</span>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-content-primary">Past claims</h2>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              className="rounded-xl bg-interactive-primary px-4 py-2 text-sm font-bold text-interactive-primary-text"
            >
              File a Claim
            </button>
          </div>

          {loading ? (
            <SkeletonList rows={3} />
          ) : showEmpty ? (
            <EmptyState
              icon={<ShieldIcon size={28} />}
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
