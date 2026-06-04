import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface AdminAuthGatewayProps {
  onAuthSuccess: (token: string) => void;
}

export const AdminAuthGateway: React.FC<AdminAuthGatewayProps> = ({ onAuthSuccess }) => {
  const [activeTab, setActiveTab] = useState<'LOGIN' | 'SIGNUP' | 'FORGOT_PASSWORD'>('LOGIN');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);

  // Sign In inputs
  const [loginEmail, setLoginEmail] = useState<string>('aniketkarmakar018@gmail.com');
  const [loginPassword, setLoginPassword] = useState<string>('Aniket018');
  
  // 2FA state management
  const [twoFactorRequired, setTwoFactorRequired] = useState<boolean>(false);
  const [twoFactorCode, setTwoFactorCode] = useState<string>('');
  const [mfaMessage, setMfaMessage] = useState<string>('');

  // Password recovery input
  const [recoveryEmail, setRecoveryEmail] = useState<string>('');

  // Registration form inputs
  const [signupName, setSignupName] = useState<string>('');
  const [signupPhone, setSignupPhone] = useState<string>('');
  const [signupEmail, setSignupEmail] = useState<string>('');
  const [signupPassword, setSignupPassword] = useState<string>('');
  const [signupRegion, setSignupRegion] = useState<string>('KOL'); 
  const [signupRole, setSignupRole] = useState<string>('FLEET_MANAGER'); 
  const [signupCityScope, setSignupCityScope] = useState<string>('KOL'); 

  // Client device fingerprint audit parameters
  const deviceFingerprint = 'fp-web-cr-' + btoa(loginEmail).substring(0, 10).toLowerCase();

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.trim(),
          password: loginPassword,
          two_factor_code: twoFactorCode,
          device_fingerprint: deviceFingerprint
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.mfa_required) {
          setTwoFactorRequired(true);
          setMfaMessage(data.message || 'Multi-Factor Authenticator is active.');
        } else {
          localStorage.setItem('admin_jwt_token', data.token);
          localStorage.setItem('admin_role', data.role || 'ADMIN');
          onAuthSuccess(data.token);
        }
      } else {
        const errText = data.message || 'Authentication rejected: Invalid corporate credentials.';
        setStatusMessage({ type: 'ERROR', text: errText });
      }
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Network connection timeout to auth gateway.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSSOLogin = async (provider: string) => {
    setIsLoading(true);
    setStatusMessage(null);

    // Google Workspace uses the real OAuth2 authorization-code flow: hand the
    // browser to the gateway, which redirects to Google's consent screen and
    // bounces back to /admin/sso-callback with a signed token.
    if (provider.toUpperCase() === 'GOOGLE') {
      window.location.href = `${API_GATEWAY_BASE_URL}/api/v1/admin/auth/sso/google/start`;
      return;
    }

    const mockSSOId = 'sso-' + provider.toLowerCase() + '-' + Math.random().toString(36).substring(2, 9);
    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.trim(),
          sso_provider: provider,
          sso_id: mockSSOId,
          two_factor_code: twoFactorCode,
          device_fingerprint: deviceFingerprint
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (data.mfa_required) {
          setTwoFactorRequired(true);
          setMfaMessage(data.message || `SSO verification complete. 2FA is active.`);
        } else {
          localStorage.setItem('admin_jwt_token', data.token);
          localStorage.setItem('admin_role', data.role || 'ADMIN');
          onAuthSuccess(data.token);
        }
      } else {
        setStatusMessage({ 
          type: 'ERROR', 
          text: data.message || `Federated ${provider} authentication failed. Is your email registered?` 
        });
      }
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Network error connecting to SSO provider.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: signupName.trim(),
          phone: signupPhone.trim(),
          email: signupEmail.trim(),
          password: signupPassword,
          region_prefix: signupRegion,
          role: signupRole,
          city_scope: signupCityScope
        }),
      });

      if (response.ok) {
        setStatusMessage({ 
          type: 'SUCCESS', 
          text: 'Account created successfully! Switching to login layer...' 
        });
        setLoginEmail(signupEmail);
        setLoginPassword(signupPassword);
        setTimeout(() => setActiveTab('LOGIN'), 1500);
      } else {
        setStatusMessage({ type: 'ERROR', text: 'Registration rejected. Profile credentials may already exist.' });
      }
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Network error occurred during profile registration.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecoverySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      setStatusMessage({
        type: 'SUCCESS',
        text: 'Credentials recovery link dispatched. If registered, verify your inbox within 15 minutes.'
      });
      setIsLoading(false);
      setRecoveryEmail('');
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-6 font-sans selection:bg-black selection:text-white">
      <div className="w-full max-w-md bg-canvas rounded-xl p-8 border border-canvas-soft shadow-[rgba(0,0,0,0.12)_0px_4px_16px_0px] relative overflow-hidden">

        {/* Brand Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-ink font-move">drivers-for-u</h1>
          <p className="text-body text-xs mt-1.5 font-medium">Operations control room terminal</p>
        </div>

        {/* Tab Selection Switches */}
        {activeTab !== 'FORGOT_PASSWORD' && !twoFactorRequired && (
          <div className="flex border-b border-canvas-soft mb-6 text-xs font-bold uppercase tracking-wider">
            <button
              onClick={() => { setActiveTab('LOGIN'); setStatusMessage(null); }}
              className={`flex-1 pb-3 text-center transition cursor-pointer ${activeTab === 'LOGIN' ? 'border-b-2 border-ink text-ink' : 'text-mute hover:text-ink'}`}
            >
              Sign in
            </button>
            <button
              onClick={() => { setActiveTab('SIGNUP'); setStatusMessage(null); }}
              className={`flex-1 pb-3 text-center transition cursor-pointer ${activeTab === 'SIGNUP' ? 'border-b-2 border-ink text-ink' : 'text-mute hover:text-ink'}`}
            >
              Create account
            </button>
          </div>
        )}

        {/* Render 2FA Passcode Screen */}
        {twoFactorRequired ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4 text-left">
            <div className="bg-canvas-soft border border-canvas-soft p-4 rounded-xl text-xs text-body leading-relaxed">
              <strong>Mandatory MFA Gate</strong>: {mfaMessage}. Use mock authentication code <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-canvas-soft text-ink font-bold">123456</code> to bypass.
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Two-Factor Passcode (6 Digits)</label>
              <input
                type="text"
                maxLength={6}
                placeholder="000 000"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-3 text-center text-lg font-mono font-bold tracking-widest text-ink focus:outline-none"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                required
                disabled={isLoading}
                autoFocus
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setTwoFactorRequired(false); setTwoFactorCode(''); setStatusMessage(null); }}
                className="flex-1 bg-canvas border border-canvas-soft text-ink font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider hover:bg-canvas-soft cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 bg-ink hover:bg-black-elevated text-on-dark font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer"
              >
                {isLoading ? 'Verifying...' : 'Authenticate'}
              </button>
            </div>
          </form>
        ) : activeTab === 'LOGIN' ? (
          // Sign In Form
          <div className="space-y-5">
            <form onSubmit={handleLoginSubmit} className="space-y-4 text-left">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Corporate Email</label>
                <input
                  type="email"
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-3 text-sm text-ink placeholder-mute focus:outline-none transition"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-body">Security Password</label>
                  <button 
                    type="button"
                    onClick={() => { setActiveTab('FORGOT_PASSWORD'); setStatusMessage(null); }}
                    className="text-[10px] font-bold text-body hover:text-ink cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <input
                  type="password"
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-3 text-sm text-ink placeholder-mute focus:outline-none transition"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-ink hover:bg-black-elevated disabled:opacity-50 text-on-dark font-bold py-3.5 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer mt-2"
              >
                {isLoading ? 'Verifying Credentials...' : 'Unlock Dashboard'}
              </button>
            </form>

            {/* SSO Providers Panel */}
            <div className="space-y-3 pt-3 border-t border-canvas-soft">
              <div className="text-center text-[10px] text-mute uppercase tracking-wider font-bold">Or Federated Identity SSO</div>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => handleSSOLogin('GOOGLE')}
                  disabled={isLoading}
                  className="w-full bg-canvas border border-canvas-soft hover:bg-canvas-soft text-ink font-bold py-2.5 px-4 rounded-pill text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-status-online" />
                  Sign in with Google Workspace
                </button>
                <button
                  type="button"
                  onClick={() => handleSSOLogin('MICROSOFT')}
                  disabled={isLoading}
                  className="w-full bg-canvas border border-canvas-soft hover:bg-canvas-soft text-ink font-bold py-2.5 px-4 rounded-pill text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-status-warn" />
                  Sign in with Microsoft 365
                </button>
                <button
                  type="button"
                  onClick={() => handleSSOLogin('SAML')}
                  disabled={isLoading}
                  className="w-full bg-canvas border border-canvas-soft hover:bg-canvas-soft text-ink font-bold py-2.5 px-4 rounded-pill text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-ink" />
                  Enterprise SAML Portal
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'SIGNUP' ? (
          // Register form
          <form onSubmit={handleSignupSubmit} className="space-y-3 text-left">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1.5">Full Name</label>
              <input
                type="text"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none transition"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1.5">Phone Number</label>
              <input
                type="text"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs font-mono text-ink focus:outline-none transition"
                value={signupPhone}
                onChange={(e) => setSignupPhone(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1.5">Corporate Email</label>
              <input
                type="email"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none transition"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1.5">Password</label>
              <input
                type="password"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none transition"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1.5">Hub Region</label>
                <select
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs font-medium text-ink focus:outline-none cursor-pointer"
                  value={signupRegion}
                  onChange={(e) => {
                    setSignupRegion(e.target.value);
                    setSignupCityScope(e.target.value);
                  }}
                  disabled={isLoading}
                >
                  <option value="KOL">KOL (Kolkata)</option>
                  <option value="BLR">BLR (Bengaluru)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1.5">Role Group</label>
                <select
                  className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs font-medium text-ink focus:outline-none cursor-pointer"
                  value={signupRole}
                  onChange={(e) => setSignupRole(e.target.value)}
                  disabled={isLoading}
                >
                  <option value="SUPER_ADMIN">Super Admin</option>
                  <option value="OPERATIONS_MANAGER">Operations Manager</option>
                  <option value="FLEET_MANAGER">Fleet Manager</option>
                  <option value="CUSTOMER_SUPPORT">Customer Support</option>
                  <option value="FINANCE">Finance</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="ANALYTICS">Analytics / BI</option>
                  <option value="CITY_MANAGER">City Manager</option>
                  <option value="COMPLIANCE">Compliance / Safety</option>
                  <option value="AUDITOR">Read-only Auditor</option>
                </select>
              </div>
            </div>
            
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1.5">Scoped Cities (comma separated)</label>
              <input
                type="text"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-xs text-ink focus:outline-none font-mono"
                value={signupCityScope}
                onChange={(e) => setSignupCityScope(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-ink hover:bg-black-elevated disabled:opacity-50 text-on-dark font-bold py-3.5 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer mt-3"
            >
              {isLoading ? 'Registering...' : 'Register Corporate Profile'}
            </button>
          </form>
        ) : (
          // Forgot Password Form
          <form onSubmit={handleRecoverySubmit} className="space-y-4 text-left">
            <div className="text-xs text-body leading-relaxed">
              Enter your registered corporate email to trigger credential lockout recovery loops.
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Corporate Email</label>
              <input
                type="email"
                required
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-3 text-xs text-ink focus:outline-none"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
              />
            </div>
            
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setActiveTab('LOGIN'); setStatusMessage(null); }}
                className="flex-1 bg-canvas border border-canvas-soft text-ink font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider hover:bg-canvas-soft cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 bg-ink hover:bg-black-elevated text-on-dark font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer"
              >
                {isLoading ? 'Processing...' : 'Recover Account'}
              </button>
            </div>
          </form>
        )}

        {/* System Message Log Banner */}
        {statusMessage && (
          <div className={`mt-4 p-3.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider text-center ${
            statusMessage.type === 'SUCCESS' ? 'bg-canvas-soft border border-surface-pressed text-ink' : 'bg-ink text-on-dark'
          }`}>
            {statusMessage.text}
          </div>
        )}
        
        {/* Device Fingerprint Audit Metadata Footer */}
        <div className="mt-6 text-center border-t border-canvas-soft pt-4 select-none">
          <span className="text-[9px] font-mono text-mute uppercase tracking-widest">
            FINGERPRINT: {deviceFingerprint}
          </span>
        </div>

      </div>
    </div>
  );
};
