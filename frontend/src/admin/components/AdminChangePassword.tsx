import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface AdminChangePasswordProps {
  // Called after the password is successfully rotated (server cleared must_change_password
  // and re-issued a full-access session cookie). The shell re-checks the session.
  onChanged: () => void;
  // Called when the user backs out (logs out) instead of rotating.
  onCancel: () => void;
}

// First-login password rotation. An invited admin signs in with the temporary password,
// gets a must_change_password session, and is routed here before reaching the dashboard.
export const AdminChangePassword: React.FC<AdminChangePasswordProps> = ({ onChanged, onCancel }) => {
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword,     setNewPassword]     = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [isLoading,       setIsLoading]       = useState<boolean>(false);
  const [errorMessage,    setErrorMessage]    = useState<string>('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (newPassword.length < 8) {
      setErrorMessage('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMessage('New password and confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setErrorMessage('New password must differ from the temporary one.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });

      if (res.ok) {
        onChanged();
      } else if (res.status === 401) {
        setErrorMessage('Current password is incorrect.');
      } else if (res.status === 400) {
        setErrorMessage('New password is too weak or unchanged (min 8 characters).');
      } else {
        setErrorMessage('Could not update password. Please try again.');
      }
    } catch {
      setErrorMessage('Network error contacting the auth gateway.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background-primary text-content-primary flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-md bg-background-primary rounded-xl p-8 border border-background-secondary shadow-[rgba(0,0,0,0.12)_0px_4px_16px_0px]">
        <div className="text-center mb-6">
          <h1 className="text-3xl font-bold tracking-tight text-content-primary">Set a new password</h1>
          <p className="text-content-secondary text-xs mt-1.5 font-medium">
            Your account is on a temporary password. Choose a new one to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Current (temporary) password</label>
            <input
              type="password"
              className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              disabled={isLoading}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">New password (min 8 chars)</label>
            <input
              type="password"
              className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Confirm new password</label>
            <input
              type="password"
              className="w-full bg-background-secondary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={isLoading}
            />
          </div>

          {errorMessage && (
            <div className="p-3 bg-negative-100 border border-negative-300 rounded-md">
              <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-center text-content-negative">
                {errorMessage}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-content-primary hover:bg-gray-800 disabled:opacity-50 text-background-primary font-bold py-3.5 px-4 rounded-pill transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer mt-2"
          >
            {isLoading ? 'Updating…' : 'Update password & continue'}
          </button>

          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full text-[10px] font-bold uppercase tracking-wider text-content-secondary hover:text-content-primary cursor-pointer"
          >
            Cancel and sign out
          </button>
        </form>
      </div>
    </div>
  );
};
