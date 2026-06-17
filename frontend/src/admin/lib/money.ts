// Shared money formatting helpers. Backend monetary values are stored in PAISE
// (1 rupee = 100 paise); convert to ₹ for display here so every admin surface
// renders currency identically.

/** Format a paise integer as a ₹ string, e.g. 57300 → "₹573". */
export function formatPaise(paise: number, fractionDigits = 0): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}`;
}

/**
 * Compact paise → ₹ for KPI cards (lakh/crore short form), e.g.
 * 22300000 → "₹2.2Cr", 532000 → "₹5.3L".
 */
export function formatPaiseCompact(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 10_000_000) return `₹${(rupees / 10_000_000).toFixed(1)}Cr`;
  if (rupees >= 100_000) return `₹${(rupees / 100_000).toFixed(1)}L`;
  if (rupees >= 1_000) return `₹${rupees.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return `₹${rupees.toFixed(0)}`;
}
