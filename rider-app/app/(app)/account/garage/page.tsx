"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { SkeletonList, EmptyState, ErrorState } from "@/components/account/States";
import { SuccessIcon, CameraIcon } from "@/components/ds/Icon";
import { garageApi, type GarageCarInput } from "@/lib/api/garage";
import type { CarType, GarageCar, Transmission } from "@/lib/api/types";
import { compressImage } from "@/lib/utils/imageCompress";
import { BlurFade } from "@/components/ui/blur-fade";
import { WordRotate } from "@/components/ui/word-rotate";

import { AnimatedIcon, StarIcon, WarningIcon, CarIcon } from "@/components/ds/Icon";
import { AnimCar } from "@/assets/icons/animated";

const CAR_TYPES: CarType[] = ["HATCHBACK", "SEDAN", "SUV", "PREMIUM"];
const TRANSMISSIONS: Transmission[] = ["MANUAL", "AUTOMATIC"];

type DocState = "ok" | "soon" | "expired" | "missing";

function docState(expiry?: string): { state: DocState; days: number | null } {
  if (!expiry) return { state: "missing", days: null };
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return { state: "expired", days };
  if (days < 30) return { state: "soon", days };
  return { state: "ok", days };
}

function ExpiryBadge({ label, expiry }: { label: string; expiry?: string }) {
  const { state, days } = docState(expiry);
  const map: Record<DocState, { cls: string; text: string }> = {
    ok: { cls: "bg-surface-positive text-content-positive", text: `Valid` },
    soon: { cls: "bg-surface-warning text-content-warning", text: `${days}d left` },
    expired: { cls: "bg-surface-negative text-content-negative", text: `Expired` },
    missing: { cls: "bg-surface-neutral text-content-secondary", text: `Not uploaded` },
  };
  const m = map[state];
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-content-secondary">{label}</span>
      <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${m.cls}`}>{m.text}</span>
    </div>
  );
}

function CarCard({
  car,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  car: GarageCar;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ins = docState(car.insurance_expiry);
  const puc = docState(car.puc_expiry);
  const alert = ins.state === "expired" || puc.state === "expired";
  const warn = ins.state === "soon" || puc.state === "soon";

  return (
    <div className="overflow-hidden rounded-2xl bg-background-secondary">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-4 text-left">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-background-tertiary">
          <CarIcon size={24} className="text-content-secondary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-content-primary">
            {car.make} {car.model} {car.year}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5 font-medium">
            <Tag>{car.car_type}</Tag>
            <Tag>{car.transmission}</Tag>
            {car.is_default && (
              <Tag accent>
                <span className="flex items-center gap-1">
                  Default <StarIcon size={10} className="text-yellow-500 fill-yellow-500" />
                </span>
              </Tag>
            )}
          </div>
        </div>
        {(alert || warn) && (
          <WarningIcon size={16} className={alert ? "text-content-negative" : "text-content-warning"} />
        )}
      </button>

      {open && (
        <div className="border-t border-border-opaque px-4 pb-4">
          <div className="py-1">
            <ExpiryBadge label="RC / Registration" expiry={undefined} />
            <ExpiryBadge label="Insurance" expiry={car.insurance_expiry} />
            <ExpiryBadge label="PUC" expiry={car.puc_expiry} />
          </div>
          <p className="mb-3 text-xs text-content-tertiary">Plate: {car.registration_plate}</p>
          <div className="flex gap-2">
            <button onClick={onEdit} className="flex-1 rounded-xl bg-background-tertiary py-2.5 text-xs font-semibold text-content-primary active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
              Edit
            </button>
            {!car.is_default && (
              <button
                onClick={onSetDefault}
                className="flex-1 rounded-xl bg-background-tertiary py-2.5 text-xs font-semibold text-content-accent active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              >
                Set Default
              </button>
            )}
            <button
              onClick={onDelete}
              className="flex-1 rounded-xl bg-surface-negative py-2.5 text-xs font-semibold text-content-negative active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${
        accent ? "bg-surface-accent text-content-accent" : "bg-background-tertiary text-content-secondary"
      }`}
    >
      {children}
    </span>
  );
}

export default function GaragePage() {
  const [cars, setCars] = useState<GarageCar[] | null>(null);
  const [error, setError] = useState(false);
  const [editing, setEditing] = useState<GarageCar | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setCars(null);
    garageApi
      .list()
      .then(setCars)
      .catch(() => setError(true));
  }, []);

  useEffect(load, [load]);

  const handleDelete = async (id: string) => {
    await garageApi.remove(id);
    load();
  };
  const handleSetDefault = async (id: string) => {
    await garageApi.setDefault(id);
    load();
  };

  return (
    <AccountScaffold title={<WordRotate words={["My Garage", "My Cars", "Vehicle Fleet"]} duration={3000} />}>
      <BlurFade delay={0.1}>
        {error ? (
          <ErrorState onRetry={load} />
        ) : cars === null ? (
          <SkeletonList rows={3} />
        ) : cars.length === 0 ? (
          <EmptyState
            icon={<AnimatedIcon src={AnimCar} size={64} trigger="in" colors="primary:#1A73E8,secondary:#FF6B35" />}
            title="No cars yet"
            message="Add the car you want a driver for."
            action={
              <button
                onClick={() => setShowForm(true)}
                className="rounded-xl bg-interactive-primary px-5 py-2.5 text-sm font-bold text-interactive-primary-text active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              >
                Add Car
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {cars.map((car) => (
              <BlurFade key={car.id} delay={0.1}>
                <CarCard
                  car={car}
                  onEdit={() => setEditing(car)}
                  onDelete={() => handleDelete(car.id)}
                  onSetDefault={() => handleSetDefault(car.id)}
                />
              </BlurFade>
            ))}
          </div>
        )}
      </BlurFade>

      {/* Add FAB */}
      <button
        onClick={() => setShowForm(true)}
        className="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-interactive-primary text-2xl text-interactive-primary-text shadow-elevation-2 active:scale-90 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        aria-label="Add car"
      >
        +
      </button>

      {(showForm || editing) && (
        <CarFormSheet
          car={editing}
          onClose={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </AccountScaffold>
  );
}

function CarFormSheet({
  car,
  onClose,
  onSaved,
}: {
  car: GarageCar | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [make, setMake] = useState(car?.make ?? "");
  const [model, setModel] = useState(car?.model ?? "");
  const [year, setYear] = useState(String(car?.year ?? ""));
  const [carType, setCarType] = useState<CarType>(car?.car_type ?? "HATCHBACK");
  const [transmission, setTransmission] = useState<Transmission>(car?.transmission ?? "MANUAL");
  const [plate, setPlate] = useState(car?.registration_plate ?? "");
  const [color, setColor] = useState(car?.color ?? "");
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid =
    make.trim() && model.trim() && /^\d{4}$/.test(year) && plate.trim().length >= 4;

  const handleDoc = (slot: string) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blob = await compressImage(file, 800, 0.8);
      setDocs((d) => ({ ...d, [slot]: `${(blob.size / 1024).toFixed(0)} KB` }));
    } catch {
      /* ignore */
    }
  };

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setErr(null);
    const payload: GarageCarInput = {
      make: make.trim(),
      model: model.trim(),
      year: Number(year),
      car_type: carType,
      transmission,
      registration_plate: plate.trim().toUpperCase(),
      color: color.trim() || undefined,
    };
    try {
      if (car) await garageApi.update(car.id, payload);
      else await garageApi.add(payload);
      onSaved();
    } catch {
      setErr("Could not save car. Try again.");
      setSaving(false);
    }
  };

  const input =
    "w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-1 focus:ring-border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-background-secondary p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        <h3 className="mb-4 text-lg font-bold text-content-primary">{car ? "Edit Car" : "Add Car"}</h3>

        <div className="space-y-3">
          <div className="flex gap-3">
            <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Make" className={input} />
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" className={input} />
          </div>
          <div className="flex gap-3">
            <input
              value={year}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Year"
              inputMode="numeric"
              className={input}
            />
            <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color" className={input} />
          </div>
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder="Registration plate"
            className={input}
          />

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-content-secondary">Type</p>
            <div className="flex flex-wrap gap-2">
              {CAR_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setCarType(t)}
                  className={`rounded-xl px-3 py-2 text-xs ${
                    carType === t ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-content-secondary">Transmission</p>
            <div className="flex gap-2">
              {TRANSMISSIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTransmission(t)}
                  className={`flex-1 rounded-xl py-2.5 text-xs ${
                    transmission === t ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Document slots */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-content-secondary">Documents</p>
            <div className="grid grid-cols-3 gap-2">
              {["RC", "Insurance", "PUC"].map((slot) => (
                <label
                  key={slot}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-xl bg-background-tertiary py-4 text-center"
                >
                  {docs[slot] ? <SuccessIcon size={22} className="text-content-positive" /> : <CameraIcon size={22} className="text-content-secondary" />}
                  <span className="text-[10px] text-content-secondary">{docs[slot] ?? slot}</span>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleDoc(slot)} />
                </label>
              ))}
            </div>
          </div>

          {err && <p className="text-xs text-content-negative">{err}</p>}
        </div>

        <button
          onClick={save}
          disabled={!valid || saving}
          className="mt-5 w-full rounded-2xl bg-interactive-primary py-4 text-base font-bold text-interactive-primary-text disabled:opacity-40 active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        >
          {saving ? "Saving…" : car ? "Save Changes" : "Add Car"}
        </button>
        <div className="h-4" />
      </div>
    </div>
  );
}
