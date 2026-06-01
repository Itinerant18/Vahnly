import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface AdminLoginProps {
  onLoginSuccess: (token: string) => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('admin_jwt_token', data.token);
        onLoginSuccess(data.token);
      } else if (response.status === 401) {
        setErrorMessage('Authentication Failed: Invalid email or password confirmation.');
      } else {
        setErrorMessage('Server Error: Access gateway rejected handshake parameters.');
      }
    } catch (err) {
      setErrorMessage('Network Error: Unable to establish communication with auth gateway.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white text-ink flex items-center justify-center p-6 font-sans selection:bg-black selection:text-white">
      <div className="w-full max-w-md bg-canvas-softer rounded-xl p-8 border border-canvas-soft shadow-sm relative overflow-hidden">
        <div className="text-center mb-8 relative">
          <h1 className="text-3xl font-bold tracking-tight text-ink font-move">drivers-for-u</h1>
          <p className="text-body text-xs mt-2 font-medium">Operations Dashboard Security Gateway</p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-5 relative">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">
              Corporate Email Address
            </label>
            <input
              type="email"
              className="w-full bg-white border border-canvas-soft focus:border-ink rounded-xl p-3 text-xs text-ink placeholder-mute focus:outline-none focus:ring-1 focus:ring-ink transition"
              placeholder="name@kolkatadrivers.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">
              Secure Access Password
            </label>
            <input
              type="password"
              className="w-full bg-white border border-canvas-soft focus:border-ink rounded-xl p-3 text-xs text-ink placeholder-mute focus:outline-none focus:ring-1 focus:ring-ink transition"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          {errorMessage && (
            <div className="p-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-black hover:bg-black-elevated disabled:opacity-50 text-white font-bold py-3.5 px-4 rounded-full transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer"
          >
            {isLoading ? 'Verifying Credentials...' : 'Unlock Control Room'}
          </button>
        </form>
      </div>
    </div>
  );
};
