import React from 'react';

interface DividerProps {
  className?: string;
}

export function Divider({ className = '' }: DividerProps) {
  return (
    <hr
      className={['border-0 border-t border-border-opaque my-4', className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
