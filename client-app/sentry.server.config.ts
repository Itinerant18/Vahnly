// Sentry server (Node runtime) init for the driver app. Loaded by
// src/instrumentation.ts register(). No-op without a DSN.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}
