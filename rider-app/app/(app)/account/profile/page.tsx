"use client";

import { useRef, useState } from "react";
import { useAuthStore } from "@/lib/store/authStore";
import { authApi } from "@/lib/api/auth";
import { API_BASE_URL, TOKEN_STORAGE_KEY } from "@/lib/api/client";
import { AccountScaffold } from "@/components/account/AccountScaffold";
import { compressImage, blobToDataUrl } from "@/lib/utils/imageCompress";
import { BlurFade } from "@/components/ui/blur-fade";
import { WordRotate } from "@/components/ui/word-rotate";
import { AvatarCircles } from "@/components/ui/avatar-circles";
import { PixelImage } from "@/components/ui/pixel-image";

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

interface PhotoUploadResponse {
  data?: { url?: string };
}

/**
 * Upload the (compressed) photo to S3 via the multipart endpoint.
 * Returns the hosted URL on success, or null when uploads are unconfigured
 * (503) or the request fails — letting the caller fall back to a data-URL.
 */
async function uploadPhotoToS3(blob: Blob): Promise<string | null> {
  const token =
    typeof window !== "undefined"
      ? window.localStorage.getItem(TOKEN_STORAGE_KEY)
      : null;
  if (!token) return null;

  const form = new FormData();
  form.append("file", blob, "profile.jpg");

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/rider/me/photo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as PhotoUploadResponse;
    return body.data?.url ?? null;
  } catch {
    return null;
  }
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
      setUploadPct(40);

      // Try uploading to S3 first; fall back to an inline data-URL if the
      // upload endpoint is unconfigured (503) or otherwise fails.
      const url = await uploadPhotoToS3(blob);
      if (url) {
        setUploadPct(90);
        setPhoto(url);
        try {
          await authApi.updateProfile({ profile_photo_url: url });
        } catch {
          /* keep the local preview even if the profile save fails */
        }
        setUploadPct(100);
        setTimeout(() => setUploadPct(null), 400);
        return;
      }

      // Fallback: inline data-URL (saved with the rest of the form on Save).
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
    <AccountScaffold title={<WordRotate words={["Profile", "Personal Info", "My Details"]} duration={3000} />}>
      {/* Avatar */}
      <BlurFade delay={0.1}>
        <div className="flex flex-col items-center">
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Change profile photo"
            className="relative h-24 w-24 overflow-hidden rounded-full bg-surface-accent active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          >
            {photo ? (
              <PixelImage
                src={photo}
                grid="4x6"
                pixelFadeInDuration={800}
                maxAnimationDelay={600}
                colorRevealDelay={900}
              />
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
      </BlurFade>

      {/* KYC banner */}
      <BlurFade delay={0.2}>
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
            <button className="rounded-xl bg-interactive-primary px-4 py-2 text-xs font-semibold text-interactive-primary-text active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]">
              Get Verified
            </button>
          )}
        </div>
      </BlurFade>

      {/* Connected accounts */}
      <BlurFade delay={0.25}>
        <div className="mt-5 flex items-center justify-between rounded-2xl bg-background-secondary p-4">
          <div>
            <p className="text-sm font-semibold text-content-primary">Connected Accounts</p>
            <p className="text-xs text-content-secondary">Google, Apple & Email</p>
          </div>
          <AvatarCircles
            avatarUrls={[
              { imageUrl: "https://ui-avatars.com/api/?name=G&background=4A6FA5&color=fff", profileUrl: "#" },
              { imageUrl: "https://ui-avatars.com/api/?name=A&background=1a5cff&color=fff", profileUrl: "#" },
              { imageUrl: "https://ui-avatars.com/api/?name=E&background=6B8EC4&color=fff", profileUrl: "#" },
            ]}
            numPeople={1}
          />
        </div>
      </BlurFade>

      {/* Fields */}
      <BlurFade delay={0.3}>
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
                  className="whitespace-nowrap rounded-xl bg-background-tertiary px-3 text-xs font-semibold text-content-accent ring-1 ring-border-opaque active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
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
                  className={`rounded-xl px-3.5 py-2 text-sm active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
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
                  className={`flex-1 rounded-xl py-2.5 text-sm active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
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
                className="text-xs font-semibold text-content-accent active:scale-95 transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              >
                Change
              </button>
            </div>
          </Field>
        </div>
      </BlurFade>

      {/* Save */}
      <BlurFade delay={0.4}>
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          className="mt-6 w-full rounded-2xl bg-interactive-primary py-4 text-base font-bold text-interactive-primary-text disabled:opacity-40 active:scale-[0.98] transition-all duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        >
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save Changes"}
        </button>
      </BlurFade>

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
