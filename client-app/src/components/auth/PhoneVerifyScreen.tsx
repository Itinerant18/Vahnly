'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { auth } from '@/lib/firebase';
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  PhoneAuthProvider,
  signInWithCredential,
  linkWithCredential,
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import { BackIcon } from '@/components/ds/Icon';

const API_URL = process.env.NEXT_PUBLIC_API_GATEWAY || process.env.NEXT_PUBLIC_API_URL || '';

interface PhoneVerifyScreenProps {
  onVerified: (jwt: string, isNewUser: boolean) => void;
  existingFirebaseUser?: User | null;
  userType: 'driver' | 'rider';
  title?: string;
  onBack?: () => void;
}

export default function PhoneVerifyScreen({
  onVerified,
  existingFirebaseUser,
  userType,
  title = 'Verify Your Mobile Number',
  onBack,
}: PhoneVerifyScreenProps) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [verificationId, setVerificationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  const recaptchaContainerRef = useRef<HTMLDivElement>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!recaptchaContainerRef.current || !auth) return;
    recaptchaVerifierRef.current = new RecaptchaVerifier(
      auth,
      recaptchaContainerRef.current,
      {
        size: 'invisible',
        callback: () => {},
        'expired-callback': () => setError('reCAPTCHA expired. Try again.'),
      },
    );
    return () => {
      try { recaptchaVerifierRef.current?.clear(); } catch { /* ignore */ }
      recaptchaVerifierRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const formatE164 = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.startsWith('91') && digits.length === 12) return '+' + digits;
    if (digits.length === 10) return '+91' + digits;
    return '+' + digits;
  };

  const handleSendOTP = async () => {
    if (phone.length < 10) { setError('Enter a valid 10-digit number.'); return; }
    if (!auth) { setError('Firebase not initialized.'); return; }
    setLoading(true);
    setError('');
    try {
      if (!recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current = new RecaptchaVerifier(
          auth,
          recaptchaContainerRef.current!,
          { size: 'invisible', callback: () => {} },
        );
      }
      const result: ConfirmationResult = await signInWithPhoneNumber(
        auth,
        formatE164(phone),
        recaptchaVerifierRef.current,
      );
      setVerificationId(result.verificationId);
      setStep('otp');
      setOtp(['', '', '', '', '', '']);
      setCountdown(30);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/invalid-phone-number') setError('Invalid phone number.');
      else if (code === 'auth/too-many-requests') setError('Too many attempts. Try later.');
      else setError('Failed to send OTP. Try again.');
      try { recaptchaVerifierRef.current?.clear(); } catch { /* ignore */ }
      recaptchaVerifierRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = useCallback(async () => {
    const code = otp.join('');
    if (code.length < 6) return;
    setLoading(true);
    setError('');
    try {
      const credential = PhoneAuthProvider.credential(verificationId, code);
      let firebaseIdToken: string;
      if (existingFirebaseUser) {
        const uc = await linkWithCredential(existingFirebaseUser, credential);
        firebaseIdToken = await uc.user.getIdToken(true);
      } else {
        if (!auth) throw new Error('Firebase not initialized.');
        const uc = await signInWithCredential(auth, credential);
        firebaseIdToken = await uc.user.getIdToken();
      }

      const res = await fetch(`${API_URL}/api/v1/auth/firebase/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firebase_id_token: firebaseIdToken, user_type: userType }),
      });
      const data: { success: boolean; is_new_user: boolean; data?: { token: string }; message?: string } = await res.json();
      if (!data.success || !data.data?.token) {
        throw new Error(data.message ?? 'Verification failed.');
      }
      onVerified(data.data.token, data.is_new_user);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/invalid-verification-code') {
        setError('Incorrect OTP. Try again.');
        setOtp(['', '', '', '', '', '']);
        otpRefs.current[0]?.focus();
      } else if (code === 'auth/code-expired') {
        setError('OTP expired. Request a new one.');
        setStep('phone');
      } else {
        setError((err as Error).message || 'Verification failed.');
      }
    } finally {
      setLoading(false);
    }
  }, [otp, verificationId, existingFirebaseUser, userType, onVerified]);

  useEffect(() => {
    if (otp.every((d) => d !== '') && step === 'otp' && !loading) {
      handleVerifyOTP();
    }
  }, [otp, step, loading, handleVerifyOTP]);

  const handleOTPChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[i] = digit;
    setOtp(next);
    if (digit && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const handleOTPKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
  };

  const handleOTPPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) { setOtp(text.split('')); otpRefs.current[5]?.focus(); }
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center p-4 sm:p-6 bg-background-primary text-content-primary font-sans">
      {/* Invisible reCAPTCHA mount */}
      <div ref={recaptchaContainerRef} id="recaptcha-container-phone-verify" />

      <div className="relative z-10 w-full max-w-md bg-background-secondary border border-border-opaque rounded-md p-6 sm:p-8 shadow-elevation-2">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-accent-50 flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="2" width="14" height="20" rx="2" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="18" r="1" fill="currentColor" />
            </svg>
          </div>
          <h2 className="text-heading-large font-bold text-content-primary">{title}</h2>
          <p className="text-paragraph-small text-content-secondary mt-1">
            {step === 'phone'
              ? "We’ll send a one-time code to verify your number."
              : `Code sent to +91 ${phone.slice(-10)}`}
          </p>
        </div>

        {error && (
          <div className="bg-surface-negative border border-content-negative text-content-negative text-paragraph-small py-3 px-4 rounded-sm mb-4 font-mono">
            {error}
          </div>
        )}

        {step === 'phone' ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex items-center bg-background-primary border border-border-opaque rounded-sm px-3 h-12 text-label-medium text-content-primary min-w-[72px] justify-center">
                🇮🇳 +91
              </div>
              <input
                type="tel"
                inputMode="numeric"
                placeholder="98765 43210"
                value={phone}
                autoFocus
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                onKeyDown={(e) => { if (e.key === 'Enter' && phone.length === 10) handleSendOTP(); }}
                className="flex-1 h-12 px-4 bg-background-primary border border-border-opaque rounded-sm text-label-medium font-mono text-content-primary focus:outline-none focus:border-2 focus:border-border-accent placeholder:text-content-tertiary"
              />
            </div>
            <button
              onClick={handleSendOTP}
              disabled={loading || phone.length < 10}
              className="w-full h-12 bg-background-inverse text-content-inverse rounded-sm text-label-large font-medium disabled:opacity-50 transition-base"
            >
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="w-full text-center text-label-medium text-content-secondary py-2 hover:text-content-primary transition-base"
              >
                <BackIcon size={16} className="inline align-middle" /> Back
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between gap-2" onPaste={handleOTPPaste}>
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
                  className="w-12 h-14 text-center text-heading-large font-bold bg-background-primary border border-border-opaque rounded-sm focus:border-2 focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none transition-base"
                />
              ))}
            </div>
            {loading && (
              <p className="text-center text-paragraph-small text-content-secondary">Verifying…</p>
            )}
            {countdown > 0 ? (
              <p className="text-center text-paragraph-small text-content-tertiary">
                Resend in <span className="font-mono">{countdown}s</span>
              </p>
            ) : (
              <button
                onClick={() => { setStep('phone'); setOtp(['', '', '', '', '', '']); setError(''); }}
                className="w-full text-center text-label-small text-content-accent hover:underline py-2"
              >
                Resend OTP
              </button>
            )}
            <button
              onClick={() => { setStep('phone'); setOtp(['', '', '', '', '', '']); setError(''); }}
              className="w-full text-center text-label-medium text-content-secondary py-2 hover:text-content-primary transition-base"
            >
              <BackIcon size={16} className="inline align-middle" /> Change number
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
