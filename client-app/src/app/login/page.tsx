'use client';

import React, { useState, useRef, Suspense, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { driverLogin, driverRegister, driverGoogleLogin, sendDriverOTP, verifyDriverOTP, driverForgotPassword, driverResetPassword } from '@/api/client';
import { registerDriverPushNotifications } from '@/services/notifications';
import { useRouter } from 'next/navigation';
import { Input, Button } from '@/components/ds';
import { getGoogleIdToken } from '@/lib/googleAuth';
import { useToastStore } from '@/store/useToastStore';
import { friendlyError } from '@/lib/ui/errorMessage';

function UnifiedLoginContent() {
  const router = useRouter();
  const { login } = useAuthStore();
  
  // State variables
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  
  // Driver registration states
  const [isDriverRegister, setIsDriverRegister] = useState<boolean>(false);
  const [driverName, setDriverName] = useState<string>('');
  const [driverEmail, setDriverEmail] = useState<string>('');
  const [driverCityPrefix, setDriverCityPrefix] = useState<string>('KOL');
  
  // Google registration states
  const [isGoogleRegister, setIsGoogleRegister] = useState<boolean>(false);
  const [googleRegInfo, setGoogleRegInfo] = useState<{ idToken: string; email: string; name: string }>({
    idToken: '',
    email: '',
    name: '',
  });

  // OTP Verification States
  const [showOtpVerification, setShowOtpVerification] = useState<boolean>(false);
  const [otpPurpose, setOtpPurpose] = useState<'registration' | 'google_registration' | 'login_verification' | null>(null);
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [otpResendTimer, setOtpResendTimer] = useState<number>(30);
  const [registrationPayload, setRegistrationPayload] = useState<any>(null);
  const [confirmationResult, setConfirmationResult] = useState<any>(null);
  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Forgot / reset password states
  const [forgotMode, setForgotMode] = useState<'phone' | 'reset' | null>(null);
  const [forgotOtp, setForgotOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');

  // Logs state
  const [logs, setLogs] = useState<string[]>([]);

  const isFirebaseConfigured = typeof window !== 'undefined' && !!process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && !(window as any).__E2E__;

  // Log audit captures helper
  const addAuditLog = (action: string, metadata: any) => {
    const logString = `[AUDIT_LOG] ${new Date().toISOString()} | Action: ${action} | Meta: ${JSON.stringify(metadata)}`;
    console.log(logString);
    setLogs((prev) => [logString, ...prev]);
    try {
      const storedLogs = JSON.parse(sessionStorage.getItem('audit_logs') || '[]');
      storedLogs.push({ timestamp: new Date().toISOString(), action, metadata });
      sessionStorage.setItem('audit_logs', JSON.stringify(storedLogs));
    } catch (e) {
      // Ignored
    }
  };

  // Real-time phone input formatting (9999988888 -> 99999 88888)
  const handlePhoneChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 10);
    if (digits.length > 5) {
      setPhone(`${digits.slice(0, 5)} ${digits.slice(5)}`);
    } else {
      setPhone(digits);
    }
  };

  // Resend timer countdown logic
  useEffect(() => {
    if (!showOtpVerification || otpResendTimer <= 0) return;
    const interval = setInterval(() => {
      setOtpResendTimer((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [showOtpVerification, otpResendTimer]);

  const handleOtpDigitChange = (index: number, value: string) => {
    const cleanVal = value.replace(/\D/g, '');
    if (!cleanVal) {
      const nextOtp = [...otpDigits];
      nextOtp[index] = '';
      setOtpDigits(nextOtp);
      return;
    }

    const nextOtp = [...otpDigits];
    nextOtp[index] = cleanVal.slice(-1);
    setOtpDigits(nextOtp);

    if (index < 5 && cleanVal) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!otpDigits[index] && index > 0) {
        const nextOtp = [...otpDigits];
        nextOtp[index - 1] = '';
        setOtpDigits(nextOtp);
        otpInputsRef.current[index - 1]?.focus();
      } else {
        const nextOtp = [...otpDigits];
        nextOtp[index] = '';
        setOtpDigits(nextOtp);
      }
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pastedData.length === 6) {
      const nextOtp = pastedData.split('');
      setOtpDigits(nextOtp);
      otpInputsRef.current[5]?.focus();
    }
  };

  const startOTPVerification = async (purpose: 'registration' | 'google_registration' | 'login_verification', cleanPhone: string, payload?: any) => {
    setLoading(true);
    setAuthError(null);
    try {
      if (isFirebaseConfigured) {
        // Firebase sends real SMS via invisible reCAPTCHA
        const { startPhoneVerification } = await import('@/lib/phoneAuth');
        const conf = await startPhoneVerification(`+91${cleanPhone}`);
        setConfirmationResult(conf);
      } else {
        // Fallback custom OTP log flow
        await sendDriverOTP(cleanPhone);
      }

      setOtpPurpose(purpose);
      setOtpDigits(['', '', '', '', '', '']);
      setOtpResendTimer(30);
      if (payload) {
        setRegistrationPayload(payload);
      }
      setShowOtpVerification(true);
      addAuditLog('OTP_SENT', { phone: cleanPhone, purpose, firebase: isFirebaseConfigured });
    } catch (err: any) {
      setAuthError(err.message || 'Failed to send OTP verification code. Please try again.');
      addAuditLog('OTP_SEND_FAILED', { phone: cleanPhone, error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const otpCode = otpDigits.join('');
    if (otpCode.length < 6) {
      setAuthError('Please enter all 6 digits.');
      return;
    }

    setLoading(true);
    setAuthError(null);
    const cleanPhone = phone.replace(/\s/g, '');

    try {
      let otpOrToken = otpCode;
      if (isFirebaseConfigured && confirmationResult) {
        // Exchange 6-digit code for Firebase ID token (JWT phone proof)
        otpOrToken = await confirmationResult.confirm(otpCode);
      }

      const verifyRes = await verifyDriverOTP(cleanPhone, otpOrToken);
      addAuditLog('OTP_VERIFIED', { phone: cleanPhone });

      if (otpPurpose === 'login_verification') {
        // Existing driver clearing the post-login phone gate -> verify-otp returns a
        // fresh session (the backend marked the row phone_verified=true).
        if (!verifyRes.token || !verifyRes.user) {
          throw new Error('Verification succeeded but no session was returned.');
        }
        login(verifyRes.token, {
          id: verifyRes.user.id,
          role: verifyRes.user.role,
          name: verifyRes.user.name,
          phone: cleanPhone,
          phone_verified: true,
        }, verifyRes.refresh_token);
        void registerDriverPushNotifications(verifyRes.token).catch((pushErr) => {
          console.warn('[UnifiedAuth] Push notification registration skipped:', pushErr);
        });
        addAuditLog('LOGIN_VERIFIED', { userId: verifyRes.user.id });
        router.push('/driver');
        return;
      }

      // Registration flows require a phone_token to create the account.
      if (!verifyRes.phone_token) {
        throw new Error('Verification completed, but no phone token was returned.');
      }

      if (otpPurpose === 'registration') {
        // Complete direct registration with verified phone token
        const regPayload = {
          ...registrationPayload,
          phone_token: verifyRes.phone_token,
        };
        // Register now auto-logs-in — no second login round-trip.
        const regRes = await driverRegister(regPayload);
        addAuditLog('REGISTER_SUCCESS', { phone: cleanPhone });
        login(regRes.token, {
          id: regRes.user.id,
          role: regRes.user.role,
          name: regRes.user.name,
          phone: cleanPhone,
          phone_verified: regRes.phone_verified,
        }, regRes.refresh_token);

        addAuditLog('LOGIN_SUCCESS', { userId: regRes.user.id, role: 'DRIVER' });
        router.push('/driver-onboarding');
      } else if (otpPurpose === 'google_registration') {
        // Complete Google registration with verified phone token
        const googleRes = await driverGoogleLogin(googleRegInfo.idToken, {
          phone: cleanPhone,
          cityPrefix: driverCityPrefix,
          name: googleRegInfo.name.trim() || undefined,
          phoneToken: verifyRes.phone_token,
        });

        if (googleRes.token && googleRes.user) {
          login(googleRes.token, {
            id: googleRes.user.id,
            role: googleRes.user.role,
            name: googleRes.user.name,
            phone: cleanPhone,
            phone_verified: googleRes.phone_verified,
          }, googleRes.refresh_token);

          void registerDriverPushNotifications(googleRes.token).catch((pushErr) => {
            console.warn('[UnifiedAuth] Push notification registration skipped:', pushErr);
          });
          addAuditLog('REGISTER_SUCCESS_GOOGLE', { userId: googleRes.user.id });
          router.push('/driver-onboarding');
        } else {
          throw new Error('Google registration failed, session token not received.');
        }
      }
    } catch (err: any) {
      console.warn('[UnifiedAuth] Verification / Registration failed.', err);
      setAuthError(err.message || 'Incorrect verification code or registration failed.');
      addAuditLog('VERIFICATION_FAILED', { phone: cleanPhone, error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  // Auto-submit OTP when all digits are entered
  useEffect(() => {
    if (otpDigits.join('').length === 6 && showOtpVerification && !loading) {
      handleVerifyOtpSubmit();
    }
  }, [otpDigits]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    const cleanPhone = phone.replace(/\s/g, '');
    if (!phone || cleanPhone.length < 10) {
      setAuthError('Please enter a valid 10-digit mobile number.');
      setLoading(false);
      return;
    }
    if (!password) {
      setAuthError('Password is required.');
      setLoading(false);
      return;
    }

    const deviceId = 'dev-hfid-' + Math.random().toString(36).substring(2, 10);
    const mockIp = '192.168.1.105';
    const appVersion = 'v2.4.1-prod';
    const location = { latitude: 22.5726, longitude: 88.3639, city: 'Kolkata' };

    const auditMeta = {
      role: 'DRIVER',
      phone: `+91 ${cleanPhone}`,
      timestamp: new Date().toISOString(),
      deviceId,
      ip: mockIp,
      appVersion,
      geoLocation: location
    };

    addAuditLog('LOGIN_ATTEMPT', auditMeta);

    try {
      const res = await driverLogin(cleanPhone, password);

      // Deep phone-verification gate: an existing driver whose number is not yet
      // verified must clear an OTP challenge before reaching the dashboard.
      if (res.phone_verified === false) {
        addAuditLog('LOGIN_PHONE_UNVERIFIED', { userId: res.user.id });
        await startOTPVerification('login_verification', cleanPhone);
        return;
      }

      login(res.token, {
        id: res.user.id,
        role: res.user.role,
        name: res.user.name,
        phone: cleanPhone,
        phone_verified: res.phone_verified,
      }, res.refresh_token);
      void registerDriverPushNotifications(res.token).catch((pushErr) => {
        console.warn('[UnifiedAuth] Push notification registration skipped:', pushErr);
      });
      addAuditLog('LOGIN_SUCCESS', { userId: res.user.id, role: 'DRIVER' });
      router.push('/driver');
    } catch (err) {
      console.warn('[UnifiedAuth] Authentication failed against gateway.', err);
      setAuthError('Authentication failed. Check your credentials and try again.');
      addAuditLog('LOGIN_FAILED', { role: 'DRIVER', phone: `+91 ${cleanPhone}`, reason: String(err) });
    } finally {
      setLoading(false);
    }
  };
  
  const handleDriverRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    const cleanPhone = phone.replace(/\s/g, '');
    if (!phone || cleanPhone.length < 10) {
      setAuthError('Please enter a valid 10-digit mobile number.');
      setLoading(false);
      return;
    }
    if (!driverName.trim()) {
      setAuthError('Legal name is required.');
      setLoading(false);
      return;
    }
    if (!password) {
      setAuthError('Password is required.');
      setLoading(false);
      return;
    }

    const payload = {
      name: driverName.trim(),
      phone: cleanPhone,
      email: driverEmail.trim() || undefined,
      password: password,
      city_prefix: driverCityPrefix,
    };

    addAuditLog('REGISTER_ATTEMPT', { phone: cleanPhone, city: driverCityPrefix });
    await startOTPVerification('registration', cleanPhone, payload);
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setAuthError(null);
    addAuditLog('GOOGLE_SIGN_IN_START', { timestamp: new Date().toISOString() });
    try {
      const idToken = await getGoogleIdToken();

      // Try to log in with Google ID token
      const res = await driverGoogleLogin(idToken);
      if (res.registered === false) {
        setGoogleRegInfo({
          idToken,
          email: res.email || '',
          name: res.name || '',
        });
        setIsGoogleRegister(true);
        addAuditLog('GOOGLE_SIGN_IN_PENDING_REGISTRATION', { email: res.email });
      } else if (res.token && res.user) {
        // Deep phone-verification gate for a returning Google driver.
        if (res.phone_verified === false) {
          const gatePhone = (res.user.phone || '').replace(/\D/g, '').slice(-10);
          handlePhoneChange(gatePhone);
          addAuditLog('GOOGLE_LOGIN_PHONE_UNVERIFIED', { userId: res.user.id });
          await startOTPVerification('login_verification', gatePhone);
          return;
        }
        login(res.token, {
          id: res.user.id,
          role: res.user.role,
          name: res.user.name,
          phone: res.user.phone || '',
          phone_verified: res.phone_verified,
        }, res.refresh_token);
        void registerDriverPushNotifications(res.token).catch((pushErr) => {
          console.warn('[UnifiedAuth] Push notification registration skipped:', pushErr);
        });
        addAuditLog('LOGIN_SUCCESS_GOOGLE', { userId: res.user.id, role: 'DRIVER' });
        router.push('/driver');
      }
    } catch (err: any) {
      console.error('[Google Sign-in] Failed:', err);
      setAuthError(err.message || 'Google Sign-in failed. Please try again.');
      useToastStore.getState().show(friendlyError(err), 'error');
      addAuditLog('GOOGLE_SIGN_IN_FAILED', { error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    const cleanPhone = phone.replace(/\s/g, '');
    if (!phone || cleanPhone.length < 10) {
      setAuthError('Please enter a valid 10-digit mobile number.');
      setLoading(false);
      return;
    }

    addAuditLog('GOOGLE_REGISTER_ATTEMPT', { email: googleRegInfo.email, phone: cleanPhone });
    await startOTPVerification('google_registration', cleanPhone);
  };

  const handleForgotSend = async () => {
    const cleanPhone = phone.replace(/\s/g, '');
    if (cleanPhone.length < 10) { setAuthError('Enter your registered 10-digit number.'); return; }
    setLoading(true);
    setAuthError(null);
    try {
      await driverForgotPassword(cleanPhone);
      setForgotMode('reset');
      setForgotOtp('');
      useToastStore.getState().show('If that number is registered, a reset code was sent.', 'info');
    } catch (err) {
      useToastStore.getState().show(friendlyError(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async () => {
    const cleanPhone = phone.replace(/\s/g, '');
    if (forgotOtp.length < 6) { setAuthError('Enter the 6-digit code.'); return; }
    if (newPassword.length < 8) { setAuthError('New password must be at least 8 characters.'); return; }
    setLoading(true);
    setAuthError(null);
    try {
      const res = await driverResetPassword(cleanPhone, forgotOtp, newPassword);
      if (!res.token || !res.user) throw new Error('Reset succeeded but no session was returned.');
      login(res.token, {
        id: res.user.id,
        role: res.user.role,
        name: res.user.name,
        phone: cleanPhone,
        phone_verified: res.phone_verified,
      }, res.refresh_token);
      useToastStore.getState().show('Password updated — you are logged in.', 'success');
      router.push('/driver');
    } catch (err) {
      useToastStore.getState().show(friendlyError(err), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center p-4 sm:p-6 bg-background-primary text-content-primary font-sans overflow-hidden">
      {/* Grid line matrix background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border-opaque)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-opaque)_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-5" />
      <div className="absolute inset-0 bg-gradient-to-tr from-background-primary via-background-secondary to-background-tertiary z-0 opacity-40" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md bg-background-secondary border border-border-opaque rounded-md p-6 sm:p-8 shadow-elevation-2">
        
        {/* Logo/Branding */}
        <div className="text-center mb-8">
          <h1 className="text-heading-large font-bold tracking-tight text-content-primary">
            VAHNLY
          </h1>
          <p className="text-label-small text-content-secondary uppercase tracking-wider mt-1">
            Enterprise Fleet Access Gateway
          </p>
        </div>

        {authError && (
          <div className="bg-surface-negative border border-content-negative text-content-negative text-paragraph-small py-3 px-4 rounded-sm mb-4 font-mono text-left">
            {authError}
          </div>
        )}

        {forgotMode ? (
          /* FORGOT / RESET PASSWORD VIEW */
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (forgotMode === 'phone') { handleForgotSend(); } else { handleResetSubmit(); }
            }}
            className="space-y-4 text-left"
          >
            <div className="mb-1">
              <p className="text-paragraph-small text-content-secondary">
                {forgotMode === 'phone'
                  ? 'Enter your registered number — we will text a reset code.'
                  : <>Enter the code sent to <strong>+91 {phone}</strong> and choose a new password.</>}
              </p>
            </div>

            {forgotMode === 'phone' ? (
              <Input
                label="Driver Phone Number"
                type="tel"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                placeholder="99999 88888"
                leftIcon={<span className="text-content-secondary font-mono text-paragraph-medium">+91</span>}
                disabled={loading}
              />
            ) : (
              <>
                <Input
                  label="Reset Code"
                  type="tel"
                  value={forgotOtp}
                  onChange={(e) => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  disabled={loading}
                />
                <Input
                  label="New Password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  disabled={loading}
                />
              </>
            )}

            <div className="pt-2 space-y-3">
              <Button type="submit" variant="primary" fullWidth loading={loading}>
                {forgotMode === 'phone' ? 'Send Reset Code' : 'Reset Password & Sign In'}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                fullWidth
                onClick={() => { setForgotMode(null); setAuthError(null); setForgotOtp(''); setNewPassword(''); }}
                disabled={loading}
              >
                Back to login
              </Button>
            </div>
          </form>
        ) : showOtpVerification ? (
          /* OTP VERIFICATION VIEW */
          <form onSubmit={(e) => handleVerifyOtpSubmit(e)} className="space-y-6 text-left">
            <div className="mb-2">
              <p className="text-paragraph-small text-content-secondary">
                Enter the 6-digit verification code sent to <strong>+91 {phone}</strong>
              </p>
            </div>

            <div className="flex justify-between gap-2">
              {otpDigits.map((digit, idx) => (
                <input
                  key={idx}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  aria-label={`OTP digit ${idx + 1}`}
                  ref={(el) => {
                    otpInputsRef.current[idx] = el;
                  }}
                  onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                  onPaste={idx === 0 ? handleOtpPaste : undefined}
                  disabled={loading}
                  className="w-12 h-12 text-center text-heading-large font-bold bg-background-primary border border-border-opaque rounded-sm focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none transition-base"
                />
              ))}
            </div>

            <div className="pt-2 space-y-3">
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
                disabled={otpDigits.join('').length < 6}
              >
                {otpPurpose === 'login_verification' ? 'Verify & Continue' : 'Verify & Register'}
              </Button>

              <div className="flex items-center justify-between text-label-small pt-1">
                <button
                  type="button"
                  onClick={() => startOTPVerification(otpPurpose!, phone.replace(/\s/g, ''))}
                  disabled={loading || otpResendTimer > 0}
                  className="text-content-secondary hover:text-content-primary transition disabled:text-content-tertiary cursor-pointer font-medium"
                >
                  {otpResendTimer > 0 ? `Resend Code in ${otpResendTimer}s` : 'Resend Code'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowOtpVerification(false);
                    setOtpPurpose(null);
                    setAuthError(null);
                  }}
                  disabled={loading}
                  className="text-content-negative hover:underline transition cursor-pointer font-medium"
                >
                  Back
                </button>
              </div>
            </div>
          </form>
        ) : isGoogleRegister ? (
          /* GOOGLE ADDITIONAL DETAILS FORM */
          <form onSubmit={handleGoogleRegisterSubmit} className="space-y-4 text-left">
            <div className="mb-2">
              <p className="text-paragraph-small text-content-secondary">
                Complete registration for <strong>{googleRegInfo.email}</strong> to continue as a Driver Partner.
              </p>
            </div>

            <Input
              label="Full Legal Name"
              type="text"
              value={googleRegInfo.name}
              onChange={(e) => setGoogleRegInfo({ ...googleRegInfo, name: e.target.value })}
              placeholder="John Doe"
              disabled={loading}
            />

            <Input
              label="Driver Phone Number"
              type="tel"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="99999 88888"
              leftIcon={<span className="text-content-secondary font-mono text-paragraph-medium">+91</span>}
              disabled={loading}
            />

            <div className="w-full">
              <label className="block text-label-small text-content-secondary mb-1">
                Hub Region City Prefix
              </label>
              <select
                value={driverCityPrefix}
                onChange={(e) => setDriverCityPrefix(e.target.value)}
                className="w-full h-12 rounded-sm px-500 font-body text-paragraph-large text-content-primary bg-background-secondary border border-border-opaque focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none transition-base cursor-pointer"
              >
                <option value="KOL">KOL (Kolkata)</option>
                <option value="BLR">BLR (Bengaluru)</option>
              </select>
            </div>

            <div className="pt-2 space-y-3">
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
              >
                Complete Registration
              </Button>

              <Button
                type="button"
                variant="tertiary"
                fullWidth
                onClick={() => {
                  setAuthError(null);
                  setIsGoogleRegister(false);
                }}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : isDriverRegister ? (
          /* DRIVER REGISTRATION FLOW */
          <form onSubmit={handleDriverRegisterSubmit} className="space-y-4 text-left">
            <Input
              label="Full Legal Name"
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="John Doe"
              disabled={loading}
            />

            <Input
              label="Driver Phone Number"
              type="tel"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="99999 88888"
              leftIcon={<span className="text-content-secondary font-mono text-paragraph-medium">+91</span>}
              disabled={loading}
            />

            <Input
              label="Email Address (Optional)"
              type="email"
              value={driverEmail}
              onChange={(e) => setDriverEmail(e.target.value)}
              placeholder="john.doe@example.com"
              disabled={loading}
            />

            <Input
              label="Secure PIN / Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
            />

            <div className="w-full">
              <label className="block text-label-small text-content-secondary mb-1">
                Hub Region City Prefix
              </label>
              <select
                value={driverCityPrefix}
                onChange={(e) => setDriverCityPrefix(e.target.value)}
                className="w-full h-12 rounded-sm px-500 font-body text-paragraph-large text-content-primary bg-background-secondary border border-border-opaque focus:border-border-accent focus:ring-2 focus:ring-accent-400 outline-none transition-base cursor-pointer"
              >
                <option value="KOL">KOL (Kolkata)</option>
                <option value="BLR">BLR (Bengaluru)</option>
              </select>
            </div>

            <div className="pt-2 space-y-3">
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
              >
                Register & Start Onboarding
              </Button>

              <Button
                type="button"
                variant="tertiary"
                fullWidth
                onClick={() => {
                  setAuthError(null);
                  setIsDriverRegister(false);
                }}
                disabled={loading}
              >
                Already have an account? Log in
              </Button>
            </div>
          </form>
        ) : (
          /* DRIVER FLOW: Standard login with password/pin input */
          <form onSubmit={handleLoginSubmit} className="space-y-4 text-left">
            <Input
              label="Driver Phone Number"
              type="tel"
              value={phone}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="99999 88888"
              leftIcon={<span className="text-content-secondary font-mono text-paragraph-medium">+91</span>}
              disabled={loading}
            />

            <Input
              label="Secure PIN / Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
            />

            <button
              type="button"
              onClick={() => { setAuthError(null); setForgotMode('phone'); }}
              disabled={loading}
              className="text-label-small text-content-secondary hover:text-content-primary transition cursor-pointer"
            >
              Forgot password?
            </button>

            <div className="pt-2 space-y-3">
              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={loading}
              >
                Authenticate & Access
              </Button>

              <Button
                type="button"
                variant="tertiary"
                fullWidth
                onClick={() => {
                  setAuthError(null);
                  addAuditLog('ONBOARDING_ROUTE_CLICKED', { timestamp: new Date().toISOString() });
                  setIsDriverRegister(true);
                }}
                disabled={loading}
              >
                Sign up as Driver Partner
              </Button>
            </div>
          </form>
        )}

        {/* Federated Social Sign-in blocks */}
        {!showOtpVerification && (
          <div className="pt-6 border-t border-border-opaque mt-6 grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              Google Sign-In
            </Button>
            
            <Button
              variant="secondary"
              onClick={() => {
                addAuditLog('OAUTH_APPLE_CLICKED', { timestamp: new Date().toISOString() });
                alert('Apple Single Sign-On simulation complete.');
              }}
              disabled={loading}
            >
              Apple Sign-In
            </Button>
          </div>
        )}

      </div>

      {/* Invisible reCAPTCHA container for Firebase Phone Auth */}
      <div id="recaptcha-container" className="hidden" />

      <footer className="mt-8 text-center text-label-small text-content-tertiary font-mono select-none">
        Secure SHA-256 Token Vault • Active Sandbox Session
      </footer>
    </div>
  );
}

export default function UnifiedLogin() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background-primary flex items-center justify-center font-sans text-content-secondary font-mono text-mono-medium uppercase animate-pulse">
        Initializing Secure Access Portal...
      </div>
    }>
      <UnifiedLoginContent />
    </Suspense>
  );
}
