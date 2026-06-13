"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/store/authStore";
import { ApiError } from "@/lib/api/client";

export default function OnboardingPage() {
  const router = useRouter();
  const { rider, setRider } = useAuthStore();
  const [step, setStep] = useState<"profile" | "car">("profile");
  const [name, setName] = useState(rider?.name ?? "");
  const [email, setEmail] = useState(rider?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const onSaveProfile = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const updated = await authApi.updateProfile({
        name: trimmedName,
        // Email is optional — only send it when provided so the backend
        // doesn't reject an empty string.
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
      });
      setRider(updated);
      setStep("car");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Could not save your details. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background-primary px-6 pt-16">
      {step === "profile" ? (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-content-primary">Tell us about you</h1>
            <p className="mt-1 text-sm text-content-secondary">
              Your driver uses your name at pickup. Email is optional.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">
                Full Name
              </label>
              <input
                className="w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none ring-1 ring-border-opaque placeholder:text-content-tertiary focus:ring-2 focus:ring-border-accent"
                placeholder="e.g. Aniket Karmakar"
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim().length >= 2) onSaveProfile();
                }}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-content-secondary">
                Email <span className="text-content-tertiary">(optional)</span>
              </label>
              <input
                className="w-full rounded-xl bg-background-tertiary px-4 py-3 text-sm text-content-primary outline-none ring-1 ring-border-opaque placeholder:text-content-tertiary focus:ring-2 focus:ring-border-accent"
                placeholder="you@example.com"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button
              className="mt-2 flex h-14 w-full items-center justify-center rounded-xl bg-interactive-primary text-base font-bold text-interactive-primary-text shadow-elevation-2 disabled:opacity-50"
              disabled={saving || name.trim().length < 2}
              onClick={onSaveProfile}
            >
              {saving ? (
                <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                </svg>
              ) : (
                "Continue"
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl bg-surface-negative px-4 py-3 text-sm text-content-negative">
              {error}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-content-primary">Add your car</h1>
            <p className="mt-1 text-sm text-content-secondary">
              You hire a driver for your own car. Add it now, or later from your
              account.
            </p>
          </div>

          <button
            className="flex h-14 w-full items-center justify-center rounded-xl bg-interactive-primary text-base font-bold text-interactive-primary-text shadow-elevation-2"
            onClick={() => router.replace("/account/garage")}
          >
            Add my car
          </button>
          <button
            className="mt-3 w-full py-3 text-sm text-content-secondary"
            onClick={() => router.replace("/home")}
          >
            Skip for now
          </button>
        </>
      )}
    </main>
  );
}
