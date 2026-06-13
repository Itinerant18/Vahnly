import React from 'react';

type FareSize = 'sm' | 'md' | 'lg' | 'display';

interface FareDisplayProps {
  /** Amount in paise (1/100 of a rupee) */
  amount: number;
  size?: FareSize;
  showSymbol?: boolean;
  className?: string;
}

const sizeCls: Record<FareSize, string> = {
  sm:      'text-mono-small',
  md:      'text-mono-large',
  lg:      'text-heading-large',
  display: 'text-display-medium',
};

function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * FareDisplay — ALWAYS renders in JetBrains Mono (font-mono).
 * NEVER use for addresses or phone numbers.
 *
 * @example <FareDisplay amount={24000} size="display" />
 * Renders: ₹240.00 in JetBrains Mono display-medium
 */
export function FareDisplay({
  amount,
  size = 'md',
  showSymbol = true,
  className = '',
}: FareDisplayProps) {
  const formatted = formatPaise(amount);

  return (
    <span
      className={['font-mono tabular-nums', sizeCls[size], className].filter(Boolean).join(' ')}
      aria-label={`₹${formatted}`}
    >
      {showSymbol && <span>₹</span>}
      {formatted}
    </span>
  );
}
