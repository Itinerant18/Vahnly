'use client';

import React, { useState, useRef, Suspense } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { driverLogin, driverRegister } from '@/api/client';
import { registerDriverPushNotifications } from '@/services/notifications';
import { useRouter } from 'next/navigation';
import { Input, Button } from '@/components/ds';

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
  
  // Logs state
  const [logs, setLogs] = useState<string[]>([]);

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
      login(res.token, {
        id: res.user.id,
        role: res.user.role,
        name: res.user.name,
        phone: cleanPhone,
      });
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

    try {
      // Register new driver account
      await driverRegister(payload);
      addAuditLog('REGISTER_SUCCESS', { phone: cleanPhone });

      // Automatically authenticate session following successful registration
      const res = await driverLogin(cleanPhone, password);
      login(res.token, {
        id: res.user.id,
        role: res.user.role,
        name: res.user.name,
        phone: cleanPhone,
      });

      addAuditLog('LOGIN_SUCCESS', { userId: res.user.id, role: 'DRIVER' });
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
    <div className="min-h-screen relative flex flex-col justify-center items-center p-4 sm:p-6 bg-background-primary text-content-primary font-sans overflow-hidden">
      {/* Grid line matrix background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border-opaque)_1px,transparent_1px),linear-gradient(to_bottom,var(--border-opaque)_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-5" />
      <div className="absolute inset-0 bg-gradient-to-tr from-background-primary via-background-secondary to-background-tertiary z-0 opacity-40" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-md bg-background-secondary border border-border-opaque rounded-md p-6 sm:p-8 shadow-elevation-2">
        
        {/* Logo/Branding */}
        <div className="text-center mb-8">
          <h1 className="text-heading-large font-bold tracking-tight text-content-primary">
            DRIVERS-FOR-U
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

        {isDriverRegister ? (
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
        <div className="pt-6 border-t border-border-opaque mt-6 grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              addAuditLog('OAUTH_GOOGLE_CLICKED', { timestamp: new Date().toISOString() });
              alert('Google Single Sign-On simulation complete.');
            }}
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

        {/* Live compliance logging terminal view */}
        {logs.length > 0 && (
          <div className="mt-6 pt-4 border-t border-border-opaque text-left">
            <span className="text-label-small font-bold text-content-secondary uppercase tracking-widest block mb-2">
              Live Compliance Logging:
            </span>
            <div className="bg-background-tertiary border border-border-opaque rounded-sm p-3 max-h-24 overflow-y-auto font-mono text-mono-small text-content-secondary space-y-1 scrollbar-thin">
              {logs.map((lg, i) => (
                <div key={i} className="truncate select-all">{lg}</div>
              ))}
            </div>
          </div>
        )}

      </div>

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
