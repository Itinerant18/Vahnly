"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { auth } from "@/lib/firebase";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  signInWithCredential,
  linkWithCredential,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { persistRefresh } from "@/lib/api/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

interface PhoneVerifyScreenProps {
  /** Called after phone verified + backend JWT received */
  onVerified: (jwt: string, isNewUser: boolean) => void;
  /** Firebase user from prior Google/Email step. Null = direct phone sign-in. */
  existingFirebaseUser?: User | null;
  userType: "driver" | "rider";
  title?: string;
}

export default function PhoneVerifyScreen({
  onVerified,
  existingFirebaseUser,
  userType,
  title = "Verify Your Mobile Number",
}: PhoneVerifyScreenProps) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [verificationId, setVerificationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState(0);

  const recaptchaContainerRef = useRef<HTMLDivElement>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Initialize invisible reCAPTCHA once the container is in the DOM.
  useEffect(() => {
    if (!recaptchaContainerRef.current || !auth) return;
    recaptchaVerifierRef.current = new RecaptchaVerifier(
      auth,
      recaptchaContainerRef.current,
      {
        size: "invisible",
        callback: () => {},
        "expired-callback": () => setError("reCAPTCHA expired. Try again."),
      },
    );
    return () => {
      try { recaptchaVerifierRef.current?.clear(); } catch { /* ignore */ }
      recaptchaVerifierRef.current = null;
    };
  }, []);

  // Resend countdown timer.
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const formatE164 = (raw: string) => {
    const digits = raw.replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) return "+" + digits;
    if (digits.length === 10) return "+91" + digits;
    return "+" + digits;
  };

  const handleSendOTP = async () => {
    if (phone.length < 10) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (Capacitor.isNativePlatform()) {
        // Native path: use @capacitor-firebase/authentication (no reCAPTCHA needed).
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        const vId = await new Promise<string>((resolve, reject) => {
          FirebaseAuthentication.addListener("phoneCodeSent", (event: { verificationId: string }) => {
            resolve(event.verificationId);
          })
            .then((handle) => {
              FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: formatE164(phone) }).catch((err) => {
                void handle.remove();
                reject(err);
              });
            })
            .catch(reject);
        });
        setVerificationId(vId);
      } else {
        // Web path: invisible reCAPTCHA + Firebase JS SDK.
        if (!auth) {
          setError("Firebase not initialized.");
          setLoading(false);
          return;
        }
        if (!recaptchaVerifierRef.current) {
          recaptchaVerifierRef.current = new RecaptchaVerifier(
            auth,
            recaptchaContainerRef.current!,
            { size: "invisible", callback: () => {} },
          );
        }
        const result: ConfirmationResult = await signInWithPhoneNumber(
          auth,
          formatE164(phone),
          recaptchaVerifierRef.current,
        );
        setVerificationId(result.verificationId);
      }
      setStep("otp");
      setOtp(["", "", "", "", "", ""]);
      setCountdown(30);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/invalid-phone-number") setError("Invalid phone number.");
      else if (code === "auth/too-many-requests") setError("Too many attempts. Try later.");
      else setError("Failed to send OTP. Try again.");
      // Reset verifier for next attempt (web only).
      try { recaptchaVerifierRef.current?.clear(); } catch { /* ignore */ }
      recaptchaVerifierRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = useCallback(async () => {
    const code = otp.join("");
    if (code.length < 6) return;
    setLoading(true);
    setError("");
    try {
      let firebaseIdToken: string;

      if (Capacitor.isNativePlatform()) {
        // Native path: confirm via @capacitor-firebase/authentication.
        const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
        await FirebaseAuthentication.confirmVerificationCode({
          verificationId,
          verificationCode: code,
        });
        const { token } = await FirebaseAuthentication.getIdToken();
        firebaseIdToken = token;
      } else {
        // Web path: use credential from verificationId.
        const credential = PhoneAuthProvider.credential(verificationId, code);
        if (existingFirebaseUser) {
          const uc = await linkWithCredential(existingFirebaseUser, credential);
          firebaseIdToken = await uc.user.getIdToken(true);
        } else {
          if (!auth) throw new Error("Firebase not initialized.");
          const uc = await signInWithCredential(auth, credential);
          firebaseIdToken = await uc.user.getIdToken();
        }
      }

      const res = await fetch(`${API_URL}/api/v1/auth/firebase/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firebase_id_token: firebaseIdToken, user_type: userType }),
      });
      const data: { success: boolean; is_new_user: boolean; data?: { token: string; refresh_token?: string }; message?: string } = await res.json();
      if (!data.success || !data.data?.token) {
        throw new Error(data.message ?? "Verification failed.");
      }
      persistRefresh(data.data.refresh_token ?? null);
      onVerified(data.data.token, data.is_new_user);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/invalid-verification-code") {
        setError("Incorrect OTP. Try again.");
        setOtp(["", "", "", "", "", ""]);
        otpRefs.current[0]?.focus();
      } else if (code === "auth/code-expired") {
        setError("OTP expired. Request a new one.");
        setStep("phone");
      } else {
        setError((err as Error).message || "Verification failed. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [otp, verificationId, existingFirebaseUser, userType, onVerified]);

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
      {/* Invisible reCAPTCHA mount point */}
      <div ref={recaptchaContainerRef} id="recaptcha-container-phone-verify" />

      {/* Top hero */}
      <div className="flex flex-[2] flex-col items-center justify-center gap-4 px-6 pt-safe-top">
        <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-interactive-primary shadow-elevation-2">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="2" width="14" height="20" rx="2" stroke="white" strokeWidth="2" />
            <circle cx="12" cy="18" r="1" fill="white" />
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
            <button
              className="flex h-14 w-full items-center justify-center rounded-sm
                bg-interactive-primary text-interactive-primary-text
                text-label-large font-medium shadow-elevation-1 transition-base
                hover:opacity-90 active:scale-[0.98]
                disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
              disabled={loading || phone.length < 10}
              onClick={handleSendOTP}
            >
              {loading ? "Sending…" : "Send OTP"}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h2 className="text-heading-medium text-content-primary mb-1">Enter 6-digit OTP</h2>
              <p className="text-paragraph-small text-content-secondary">
                Sent to +91 {phone.slice(-10)}
              </p>
            </div>
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
                onClick={() => { setStep("phone"); setOtp(["", "", "", "", "", ""]); setError(""); }}
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
          🔒 Secured by Firebase · For trip communication only
        </p>
      </div>
    </main>
  );
}
