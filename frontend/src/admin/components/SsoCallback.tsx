import React, { useEffect, useState } from 'react';

/**
 * Consumes the token the SSO callback hands back in the URL fragment
 * (`/admin/sso-callback#token=…&role=…`), persists it the same way the
 * password gateway does, then hard-reloads into the dashboard so the shell
 * re-initialises auth + role from storage. The fragment never hits the server.
 */
export const SsoCallback: React.FC = () => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const params = new URLSearchParams(raw);
    const token = params.get('token');
    const role = params.get('role') || 'ADMIN';

    if (!token) {
      setError('Missing token in SSO response. Return to login and try again.');
      return;
    }
    localStorage.setItem('admin_jwt_token', token);
    localStorage.setItem('admin_role', role);
    window.location.replace('/admin');
  }, []);

  return (
    <div className="min-h-screen bg-canvas text-ink flex items-center justify-center font-sans">
      <div className="text-center space-y-4">
        {error ? (
          <>
            <p className="text-sm text-status-alert font-medium">{error}</p>
            <a href="/admin" className="inline-block text-sm font-medium py-2 px-5 rounded-pill bg-ink text-on-dark">
              Back to login
            </a>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-full border-2 border-canvas-soft border-t-ink animate-spin mx-auto" />
            <p className="text-xs text-mute uppercase font-bold tracking-wider">Completing sign-in…</p>
          </>
        )}
      </div>
    </div>
  );
};
