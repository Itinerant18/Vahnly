/** Formats paise (integer) as Indian Rupees: 12345 -> "₹123.45". */
export function formatCurrency(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole-rupee variant: 12300 -> "₹123". */
export function formatRupeesWhole(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
