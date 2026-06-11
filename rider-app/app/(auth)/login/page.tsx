"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";

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
    <div className="flex gap-2" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="tel"
          inputMode="numeric"
          maxLength={1}
          value={d}
          autoFocus={i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          className="h-14 w-full rounded-xl bg-[#1E1E1E] text-center text-xl font-bold text-white caret-[#FF6B35] outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-[#FF6B35]"
        />
      ))}
    </div>
  );
}

function ResendTimer({ onResend }: { onResend: () => void }) {
  const [seconds, setSeconds] = useState(30);

  useEffect(() => {
    if (seconds === 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  if (seconds > 0) {
    return (
      <p className="text-center text-sm text-[#9CA3AF]">
        Resend OTP in <span className="text-white">{seconds}s</span>
      </p>
    );
  }

  return (
    <button
      onClick={() => { setSeconds(30); onResend(); }}
      className="w-full text-center text-sm font-medium text-[#FF6B35]"
    >
      Resend OTP
    </button>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { sendOTP, verifyOTP, isLoading } = useAuthStore();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [referral, setReferral] = useState("");
  const [error, setError] = useState("");

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

  return (
    <main className="flex min-h-screen flex-col bg-[#0A0A0A] px-6 pt-16">
      {/* Logo */}
      <div className="mb-10 flex flex-col items-center gap-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FF6B35]">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M3 17l2.5-7.5L9 12l3-8 3 8 3.5-2.5L21 17H3z" fill="white" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white">Drivers-for-u</h1>
          <p className="mt-1 text-sm text-[#9CA3AF]">Your car. Our driver.</p>
        </div>
      </div>

      {step === "phone" ? (
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#9CA3AF]">Mobile Number</label>
            <div className="flex overflow-hidden rounded-xl bg-[#1E1E1E] ring-1 ring-white/10 focus-within:ring-2 focus-within:ring-[#FF6B35]">
              <div className="flex items-center gap-1.5 border-r border-white/10 px-3 py-3">
                <span className="text-sm">🇮🇳</span>
                <span className="text-sm font-medium text-white">+91</span>
              </div>
              <input
                className="flex-1 bg-transparent px-4 py-3 text-sm text-white outline-none placeholder:text-[#9CA3AF]"
                placeholder="10-digit number"
                inputMode="tel"
                value={phone}
                maxLength={10}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                onKeyDown={(e) => { if (e.key === "Enter" && phone.length === 10) onSendOTP(); }}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#9CA3AF]">Referral Code (optional)</label>
            <input
              className="w-full rounded-xl bg-[#1E1E1E] px-4 py-3 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-[#9CA3AF] focus:ring-2 focus:ring-[#FF6B35]"
              placeholder="e.g. DFU1A2B3"
              value={referral}
              onChange={(e) => setReferral(e.target.value.toUpperCase())}
            />
          </div>

          <button
            className="mt-2 flex h-14 w-full items-center justify-center rounded-xl bg-[#FF6B35] text-base font-bold text-white shadow-lg shadow-[#FF6B35]/20 disabled:opacity-50"
            disabled={isLoading || phone.length !== 10}
            onClick={onSendOTP}
          >
            {isLoading ? (
              <svg className="animate-spin" width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="40 20" />
              </svg>
            ) : "Send OTP"}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-xs font-medium text-[#9CA3AF]">
              Enter OTP sent to +91 {phone}
            </p>
            <OtpInput onComplete={onVerify} />
          </div>

          {isLoading && (
            <div className="flex items-center justify-center gap-2 text-sm text-[#9CA3AF]">
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#9CA3AF" strokeWidth="3" strokeDasharray="40 20" />
              </svg>
              Verifying…
            </div>
          )}

          <ResendTimer onResend={() => sendOTP(`+91${phone}`).catch(() => {})} />

          <button
            className="w-full py-2 text-sm text-[#9CA3AF]"
            onClick={() => setStep("phone")}
          >
            Change number
          </button>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl bg-[#EF4444]/10 px-4 py-3 text-sm text-[#EF4444]">
          {error}
        </div>
      )}

      {/* Social login stubs */}
      <div className="mt-8 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 border-t border-white/10" />
          <span className="text-xs text-[#9CA3AF]">or continue with</span>
          <div className="flex-1 border-t border-white/10" />
        </div>
        <div className="grid grid-cols-2 gap-3 opacity-50">
          <button className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1E1E1E] text-sm font-medium text-white ring-1 ring-white/10">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google
            <span className="text-[10px] text-[#9CA3AF]">(Soon)</span>
          </button>
          <button className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#1E1E1E] text-sm font-medium text-white ring-1 ring-white/10">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
            </svg>
            Apple
            <span className="text-[10px] text-[#9CA3AF]">(Soon)</span>
          </button>
        </div>
      </div>

      {/* Terms */}
      <p className="mt-auto pb-8 pt-6 text-center text-xs text-[#9CA3AF]">
        By continuing, you agree to our{" "}
        <span className="text-[#FF6B35]">Terms of Service</span> and{" "}
        <span className="text-[#FF6B35]">Privacy Policy</span>
      </p>
    </main>
  );
}
