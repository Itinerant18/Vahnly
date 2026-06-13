import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface AdminLoginProps {
  onLoginSuccess: (token: string) => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess }) => {
  const [email,        setEmail]        = useState<string>('');
  const [password,     setPassword]     = useState<string>('');
  const [isLoading,    setIsLoading]    = useState<boolean>(false);
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
        if (data.role) localStorage.setItem('admin_role', data.role);
        onLoginSuccess(data.token);
      } else if (response.status === 401) {
        setErrorMessage('Authentication Failed: Invalid email or password confirmation.');
      } else {
        setErrorMessage('Server Error: Access gateway rejected handshake parameters.');
      }
    } catch {
      setErrorMessage('Network Error: Unable to establish communication with auth gateway.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-primary text-content-primary flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-background-secondary rounded-md p-8 border border-border-opaque shadow-elevation-2 relative overflow-hidden">

        {/* Brand */}
        <div className="text-center mb-8">
          <h1 className="text-display-small text-content-primary tracking-tight">drivers-for-u</h1>
          <p className="text-label-medium text-content-secondary mt-2">Operations Dashboard Security Gateway</p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-5">
          {/* Email */}
          <div>
            <label className="block text-label-small text-content-secondary uppercase tracking-wider mb-2">
              Corporate Email Address
            </label>
            <input
              type="email"
              className="w-full bg-background-primary border border-border-opaque
                focus:border-border-accent rounded-sm p-3
                text-paragraph-medium text-content-primary placeholder:text-content-tertiary
                focus:outline-none focus:ring-2 focus:ring-accent-400
                transition-base disabled:opacity-40"
              placeholder="name@kolkatadrivers.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-label-small text-content-secondary uppercase tracking-wider mb-2">
              Secure Access Password
            </label>
            <input
              type="password"
              className="w-full bg-background-primary border border-border-opaque
                focus:border-border-accent rounded-sm p-3
                text-paragraph-medium text-content-primary placeholder:text-content-tertiary
                focus:outline-none focus:ring-2 focus:ring-accent-400
                transition-base disabled:opacity-40"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          {/* Error banner */}
          {errorMessage && (
            <div className="p-3 bg-surface-negative border border-negative-200 rounded-sm">
              <p className="text-label-small text-content-negative uppercase tracking-wider text-center">
                {errorMessage}
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="btn-primary w-full rounded-pill h-12 text-label-medium uppercase tracking-wider
              active:scale-[0.98] cursor-pointer transition-base"
          >
            {isLoading ? 'Verifying Credentials…' : 'Unlock Control Room'}
          </button>
        </form>
      </div>
    </div>
  );
};
