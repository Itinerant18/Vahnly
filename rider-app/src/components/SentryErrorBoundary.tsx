'use client';

// Reusable error boundary that reports to Sentry and shows a minimal fallback.
// Wrap high-value flows (booking, live trip) so a render crash is captured and
// contained rather than blanking the whole app.
import * as Sentry from '@sentry/nextjs';
import type { ReactElement, ReactNode } from 'react';

function DefaultFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="font-medium">Something went wrong.</p>
      <p className="text-sm opacity-70">This screen hit an error. Please retry.</p>
    </div>
  );
}

export function SentryErrorBoundary({
  children,
  name,
  fallback,
}: {
  children: ReactNode;
  name: string;
  fallback?: ReactElement;
}) {
  return (
    <Sentry.ErrorBoundary
      fallback={fallback ?? <DefaultFallback />}
      beforeCapture={(scope) => {
        scope.setTag('boundary', name);
      }}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
