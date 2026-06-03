/**
 * Telemetry integrity heuristics for the operations dashboard.
 *
 * NOTE ON SCOPE: the cell-drivers endpoint returns a single telemetry *snapshot*
 * per driver (speed, bearing, last ping) — not a position track. True GPS-spoof
 * detection (impossible inter-ping displacement, replayed loops) requires the
 * raw position-history stream, which this view does not consume. These checks
 * are therefore snapshot-level signals: cheap, high-precision flags that catch
 * the obvious synthetic patterns mock-location tools emit, without false-alarming
 * on normal driving. Anything flagged here warrants a hold, not an auto-ban.
 */

export interface TelemetrySnapshot {
  current_state: 'ONLINE_AVAILABLE' | 'EN_ROUTE' | 'ON_TRIP' | 'OFFLINE';
  speed_kms: number;
  bearing: number;
  last_ping_utc: string;
}

export type IntegrityRisk = 'CLEAR' | 'AMBER';

export interface IntegrityVerdict {
  risk: IntegrityRisk;
  reasons: string[];
}

// No ground vehicle in a metro service area sustains this — implies a position jump.
const IMPOSSIBLE_VELOCITY_KMH = 180;
// A moving vehicle that never deviates from an exact cardinal heading is synthetic.
const MOVING_THRESHOLD_KMH = 10;
const CARDINAL_BEARINGS = new Set([0, 90, 180, 270]);
// An active trip with a frozen null vector hasn't pinged a real fix.
const STALE_PING_SECONDS = 45;

export function assessTelemetryIntegrity(t: TelemetrySnapshot): IntegrityVerdict {
  const reasons: string[] = [];

  if (t.speed_kms > IMPOSSIBLE_VELOCITY_KMH) {
    reasons.push(`Implausible velocity ${t.speed_kms.toFixed(0)} km/h — likely a position jump`);
  }

  if (t.speed_kms >= MOVING_THRESHOLD_KMH && CARDINAL_BEARINGS.has(Math.round(t.bearing))) {
    reasons.push(`Frozen cardinal heading ${Math.round(t.bearing)}° while moving — synthetic track signature`);
  }

  const isActive = t.current_state === 'EN_ROUTE' || t.current_state === 'ON_TRIP';
  const ageSeconds = (Date.now() - new Date(t.last_ping_utc).getTime()) / 1000;
  if (isActive && t.speed_kms === 0 && t.bearing === 0 && ageSeconds > STALE_PING_SECONDS) {
    reasons.push('Active trip with frozen null vector — stale or spoofed fix');
  }

  return { risk: reasons.length > 0 ? 'AMBER' : 'CLEAR', reasons };
}
