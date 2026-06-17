'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { sendDriverOTP, verifyDriverOTP } from '@/api/client';
import { Button } from '@/components/ds';

export default function PhoneVerificationGate() {
  const { user, login, logout } = useAuthStore();
  const [otp, setOtp] = useState<string[]>(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(30);
  const [otpSent, setOtpSent] = useState(false);

  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const rawPhone = user?.phone || '';
  const cleanPhone = rawPhone.replace(/\s/g, '');

  const triggerSendOTP = async () => {
    if (!cleanPhone) {
      setError('No phone number associated with this account. Please log out and contact support.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await sendDriverOTP(cleanPhone);
      setOtpSent(true);
      setResendTimer(30);
      console.log(`[PhoneVerificationGate] OTP sent to ${cleanPhone}`);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-send OTP on mount if not sent yet
  useEffect(() => {
    if (cleanPhone && !otpSent) {
      triggerSendOTP();
    }
  }, [cleanPhone, otpSent]);

  // Countdown timer for resend button
  useEffect(() => {
    if (resendTimer <= 0) return;
    const interval = setInterval(() => {
      setResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [resendTimer]);

  const handleChange = (index: number, value: string) => {
    // Only allow numbers
    const cleanVal = value.replace(/\D/g, '');
    if (!cleanVal) {
      const nextOtp = [...otp];
      nextOtp[index] = '';
      setOtp(nextOtp);
      return;
    }

    const nextOtp = [...otp];
    nextOtp[index] = cleanVal.slice(-1);
    setOtp(nextOtp);

    // Focus next box if current is filled
    if (index < 5 && cleanVal) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!otp[index] && index > 0) {
        const nextOtp = [...otp];
        nextOtp[index - 1] = '';
        setOtp(nextOtp);
        inputsRef.current[index - 1]?.focus();
      } else {
        const nextOtp = [...otp];
        nextOtp[index] = '';
        setOtp(nextOtp);
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length === 6) {
      const nextOtp = pastedData.split('');
      setOtp(nextOtp);
      inputsRef.current[5]?.focus();
    }
  };

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const otpCode = otp.join('');
    if (otpCode.length < 6) {
      setError('Please enter all 6 digits.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await verifyDriverOTP(cleanPhone, otpCode);
      if (res.token && res.user) {
        // Successful login, update auth store
        login(res.token, {
          id: res.user.id,
          role: 'DRIVER',
          name: res.user.name,
          phone: cleanPhone,
          phone_verified: true,
        });
        console.log('[PhoneVerificationGate] Phone verified successfully, store updated');
      } else {
        setError('Verification succeeded, but session token was not received.');
      }
    } catch (err: any) {
      setError(err.message || 'Incorrect verification code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit when all 6 boxes are filled
  useEffect(() => {
    if (otp.join('').length === 6 && !loading) {
      handleVerify();
    }
  }, [otp]);

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center p-4 sm:p-6 bg-background-primary text-content-primary font-sans overflow-hidden">
      {/* Grid line background matching Vahnly login */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border-opaque)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-opaque)_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-5" />
      <div className="absolute inset-0 bg-gradient-to-tr from-background-primary via-background-secondary to-background-tertiary z-0 opacity-40" />

      <div className="relative z-10 w-full max-w-md bg-background-secondary border border-border-opaque rounded-md p-6 sm:p-8 shadow-elevation-2">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-accent-500/10 rounded-full flex items-center justify-center mx-auto mb-4 text-accent-400">
            🔒
          </div>
          <h1 className="text-heading-large font-bold tracking-tight text-white">
            Phone Verification Required
          </h1>
          <p className="text-paragraph-small text-content-secondary mt-2">
            To secure your account and proceed to the driver dashboard, please verify your mobile number.
          </p>
          {cleanPhone && (
            <p className="text-paragraph-medium font-mono font-semibold text-accent-400 mt-2">
              +91 {cleanPhone.slice(0, 5)} {cleanPhone.slice(5)}
            </p>
          )}
        </div>

        {error && (
          <div className="bg-surface-negative border border-content-negative text-content-negative text-paragraph-small py-3 px-4 rounded-sm mb-4 font-mono text-left">
            {error}
          </div>
        )}

        <form onSubmit={handleVerify} className="space-y-6">
          <div className="flex justify-between gap-2">
            {otp.map((digit, idx) => (
              <input
                key={idx}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                aria-label={`OTP digit ${idx + 1}`}
                ref={(el) => {
                  inputsRef.current[idx] = el;
                }}
                onChange={(e) => handleChange(idx, e.target.value)}
                onKeyDown={(e) => handleKeyDown(idx, e)}
                onPaste={idx === 0 ? handlePaste : undefined}
                disabled={loading}
                className="w-12 h-12 text-center text-heading-large font-bold bg-background-primary border border-border-opaque rounded-sm focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none transition-base"
              />
            ))}
          </div>

          <div className="space-y-3 pt-2">
            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={loading}
              disabled={otp.join('').length < 6}
            >
              Verify & Complete Access
            </Button>

            <div className="flex items-center justify-between text-label-small pt-1">
              <button
                type="button"
                onClick={triggerSendOTP}
                disabled={loading || resendTimer > 0}
                className="text-content-secondary hover:text-white transition disabled:text-content-tertiary cursor-pointer font-medium"
              >
                {resendTimer > 0 ? `Resend Code in ${resendTimer}s` : 'Resend Code'}
              </button>

              <button
                type="button"
                onClick={logout}
                className="text-content-negative hover:underline transition cursor-pointer font-medium"
              >
                Sign Out
              </button>
            </div>
          </div>
        </form>
      </div>

      <footer className="mt-8 text-center text-label-small text-content-tertiary font-mono select-none">
        VAHNLY Guard • OTP Verification Gate
      </footer>
    </div>
  );
}
