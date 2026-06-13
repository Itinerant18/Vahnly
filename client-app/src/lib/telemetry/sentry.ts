// Thin telemetry helpers over Sentry. Safe to call when Sentry is uninitialized
// (no DSN) — the SDK no-ops.
//
// NOTE: the `Sentry.metrics.*` API referenced in older guides was REMOVED in
// Sentry JS v8. We model the dispatch funnel with breadcrumbs (visible on any
// captured error) plus span attributes, which is the supported v10 approach.
import * as Sentry from '@sentry/nextjs';

type FunnelStep =
  | 'booking.started'
  | 'booking.driver_assigned'
  | 'booking.completed'
  | 'booking.cancelled';

/** Record a dispatch-funnel step as a breadcrumb (and increment a span attribute). */
export function trackFunnel(step: FunnelStep, data?: Record<string, unknown>) {
  Sentry.addBreadcrumb({
    category: 'funnel',
    message: step,
    level: 'info',
    data,
  });
  const span = Sentry.getActiveSpan();
  if (span) {
    span.setAttribute(`funnel.${step}`, true);
  }
}

/** Generic info breadcrumb, e.g. trackEvent('booking', 'Driver booked'). */
export function trackEvent(
  category: string,
  message: string,
  data?: Record<string, unknown>,
) {
  Sentry.addBreadcrumb({ category, message, level: 'info', data });
}
