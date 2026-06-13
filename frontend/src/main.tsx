import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AdminShell } from './admin/AdminShell';
import { SentryErrorBoundary } from './components/SentryErrorBoundary';
import { initSentry } from './lib/sentry';
// Design system tokens must be imported before index.css so CSS custom
// properties are defined before Tailwind utilities reference them.
import './styles/tokens.css';
import './index.css';

// Initialize error tracking as early as possible (no-op without VITE_SENTRY_DSN).
initSentry();

// Auth rides entirely on the HttpOnly `admin_session` cookie — the JWT is never in
// JS-readable storage. Default every request to send credentials so the cookie is
// attached (same-origin sends it anyway; this also covers any cross-origin setup).
const originalFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
  originalFetch(input, { ...init, credentials: init.credentials ?? 'include' });

// The router is mounted under basename="/admin"; any URL outside it (e.g. "/")
// matches nothing and renders a blank page. Send those to the admin root.
if (!window.location.pathname.startsWith('/admin')) {
  window.location.replace('/admin');
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <SentryErrorBoundary name="admin-root">
      <BrowserRouter
        basename="/admin"
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AdminShell />
      </BrowserRouter>
    </SentryErrorBoundary>
  </React.StrictMode>,
);
