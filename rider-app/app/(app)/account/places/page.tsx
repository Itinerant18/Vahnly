"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { accountApi, type SavePlaceInput } from "@/lib/api/account";
import type { SavedPlace } from "@/lib/api/types";

const PlacePickerMap = dynamic(() => import("@/components/account/PlacePickerMap"), {
  ssr: false,
  loading: () => <div className="h-56 w-full animate-pulse rounded-2xl bg-background-tertiary" />,
});

const LABELS: { value: SavePlaceInput["label"]; icon: string; name: string }[] = [
  { value: "HOME", icon: "🏠", name: "Home" },
  { value: "WORK", icon: "💼", name: "Work" },
  { value: "CUSTOM", icon: "📍", name: "Other" },
];

const KOLKATA = { lat: 22.5726, lng: 88.3639 };

export default function PlacesPage() {
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = () => {
    setError(false);
    setPlaces(null);
    accountApi.listPlaces().then(setPlaces).catch(() => setError(true));
  };
  useEffect(load, []);

  const remove = async (id: string) => {
    await accountApi.removePlace(id);
    load();
  };

  const iconFor = (label: string) => LABELS.find((l) => l.value === label)?.icon ?? "📍";

  return (
    <AccountScaffold title="Saved Places">
      {error ? (
        <ErrorState onRetry={load} />
      ) : places === null ? (
        <SkeletonList rows={3} height="h-16" />
      ) : (
        <div className="space-y-3">
          {places.length === 0 && (
            <EmptyState icon="📍" title="No saved places" message="Save Home & Work for one-tap booking." />
          )}
          {places.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl bg-background-secondary p-4">
              <span className="text-2xl">{iconFor(p.label)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content-primary">{p.display_name}</p>
                <p className="truncate text-xs text-content-secondary">{p.address_text}</p>
              </div>
              <button onClick={() => remove(p.id)} className="text-xs font-semibold text-content-negative">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={() => setEditing(true)}
        className="mt-4 w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text"
      >
        + Add Place
      </button>

      {editing && (
        <AddPlaceSheet
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </AccountScaffold>
  );
}

function AddPlaceSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState<SavePlaceInput["label"]>("HOME");
  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState(KOLKATA);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }, []);

  const valid = displayName.trim().length >= 2 && address.trim().length >= 3;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setErr(null);
    try {
      await accountApi.addPlace({
        label,
        display_name: displayName.trim(),
        address_text: address.trim(),
        lat: coords.lat,
        lng: coords.lng,
      });
      onSaved();
    } catch {
      setErr("Could not save place. Try again.");
      setSaving(false);
    }
  };

  const input =
    "w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-1 focus:ring-border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-background-secondary p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h3 className="mb-4 text-lg font-bold text-content-primary">Add Place</h3>

        <PlacePickerMap lat={coords.lat} lng={coords.lng} onPick={(lat, lng) => setCoords({ lat, lng })} />
        <p className="mb-3 mt-2 text-center text-xs text-content-tertiary">
          Tap or drag the pin · {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
        </p>

        <div className="space-y-3">
          <div className="flex gap-2">
            {LABELS.map((l) => (
              <button
                key={l.value}
                onClick={() => setLabel(l.value)}
                className={`flex-1 rounded-xl py-2.5 text-sm ${
                  label === l.value ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
                }`}
              >
                {l.icon} {l.name}
              </button>
            ))}
          </div>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Label (e.g. Mom's house)"
            className={input}
          />
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Search or enter address"
            className={input}
          />
          {err && <p className="text-xs text-content-negative">{err}</p>}
        </div>

        <button
          onClick={save}
          disabled={!valid || saving}
          className="mt-5 w-full rounded-2xl bg-interactive-primary py-4 text-base font-bold text-interactive-primary-text disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save Place"}
        </button>
        <div className="h-4" />
      </div>
    </div>
  );
}
