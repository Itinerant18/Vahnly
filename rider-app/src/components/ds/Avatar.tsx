import React from 'react';

type AvatarSize = 32 | 40 | 48 | 64 | 80;

interface AvatarProps {
  src?: string;
  name: string;
  size?: AvatarSize;
  className?: string;
}

const sizeCls: Record<AvatarSize, string> = {
  32: 'w-8 h-8 text-label-small',
  40: 'w-10 h-10 text-label-medium',
  48: 'w-12 h-12 text-label-large',
  64: 'w-16 h-16 text-heading-small',
  80: 'w-20 h-20 text-heading-medium',
};

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ src, name, size = 40, className = '' }: AvatarProps) {
  const base = [sizeCls[size], 'rounded-pill flex-shrink-0', className].join(' ');

  if (src) {
    return <img src={src} alt={name} className={[base, 'object-cover'].join(' ')} />;
  }

  return (
    <div
      className={[
        base,
        'bg-gray-200 text-content-secondary font-medium',
        'flex items-center justify-center select-none',
      ].join(' ')}
      aria-label={name}
    >
      {getInitials(name)}
    </div>
  );
}
