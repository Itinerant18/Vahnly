import React, { useEffect } from 'react';

/**
 * Legacy landing for the SSO redirect. The Google callback now sets the session as an
 * HttpOnly cookie server-side and redirects straight to `/admin`, so no token is ever
 * placed in the URL fragment (closes the token-in-history leak). If this route is reached,
 * the cookie is already set — just bounce into the dashboard, where the session gate runs.
 */
export const SsoCallback: React.FC = () => {
  useEffect(() => {
    window.location.replace('/admin');
  }, []);

  return (
    <div className="min-h-screen bg-background-primary text-content-primary flex items-center justify-center font-sans">
      <div className="text-center space-y-4">
        <div className="w-8 h-8 rounded-full border-2 border-background-secondary border-t-ink animate-spin mx-auto" />
        <p className="text-xs text-content-tertiary uppercase font-bold tracking-wider">Completing sign-in…</p>
      </div>
    </div>
  );
};
