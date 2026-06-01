import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface AdminAuthGatewayProps {
  onAuthSuccess: (token: string) => void;
}

export const AdminAuthGateway: React.FC<AdminAuthGatewayProps> = ({ onAuthSuccess }) => {
  const [activeTab, setActiveTab] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);

  // Testing Credentials Preloaded for instant environment loopback verification
  const [loginEmail, setLoginEmail] = useState<string>('aniketkarmakar018@gmail.com');
  const [loginPassword, setLoginPassword] = useState<string>('Aniket018');

  // Registration form inputs
  const [signupName, setSignupName] = useState<string>('Aniket karmakar');
  const [signupPhone, setSignupPhone] = useState<string>('+91 7602676448');
  const [signupEmail, setSignupEmail] = useState<string>('aniketkarmakar018@gmail.com');
  const [signupPassword, setSignupPassword] = useState<string>('Aniket018');
  const [signupRegion, setSignupRegion] = useState<string>('KOL'); // Defaulting to Kolkata operational grid
  const [signupRole, setSignupRole] = useState<string>('FLEET_MANAGER'); // Defaulting to Fleet Manager role

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
        }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('admin_jwt_token', data.token);
        localStorage.setItem('admin_role', data.role || 'ADMIN');
        onAuthSuccess(data.token);
      } else {
        const errText = response.status === 401 
          ? 'Authentication rejected: Invalid administrative credentials.' 
          : 'Gateway handshake failed. Verify server runtime.';
        setStatusMessage({ type: 'ERROR', text: errText });
      }
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Network connection timeout to auth gateway.' });
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
        }),
      });

      if (response.ok) {
        setStatusMessage({ 
          type: 'SUCCESS', 
          text: 'Account created successfully! Switching to login layer...' 
        });
        // Auto-hydrate login forms and toggle tab after safe registration
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

  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center p-6 font-sans selection:bg-black selection:text-white">
      <div className="w-full max-w-md bg-canvas rounded-xl p-8 border border-canvas-soft shadow-[rgba(0,0,0,0.12)_0px_4px_16px_0px] relative overflow-hidden">

        {/* Brand Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-ink">drivers-for-u</h1>
          <p className="text-body text-sm mt-1.5 font-medium">Operations dashboard control gateway</p>
        </div>

        {/* Tab Selection Switches */}
        <div className="flex border-b border-canvas-soft mb-6 text-sm font-medium">
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

        {/* Form Layer Renderings */}
        {activeTab === 'LOGIN' ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4 text-left">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-2">Corporate Email</label>
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
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-2">Security Password</label>
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
              className="w-full bg-ink hover:bg-black-elevated disabled:opacity-50 text-on-dark font-medium py-3.5 px-4 rounded-pill transition text-sm active:scale-[0.98] cursor-pointer mt-2"
            >
              {isLoading ? 'Verifying Credentials...' : 'Unlock Dashboard'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSignupSubmit} className="space-y-3 text-left">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-1.5">Full Name</label>
              <input
                type="text"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-sm text-ink focus:outline-none transition"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-1.5">Phone Number</label>
              <input
                type="text"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-sm font-mono text-ink focus:outline-none transition"
                value={signupPhone}
                onChange={(e) => setSignupPhone(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-1.5">Corporate Email</label>
              <input
                type="email"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-sm text-ink focus:outline-none transition"
                value={signupEmail}
                onChange={(e) => setSignupEmail(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-1.5">Password</label>
              <input
                type="password"
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-sm text-ink focus:outline-none transition"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-1.5">Assigned Operating Hub</label>
              <select
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-sm font-medium text-ink focus:outline-none cursor-pointer"
                value={signupRegion}
                onChange={(e) => setSignupRegion(e.target.value)}
                disabled={isLoading}
              >
                <option value="KOL">KOL (Kolkata Core Grid)</option>
                <option value="BLR">BLR (Bengaluru Expansion Grid)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium text-body mb-1.5">Assigned Operating Role</label>
              <select
                className="w-full bg-canvas-soft border border-canvas-soft focus:border-ink rounded-md p-2.5 text-sm font-medium text-ink focus:outline-none cursor-pointer"
                value={signupRole}
                onChange={(e) => setSignupRole(e.target.value)}
                disabled={isLoading}
              >
                <option value="FLEET_MANAGER">FLEET_MANAGER (Fleet Operations Manager)</option>
                <option value="FINANCIAL_AUDITOR">FINANCIAL_AUDITOR (Financial Auditor)</option>
                <option value="SUPER_ADMIN">SUPER_ADMIN (Total System Controller)</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-ink hover:bg-black-elevated disabled:opacity-50 text-on-dark font-medium py-3.5 px-4 rounded-pill transition text-sm active:scale-[0.98] cursor-pointer mt-3"
            >
              {isLoading ? 'Registering Administrator...' : 'Register Corporate Profile'}
            </button>
          </form>
        )}

        {/* System Messages Banner Box */}
        {statusMessage && (
          <div className={`mt-4 p-3 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider text-center ${
            statusMessage.type === 'SUCCESS' ? 'bg-canvas-soft border border-surface-pressed text-ink' : 'bg-ink text-on-dark'
          }`}>
            {statusMessage.text}
          </div>
        )}
      </div>
    </div>
  );
};
