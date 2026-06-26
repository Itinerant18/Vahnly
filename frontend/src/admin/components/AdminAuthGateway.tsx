import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

// Stable per-browser device id, generated once and persisted. Not derived from the email
// (which made it predictable and trivially forgeable) — it is a random, opaque value used
// only as a soft device-trust signal.
function getDeviceFingerprint(): string {
  if (typeof localStorage === 'undefined') return 'fp-web-cr-ephemeral';
  let fp = localStorage.getItem('admin_device_fp');
  if (!fp) {
    const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    fp = 'fp-web-cr-' + rand.slice(0, 16);
    localStorage.setItem('admin_device_fp', fp);
  }
  return fp;
}

interface AdminAuthGatewayProps {
  onAuthSuccess: () => void;
}

export const AdminAuthGateway: React.FC<AdminAuthGatewayProps> = ({ onAuthSuccess }) => {
  const [activeTab, setActiveTab] = useState<'LOGIN' | 'SIGNUP' | 'FORGOT_PASSWORD'>('LOGIN');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);

  // Sign In inputs
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  
  // 2FA state management
  const [twoFactorRequired, setTwoFactorRequired] = useState<boolean>(false);
  const [twoFactorCode, setTwoFactorCode] = useState<string>('');
  const [mfaMessage, setMfaMessage] = useState<string>('');

  // Password recovery input
  const [recoveryEmail, setRecoveryEmail] = useState<string>('');

  // New-administrator details. The new admin's password is NOT set here — creation goes
  // through the SUPER_ADMIN invite flow, which issues a temporary password.
  const [signupName, setSignupName] = useState<string>('');
  const [signupPhone, setSignupPhone] = useState<string>('');
  const [signupEmail, setSignupEmail] = useState<string>('');
  const [signupRegion, setSignupRegion] = useState<string>('KOL');
  const [signupRole, setSignupRole] = useState<string>('FLEET_MANAGER');
  const [signupCityScope, setSignupCityScope] = useState<string>('KOL');

  // Authorizing SUPER_ADMIN credentials. Creating an account is a privileged, audited action,
  // so the signup form posts through /team/invite under a real SUPER_ADMIN session instead of
  // the disabled public /auth/register.
  const [authorizerEmail, setAuthorizerEmail] = useState<string>('');
  const [authorizerPassword, setAuthorizerPassword] = useState<string>('');
  const [authorizerTwoFactor, setAuthorizerTwoFactor] = useState<string>('');

  // Client device fingerprint audit parameters
  const deviceFingerprint = getDeviceFingerprint();

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/login`, {
        method: 'POST',
        // Cross-origin (Firebase Hosting -> api.aniket.site) must opt in so the gateway's
        // Set-Cookie session cookie (CRIT-004) is stored; checkSession()/logout already do.
        credentials: 'include',
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
          // The server set the HttpOnly session cookie. Store only the non-sensitive role
          // for nav/RBAC gating — never the JWT.
          localStorage.setItem('admin_role', data.role || 'ADMIN');
          onAuthSuccess();
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

    // Only Google Workspace SSO is wired to a real identity provider. Other
    // providers must never fabricate a client-side sso_id — a backend that trusted
    // it would let anyone claim any federated account without an IdP assertion.
    setStatusMessage({
      type: 'ERROR',
      text: `${provider} SSO is not configured. Use Google Workspace or password sign-in.`,
    });
    setIsLoading(false);
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage(null);

    try {
      // 1. Authenticate the authorizing SUPER_ADMIN. Public self-registration is disabled
      //    server-side (/auth/register requires SUPER_ADMIN), so we open a real session for
      //    the authorizer and provision the new admin through the audited invite endpoint.
      const authRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authorizerEmail.trim(),
          password: authorizerPassword,
          two_factor_code: authorizerTwoFactor,
        }),
      });
      const authData = await authRes.json().catch(() => ({}));
      if (!authRes.ok) {
        setStatusMessage({ type: 'ERROR', text: 'Authorizing sign-in failed — check the SUPER_ADMIN email and password.' });
        return;
      }
      if (authData.mfa_required) {
        setStatusMessage({ type: 'ERROR', text: 'Authorizing admin needs a 2FA code — enter the SUPER_ADMIN 6-digit code and retry.' });
        return;
      }

      // 2. Provision the new admin via the SUPER_ADMIN-gated invite (temp password + mandatory
      //    2FA enrolment). Never /auth/register.
      const inviteRes = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/team/invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: signupName.trim(),
          phone: signupPhone.trim(),
          email: signupEmail.trim(),
          role: signupRole,
          region_prefix: signupRegion,
          city_scope: signupCityScope,
        }),
      });

      // 3. Drop the authorizer session so the public signup screen never leaves a SUPER_ADMIN
      //    logged in on a shared browser.
      await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});

      if (inviteRes.status === 401 || inviteRes.status === 403) {
        setStatusMessage({ type: 'ERROR', text: 'Authorizing account is not a SUPER_ADMIN — only SUPER_ADMIN can create accounts.' });
        return;
      }
      if (inviteRes.status === 409) {
        setStatusMessage({ type: 'ERROR', text: 'An account with this email already exists.' });
        return;
      }
      if (!inviteRes.ok) {
        setStatusMessage({ type: 'ERROR', text: 'Account creation failed — check the details and try again.' });
        return;
      }

      setStatusMessage({
        type: 'SUCCESS',
        text: `Invited ${signupEmail.trim()} as ${signupRole}. Temporary password: TempPassword123 — sign in with it plus the 2FA code, then rotate it.`,
      });
      setLoginEmail(signupEmail.trim());
      // Clear the authorizer secret from memory once consumed.
      setAuthorizerPassword('');
      setAuthorizerTwoFactor('');
      setTimeout(() => setActiveTab('LOGIN'), 3000);
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Network error during account provisioning.' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecoverySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // There is no self-service password-reset endpoint: temporary passwords are issued only
    // through the SUPER_ADMIN invite flow. Be honest rather than faking a "reset link sent".
    setStatusMessage({
      type: 'ERROR',
      text: 'No self-service reset. Contact your SUPER_ADMIN to issue a new temporary password.',
    });
  };

  return (
    <div className="min-h-screen bg-background-primary text-content-primary flex items-center justify-center p-6 font-sans selection:bg-gray-1000 selection:text-gray-0">
      <div className="w-full max-w-md bg-background-primary rounded-xl p-8 border border-background-secondary shadow-elevation-2 relative overflow-hidden">

        {/* Brand Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-content-primary font-move">vahnly</h1>
          <p className="text-content-secondary text-xs mt-1.5 font-medium">Operations control room terminal</p>
        </div>

        {/* Tab Selection Switches */}
        {activeTab !== 'FORGOT_PASSWORD' && !twoFactorRequired && (
          <div className="flex border-b border-background-secondary mb-6 text-xs font-bold uppercase tracking-wider">
            <button
              onClick={() => { setActiveTab('LOGIN'); setStatusMessage(null); }}
              className={`flex-1 pb-3 text-center transition cursor-pointer ${activeTab === 'LOGIN' ? 'border-b-2 border-content-primary text-content-primary' : 'text-content-tertiary hover:text-content-primary'}`}
            >
              Sign in
            </button>
            <button
              onClick={() => { setActiveTab('SIGNUP'); setStatusMessage(null); }}
              className={`flex-1 pb-3 text-center transition cursor-pointer ${activeTab === 'SIGNUP' ? 'border-b-2 border-content-primary text-content-primary' : 'text-content-tertiary hover:text-content-primary'}`}
            >
              Create account
            </button>
          </div>
        )}

        {/* Render 2FA Passcode Screen */}
        {twoFactorRequired ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4 text-left">
            <div className="bg-background-secondary border border-background-secondary p-4 rounded-xl text-xs text-content-secondary leading-relaxed">
              <strong>Mandatory MFA Gate</strong>: {mfaMessage}. Enter the 6-digit code from your authenticator app.
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-2">Two-Factor Passcode (6 Digits)</label>
              <input
                type="text"
                maxLength={6}
                placeholder="000 000"
                className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-3 text-center text-lg font-mono font-bold tracking-widest text-content-primary focus:outline-none"
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
                className="flex-1 bg-background-primary border border-background-secondary text-content-primary font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider hover:bg-background-secondary cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 bg-content-primary hover:opacity-90 text-background-primary font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer"
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
                <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-2">Corporate Email</label>
                <input
                  type="email"
                  className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-3 text-sm text-content-primary placeholder-content-tertiary focus:outline-none transition"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary">Security Password</label>
                  <button 
                    type="button"
                    onClick={() => { setActiveTab('FORGOT_PASSWORD'); setStatusMessage(null); }}
                    className="text-[10px] font-bold text-content-secondary hover:text-content-primary cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <input
                  type="password"
                  className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-3 text-sm text-content-primary placeholder-content-tertiary focus:outline-none transition"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-content-primary hover:opacity-90 disabled:opacity-50 text-background-primary font-bold py-3.5 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer mt-2"
              >
                {isLoading ? 'Verifying Credentials...' : 'Unlock Dashboard'}
              </button>
            </form>

            {/* SSO Providers Panel */}
            <div className="space-y-3 pt-3 border-t border-background-secondary">
              <div className="text-center text-[10px] text-content-tertiary uppercase tracking-wider font-bold">Or Federated Identity SSO</div>
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={() => handleSSOLogin('GOOGLE')}
                  disabled={isLoading}
                  className="w-full bg-background-primary border border-background-secondary hover:bg-background-secondary text-content-primary font-bold py-2.5 px-4 rounded-pill text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-status-online" />
                  Sign in with Google Workspace
                </button>
                <button
                  type="button"
                  onClick={() => handleSSOLogin('MICROSOFT')}
                  disabled={isLoading}
                  className="w-full bg-background-primary border border-background-secondary hover:bg-background-secondary text-content-primary font-bold py-2.5 px-4 rounded-pill text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-status-pending" />
                  Sign in with Microsoft 365
                </button>
                <button
                  type="button"
                  onClick={() => handleSSOLogin('SAML')}
                  disabled={isLoading}
                  className="w-full bg-background-primary border border-background-secondary hover:bg-background-secondary text-content-primary font-bold py-2.5 px-4 rounded-pill text-[10px] uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-content-primary" />
                  Enterprise SAML Portal
                </button>
              </div>
            </div>
          </div>
        ) : activeTab === 'SIGNUP' ? (
          // Register form
          <form onSubmit={handleSignupSubmit} className="space-y-3 text-left">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Full Name</label>
              <input
                type="text"
                className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Phone Number</label>
              <input
                type="text"
                className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs font-mono text-content-primary focus:outline-none transition"
                value={signupPhone}
                onChange={(e) => setSignupPhone(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Corporate Email</label>
              <input
                type="email"
                className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Hub Region</label>
                <select
                  className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs font-medium text-content-primary focus:outline-none cursor-pointer"
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
                <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Role Group</label>
                <select
                  className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs font-medium text-content-primary focus:outline-none cursor-pointer"
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
              <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Scoped Cities (comma separated)</label>
              <input
                type="text"
                className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none font-mono"
                value={signupCityScope}
                onChange={(e) => setSignupCityScope(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>

            {/* Authorization — account creation runs under a SUPER_ADMIN session via the
                audited invite endpoint, not public self-registration. */}
            <div className="space-y-3 pt-3 mt-1 border-t border-background-secondary">
              <div className="text-[10px] uppercase tracking-wider font-bold text-content-tertiary">
                Authorize as SUPER_ADMIN
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">SUPER_ADMIN Email</label>
                <input
                  type="email"
                  className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
                  value={authorizerEmail}
                  onChange={(e) => setAuthorizerEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Password</label>
                  <input
                    type="password"
                    className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
                    value={authorizerPassword}
                    onChange={(e) => setAuthorizerPassword(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">2FA Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs font-mono text-content-primary focus:outline-none transition"
                    value={authorizerTwoFactor}
                    onChange={(e) => setAuthorizerTwoFactor(e.target.value.replace(/\D/g, ''))}
                    disabled={isLoading}
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-content-primary hover:opacity-90 disabled:opacity-50 text-background-primary font-bold py-3.5 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer mt-3"
            >
              {isLoading ? 'Provisioning…' : 'Create Account (SUPER_ADMIN)'}
            </button>
          </form>
        ) : (
          // Forgot Password Form
          <form onSubmit={handleRecoverySubmit} className="space-y-4 text-left">
            <div className="text-xs text-content-secondary leading-relaxed">
              Password reset is not self-service. Only a SUPER_ADMIN can issue a new temporary
              password through the invite flow — contact yours to regain access.
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-2">Corporate Email</label>
              <input
                type="email"
                required
                className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-3 text-xs text-content-primary focus:outline-none"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setActiveTab('LOGIN'); setStatusMessage(null); }}
                className="flex-1 bg-background-primary border border-background-secondary text-content-primary font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider hover:bg-background-secondary cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 bg-content-primary hover:opacity-90 text-background-primary font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer"
              >
                How to reset
              </button>
            </div>
          </form>
        )}

        {/* System Message Log Banner */}
        {statusMessage && (
          <div className={`mt-4 p-3.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider text-center ${
            statusMessage.type === 'SUCCESS'
              ? 'bg-background-secondary border border-border-opaque text-content-primary'
              : 'bg-negative-100 border border-negative-300 text-content-negative'
          }`}>
            {statusMessage.text}
          </div>
        )}
        
        {/* Device Fingerprint Audit Metadata Footer */}
        <div className="mt-6 text-center border-t border-background-secondary pt-4 select-none">
          <span className="text-[9px] font-mono text-content-tertiary uppercase tracking-widest">
            FINGERPRINT: {deviceFingerprint}
          </span>
        </div>

      </div>
    </div>
  );
};
