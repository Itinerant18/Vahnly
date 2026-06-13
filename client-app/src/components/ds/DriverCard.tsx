import React from 'react';
import { Avatar } from './Avatar';
import { StatusBadge } from './StatusBadge';
import { FareDisplay } from './FareDisplay';

type CardStatus =
  | 'online' | 'available'
  | 'on_trip' | 'active'
  | 'pending' | 'offer'
  | 'offline'
  | 'cancelled' | 'error'
  | 'completed';

interface DriverCardProps {
  photoUrl?: string;
  name: string;
  rating: number;
  status: CardStatus;
  subtitle?: string;
  fareAmount?: number;
  onClick?: () => void;
}

export function DriverCard({
  photoUrl,
  name,
  rating,
  status,
  subtitle,
  fareAmount,
  onClick,
}: DriverCardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={[
        'card flex items-center gap-4',
        onClick
          ? 'cursor-pointer active:bg-background-secondary transition-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400'
          : '',
      ].join(' ')}
    >
      <Avatar name={name} src={photoUrl} size={48} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-heading-small text-content-primary truncate">{name}</span>
          <span className="font-mono text-mono-small text-content-secondary tabular-nums flex-shrink-0">
            ★ {rating.toFixed(2)}
          </span>
        </div>
        {subtitle && (
          <p className="text-paragraph-small text-content-secondary truncate mt-0.5">{subtitle}</p>
        )}
        <div className="mt-2">
          <StatusBadge status={status} size="sm" />
        </div>
      </div>

      {fareAmount !== undefined && (
        <FareDisplay amount={fareAmount} size="md" className="flex-shrink-0" />
      )}
    </div>
  );
}
