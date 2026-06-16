"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { getGoogleIdToken } from "@/lib/googleAuth";
import { startPhoneVerification } from "@/lib/phoneAuth";
import type { ConfirmationResult } from "firebase/auth";

// ── 6-box OTP input with auto-advance + paste ────────────────────────────────
function OtpInput({ onComplete }: { onComplete: (otp: string) => void }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[i] = digit;
    setDigits(next);
    if (digit && i < 5) refs.current[i + 1]?.focus();
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      const next = text.split("");
      setDigits(next);
      refs.current[5]?.focus();
      onComplete(text);
    }
    e.preventDefault();
  };

  return (
    <div className="flex gap-2" onPaste={handlePaste} role="group" aria-label="OTP code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          value={d}
          autoFocus={i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          aria-label={`OTP digit ${i + 1}`}
          className="h-14 w-full rounded-sm border border-border-opaque bg-background-secondary
            text-center font-mono text-display-small text-content-primary
            caret-accent-400 outline-none
            focus:border-2 focus:border-border-accent focus:ring-0
            transition-base"
        />
      ))}
    </div>
  );
}

// ── Resend timer ─────────────────────────────────────────────────────────────
function ResendTimer({ onResend }: { onResend: () => void }) {
  const [seconds, setSeconds] = useState(30);

  useEffect(() => {
    if (seconds === 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  if (seconds > 0) {
    return (
      <p className="text-center text-paragraph-small text-content-tertiary">
        Resend OTP in{" "}
        <span className="font-mono text-content-primary">{seconds}s</span>
      </p>
    );
  }

  return (
    <button
      onClick={() => { setSeconds(30); onResend(); }}
      className="w-full text-center text-label-medium text-content-accent
        hover:opacity-80 transition-base min-h-[44px]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
    >
      Resend OTP
    </button>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="animate-spin" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
    </svg>
  );
}

// ── Logo SVG ─────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-interactive-primary shadow-elevation-2">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L3 8v13h6v-5h6v5h6V8L12 2z" fill="white" strokeLinejoin="round" />
        <circle cx="12" cy="11" r="2" fill="white" opacity="0.8" />
      </svg>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const { sendOTP, verifyOTP, googleLogin, isLoading } = useAuthStore();
  const [step, setStep] = useState<"phone" | "otp" | "google-register">("phone");
  const [phone, setPhone] = useState("");
  const [referral, setReferral] = useState("");
  const [error, setError] = useState("");
  const [googleRegInfo, setGoogleRegInfo] = useState<{ idToken: string; email: string; name: string } | null>(null);
  const [googleOtpSent, setGoogleOtpSent] = useState(false);
  const [googleOtp, setGoogleOtp] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);

  const onSendOTP = async () => {
    setError("");
    try {
      await sendOTP(`+91${phone.replace(/\D/g, "")}`);
      setStep("otp");
    } catch {
      setError("Could not send OTP. Check the number and try again.");
    }
  };

  const onVerify = useCallback(async (otp: string) => {
    setError("");
    try {
      const { isNew } = await verifyOTP(`+91${phone.replace(/\D/g, "")}`, otp, referral || undefined);
      router.replace(isNew ? "/onboarding" : "/home");
    } catch {
      setError("Incorrect or expired OTP. Please try again.");
    }
  }, [phone, referral, verifyOTP, router]);

  const handleGoogleSignIn = async () => {
    setError("");
    try {
      const idToken = await getGoogleIdToken();
      const res = await googleLogin(idToken);
      if (!res.registered) {
        setGoogleRegInfo({
          idToken,
          email: res.email || "",
          name: res.name || "",
        });
        setStep("google-register");
      } else {
        router.replace(res.isNew ? "/onboarding" : "/home");
      }
    } catch (err: any) {
      setError(err.message || "Google sign-in failed. Please try again.");
    }
  };

  const sendGoogleOtp = async () => {
    setError("");
    try {
      // Firebase Phone Auth sends the real SMS (invisible reCAPTCHA).
      const conf = await startPhoneVerification(`+91${phone.replace(/\D/g, "")}`);
      setConfirmation(conf);
      setGoogleOtpSent(true);
    } catch {
      setError("Could not send OTP. Check the number and try again.");
    }
  };

  const onCompleteGoogleRegistration = async () => {
    if (!googleRegInfo || !confirmation) return;
    setError("");
    try {
      // Confirm the SMS code → the verified phone user's Firebase ID token carries the
      // phone_number claim that the backend trusts to register the rider.
      const cred = await confirmation.confirm(googleOtp);
      const phoneToken = await cred.user.getIdToken();
      const res = await googleLogin(googleRegInfo.idToken, {
        phone_token: phoneToken,
        name: googleRegInfo.name,
        referred_by_code: referral || undefined,
      });
      if (res.registered) {
        router.replace(res.isNew ? "/onboarding" : "/home");
      } else {
        setError("Registration incomplete. Please verify your details.");
      }
    } catch (err: any) {
      setError(err.message || "Incorrect or expired OTP. Please try again.");
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background-primary">

      {/* ── Top hero (40%) ── */}
      <div className="flex flex-[2] flex-col items-center justify-center gap-4 px-6 pt-safe-top">
        <Logo />
        <div className="text-center">
          <h1 className="text-display-small text-content-primary mt-4">Vahnly</h1>
          <p className="text-paragraph-large text-content-secondary mt-2">
            Your car. Our driver.
          </p>
        </div>
      </div>

      {/* ── Bottom card (60%) ── */}
      <div className="flex-[3] bg-background-secondary rounded-t-lg shadow-elevation-3 px-6 pt-8 pb-safe-bottom overflow-y-auto">

        {step === "phone" ? (
          <div className="space-y-5">
            <h2 className="text-heading-medium text-content-primary">
              Enter your mobile number
            </h2>

            {/* Phone input row */}
            <div className="flex gap-2">
              {/* Country code button */}
              <div className="flex h-12 items-center gap-1.5 rounded-sm border border-border-opaque bg-background-tertiary px-3 flex-shrink-0">
                <span className="text-lg">🇮🇳</span>
                <span className="text-label-medium text-content-primary">+91</span>
              </div>
              {/* Phone number */}
              <input
                className="h-12 flex-1 rounded-sm border border-border-opaque bg-background-primary
                  px-4 font-mono text-mono-medium text-content-primary
                  placeholder:text-content-tertiary
                  outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400
                  transition-base"
                placeholder="98765 43210"
                inputMode="numeric"
                type="tel"
                value={phone}
                maxLength={10}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => { if (e.key === "Enter" && phone.length === 10) onSendOTP(); }}
              />
            </div>

            {/* Referral code */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">
                Referral Code (optional)
              </label>
              <input
                className="h-12 w-full rounded-sm border border-border-opaque bg-background-primary
                  px-4 font-mono text-mono-small text-content-primary uppercase
                  placeholder:text-content-tertiary
                  outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400
                  transition-base"
                placeholder="e.g. DFU1A2B3"
                value={referral}
                onChange={(e) => setReferral(e.target.value.toUpperCase())}
              />
            </div>

            {/* Send OTP button */}
            <button
              className="flex h-14 w-full items-center justify-center rounded-sm
                bg-interactive-primary text-interactive-primary-text
                text-label-large font-medium
                shadow-elevation-1 transition-base
                hover:opacity-90 active:scale-[0.98]
                disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
              style={{
                boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                WebkitTapHighlightColor: "transparent",
              }}
              disabled={isLoading || phone.length !== 10}
              onClick={onSendOTP}
            >
              {isLoading ? <Spinner /> : "Send OTP"}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-border-opaque" />
              <span className="text-label-small text-content-tertiary">or</span>
              <div className="flex-1 border-t border-border-opaque" />
            </div>

            {/* Social buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="flex h-12 items-center justify-center gap-2 rounded-sm
                  bg-background-primary border border-border-opaque
                  text-label-medium text-content-primary
                  cursor-pointer hover:bg-background-secondary active:scale-[0.98] transition-base
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                disabled={isLoading}
              >
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Google
              </button>
              <button
                type="button"
                className="flex h-12 items-center justify-center gap-2 rounded-sm
                  bg-background-primary border border-border-opaque
                  text-label-medium text-content-primary
                  opacity-50 cursor-not-allowed relative"
                disabled
                title="Coming soon"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                Apple
                <span className="absolute -top-1.5 -right-1.5 rounded-pill bg-background-tertiary px-1.5 py-0.5 text-label-small text-content-tertiary text-[9px]">
                  Soon
                </span>
              </button>
            </div>
          </div>
        ) : step === "otp" ? (
          /* ── OTP step ── */
          <div className="space-y-5">
            <div>
              <h2 className="text-heading-medium text-content-primary mb-1">
                Enter 6-digit OTP
              </h2>
              <p className="text-paragraph-small text-content-secondary">
                Sent to +91 {phone}
              </p>
            </div>

            <OtpInput onComplete={onVerify} />

            {isLoading && (
              <div className="flex items-center justify-center gap-2 text-content-secondary">
                <Spinner size={16} />
                <span className="text-paragraph-small">Verifying…</span>
              </div>
            )}

            <ResendTimer onResend={() => sendOTP(`+91${phone}`).catch(() => {})} />

            <button
              className="w-full text-center text-label-medium text-content-secondary py-3 min-h-[44px]
                hover:text-content-primary transition-base
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              onClick={() => setStep("phone")}
            >
              Change number
            </button>
          </div>
        ) : (
          /* ── Google Registration Gate step ── */
          <div className="space-y-5">
            <div>
              <h2 className="text-heading-medium text-content-primary mb-1">
                Complete Registration
              </h2>
              <p className="text-paragraph-small text-content-secondary">
                We need a few details to set up your account.
              </p>
            </div>

            {/* Email (Readonly representation) */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">
                Email
              </label>
              <input
                className="h-12 w-full rounded-sm border border-border-opaque bg-background-tertiary
                  px-4 text-content-secondary cursor-not-allowed outline-none"
                value={googleRegInfo?.email || ""}
                disabled
                readOnly
              />
            </div>

            {/* Name */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">
                Full Name
              </label>
              <input
                className="h-12 w-full rounded-sm border border-border-opaque bg-background-primary
                  px-4 font-sans text-content-primary
                  placeholder:text-content-tertiary
                  outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400
                  transition-base"
                placeholder="Full Name"
                type="text"
                value={googleRegInfo?.name || ""}
                onChange={(e) =>
                  setGoogleRegInfo((prev) =>
                    prev ? { ...prev, name: e.target.value } : null,
                  )
                }
              />
            </div>

            {/* Phone input row */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">
                Mobile Number
              </label>
              <div className="flex gap-2">
                <div className="flex h-12 items-center gap-1.5 rounded-sm border border-border-opaque bg-background-tertiary px-3 flex-shrink-0">
                  <span className="text-lg">🇮🇳</span>
                  <span className="text-label-medium text-content-primary">+91</span>
                </div>
                <input
                  className="h-12 flex-1 rounded-sm border border-border-opaque bg-background-primary
                    px-4 font-mono text-mono-medium text-content-primary
                    placeholder:text-content-tertiary
                    outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400
                    transition-base"
                  placeholder="98765 43210"
                  inputMode="numeric"
                  type="tel"
                  value={phone}
                  maxLength={10}
                  onChange={(e) => {
                    setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setGoogleOtpSent(false);
                    setGoogleOtp("");
                  }}
                />
              </div>

              {/* The number must be verified by OTP before the account is created. */}
              {!googleOtpSent ? (
                <button
                  type="button"
                  onClick={sendGoogleOtp}
                  disabled={isLoading || phone.length !== 10}
                  className="mt-2 flex h-11 w-full items-center justify-center rounded-sm
                    border border-border-opaque bg-background-primary
                    text-label-medium text-content-primary
                    disabled:opacity-50 disabled:cursor-not-allowed
                    hover:bg-background-secondary active:scale-[0.98] transition-base
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
                >
                  {isLoading ? <Spinner size={16} /> : "Send OTP to verify number"}
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-paragraph-small text-content-secondary">
                    Enter the 6-digit OTP sent to +91 {phone}
                  </p>
                  <OtpInput onComplete={(o) => setGoogleOtp(o)} />
                  <ResendTimer onResend={() => sendGoogleOtp()} />
                </div>
              )}
            </div>

            {/* Referral code */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">
                Referral Code (optional)
              </label>
              <input
                className="h-12 w-full rounded-sm border border-border-opaque bg-background-primary
                  px-4 font-mono text-mono-small text-content-primary uppercase
                  placeholder:text-content-tertiary
                  outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400
                  transition-base"
                placeholder="e.g. DFU1A2B3"
                value={referral}
                onChange={(e) => setReferral(e.target.value.toUpperCase())}
              />
            </div>

            {/* Complete Registration button */}
            <button
              className="flex h-14 w-full items-center justify-center rounded-sm
                bg-interactive-primary text-interactive-primary-text
                text-label-large font-medium
                shadow-elevation-1 transition-base
                hover:opacity-90 active:scale-[0.98]
                disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2"
              style={{
                boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                WebkitTapHighlightColor: "transparent",
              }}
              disabled={isLoading || phone.length !== 10 || googleOtp.length !== 6}
              onClick={onCompleteGoogleRegistration}
            >
              {isLoading ? <Spinner /> : "Complete Registration"}
            </button>

            <button
              className="w-full text-center text-label-medium text-content-secondary py-3 min-h-[44px]
                hover:text-content-primary transition-base
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              onClick={() => {
                setStep("phone");
                setGoogleRegInfo(null);
                setGoogleOtpSent(false);
                setGoogleOtp("");
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Invisible reCAPTCHA mount point for Firebase Phone Auth */}
        <div id="recaptcha-container" />

        {/* Error banner */}
        {error && (
          <div className="mt-4 rounded-sm bg-surface-negative border border-negative-200 px-4 py-3">
            <p className="text-paragraph-small text-content-negative">{error}</p>
          </div>
        )}

        {/* Terms */}
        <p className="mt-8 pb-4 text-center text-label-small text-content-tertiary">
          By continuing, you agree to our{" "}
          <span className="text-content-accent cursor-pointer hover:underline">Terms of Service</span>{" "}
          and{" "}
          <span className="text-content-accent cursor-pointer hover:underline">Privacy Policy</span>
        </p>
      </div>
    </main>
  );
}
