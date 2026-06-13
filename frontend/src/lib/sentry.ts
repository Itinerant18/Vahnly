// Sentry init for the admin SPA (Vite + React 18). Call initSentry() once at
// startup. No-op when VITE_SENTRY_DSN is unset, so local/dev runs without a DSN.
//
// NOTE: per-environment DSN — never share staging and production DSNs.
import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initSentry() {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_ENV as string | undefined) ?? import.meta.env.MODE,
    tracesSampleRate: 0.1,

    // Strip PII before events leave the browser.
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete (event.user as { phone?: string }).phone;
        delete (event.user as { ip_address?: string }).ip_address;
      }
      return event;
    },

    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: false,
      }),
    ],
    replaysSessionSampleRate: 0.01,
    replaysOnErrorSampleRate: 1.0,
  });
}

/** Generic info breadcrumb for admin actions, e.g. trackEvent('table', 'export csv'). */
export function trackEvent(category: string, message: string, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({ category, message, level: 'info', data });
}
