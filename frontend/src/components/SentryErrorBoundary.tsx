// Reusable error boundary for the admin SPA. Reports render crashes to Sentry and
// shows a minimal fallback. Wrap data tables / dashboard panels so one failing
// view doesn't blank the whole control room.
import * as Sentry from '@sentry/react';
import type { ReactElement, ReactNode } from 'react';

function DefaultFallback() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="font-medium">Something went wrong.</p>
      <p className="text-sm opacity-70">This panel hit an error. Try reloading.</p>
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
