import React from 'react';

type StatusKey =
  | 'online'
  | 'available'
  | 'on_trip'
  | 'active'
  | 'pending'
  | 'offer'
  | 'offline'
  | 'cancelled'
  | 'error'
  | 'completed';

interface StatusBadgeProps {
  status: StatusKey;
  label?: string;
  size?: 'sm' | 'md';
}

const statusConfig: Record<
  string,
  { cls: string; dot: string; defaultLabel: string }
> = {
  online:    { cls: 'badge badge-positive', dot: 'status-dot status-dot-online',   defaultLabel: 'Online' },
  available: { cls: 'badge badge-positive', dot: 'status-dot status-dot-online',   defaultLabel: 'Available' },
  on_trip:   { cls: 'badge badge-accent',   dot: 'status-dot status-dot-active',   defaultLabel: 'On Trip' },
  active:    { cls: 'badge badge-accent',   dot: 'status-dot status-dot-active',   defaultLabel: 'Active' },
  pending:   { cls: 'badge badge-warning',  dot: 'status-dot status-dot-pending',  defaultLabel: 'Pending' },
  offer:     { cls: 'badge badge-warning',  dot: 'status-dot status-dot-pending',  defaultLabel: 'Offer' },
  offline:   { cls: 'badge badge-neutral',  dot: 'status-dot status-dot-offline',  defaultLabel: 'Offline' },
  cancelled: { cls: 'badge badge-negative', dot: 'status-dot status-dot-negative', defaultLabel: 'Cancelled' },
  error:     { cls: 'badge badge-negative', dot: 'status-dot status-dot-negative', defaultLabel: 'Error' },
  completed: { cls: 'badge badge-positive', dot: 'status-dot status-dot-online',   defaultLabel: 'Completed' },
};

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.offline;
  const text = label ?? config.defaultLabel;

  return (
    <span
      className={[
        config.cls,
        size === 'sm' ? 'h-5 text-[11px] px-200' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className={config.dot} />
      <span className="ml-1">{text}</span>
    </span>
  );
}
