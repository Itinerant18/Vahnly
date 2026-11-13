"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { persistRefresh } from "@/lib/api/client";
import { authApi } from "@/lib/api/auth";

interface PhoneVerifyScreenProps {
  /** Called after phone verified + backend JWT received */
  onVerified: (jwt: string, isNewUser: boolean) => void;
  userType?: "driver" | "rider";
  title?: string;
  /** Optional: show a back link on the phone step (returns to the caller's screen). */
  onBack?: () => void;
}

export default function PhoneVerifyScreen({
  onVerified,
  userType = "rider",
  title = "Verify Your Mobile Number",
  onBack,
}: PhoneVerifyScreenProps) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [testCode, setTestCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend countdown timer.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const handleSendOTP = async (customPhone?: string) => {
    const targetPhone = (customPhone || phone).replace(/\D/g, "").slice(-10);
    if (targetPhone.length < 10) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await authApi.sendOTP(targetPhone);
      const code = res.test_code || (res.method_id?.startsWith("dev-") || res.method_id?.startsWith("mock-") ? "123456" : null);
      setTestCode(code);
      setStep("otp");
      setOtp(["", "", "", "", "", ""]);
      setCountdown(30);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to send OTP. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = useCallback(async () => {
    const code = otp.join("");
    if (code.length < 6) return;
    setLoading(true);
    setError("");
    const cleanPhone = phone.replace(/\D/g, "").slice(-10);
    try {
      const res = await authApi.verifyOTP(cleanPhone, code);
      if (!res.token) {
        throw new Error("Verification failed: no token received.");
      }
      if (res.refresh_token) {
        persistRefresh(res.refresh_token);
      }
      onVerified(res.token, res.is_new ?? res.is_new_rider ?? false);
    } catch (err: unknown) {
      setError((err as Error).message || "Incorrect or expired OTP. Please try again.");
      setOtp(["", "", "", "", "", ""]);
      otpRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }, [otp, phone, onVerified]);

  // Auto-submit when all 6 digits filled.
  useEffect(() => {
    if (otp.every((d) => d !== "") && step === "otp" && !loading) {
      handleVerifyOTP();
    }
  }, [otp, step, loading, handleVerifyOTP]);

  const handleOTPChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    if (digit && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const handleOTPKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };

  const handleOTPPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split(""));
      otpRefs.current[5]?.focus();
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-background-primary">
      {/* Top hero */}
      <div className="flex flex-[2] flex-col items-center justify-center gap-4 px-6 pt-safe-top">
        <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-interactive-primary shadow-elevation-2">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="2" width="14" height="20" rx="2" stroke="#111827" strokeWidth="2" />
            <circle cx="12" cy="18" r="1" fill="#111827" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-display-small text-content-primary mt-4">{title}</h1>
          <p className="text-paragraph-large text-content-secondary mt-2">
            {step === "phone"
              ? "We'll send a one-time code to verify your number."
              : `Code sent to +91 ${phone.slice(-10)}`}
          </p>
        </div>
      </div>

      {/* Bottom card */}
      <div className="flex-[3] bg-background-secondary rounded-t-lg shadow-elevation-3 px-6 pt-8 pb-safe-bottom">

        {error && (
          <div className="mb-4 rounded-sm bg-surface-negative border border-negative-200 px-4 py-3">
            <p className="text-paragraph-small text-content-negative">{error}</p>
          </div>
        )}

        {step === "phone" ? (
          <div className="space-y-5">
            <h2 className="text-heading-medium text-content-primary">Enter your mobile number</h2>
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
                autoFocus
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => { if (e.key === "Enter" && phone.length === 10) handleSendOTP(); }}
              />
            </div>

            {/* Quick Test Rider Numbers */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-content-tertiary pt-1">
              <span className="font-medium">Quick Test:</span>
              <button
                type="button"
                onClick={() => { setPhone("7602676448"); handleSendOTP("7602676448"); }}
                className="underline hover:text-accent-400 cursor-pointer text-content-secondary transition"
              >
                76026 76448
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => { setPhone("9933632763"); handleSendOTP("9933632763"); }}
                className="underline hover:text-accent-400 cursor-pointer text-content-secondary transition"
              >
                99336 32763
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => { setPhone("9775104726"); handleSendOTP("9775104726"); }}
                className="underline hover:text-accent-400 cursor-pointer text-content-secondary transition"
              >
                97751 04726
              </button>
            </div>

            <button
              className="flex h-14 w-full items-center justify-center rounded-sm
                bg-interactive-primary text-interactive-primary-text
                text-label-large font-medium shadow-elevation-1 transition-base
                hover:opacity-90 active:scale-[0.98]
                disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              disabled={loading || phone.length < 10}
              onClick={() => handleSendOTP()}
            >
              {loading ? "Sending…" : "Send OTP"}
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="w-full text-center text-label-medium text-content-secondary py-3 min-h-[44px]
                  hover:text-content-primary transition-base"
              >
                ← Back
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h2 className="text-heading-medium text-content-primary mb-1">Enter 6-digit OTP</h2>
              <p className="text-paragraph-small text-content-secondary">
                Sent to +91 {phone.slice(-10)}
              </p>
            </div>

            {testCode && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-paragraph-small py-2.5 px-3 rounded-sm flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm">🧪 Test Mode: Code is <strong className="font-mono text-emerald-300 font-bold">{testCode}</strong></span>
                <button
                  type="button"
                  onClick={() => setOtp(testCode.split(""))}
                  className="bg-emerald-500 text-background-primary text-label-small font-bold px-2.5 py-1 rounded-sm hover:bg-emerald-400 transition cursor-pointer shrink-0"
                >
                  Auto-fill
                </button>
              </div>
            )}

            <div
              className="flex gap-2"
              onPaste={handleOTPPaste}
              role="group"
              aria-label="OTP code"
            >
              {otp.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={d}
                  autoFocus={i === 0}
                  onChange={(e) => handleOTPChange(i, e.target.value)}
                  onKeyDown={(e) => handleOTPKeyDown(i, e)}
                  aria-label={`OTP digit ${i + 1}`}
                  className="h-14 w-full rounded-sm border border-border-opaque bg-background-primary
                    text-center font-mono text-display-small text-content-primary
                    caret-accent-400 outline-none
                    focus:border-2 focus:border-border-accent
                    transition-base"
                />
              ))}
            </div>
            {loading && (
              <div className="flex items-center justify-center gap-2 text-content-secondary">
                <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40 20" />
                </svg>
                <span className="text-paragraph-small">Verifying…</span>
              </div>
            )}
            {countdown > 0 ? (
              <p className="text-center text-paragraph-small text-content-tertiary">
                Resend in <span className="font-mono text-content-primary">{countdown}s</span>
              </p>
            ) : (
              <button
                onClick={() => { handleSendOTP(); }}
                className="w-full text-center text-label-medium text-content-accent
                  hover:opacity-80 transition-base min-h-[44px]"
              >
                Resend OTP
              </button>
            )}
            <button
              className="w-full text-center text-label-medium text-content-secondary py-3 min-h-[44px]
                hover:text-content-primary transition-base"
              onClick={() => { setStep("phone"); setOtp(["", "", "", "", "", ""]); setError(""); }}
            >
              ← Change number
            </button>
          </div>
        )}

        <p className="mt-8 pb-4 text-center text-label-small text-content-tertiary">
          🔒 Secure Verification • Vahnly Rider
        </p>
      </div>
    </main>
  );
}
