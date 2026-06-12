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
    <main className="flex min-h-screen flex-col bg-[#0A0A0A] px-6 pt-16">
      {step === "profile" ? (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Tell us about you</h1>
            <p className="mt-1 text-sm text-[#9CA3AF]">
              Your driver uses your name at pickup. Email is optional.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#9CA3AF]">
                Full Name
              </label>
              <input
                className="w-full rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-[#9CA3AF] focus:ring-2 focus:ring-[#FF6B35]"
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
              <label className="mb-1.5 block text-xs font-medium text-[#9CA3AF]">
                Email <span className="text-[#6B7280]">(optional)</span>
              </label>
              <input
                className="w-full rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-[#9CA3AF] focus:ring-2 focus:ring-[#FF6B35]"
                placeholder="you@example.com"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <button
              className="mt-2 flex h-14 w-full items-center justify-center rounded-xl bg-[#FF6B35] text-base font-bold text-white shadow-lg shadow-[#FF6B35]/20 disabled:opacity-50"
              disabled={saving || name.trim().length < 2}
              onClick={onSaveProfile}
            >
              {saving ? (
                <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="40 20" />
                </svg>
              ) : (
                "Continue"
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
              {error}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white">Add your car</h1>
            <p className="mt-1 text-sm text-[#9CA3AF]">
              You hire a driver for your own car. Add it now, or later from your
              account.
            </p>
          </div>

          <button
            className="flex h-14 w-full items-center justify-center rounded-xl bg-[#FF6B35] text-base font-bold text-white shadow-lg shadow-[#FF6B35]/20"
            onClick={() => router.replace("/account/garage")}
          >
            Add my car
          </button>
          <button
            className="mt-3 w-full py-3 text-sm text-[#9CA3AF]"
            onClick={() => router.replace("/home")}
          >
            Skip for now
          </button>
        </>
      )}
    </main>
  );
}
