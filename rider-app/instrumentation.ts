// Next 16 server instrumentation hook. Initializes Sentry on the server runtime
// and forwards nested React Server Component errors to Sentry.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
