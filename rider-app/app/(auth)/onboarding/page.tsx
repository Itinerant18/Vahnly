"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { Geolocation } from "@capacitor/geolocation";
import { authApi } from "@/lib/api/auth";
import { garageApi, type GarageCarInput } from "@/lib/api/garage";
import { accountApi } from "@/lib/api/account";
import { useAuthStore } from "@/lib/store/authStore";
import { compressImage, blobToDataUrl } from "@/lib/utils/imageCompress";
import type { CarType, Transmission } from "@/lib/api/types";

const TOTAL_STEPS = 6;
const CAR_TYPES: CarType[] = ["HATCHBACK", "SEDAN", "SUV", "PREMIUM"];
const TRANSMISSIONS: Transmission[] = ["MANUAL", "AUTOMATIC"];

const INPUT =
  "w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none ring-1 ring-border-opaque placeholder:text-content-tertiary focus:ring-2 focus:ring-border-accent";

type PermState = "idle" | "granted" | "denied";

// ── Per-step local state shapes ──────────────────────────────────────────────
interface CarForm {
  make: string;
  model: string;
  year: string;
  car_type: CarType;
  transmission: Transmission;
  fuel_type: string;
  registration_plate: string;
  color: string;
}

interface PlaceForm {
  address: string;
  lat: number | null;
  lng: number | null;
}

interface ContactRow {
  name: string;
  phone: string;
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function Progress({ step }: { step: number }) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-content-secondary">
          Step {step} of {TOTAL_STEPS}
        </span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < step ? "bg-interactive-primary" : "bg-background-tertiary"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Bottom nav controls ──────────────────────────────────────────────────────
function NavBar({
  step,
  onBack,
  onSkip,
  onNext,
  nextLabel,
  nextDisabled,
  busy,
  skippable,
}: {
  step: number;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  busy?: boolean;
  skippable?: boolean;
}) {
  return (
    <div className="mt-8 flex items-center gap-3">
      {step > 1 && (
        <button
          className="rounded-xl bg-background-tertiary px-5 py-3.5 text-sm font-semibold text-content-secondary"
          onClick={onBack}
          disabled={busy}
        >
          Back
        </button>
      )}
      {skippable && (
        <button
          className="rounded-xl px-4 py-3.5 text-sm font-semibold text-content-secondary"
          onClick={onSkip}
          disabled={busy}
        >
          Skip
        </button>
      )}
      <button
        className="flex h-14 flex-1 items-center justify-center rounded-xl bg-interactive-primary text-base font-bold text-interactive-primary-text shadow-elevation-2 disabled:opacity-50"
        onClick={onNext}
        disabled={nextDisabled || busy}
      >
        {busy ? (
          <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
          </svg>
        ) : (
          nextLabel
        )}
      </button>
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-content-primary">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-content-secondary">{subtitle}</p>}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-xl bg-surface-negative px-4 py-3 text-sm text-content-negative">
      {message}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { rider, setRider } = useAuthStore();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Step 1 — personal info
  const [name, setName] = useState(rider?.name ?? "");
  const [email, setEmail] = useState(rider?.email ?? "");
  const [gender, setGender] = useState(rider?.gender ?? "");
  const [dob, setDob] = useState(rider?.date_of_birth ?? "");
  const [photoUrl, setPhotoUrl] = useState<string>(rider?.profile_photo_url ?? "");

  // Step 2 — first car
  const [car, setCar] = useState<CarForm>({
    make: "",
    model: "",
    year: "",
    car_type: "HATCHBACK",
    transmission: "MANUAL",
    fuel_type: "",
    registration_plate: "",
    color: "",
  });

  // Step 3 — home & work
  const [home, setHome] = useState<PlaceForm>({ address: "", lat: null, lng: null });
  const [work, setWork] = useState<PlaceForm>({ address: "", lat: null, lng: null });

  // Step 4 — emergency contacts
  const [contacts, setContacts] = useState<ContactRow[]>([{ name: "", phone: "" }]);

  // Step 5 / 6 — permissions
  const [notifState, setNotifState] = useState<PermState>("idle");
  const [locState, setLocState] = useState<PermState>("idle");

  const next = () => {
    setError("");
    setStep((s) => Math.min(TOTAL_STEPS, s + 1));
  };
  const back = () => {
    setError("");
    setStep((s) => Math.max(1, s - 1));
  };
  const finish = () => router.replace("/home");

  // ── Step 1: save profile ───────────────────────────────────────────────────
  const onPhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blob = await compressImage(file, 512, 0.8);
      setPhotoUrl(await blobToDataUrl(blob));
    } catch {
      /* ignore — photo is optional */
    }
  };

  const saveProfile = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await authApi.updateProfile({
        name: trimmedName,
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(gender ? { gender } : {}),
        ...(dob ? { date_of_birth: dob } : {}),
        ...(photoUrl ? { profile_photo_url: photoUrl } : {}),
      });
      setRider(updated);
      next();
    } catch {
      setError("Could not save your details. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // ── Step 2: save first car ──────────────────────────────────────────────────
  const carValid =
    car.make.trim().length > 0 &&
    car.model.trim().length > 0 &&
    /^\d{4}$/.test(car.year) &&
    car.registration_plate.trim().length >= 4;

  const saveCar = async () => {
    setBusy(true);
    setError("");
    const payload: GarageCarInput = {
      make: car.make.trim(),
      model: car.model.trim(),
      year: Number(car.year),
      car_type: car.car_type,
      transmission: car.transmission,
      registration_plate: car.registration_plate.trim().toUpperCase(),
      is_default: true,
      ...(car.fuel_type.trim() ? { fuel_type: car.fuel_type.trim() } : {}),
      ...(car.color.trim() ? { color: car.color.trim() } : {}),
    };
    try {
      await garageApi.add(payload);
      next();
    } catch {
      setError("Could not save your car. You can add it later from your account.");
    } finally {
      setBusy(false);
    }
  };

  // ── Step 3: save home & work ────────────────────────────────────────────────
  const useCurrentLocation = (set: (p: PlaceForm) => void, current: PlaceForm) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => set({ ...current, lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError("Could not get your current location."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const savePlaces = async () => {
    setBusy(true);
    setError("");
    const jobs: Promise<unknown>[] = [];
    if (home.address.trim()) {
      jobs.push(
        accountApi.addPlace({
          label: "HOME",
          display_name: "Home",
          address_text: home.address.trim(),
          lat: home.lat ?? 0,
          lng: home.lng ?? 0,
        }),
      );
    }
    if (work.address.trim()) {
      jobs.push(
        accountApi.addPlace({
          label: "WORK",
          display_name: "Work",
          address_text: work.address.trim(),
          lat: work.lat ?? 0,
          lng: work.lng ?? 0,
        }),
      );
    }
    try {
      await Promise.allSettled(jobs);
      next();
    } catch {
      next();
    } finally {
      setBusy(false);
    }
  };

  // ── Step 4: save emergency contacts ─────────────────────────────────────────
  const updateContact = (i: number, patch: Partial<ContactRow>) =>
    setContacts((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addContactRow = () =>
    setContacts((rows) => (rows.length >= 3 ? rows : [...rows, { name: "", phone: "" }]));
  const removeContactRow = (i: number) =>
    setContacts((rows) => rows.filter((_, idx) => idx !== i));

  const saveContacts = async () => {
    setBusy(true);
    setError("");
    const valid = contacts.filter(
      (c) => c.name.trim().length >= 2 && /^\d{10}$/.test(c.phone.trim()),
    );
    try {
      await Promise.allSettled(
        valid.map((c) =>
          accountApi.addEmergency({ name: c.name.trim(), phone: c.phone.trim() }),
        ),
      );
      next();
    } catch {
      next();
    } finally {
      setBusy(false);
    }
  };

  // ── Step 5: notifications permission ────────────────────────────────────────
  const requestNotif = async () => {
    setError("");
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await PushNotifications.requestPermissions();
        setNotifState(res.receive === "granted" ? "granted" : "denied");
      } else if (typeof Notification !== "undefined") {
        const res = await Notification.requestPermission();
        setNotifState(res === "granted" ? "granted" : "denied");
      } else {
        setNotifState("denied");
      }
    } catch {
      setNotifState("denied");
    }
  };

  // ── Step 6: location permission ─────────────────────────────────────────────
  const requestLocation = async () => {
    setError("");
    try {
      if (Capacitor.isNativePlatform()) {
        const res = await Geolocation.requestPermissions();
        setLocState(res.location === "granted" ? "granted" : "denied");
      } else if (typeof navigator !== "undefined" && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            () => {
              setLocState("granted");
              resolve();
            },
            () => {
              setLocState("denied");
              resolve();
            },
            { timeout: 8000 },
          );
        });
      } else {
        setLocState("denied");
      }
    } catch {
      setLocState("denied");
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background-primary px-6 pb-10 pt-12">
      <Progress step={step} />

      {/* ── Step 1: Personal info ── */}
      {step === 1 && (
        <>
          <StepHeader title="Tell us about you" subtitle="Your driver uses your name at pickup." />

          <div className="space-y-4">
            <label className="flex items-center gap-4">
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-background-tertiary text-2xl">
                {photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoUrl} alt="Profile" className="h-full w-full object-cover" />
                ) : (
                  "📷"
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-content-primary">Profile photo</p>
                <p className="text-xs text-content-tertiary">Optional · tap to upload</p>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={onPhotoPick} />
            </label>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">Full Name</label>
              <input
                className={INPUT}
                placeholder="e.g. Aniket Karmakar"
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">
                Email <span className="text-content-tertiary">(optional)</span>
              </label>
              <input
                className={INPUT}
                placeholder="you@example.com"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">
                Gender <span className="text-content-tertiary">(optional)</span>
              </label>
              <div className="flex gap-2">
                {["MALE", "FEMALE", "OTHER"].map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender((prev) => (prev === g ? "" : g))}
                    className={`flex-1 rounded-xl py-2.5 text-xs font-medium ${
                      gender === g
                        ? "bg-accent-400 text-content-primary"
                        : "bg-background-tertiary text-content-secondary"
                    }`}
                  >
                    {g.charAt(0) + g.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">
                Date of birth <span className="text-content-tertiary">(optional)</span>
              </label>
              <input className={INPUT} type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
          </div>

          {error && <InlineError message={error} />}

          <NavBar
            step={step}
            onBack={back}
            onSkip={next}
            onNext={saveProfile}
            nextLabel="Continue"
            nextDisabled={name.trim().length < 2}
            busy={busy}
          />
        </>
      )}

      {/* ── Step 2: Add first car ── */}
      {step === 2 && (
        <>
          <StepHeader title="Add your car" subtitle="You hire a driver for your own car. Add it now, or skip." />

          <div className="space-y-3">
            <div className="flex gap-3">
              <input
                className={INPUT}
                placeholder="Make"
                value={car.make}
                onChange={(e) => setCar({ ...car, make: e.target.value })}
              />
              <input
                className={INPUT}
                placeholder="Model"
                value={car.model}
                onChange={(e) => setCar({ ...car, model: e.target.value })}
              />
            </div>
            <div className="flex gap-3">
              <input
                className={INPUT}
                placeholder="Year"
                inputMode="numeric"
                value={car.year}
                onChange={(e) => setCar({ ...car, year: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              />
              <input
                className={INPUT}
                placeholder="Color (optional)"
                value={car.color}
                onChange={(e) => setCar({ ...car, color: e.target.value })}
              />
            </div>
            <input
              className={INPUT}
              placeholder="Registration plate"
              value={car.registration_plate}
              onChange={(e) => setCar({ ...car, registration_plate: e.target.value.toUpperCase() })}
            />
            <input
              className={INPUT}
              placeholder="Fuel type (optional, e.g. Petrol)"
              value={car.fuel_type}
              onChange={(e) => setCar({ ...car, fuel_type: e.target.value })}
            />

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-content-secondary">Type</p>
              <div className="flex flex-wrap gap-2">
                {CAR_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setCar({ ...car, car_type: t })}
                    className={`rounded-xl px-3 py-2 text-xs ${
                      car.car_type === t
                        ? "bg-accent-400 text-content-primary"
                        : "bg-background-tertiary text-content-secondary"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-content-secondary">
                Transmission
              </p>
              <div className="flex gap-2">
                {TRANSMISSIONS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setCar({ ...car, transmission: t })}
                    className={`flex-1 rounded-xl py-2.5 text-xs ${
                      car.transmission === t
                        ? "bg-accent-400 text-content-primary"
                        : "bg-background-tertiary text-content-secondary"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && <InlineError message={error} />}

          <NavBar
            step={step}
            onBack={back}
            onSkip={next}
            onNext={saveCar}
            nextLabel="Save & Continue"
            nextDisabled={!carValid}
            busy={busy}
            skippable
          />
        </>
      )}

      {/* ── Step 3: Home & Work ── */}
      {step === 3 && (
        <>
          <StepHeader title="Home & Work" subtitle="Save them for one-tap booking. You can add coords later." />

          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">🏠 Home address</label>
              <input
                className={INPUT}
                placeholder="Enter your home address"
                value={home.address}
                onChange={(e) => setHome({ ...home, address: e.target.value })}
              />
              <button
                className="mt-2 text-xs font-medium text-content-accent"
                onClick={() => useCurrentLocation(setHome, home)}
              >
                {home.lat != null
                  ? `📍 ${home.lat.toFixed(4)}, ${home.lng?.toFixed(4)}`
                  : "Use current location"}
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">💼 Work address</label>
              <input
                className={INPUT}
                placeholder="Enter your work address"
                value={work.address}
                onChange={(e) => setWork({ ...work, address: e.target.value })}
              />
              <button
                className="mt-2 text-xs font-medium text-content-accent"
                onClick={() => useCurrentLocation(setWork, work)}
              >
                {work.lat != null
                  ? `📍 ${work.lat.toFixed(4)}, ${work.lng?.toFixed(4)}`
                  : "Use current location"}
              </button>
            </div>
          </div>

          {error && <InlineError message={error} />}

          <NavBar
            step={step}
            onBack={back}
            onSkip={next}
            onNext={savePlaces}
            nextLabel="Save & Continue"
            busy={busy}
            skippable
          />
        </>
      )}

      {/* ── Step 4: Emergency contacts ── */}
      {step === 4 && (
        <>
          <StepHeader title="Emergency contacts" subtitle="Add up to 3 people to alert during a trip." />

          <div className="space-y-4">
            {contacts.map((c, i) => (
              <div key={i} className="space-y-2 rounded-2xl bg-background-secondary p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-content-secondary">Contact {i + 1}</span>
                  {contacts.length > 1 && (
                    <button
                      onClick={() => removeContactRow(i)}
                      className="text-xs font-semibold text-content-negative"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  className={INPUT}
                  placeholder="Name"
                  value={c.name}
                  onChange={(e) => updateContact(i, { name: e.target.value })}
                />
                <input
                  className={INPUT}
                  placeholder="10-digit phone"
                  inputMode="numeric"
                  value={c.phone}
                  onChange={(e) => updateContact(i, { phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
                />
              </div>
            ))}

            {contacts.length < 3 && (
              <button
                onClick={addContactRow}
                className="w-full rounded-2xl bg-background-tertiary py-3 text-sm font-semibold text-content-secondary"
              >
                + Add another contact
              </button>
            )}
          </div>

          {error && <InlineError message={error} />}

          <NavBar
            step={step}
            onBack={back}
            onSkip={next}
            onNext={saveContacts}
            nextLabel="Save & Continue"
            busy={busy}
            skippable
          />
        </>
      )}

      {/* ── Step 5: Notifications ── */}
      {step === 5 && (
        <>
          <StepHeader
            title="Stay updated"
            subtitle="Allow notifications so you know when your driver arrives."
          />

          <div className="rounded-2xl bg-background-secondary p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-background-tertiary text-3xl">
              🔔
            </div>
            {notifState === "idle" ? (
              <button
                onClick={requestNotif}
                className="w-full rounded-xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text"
              >
                Enable notifications
              </button>
            ) : (
              <p
                className={`text-sm font-semibold ${
                  notifState === "granted" ? "text-content-positive" : "text-content-negative"
                }`}
              >
                {notifState === "granted" ? "✓ Notifications enabled" : "Notifications were not allowed"}
              </p>
            )}
          </div>

          {error && <InlineError message={error} />}

          <NavBar
            step={step}
            onBack={back}
            onSkip={next}
            onNext={next}
            nextLabel="Continue"
            busy={busy}
            skippable
          />
        </>
      )}

      {/* ── Step 6: Location ── */}
      {step === 6 && (
        <>
          <StepHeader
            title="Find drivers near you"
            subtitle="Allow location so we can match nearby drivers and set your pickup."
          />

          <div className="rounded-2xl bg-background-secondary p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-background-tertiary text-3xl">
              📍
            </div>
            {locState === "idle" ? (
              <button
                onClick={requestLocation}
                className="w-full rounded-xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text"
              >
                Enable location
              </button>
            ) : (
              <p
                className={`text-sm font-semibold ${
                  locState === "granted" ? "text-content-positive" : "text-content-negative"
                }`}
              >
                {locState === "granted" ? "✓ Location enabled" : "Location was not allowed"}
              </p>
            )}
          </div>

          {error && <InlineError message={error} />}

          <NavBar
            step={step}
            onBack={back}
            onSkip={finish}
            onNext={finish}
            nextLabel="Finish"
            busy={busy}
            skippable
          />
        </>
      )}
    </main>
  );
}
