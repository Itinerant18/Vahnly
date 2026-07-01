"use client";

import { useState, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/authStore";
import { getGoogleIdToken } from "@/lib/googleAuth";
import PhoneVerifyScreen from "@/components/auth/PhoneVerifyScreen";
import { authApi } from "@/lib/api/auth";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { TypingAnimation } from "@/components/ui/typing-animation";

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
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex h-20 w-20 items-center justify-center rounded-xl bg-interactive-primary shadow-elevation-2"
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="20" stroke="white" strokeWidth="2.5" fill="none" />
          <circle cx="24" cy="24" r="6" fill="white" />
          <rect x="22.5" y="4" width="3" height="12" rx="1.5" fill="white" />
          <rect x="22.5" y="32" width="3" height="12" rx="1.5" fill="white" />
          <rect x="4" y="22.5" width="12" height="3" rx="1.5" fill="white" />
          <rect x="32" y="22.5" width="12" height="3" rx="1.5" fill="white" />
        </svg>
      </motion.div>
    </motion.div>
  );
}

// ── OTP input (used only for the Google registration sub-flow) ───────────────
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
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = [...digits];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setDigits(next);
    const focusIdx = Math.min(pasted.length, 5);
    refs.current[focusIdx]?.focus();
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  };

  return (
    <div className="flex gap-2" role="group" aria-label="OTP code" onPaste={handlePaste}>
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
          className="h-14 w-10 rounded-md border border-border-opaque bg-background-secondary
            text-center font-mono text-display-small text-content-primary
            caret-accent-400 outline-none
            focus:border-2 focus:border-border-accent
            transition-base"
        />
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const router = useRouter();
  const { googleLogin, fetchMe, setToken, passwordLogin, forgotPassword, resetPassword, isLoading } = useAuthStore();

  type AuthStep = "choose" | "phone_verify" | "google-register" | "reset" | "set_password";
  const [step, setStep] = useState<AuthStep>("choose");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [referral, setReferral] = useState("");
  const [error, setError] = useState("");

  // Phone + password login (no OTP / no SMS)
  const [loginPhone, setLoginPhone] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  // Forgot / reset
  const [forgotOtp, setForgotOtp] = useState("");
  const [resetPw, setResetPw] = useState("");
  // Create-password (new rider, right after OTP verify)
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Google registration sub-flow state
  const [googleRegInfo, setGoogleRegInfo] = useState<{ idToken: string; email: string; name: string } | null>(null);
  const [googlePhone, setGooglePhone] = useState("");
  const [googleOtpSent, setGoogleOtpSent] = useState(false);
  const [googleConfirmation, setGoogleConfirmation] = useState<import("@/lib/phoneAuth").PhoneConfirmation | null>(null);
  const [googleOtp, setGoogleOtp] = useState("");

  // ── Phone OTP (primary) ──────────────────────────────────────────────────
  // PhoneVerifyScreen handles everything internally. When done it calls onVerified.
  const handlePhoneVerified = async (jwt: string, isNew: boolean) => {
    setToken(jwt);
    try { await fetchMe(); } catch { /* profile loads on next request */ }
    if (isNew) {
      // New rider — let them set a password now so every future login skips OTP (no SMS).
      setError("");
      setNewPw("");
      setStep("set_password");
    } else {
      router.replace("/home");
    }
  };

  const handleCreatePassword = async () => {
    setError("");
    if (newPw.length < 8) { setError("Password must be at least 8 characters."); return; }
    setSavingPw(true);
    try {
      await authApi.setPassword(newPw);
      router.replace("/onboarding");
    } catch (err: unknown) {
      setError((err as Error).message || "Could not set password. You can set it later in Settings.");
    } finally {
      setSavingPw(false);
    }
  };

  // ── Phone + password login ────────────────────────────────────────────────
  const handlePasswordLogin = async () => {
    setError("");
    const phone = loginPhone.replace(/\D/g, "");
    if (phone.length !== 10) { setError("Enter your 10-digit number."); return; }
    if (!loginPassword) { setError("Enter your password."); return; }
    try {
      await passwordLogin(phone, loginPassword);
      router.replace("/home");
    } catch (err: unknown) {
      setError((err as Error).message || "Invalid phone or password.");
    }
  };

  const handleForgotSend = async () => {
    setError("");
    const phone = loginPhone.replace(/\D/g, "");
    if (phone.length !== 10) { setError("Enter your registered 10-digit number first."); return; }
    try {
      await forgotPassword(phone);
      setForgotOtp("");
      setResetPw("");
      setStep("reset");
    } catch (err: unknown) {
      setError((err as Error).message || "Could not send the reset code.");
    }
  };

  const handleResetSubmit = async () => {
    setError("");
    const phone = loginPhone.replace(/\D/g, "");
    if (forgotOtp.length < 6) { setError("Enter the 6-digit code."); return; }
    if (resetPw.length < 8) { setError("New password must be at least 8 characters."); return; }
    try {
      await resetPassword(phone, forgotOtp, resetPw);
      router.replace("/home");
    } catch (err: unknown) {
      setError((err as Error).message || "Reset failed. Check the code and try again.");
    }
  };

  // ── Google sign-in ───────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setError("");
    try {
      const idToken = await getGoogleIdToken();
      const res = await googleLogin(idToken);
      if (!res.registered) {
        setGoogleRegInfo({ idToken, email: res.email ?? "", name: res.name ?? "" });
        setStep("google-register");
      } else {
        router.replace(res.isNew ? "/onboarding" : "/home");
      }
    } catch (err: unknown) {
      setError((err as Error).message || "Google sign-in failed. Please try again.");
    }
  };

  // Google registration: send OTP to verify the phone number.
  const sendGoogleOtp = async () => {
    setError("");
    try {
      const { startPhoneVerification } = await import("@/lib/phoneAuth");
      const conf = await startPhoneVerification(`+91${googlePhone.replace(/\D/g, "")}`);
      setGoogleConfirmation(conf);
      setGoogleOtpSent(true);
    } catch {
      setError("Could not send OTP. Check the number and try again.");
    }
  };

  const onCompleteGoogleRegistration = async () => {
    if (!googleRegInfo || !googleConfirmation) return;
    setError("");
    try {
      const phoneToken = await googleConfirmation.confirm(googleOtp);
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
    } catch (err: unknown) {
      setError((err as Error).message || "Incorrect or expired OTP. Please try again.");
    }
  };

  // ── Render: phone_verify step → full-screen PhoneVerifyScreen ───────────
  if (step === "phone_verify") {
    return (
      <PhoneVerifyScreen
        userType="rider"
        onVerified={handlePhoneVerified}
        onBack={() => { setStep("choose"); setError(""); }}
        title="Create Your Account"
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-background-primary">

      {/* ── Top hero ── */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pt-safe-top">
        <Logo />
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <h1 className="text-display-small text-content-primary mt-4" style={{ letterSpacing: "-0.02em" }}>Vahnly</h1>
          <TypingAnimation
            className="text-paragraph-large text-content-secondary mt-2 block"
            duration={25}
            delay={500}
            startOnView={false}
          >
            Your car. Our driver.
          </TypingAnimation>
        </motion.div>
      </div>

      {/* ── Bottom card ── */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex-[3] bg-background-secondary rounded-t-lg shadow-elevation-3 px-6 pt-8 pb-safe-bottom overflow-y-auto"
      >
        {/* Error banner */}
        {error && (
          <div className="mb-4 rounded-md bg-surface-negative border border-negative-200 px-4 py-3">
            <p className="text-paragraph-small text-content-negative">{error}</p>
          </div>
        )}

        <AnimatePresence mode="wait">
        {step === "choose" && (
          <motion.div
            key="choose"
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0, y: -12, transition: { duration: 0.15 } }}
            variants={{
              visible: { transition: { staggerChildren: 0.04 } },
            }}
            className="space-y-5"
          >
            {/* Log In / Sign Up segmented toggle */}
            <motion.div
              variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
            <div className="flex gap-1 rounded-md border border-border-opaque bg-background-primary p-1">
              <button
                type="button"
                onClick={() => { setMode("login"); setError(""); }}
                className={`flex-1 h-10 rounded-md text-label-medium font-medium transition-base ${
                  mode === "login"
                    ? "bg-interactive-primary text-interactive-primary-text shadow-elevation-1"
                    : "text-content-secondary hover:text-content-primary"
                }`}
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => { setMode("signup"); setError(""); }}
                className={`flex-1 h-10 rounded-md text-label-medium font-medium transition-base ${
                  mode === "signup"
                    ? "bg-interactive-primary text-interactive-primary-text shadow-elevation-1"
                    : "text-content-secondary hover:text-content-primary"
                }`}
              >
                Sign Up
              </button>
            </div>
            </motion.div>

            {mode === "login" ? (
              /* ── Returning user: phone + password (no OTP / no SMS) ── */
              <motion.div
                variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-3"
              >
                <h2 className="text-heading-medium text-content-primary">Welcome back</h2>
                <div className="flex gap-2">
                  <div className="flex h-12 items-center gap-1.5 rounded-md border border-border-opaque bg-background-tertiary px-3 flex-shrink-0">
                    <span className="text-lg">🇮🇳</span>
                    <span className="text-label-medium text-content-primary">+91</span>
                  </div>
                  <input
                    className="h-12 flex-1 rounded-md border border-border-opaque bg-background-primary px-4 font-mono text-mono-medium text-content-primary placeholder:text-content-tertiary outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
                    placeholder="98765 43210"
                    inputMode="numeric"
                    type="tel"
                    maxLength={10}
                    value={loginPhone}
                    onChange={(e) => setLoginPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  />
                </div>
                <input
                  className="h-12 w-full rounded-md border border-border-opaque bg-background-primary px-4 text-content-primary placeholder:text-content-tertiary outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
                  placeholder="Password"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handlePasswordLogin(); }}
                />
                <ShimmerButton
                  type="button"
                  disabled={isLoading}
                  onClick={handlePasswordLogin}
                  shimmerColor="rgba(255,255,255,0.3)"
                  background="var(--accent-400)"
                  borderRadius="8px"
                  className="h-14 text-label-large font-medium shadow-elevation-1"
                >
                  {isLoading ? <Spinner /> : "Log In"}
                </ShimmerButton>
                <button
                  type="button"
                  onClick={handleForgotSend}
                  disabled={isLoading}
                  className="w-full text-center text-label-small text-content-secondary py-2 min-h-[44px] hover:text-content-primary transition-base"
                >
                  Forgot password?
                </button>
                </motion.div>
              ) : (
                /* ── New user: verify number once, then set a password ── */
                <motion.div
                  variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-3"
                >
                  <h2 className="text-heading-medium text-content-primary">Create your account</h2>
                <p className="text-paragraph-small text-content-secondary">
                  Verify your number once with an OTP, then set a password. After that,
                  just log in with your password — no OTP, no SMS.
                </p>
                <ShimmerButton
                  type="button"
                  onClick={() => { setError(""); setStep("phone_verify"); }}
                  shimmerColor="rgba(255,255,255,0.3)"
                  background="var(--accent-400)"
                  borderRadius="8px"
                  className="h-14 text-label-large font-medium shadow-elevation-1"
                >
                  Sign up with phone number
                </ShimmerButton>

                {/* Referral code (new users only) */}
                <div className="pt-1">
                  <label className="text-label-small text-content-secondary block mb-1">
                    Referral Code (optional)
                  </label>
                  <input
                    className="h-12 w-full rounded-md border border-border-opaque bg-background-primary
                      px-4 font-mono text-mono-small text-content-primary uppercase
                      placeholder:text-content-tertiary
                      outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400
                      transition-base"
                    placeholder="e.g. DFU1A2B3"
                    value={referral}
                    onChange={(e) => setReferral(e.target.value.toUpperCase())}
                  />
                </div>
                </motion.div>
              )}

            {/* Divider */}
            <motion.div
              variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-border-opaque" />
              <span className="text-label-small text-content-secondary">or</span>
              <div className="flex-1 border-t border-border-opaque" />
            </div>
            </motion.div>

            {/* Social buttons (sign in OR sign up) */}
            <motion.div
              variants={{ hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0 } }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="flex h-12 items-center justify-center gap-2 rounded-md
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
                className="flex h-12 items-center justify-center gap-2 rounded-md
                  bg-background-primary border border-border-opaque
                  text-label-medium text-content-primary
                  opacity-50 cursor-not-allowed relative"
                disabled
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
            </motion.div>
          </motion.div>
        )}

        {step === "google-register" && (
          <motion.div
            key="google-register"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-5"
          >
            <div>
              <h2 className="text-heading-medium text-content-primary mb-1">Complete Registration</h2>
              <p className="text-paragraph-small text-content-secondary">
                We need a few details to set up your account.
              </p>
            </div>

            {/* Email readonly */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">Email</label>
              <input
                className="h-12 w-full rounded-md border border-border-opaque bg-background-tertiary
                  px-4 text-content-secondary cursor-not-allowed outline-none"
                value={googleRegInfo?.email ?? ""}
                disabled readOnly
              />
            </div>

            {/* Name */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">Full Name</label>
              <input
                className="h-12 w-full rounded-md border border-border-opaque bg-background-primary
                  px-4 font-sans text-content-primary placeholder:text-content-tertiary
                  outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
                placeholder="Full Name"
                type="text"
                value={googleRegInfo?.name ?? ""}
                onChange={(e) =>
                  setGoogleRegInfo((prev) => prev ? { ...prev, name: e.target.value } : null)
                }
              />
            </div>

            {/* Phone */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">Mobile Number</label>
              <div className="flex gap-2">
                <div className="flex h-12 items-center gap-1.5 rounded-md border border-border-opaque bg-background-tertiary px-3 flex-shrink-0">
                  <span className="text-lg">🇮🇳</span>
                  <span className="text-label-medium text-content-primary">+91</span>
                </div>
                <input
                  className="h-12 flex-1 rounded-md border border-border-opaque bg-background-primary
                    px-4 font-mono text-mono-medium text-content-primary placeholder:text-content-tertiary
                    outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
                  placeholder="98765 43210"
                  inputMode="numeric"
                  type="tel"
                  value={googlePhone}
                  maxLength={10}
                  onChange={(e) => {
                    setGooglePhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                    setGoogleOtpSent(false);
                    setGoogleOtp("");
                  }}
                />
              </div>
              {!googleOtpSent ? (
                <button
                  type="button"
                  onClick={sendGoogleOtp}
                  disabled={isLoading || googlePhone.length !== 10}
                  className="mt-2 flex h-11 w-full items-center justify-center rounded-md
                    border border-border-opaque bg-background-primary
                    text-label-medium text-content-primary
                    disabled:opacity-50 disabled:cursor-not-allowed
                    hover:bg-background-secondary active:scale-[0.98] transition-base"
                >
                  {isLoading ? <Spinner size={16} /> : "Send OTP to verify number"}
                </button>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-paragraph-small text-content-secondary">
                    Enter the 6-digit OTP sent to +91 {googlePhone}
                  </p>
                  <OtpInput onComplete={(o) => setGoogleOtp(o)} />
                </div>
              )}
            </div>

            {/* Referral */}
            <div>
              <label className="text-label-small text-content-secondary block mb-1">
                Referral Code (optional)
              </label>
              <input
                className="h-12 w-full rounded-md border border-border-opaque bg-background-primary
                  px-4 font-mono text-mono-small text-content-primary uppercase
                  placeholder:text-content-tertiary
                  outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
                placeholder="e.g. DFU1A2B3"
                value={referral}
                onChange={(e) => setReferral(e.target.value.toUpperCase())}
              />
            </div>

            <ShimmerButton
              type="button"
              disabled={isLoading || googlePhone.length !== 10 || googleOtp.length !== 6}
              onClick={onCompleteGoogleRegistration}
              shimmerColor="rgba(255,255,255,0.3)"
              background="var(--accent-400)"
              borderRadius="8px"
              className="h-14 text-label-large font-medium shadow-elevation-1"
            >
              {isLoading ? <Spinner /> : "Complete Registration"}
            </ShimmerButton>

            <button
              className="w-full text-center text-label-medium text-content-secondary py-3 min-h-[44px]
                hover:text-content-primary transition-base"
              onClick={() => { setStep("choose"); setGoogleRegInfo(null); setError(""); }}
            >
              Cancel
            </button>
          </motion.div>
        )}

        {step === "reset" && (
          <motion.div
            key="reset"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-5"
          >
            <div>
              <h2 className="text-heading-medium text-content-primary mb-1">Reset password</h2>
              <p className="text-paragraph-small text-content-secondary">
                Enter the code sent to +91 {loginPhone} and choose a new password.
              </p>
            </div>
            <input
              className="h-12 w-full rounded-md border border-border-opaque bg-background-primary px-4 font-mono text-mono-medium text-content-primary placeholder:text-content-tertiary outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
              placeholder="6-digit code"
              inputMode="numeric"
              type="tel"
              maxLength={6}
              value={forgotOtp}
              onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <input
              className="h-12 w-full rounded-md border border-border-opaque bg-background-primary px-4 text-content-primary placeholder:text-content-tertiary outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
              placeholder="New password (min 8 chars)"
              type="password"
              value={resetPw}
              onChange={(e) => setResetPw(e.target.value)}
            />
            <ShimmerButton
              type="button"
              disabled={isLoading}
              onClick={handleResetSubmit}
              shimmerColor="rgba(255,255,255,0.3)"
              background="var(--accent-400)"
              borderRadius="8px"
              className="h-14 text-label-large font-medium shadow-elevation-1"
            >
              {isLoading ? <Spinner /> : "Reset & Log In"}
            </ShimmerButton>
            <button
              className="w-full text-center text-label-medium text-content-secondary py-3 min-h-[44px] hover:text-content-primary transition-base"
              onClick={() => { setStep("choose"); setError(""); }}
            >
              Back
            </button>
          </motion.div>
        )}

        {step === "set_password" && (
          <motion.div
            key="set_password"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-5"
          >
            <div>
              <h2 className="text-heading-medium text-content-primary mb-1">Create a password</h2>
              <p className="text-paragraph-small text-content-secondary">
                Set a password so next time you can log in without an OTP.
              </p>
            </div>
            <input
              className="h-12 w-full rounded-md border border-border-opaque bg-background-primary px-4 text-content-primary placeholder:text-content-tertiary outline-none focus:border-border-accent focus:ring-2 focus:ring-accent-400 transition-base"
              placeholder="Password (min 8 chars)"
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreatePassword(); }}
            />
            <ShimmerButton
              type="button"
              disabled={savingPw}
              onClick={handleCreatePassword}
              shimmerColor="rgba(255,255,255,0.3)"
              background="var(--accent-400)"
              borderRadius="8px"
              className="h-14 text-label-large font-medium shadow-elevation-1"
            >
              {savingPw ? <Spinner /> : "Create password & continue"}
            </ShimmerButton>
            <button
              className="w-full text-center text-label-medium text-content-secondary py-3 min-h-[44px] hover:text-content-primary transition-base"
              onClick={() => router.replace("/onboarding")}
            >
              Skip for now
            </button>
          </motion.div>
        )}
        </AnimatePresence>

        {/* Terms */}
        <p className="mt-8 pb-4 text-center text-label-small text-content-secondary leading-10">
          By continuing, you agree to our{" "}
          <button type="button" className="inline-flex items-center min-h-[44px] text-content-accent hover:underline px-1">
            Terms of Service
          </button>{" "}
          and{" "}
          <button type="button" className="inline-flex items-center min-h-[44px] text-content-accent hover:underline px-1">
            Privacy Policy
          </button>
        </p>
      </motion.div>
    </main>
  );
}
