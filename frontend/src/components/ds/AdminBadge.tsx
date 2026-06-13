

type BadgeVariant = 'positive' | 'negative' | 'warning' | 'accent' | 'neutral';

interface AdminBadgeProps {
  label: string;
  variant?: BadgeVariant;
  dot?: boolean;
  pulse?: boolean;
}

// Status → variant mapping
const STATUS_MAP: Record<string, BadgeVariant> = {
  // Driver statuses
  active:     'positive',
  online:     'positive',
  available:  'positive',
  on_trip:    'accent',
  busy:       'accent',
  suspended:  'negative',
  blocked:    'negative',
  banned:     'negative',
  pending:    'warning',
  // KYC
  verified:   'positive',
  rejected:   'negative',
  // Trip
  completed:  'positive',
  cancelled:  'neutral',
  disputed:   'negative',
  // Payout
  processing: 'warning',
  paid:       'positive',
  failed:     'negative',
  // Generic
  success:    'positive',
  error:      'negative',
  inactive:   'neutral',
  offline:    'neutral',
};

export function AdminBadge({ label, variant, dot = false, pulse = false }: AdminBadgeProps) {
  const resolved: BadgeVariant = variant ?? STATUS_MAP[label.toLowerCase()] ?? 'neutral';
  return (
    <span className={`badge badge-${resolved} inline-flex items-center gap-1`}>
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-pill flex-shrink-0 ${
            resolved === 'positive' ? 'bg-positive-400' :
            resolved === 'negative' ? 'bg-negative-400' :
            resolved === 'warning'  ? 'bg-warning-400'  :
            resolved === 'accent'   ? 'bg-accent-400'   :
            'bg-background-tertiary'
          } ${pulse ? 'animate-pulse' : ''}`}
        />
      )}
      {label}
    </span>
  );
}

// Convenience auto-badge: pass status string, auto-resolves variant
export function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, ' ').toLowerCase();
  const variant: BadgeVariant = STATUS_MAP[label.replace(/ /g, '_')] ?? 'neutral';
  return <AdminBadge label={label} variant={variant} />;
}
