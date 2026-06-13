// Sentry browser init for the driver app. Loaded by src/instrumentation-client.ts
// (Next 16 auto-loads that on the client). No-op when NEXT_PUBLIC_SENTRY_DSN is
// unset, so local/dev builds and CI run without a DSN.
//
// NOTE: per-environment DSN — never share staging and production DSNs
// (execution rule 2). Set NEXT_PUBLIC_SENTRY_DSN + NEXT_PUBLIC_ENV per deploy.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? 'development',
    tracesSampleRate: 0.1, // 10% of transactions

    // Strip PII from error events before they leave the device.
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
        maskAllText: true, // privacy: never capture rider/driver text
        blockAllMedia: false,
      }),
    ],
    replaysSessionSampleRate: 0.01, // 1% of sessions
    replaysOnErrorSampleRate: 1.0, // 100% when an error occurs
  });
}

// Surfaces router transitions to Sentry tracing (Next 16 client navigation).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
