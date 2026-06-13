import React from 'react';

interface ETADisplayProps {
  minutes: number;
  label?: string;
  className?: string;
}

/**
 * ETADisplay — numeric value always in JetBrains Mono.
 * NEVER use for addresses or phone numbers.
 *
 * @example <ETADisplay minutes={4} label="away" />
 * Renders: "4 away" — the "4" in JetBrains Mono
 */
export function ETADisplay({ minutes, label, className = '' }: ETADisplayProps) {
  const displayLabel = label ?? 'min';

  return (
    <span className={`inline-flex items-baseline gap-1 ${className}`}>
      <span className="font-mono text-mono-medium tabular-nums">{minutes}</span>
      <span className="text-paragraph-small text-content-secondary">{displayLabel}</span>
    </span>
  );
}
