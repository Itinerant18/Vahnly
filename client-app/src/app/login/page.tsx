'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { apiFetch } from '@/network/ClientCoreEngine';
import { driverLogin, driverRegister } from '@/api/client';
import { registerDriverPushNotifications } from '@/services/notifications';
import { useRouter, useSearchParams } from 'next/navigation';

function UnifiedLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuthStore();
  
  // State variables
  const [role, setRole] = useState<'DRIVER' | 'RIDER'>('DRIVER');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); // Pin fallback for Driver or custom riders
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  
  // Driver registration states
  const [isDriverRegister, setIsDriverRegister] = useState<boolean>(false);
  const [driverName, setDriverName] = useState<string>('');
  const [driverEmail, setDriverEmail] = useState<string>('');
  const [driverCityPrefix, setDriverCityPrefix] = useState<string>('KOL');
  
  // OTP states
  const [authStep, setAuthStep] = useState<'IDLE' | 'AWAITING_OTP' | 'COOL_DOWN_LOCKOUT'>('IDLE');
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''));
  const [cooldown, setCooldown] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Automatically read pre-selected role query
  useEffect(() => {
    const roleParam = searchParams.get('role');
    if (roleParam === 'rider') {
      setRole('RIDER');
    } else {
      setRole('DRIVER');
    }
  }, [searchParams]);

  // Handle countdown timers
  useEffect(() => {
    if (cooldown <= 0) {
      if (authStep === 'COOL_DOWN_LOCKOUT') {
        setAuthStep('AWAITING_OTP');
      }
      return;
    }
    const timer = setInterval(() => {
      setCooldown((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown, authStep]);

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

  // OTP inputs callbacks
  const handleOtpChange = (idx: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const newOtp = [...otp];
    newOtp[idx] = digit;
    setOtp(newOtp);

    // Auto-focus next input slot
    if (digit && idx < 5) {
      otpRefs.current[idx + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim().replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const digits = pasted.split('');
      setOtp(digits);
      otpRefs.current[5]?.focus();
    }
  };

  const handleRequestOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone || phone.replace(/\s/g, '').length < 10) {
      setAuthError('Please enter a valid 10-digit mobile number.');
      return;
    }
    
    setLoading(true);
    setAuthError(null);
    
    setTimeout(() => {
      setLoading(false);
      setAuthStep('AWAITING_OTP');
      setCooldown(30); // 30 second resend cooldown
      addAuditLog('OTP_REQUESTED', { phone: `${countryCode} ${phone}`, timestamp: new Date().toISOString() });
    }, 800);
  };

  const handleResendOtp = () => {
    if (cooldown > 0) return;
    setCooldown(30);
    setAuthStep('COOL_DOWN_LOCKOUT');
    addAuditLog('OTP_RESEND_TRIGGERED', { phone: `${countryCode} ${phone}`, timestamp: new Date().toISOString() });
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    const fullPhone = `${countryCode} ${phone.replace(/\s/g, '')}`;
    const deviceId = 'dev-hfid-' + Math.random().toString(36).substring(2, 10);
    const mockIp = '192.168.1.105';
    const appVersion = 'v2.4.1-prod';
    const location = { latitude: 22.5726, longitude: 88.3639, city: 'Kolkata' };

    const auditMeta = {
      role,
      phone: fullPhone,
      timestamp: new Date().toISOString(),
      deviceId,
      ip: mockIp,
      appVersion,
      geoLocation: location
    };

    addAuditLog('LOGIN_ATTEMPT', auditMeta);

    try {
      if (role === 'DRIVER') {
        // Driver login uses postgres lookup via password
        const cleanPhone = phone.replace(/\s/g, '');
        if (!password) {
        throw new Error('Password is required.');
      }
      const res = await driverLogin(cleanPhone, password);
        login(res.token, {
          id: res.user.id,
          role: res.user.role,
          name: res.user.name,
          phone: cleanPhone,
        });
        void registerDriverPushNotifications(res.token).catch((pushErr) => {
          console.warn('[UnifiedAuth] Push notification registration skipped:', pushErr);
        });
        addAuditLog('LOGIN_SUCCESS', { userId: res.user.id, role });
        router.push('/driver');
      } else {
        // Rider login accepts code and phone
        const enteredOtp = otp.join('');
        if (enteredOtp.length < 6) {
          setAuthError('Please complete the 6-digit OTP verification code.');
          setLoading(false);
          return;
        }

        const res = await apiFetch('/api/v1/auth/rider/login', {
          method: 'POST',
          body: JSON.stringify({ phone: fullPhone, otp: enteredOtp })
        });

        login(res.token, {
          id: res.user.id,
          role: res.user.role,
          name: res.user.name,
          phone: res.user.phone ?? fullPhone,
        });
        addAuditLog('LOGIN_SUCCESS', { userId: res.user.id, role });
        
        // Prevent bypassing onboarding if incomplete
        const onboardingCompleted = localStorage.getItem('rider_onboarding_completed') === 'true';
        if (onboardingCompleted) {
          router.push('/rider');
        } else {
          router.push('/onboarding');
        }
      }
    } catch (err) {
      console.warn('[UnifiedAuth] Authentication failed against gateway.', err);
      setAuthError('Authentication failed. Check your credentials and try again.');
      addAuditLog('LOGIN_FAILED', { role, phone: fullPhone, reason: String(err) });
    } finally {
      setLoading(false);
    }
  };
  
  const handleDriverRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(null);

    const cleanPhone = phone.replace(/\s/g, '');
    const payload = {
      name: driverName.trim(),
      phone: cleanPhone,
      email: driverEmail.trim() || undefined,
      password: password,
      city_prefix: driverCityPrefix,
    };

    addAuditLog('REGISTER_ATTEMPT', { phone: cleanPhone, city: driverCityPrefix });

    try {
      // Register new driver account
      await driverRegister(payload);
      addAuditLog('REGISTER_SUCCESS', { phone: cleanPhone });

      // Automatically authenticate session following successful registration
      if (!password) {
        throw new Error('Password is required.');
      }
      const res = await driverLogin(cleanPhone, password);
      login(res.token, {
        id: res.user.id,
        role: res.user.role,
        name: res.user.name,
        phone: cleanPhone,
      });

      addAuditLog('LOGIN_SUCCESS', { userId: res.user.id, role: 'DRIVER' });
      
      // Dispatch browser routing to onboarding wizard
      router.push('/driver-onboarding');
    } catch (err: any) {
      console.warn('[UnifiedAuth] Driver registration failed.', err);
      setAuthError(err.message || 'Registration failed. Phone or email may already be registered.');
      addAuditLog('REGISTER_FAILED', { phone: cleanPhone, error: String(err) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex flex-col justify-center items-center p-4 sm:p-6 bg-black text-white font-sans overflow-hidden">
      {/* Grid line matrix background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-25" />
      <div className="absolute inset-0 bg-gradient-to-tr from-zinc-950 via-black to-zinc-900 z-0 animate-pulse duration-10000" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
        
        {/* Logo/Branding */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight font-move bg-gradient-to-r from-white via-zinc-400 to-zinc-600 bg-clip-text text-transparent">
            DRIVERS-FOR-U
          </h1>
          <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider mt-1">
            Enterprise Fleet Access Gateway
          </p>
        </div>

        {/* Role Segmented Controller Tab Toggle */}
        <div className="flex bg-zinc-900 p-1.5 rounded-xl border border-zinc-800 mb-6 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => {
              setRole('DRIVER');
              setAuthStep('IDLE');
              setAuthError(null);
              addAuditLog('ROLE_SWITCH', { target: 'DRIVER' });
            }}
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
              role === 'DRIVER' 
                ? 'bg-white text-black shadow' 
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
            }`}
          >
            🚗 Driver Partner
          </button>
          <button
            type="button"
            onClick={() => {
              setRole('RIDER');
              setAuthStep('IDLE');
              setAuthError(null);
              addAuditLog('ROLE_SWITCH', { target: 'RIDER' });
            }}
            className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-300 ${
              role === 'RIDER' 
                ? 'bg-white text-black shadow' 
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/40'
            }`}
          >
            🔑 Vehicle Owner
          </button>
        </div>

        {authStep === 'AWAITING_OTP' && (
          <div className="bg-zinc-900 border border-zinc-800 text-emerald-400 text-[10px] py-3 px-4 rounded-xl mb-4 font-mono">
            🔔 [MOCK_SMS_GATEWAY]: OTP request registered! Use code <strong>123456</strong> to bypass and log in.
          </div>
        )}

        {authError && (
          <div className="bg-rose-950/30 border border-rose-900 text-rose-300 text-xs py-3 px-4 rounded-xl mb-4 font-mono text-left">
            {authError}
          </div>
        )}

        {role === 'RIDER' ? (
          /* RIDER FLOW: OTP-focused sequence */
          <div className="space-y-4">
            {authStep === 'IDLE' ? (
              <form onSubmit={handleRequestOtp} className="space-y-4 text-left">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 font-mono">
                    Mobile Phone Number
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                      className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white text-xs focus:outline-none focus:border-zinc-500 font-mono"
                    >
                      <option value="+91">IN (+91)</option>
                      <option value="+1">US (+1)</option>
                      <option value="+44">UK (+44)</option>
                    </select>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono transition-all"
                      placeholder="99999 88888"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-white hover:bg-zinc-200 text-black rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer shadow-md"
                >
                  {loading ? 'Requesting OTP Code...' : 'Send Verification OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleLoginSubmit} className="space-y-4 text-left animate-fadeIn">
                <div>
                  <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 font-mono">
                    Enter 6-Digit Passcode
                  </label>
                  
                  {/* 6 passcode slots with auto focusing */}
                  <div className="grid grid-cols-6 gap-2">
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        type="text"
                        maxLength={1}
                        value={digit}
                        ref={(el) => { otpRefs.current[idx] = el; }}
                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        onPaste={idx === 0 ? handleOtpPaste : undefined}
                        className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-center text-lg text-white font-mono focus:outline-none focus:border-zinc-500 focus:bg-zinc-900/80 transition-all"
                        placeholder="-"
                      />
                    ))}
                  </div>
                </div>

                {/* Resend countdown progress bar */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-400">
                    <span>RESEND GATE:</span>
                    {cooldown > 0 ? (
                      <span className="text-zinc-500 font-bold">Locked ({cooldown}s)</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        className="text-white font-bold hover:underline cursor-pointer bg-transparent border-none p-0 focus:outline-none"
                      >
                        Resend Code
                      </button>
                    )}
                  </div>
                  {cooldown > 0 && (
                    <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden">
                      <div 
                        className="bg-white h-1 transition-all duration-1000" 
                        style={{ width: `${(cooldown / 30) * 100}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="pt-2 space-y-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-white hover:bg-zinc-200 text-black rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer shadow-md"
                  >
                    {loading ? 'Verifying Verification OTP...' : 'Verify OTP & Access'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAuthStep('IDLE'); setOtp(Array(6).fill('')); }}
                    className="w-full bg-transparent border border-zinc-850 hover:bg-zinc-900/20 text-zinc-400 hover:text-white rounded-xl py-2.5 text-[10px] font-mono uppercase tracking-wider transition cursor-pointer"
                  >
                    Change Phone Number
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : isDriverRegister ? (
          /* DRIVER REGISTRATION FLOW */
          <form onSubmit={handleDriverRegisterSubmit} className="space-y-4 text-left font-mono text-xs">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                Full Legal Name
              </label>
              <input
                type="text"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono transition-all"
                placeholder="John Doe"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                Driver Phone Number
              </label>
              <div className="flex gap-2">
                <span className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white text-xs flex items-center">
                  +91
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-all"
                  placeholder="99999 88888"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                Email Address (Optional)
              </label>
              <input
                type="email"
                value={driverEmail}
                onChange={(e) => setDriverEmail(e.target.value)}
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl p-3 text-white text-sm placeholder-zinc-650 focus:outline-none focus:border-zinc-500 font-mono transition-all"
                placeholder="john.doe@example.com"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                Secure PIN / Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 font-mono">
                Hub Region City prefix
              </label>
              <select
                value={driverCityPrefix}
                onChange={(e) => setDriverCityPrefix(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white text-xs focus:outline-none focus:border-zinc-500 font-mono cursor-pointer"
              >
                <option value="KOL">KOL (Kolkata)</option>
                <option value="BLR">BLR (Bengaluru)</option>
              </select>
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white hover:bg-zinc-200 text-black rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer shadow-md"
              >
                {loading ? 'Creating Partner Profile...' : 'Register & Start Onboarding'}
              </button>

              <button
                type="button"
                onClick={() => setIsDriverRegister(false)}
                className="w-full bg-transparent hover:bg-zinc-900/40 text-zinc-400 hover:text-white border border-dashed border-zinc-800 hover:border-zinc-700 rounded-xl py-3 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer mt-2"
              >
                Already have an account? Log in
              </button>
            </div>
          </form>
        ) : (
          /* DRIVER FLOW: Standard login with password/pin input */
          <form onSubmit={handleLoginSubmit} className="space-y-4 text-left font-mono text-xs">
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                Driver Phone Number
              </label>
              <div className="flex gap-2">
                <span className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-white text-xs flex items-center">
                  +91
                </span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  className="flex-1 bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-all"
                  placeholder="99999 88888"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5">
                Secure PIN / Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500 transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white hover:bg-zinc-200 text-black rounded-xl py-3.5 text-xs font-bold uppercase tracking-wider transition-all active:scale-[0.98] cursor-pointer shadow-md"
              >
                {loading ? 'Authorizing Dispatch Session...' : 'Authenticate & Access'}
              </button>

              <button
                type="button"
                onClick={() => {
                  addAuditLog('ONBOARDING_ROUTE_CLICKED', { timestamp: new Date().toISOString() });
                  setIsDriverRegister(true);
                }}
                className="w-full bg-transparent hover:bg-zinc-900/40 text-zinc-400 hover:text-white border border-dashed border-zinc-800 hover:border-zinc-700 rounded-xl py-3 text-[10px] font-bold uppercase tracking-wider transition cursor-pointer mt-2"
              >
                📝 Sign up as Driver Partner
              </button>
            </div>
          </form>
        )}

        {/* Federated Social Sign-in blocks */}
        <div className="pt-4 border-t border-zinc-900 mt-6 grid grid-cols-2 gap-3 text-[9px] font-mono">
          <button
            type="button"
            onClick={() => {
              addAuditLog('OAUTH_GOOGLE_CLICKED', { timestamp: new Date().toISOString() });
              alert('Google Single Sign-On simulation complete.');
            }}
            className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-xl py-2.5 uppercase tracking-wider transition cursor-pointer"
          >
            Google Sign-In
          </button>
          
          <button
            type="button"
            onClick={() => {
              addAuditLog('OAUTH_APPLE_CLICKED', { timestamp: new Date().toISOString() });
              alert('Apple Single Sign-On simulation complete.');
            }}
            className="bg-zinc-900 hover:bg-zinc-850 text-zinc-300 border border-zinc-800 rounded-xl py-2.5 uppercase tracking-wider transition cursor-pointer"
          >
            Apple Sign-In
          </button>
        </div>

        {/* Live compliance logging terminal view */}
        {logs.length > 0 && (
          <div className="mt-6 pt-4 border-t border-zinc-900 text-left">
            <span className="text-[9px] font-mono font-bold text-zinc-600 uppercase tracking-widest block mb-2">Live Compliance Logging:</span>
            <div className="bg-black/50 border border-zinc-900 rounded-xl p-3 max-h-24 overflow-y-auto font-mono text-[8px] text-zinc-500 space-y-1 scrollbar-thin">
              {logs.map((lg, i) => (
                <div key={i} className="truncate select-all">{lg}</div>
              ))}
            </div>
          </div>
        )}

      </div>

      <footer className="mt-8 text-center text-[10px] text-zinc-650 font-mono select-none">
        Secure SHA-256 Token Vault • Active Sandbox Session
      </footer>
    </div>
  );
}

export default function UnifiedLogin() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center font-sans text-zinc-500 font-mono text-xs uppercase animate-pulse">
        Initializing Secure Access Portal...
      </div>
    }>
      <UnifiedLoginContent />
    </Suspense>
  );
}
