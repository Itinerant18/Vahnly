/** OTP resend countdown helpers. */

export const OTP_RESEND_SECONDS = 30;

/** Formats remaining seconds as M:SS. */
export function formatCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, "0")}`;
}

/** Seconds remaining until `expiresAtMs`, floored at 0. */
export function secondsUntil(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}
