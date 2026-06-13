// Sentry browser init for the rider app. Loaded by instrumentation-client.ts.
// No-op when NEXT_PUBLIC_SENTRY_DSN is unset.
//
// NOTE: per-environment DSN — never share staging and production DSNs.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? 'development',
    tracesSampleRate: 0.1,

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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
