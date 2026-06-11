import { useState, useEffect, useCallback, useRef } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface OdoCheckpoint {
  checkpoint_type: string;
  odometer_value: number;
  fuel_percentage: number;
  photo_url: string;
  captured_at: string;
}

interface OdoAudit {
  order_id: string;
  status: string;
  financial_status: string;
  expected_km: number;
  road_factor: number;
  tolerance_pct: number;
  has_both: boolean;
  reported_km?: number;
  variance_pct?: number;
  is_flagged: boolean;
  start: OdoCheckpoint | null;
  end: OdoCheckpoint | null;
}

interface Props {
  orderId: string;
  // Reports the audit gate state up to the parent (e.g. to block ledger verification).
  onAuditState?: (s: { isFlagged: boolean; acknowledged: boolean }) => void;
}

const authHeaders = (json = false): Record<string, string> => {
  const email = localStorage.getItem('admin_email') || '';
  const h: Record<string, string> = {};
  if (email) h['X-Admin-Email'] = email;
  if (json) h['Content-Type'] = 'application/json';
  return h;
};

function CheckpointCard({
  label,
  cp,
  onZoom,
  onAdjust,
}: {
  label: string;
  cp: OdoCheckpoint | null;
  onZoom: (url: string) => void;
  onAdjust: () => void;
}) {
  return (
    <div className="flex-1 bg-canvas-softer border border-canvas-soft rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-mute">{label}</span>
        {cp && (
          <button type="button" onClick={onAdjust} className="text-[9px] text-blue-600 hover:underline font-bold uppercase tracking-wider">
            Adjust
          </button>
        )}
      </div>
      {cp ? (
        <>
          <div className="font-mono font-bold text-ink text-lg">{cp.odometer_value.toLocaleString()} km</div>
          <div className="text-[10px] text-body">Fuel: {cp.fuel_percentage}% · {new Date(cp.captured_at).toLocaleString()}</div>
          {cp.photo_url ? (
            <button type="button" onClick={() => onZoom(cp.photo_url)} className="block w-full">
              <img
                src={cp.photo_url}
                alt={`${label} odometer`}
                className="mt-1 h-24 w-full object-cover rounded-md border border-canvas-soft hover:opacity-90 transition cursor-zoom-in"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            </button>
          ) : (
            <div className="mt-1 h-24 w-full rounded-md border border-dashed border-canvas-soft flex items-center justify-center text-[10px] text-mute">No photo</div>
          )}
        </>
      ) : (
        <div className="py-6 text-center text-[10px] text-mute font-mono">Not captured</div>
      )}
    </div>
  );
}

export function OdometerVerificationPanel({ orderId, onAuditState }: Props) {
  const [audit, setAudit] = useState<OdoAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [editing, setEditing] = useState<'START' | 'END' | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);

  // Keep the latest callback in a ref so reporting state up never re-triggers the loop.
  const cbRef = useRef(onAuditState);
  cbRef.current = onAuditState;

  const load = useCallback(async () => {
    setLoading(true);
    setAcknowledged(false);
    try {
      const r = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${orderId}/odometer-audit`, { headers: authHeaders() });
      setAudit(r.ok ? await r.json() : null);
    } catch {
      setAudit(null);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    cbRef.current?.({ isFlagged: !!audit?.is_flagged, acknowledged });
  }, [audit?.is_flagged, acknowledged]);

  const saveOverride = async (type: 'START' | 'END') => {
    if (!window.confirm(
      `Override the ${type} odometer reading to ${editValue} km for order ${orderId}?\n\n` +
      `If this pushes mileage variance past tolerance it posts a corrective ledger ` +
      `entry and places the driver on payout hold.`
    )) {
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/orders/${orderId}/odometer-audit`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ checkpoint_type: type, odometer_value: editValue, reason: editReason }),
      });
      if (r.ok) {
        setAudit(await r.json());
        setEditing(null);
        setEditReason('');
        setAcknowledged(false);
      }
    } catch {
      /* surfaced via unchanged state */
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (type: 'START' | 'END') => {
    const cp = type === 'START' ? audit?.start : audit?.end;
    setEditing(type);
    setEditValue(cp?.odometer_value ?? 0);
    setEditReason('');
  };

  if (loading) {
    return <div className="text-[11px] text-mute font-mono animate-pulse py-4">Loading odometer audit…</div>;
  }
  if (!audit) {
    return <div className="text-[11px] text-mute py-4">No odometer audit available for this trip.</div>;
  }

  const variance = audit.variance_pct;
  const badge = !audit.has_both
    ? { cls: 'bg-gray-100 text-gray-600 border-gray-300', text: 'Incomplete checkpoints' }
    : audit.is_flagged
      ? { cls: 'bg-red-100 text-red-700 border-red-300', text: `Variance ${variance?.toFixed(1)}% — action required` }
      : { cls: 'bg-green-100 text-green-700 border-green-300', text: `Variance ${variance?.toFixed(1)}% — balanced` };

  return (
    <div className="border-t border-canvas-soft pt-4 mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider font-bold text-mute">Odometer / mileage audit</span>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${badge.cls}`}>{badge.text}</span>
      </div>

      {audit.financial_status === 'REVIEW_REQUIRED' && (
        <div className="flex items-center gap-2 p-2 rounded-md bg-red-50 border border-red-200 text-[10px] font-bold text-red-700 uppercase tracking-wider">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
          Financial review required — corrective ledger entry posted, driver payout held
        </div>
      )}

      <div className="flex gap-3">
        <CheckpointCard label="Start" cp={audit.start} onZoom={setLightbox} onAdjust={() => beginEdit('START')} />
        <CheckpointCard label="End" cp={audit.end} onZoom={setLightbox} onAdjust={() => beginEdit('END')} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
        <div className="bg-canvas-softer rounded-md p-2">
          <div className="text-mute">Reported</div>
          <div className="font-mono font-bold text-ink">{audit.reported_km != null ? `${audit.reported_km} km` : '—'}</div>
        </div>
        <div className="bg-canvas-softer rounded-md p-2">
          <div className="text-mute">Expected (×{audit.road_factor})</div>
          <div className="font-mono font-bold text-ink">{audit.expected_km} km</div>
        </div>
        <div className="bg-canvas-softer rounded-md p-2">
          <div className="text-mute">Tolerance</div>
          <div className="font-mono font-bold text-ink">±{audit.tolerance_pct}%</div>
        </div>
      </div>

      {editing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Override {editing} odometer</p>
          <div className="flex gap-2">
            <input
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(parseInt(e.target.value, 10) || 0)}
              className="w-32 border rounded px-2 py-1 text-xs font-mono"
              placeholder="km"
            />
            <input
              type="text"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              className="flex-1 border rounded px-2 py-1 text-xs"
              placeholder="Reason for correction (audited)"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving || editValue <= 0 || !editReason.trim()}
              onClick={() => saveOverride(editing)}
              className="px-3 py-1 bg-blue-600 text-white text-[10px] font-bold rounded disabled:opacity-40 uppercase tracking-wider"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="px-3 py-1 bg-white border text-[10px] text-gray-600 rounded uppercase tracking-wider">
              Cancel
            </button>
          </div>
        </div>
      )}

      {audit.is_flagged && (
        <label className="flex items-center gap-2 text-[11px] text-red-700 font-medium bg-red-50 border border-red-200 rounded-md p-2 cursor-pointer">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          I have inspected the dashboard photos and sign off on this mileage variance.
        </label>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6 cursor-zoom-out"
          onClick={() => setLightbox(null)}
        >
          <img src={lightbox} alt="Odometer dashboard" className="max-h-full max-w-full rounded-lg shadow-2xl" />
        </div>
      )}
    </div>
  );
}
