"use client";

import { useRef, useState } from "react";
import { useAuthStore } from "@/lib/store/authStore";
import { authApi } from "@/lib/api/auth";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { compressImage, blobToDataUrl } from "@/lib/utils/imageCompress";

const INPUT =
  "w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none placeholder:text-content-tertiary focus:ring-1 focus:ring-border-accent";

const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "বাংলা" },
];

type Field = "name" | "email" | "dob";
type Errors = Partial<Record<Field, string>>;

function validate(field: Field, value: string): string | undefined {
  if (field === "name" && value.trim().length < 2) return "Enter your full name";
  if (field === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    return "Invalid email address";
  if (field === "dob" && value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime()) || d > new Date()) return "Invalid date";
  }
  return undefined;
}

export default function ProfilePage() {
  const rider = useAuthStore((s) => s.rider);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(rider?.name ?? "");
  const [email, setEmail] = useState(rider?.email ?? "");
  const [dob, setDob] = useState(rider?.date_of_birth ?? "");
  const [gender, setGender] = useState(rider?.gender ?? "");
  const [lang, setLang] = useState(rider?.preferred_language ?? "en");
  const [photo, setPhoto] = useState<string | null>(rider?.profile_photo_url ?? null);

  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [showPhoneFlow, setShowPhoneFlow] = useState(false);

  const onBlur = (field: Field, value: string) =>
    setErrors((e) => ({ ...e, [field]: validate(field, value) }));

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadPct(10);
    try {
      const blob = await compressImage(file, 800, 0.8);
      setUploadPct(60);
      const dataUrl = await blobToDataUrl(blob);
      setUploadPct(100);
      setPhoto(dataUrl);
      setTimeout(() => setUploadPct(null), 400);
    } catch {
      setUploadPct(null);
    }
  };

  const canSave = !errors.name && !errors.email && !errors.dob && name.trim().length >= 2;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await authApi.updateProfile({
        name: name.trim(),
        email: email.trim() || undefined,
        gender: gender || undefined,
        preferred_language: lang,
        date_of_birth: dob || undefined,
        profile_photo_url: photo ?? undefined,
      });
      await fetchMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setErrors((e) => ({ ...e, name: "Could not save. Try again." }));
    } finally {
      setSaving(false);
    }
  };

  const kycVerified = rider?.kyc_level && rider.kyc_level !== "NONE";
  const initials = (name || "?").trim().slice(0, 1).toUpperCase();

  return (
    <AccountScaffold title="Profile">
      {/* Avatar */}
      <div className="flex flex-col items-center">
        <button
          onClick={() => fileRef.current?.click()}
          aria-label="Change profile photo"
          className="relative h-24 w-24 overflow-hidden rounded-full bg-surface-accent"
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-3xl font-bold text-content-accent">
              {initials}
            </span>
          )}
          <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-accent-400 text-sm ring-2 ring-background-primary">
            ✎
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={handlePhoto}
        />
        {uploadPct !== null && (
          <div className="mt-3 h-1.5 w-32 overflow-hidden rounded-full bg-background-tertiary">
            <div className="h-full bg-accent-400 transition-all" style={{ width: `${uploadPct}%` }} />
          </div>
        )}
      </div>

      {/* KYC banner */}
      <div
        className={`mt-5 flex items-center justify-between rounded-2xl p-4 ${
          kycVerified ? "bg-surface-positive" : "bg-surface-accent"
        }`}
      >
        <div>
          <p className={`text-sm font-semibold ${kycVerified ? "text-content-positive" : "text-content-accent"}`}>
            {kycVerified ? "KYC Verified" : "Identity not verified"}
          </p>
          <p className="text-xs text-content-secondary">Level: {rider?.kyc_level ?? "NONE"}</p>
        </div>
        {!kycVerified && (
          <button className="rounded-xl bg-interactive-primary px-4 py-2 text-xs font-semibold text-interactive-primary-text">
            Get Verified
          </button>
        )}
      </div>

      {/* Fields */}
      <div className="mt-5 space-y-4">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => onBlur("name", e.target.value)}
            className={INPUT}
            placeholder="Full name"
          />
          {errors.name && <FieldError msg={errors.name} />}
        </Field>

        <Field label="Email">
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => onBlur("email", e.target.value)}
              className={`${INPUT} flex-1`}
              placeholder="you@example.com"
            />
            {email && !rider?.email_verified && (
              <button
                onClick={() => setEmailOtpSent(true)}
                className="whitespace-nowrap rounded-xl bg-background-tertiary px-3 text-xs font-semibold text-content-accent ring-1 ring-border-opaque"
              >
                {emailOtpSent ? "OTP Sent" : "Verify"}
              </button>
            )}
          </div>
          {errors.email && <FieldError msg={errors.email} />}
          {rider?.email_verified && <p className="mt-1 text-xs text-content-positive">✓ Verified</p>}
        </Field>

        <Field label="Date of Birth">
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            onBlur={(e) => onBlur("dob", e.target.value)}
            className={INPUT}
          />
          {errors.dob && <FieldError msg={errors.dob} />}
        </Field>

        <Field label="Gender">
          <div className="flex flex-wrap gap-2">
            {GENDERS.map((g) => (
              <button
                key={g}
                onClick={() => setGender(g)}
                className={`rounded-xl px-3.5 py-2 text-sm ${
                  gender === g ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Language">
          <div className="flex gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                className={`flex-1 rounded-xl py-2.5 text-sm ${
                  lang === l.code ? "bg-accent-400 text-content-primary" : "bg-background-tertiary text-content-secondary"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Phone">
          <div className="flex items-center justify-between rounded-xl bg-background-tertiary px-4 py-3">
            <span className="text-sm text-content-primary">{rider?.phone}</span>
            <button
              onClick={() => setShowPhoneFlow(true)}
              className="text-xs font-semibold text-content-accent"
            >
              Change
            </button>
          </div>
        </Field>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={!canSave || saving}
        className="mt-6 w-full rounded-2xl bg-interactive-primary py-4 text-base font-bold text-interactive-primary-text disabled:opacity-40"
      >
        {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
      </button>

      {showPhoneFlow && (
        <PhoneChangeSheet phone={rider?.phone ?? ""} onClose={() => setShowPhoneFlow(false)} />
      )}
    </AccountScaffold>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-content-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldError({ msg }: { msg: string }) {
  return <p className="mt-1 text-xs text-content-negative">{msg}</p>;
}

function PhoneChangeSheet({ phone, onClose }: { phone: string; onClose: () => void }) {
  const [step, setStep] = useState<"old" | "new" | "done">("old");
  const [newPhone, setNewPhone] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-background-secondary p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
        {step === "old" && (
          <>
            <h3 className="text-base font-bold text-content-primary">Verify current number</h3>
            <p className="mt-1 text-sm text-content-secondary">We sent an OTP to {phone}</p>
            <button
              onClick={() => setStep("new")}
              className="mt-5 w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text"
            >
              Verify & Continue
            </button>
          </>
        )}
        {step === "new" && (
          <>
            <h3 className="text-base font-bold text-content-primary">New phone number</h3>
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit number"
              className="mt-3 w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none"
            />
            <button
              disabled={newPhone.length !== 10}
              onClick={() => setStep("done")}
              className="mt-5 w-full rounded-2xl bg-interactive-primary py-3.5 text-sm font-bold text-interactive-primary-text disabled:opacity-40"
            >
              Send OTP
            </button>
          </>
        )}
        {step === "done" && (
          <>
            <h3 className="text-base font-bold text-content-primary">Almost there</h3>
            <p className="mt-1 text-sm text-content-secondary">
              Enter the OTP sent to +91 {newPhone} to finish changing your number.
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full rounded-2xl bg-background-tertiary py-3.5 text-sm font-semibold text-content-secondary"
            >
              Close
            </button>
          </>
        )}
        <div className="h-4" />
      </div>
    </div>
  );
}
