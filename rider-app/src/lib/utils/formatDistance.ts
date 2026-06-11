/** Formats metres as a human distance: 850 -> "850 m", 4300 -> "4.3 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Formats kilometres directly: 4.27 -> "4.3 km". */
export function formatKm(km: number): string {
  return `${km.toFixed(1)} km`;
}
