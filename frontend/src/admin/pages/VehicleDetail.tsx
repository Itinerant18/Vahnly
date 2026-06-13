import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';
import type { Vehicle } from './VehiclesList';

const DOC_CLS: Record<string, string> = {
  VERIFIED: 'bg-surface-positive text-content-positive',
  EXPIRING_SOON: 'bg-surface-warning text-content-warning',
  EXPIRED: 'bg-surface-negative text-content-negative',
};

function DocCard({ label, status, expiry }: { label: string; status: string; expiry: string }) {
  return (
    <div className="p-4 bg-white border border-border-opaque rounded-lg">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-medium text-content-primary">{label}</p>
        <span className={`text-xs px-2 py-0.5 rounded ${DOC_CLS[status] ?? 'bg-background-secondary text-content-secondary'}`}>{status}</span>
      </div>
      <p className="text-xs text-content-secondary">Expires {expiry ? new Date(expiry).toLocaleDateString() : '—'}</p>
    </div>
  );
}

export function VehicleDetail() {
  const { id } = useParams<{ id: string }>();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/vehicles/${encodeURIComponent(id)}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error('failed');
      setVehicle(await res.json());
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="p-6 text-sm text-content-secondary animate-pulse">Loading vehicle…</div>;
  }
  if (notFound || !vehicle) {
    return (
      <div className="p-6 space-y-3">
        <Link to="/vehicles" className="text-sm text-content-accent hover:underline">← Back to Vehicles</Link>
        <p className="text-content-secondary">Vehicle <span className="font-mono">{id}</span> not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <Link to="/vehicles" className="text-sm text-content-accent hover:underline">← Back to Vehicles</Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content-primary font-mono">{vehicle.plate}</h1>
          <p className="text-content-secondary mt-1">{vehicle.model} · {vehicle.type} · {vehicle.transmission} · {vehicle.fuel} · {vehicle.year}</p>
        </div>
        <span className="text-xs bg-background-secondary text-content-secondary px-2 py-1 rounded">{vehicle.city}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-background-secondary rounded-lg">
          <p className="text-xs text-content-secondary">Owner</p>
          <Link
            to={vehicle.owner_type === 'DRIVER' ? `/drivers/${vehicle.owner_id}` : `/riders/${vehicle.owner_id}`}
            className="text-sm font-medium text-content-accent hover:underline"
          >
            {vehicle.owner_name}
          </Link>
          <p className="text-xs text-content-tertiary mt-0.5">{vehicle.owner_type}</p>
        </div>
        <div className="p-4 bg-background-secondary rounded-lg">
          <p className="text-xs text-content-secondary">Trips</p>
          <p className="text-lg font-bold text-content-primary">{vehicle.trips_count}</p>
        </div>
        <div className="p-4 bg-background-secondary rounded-lg">
          <p className="text-xs text-content-secondary">Last Serviced</p>
          <p className="text-sm font-medium text-content-primary">{vehicle.last_serviced ? new Date(vehicle.last_serviced).toLocaleDateString() : '—'}</p>
        </div>
        <div className="p-4 bg-background-secondary rounded-lg">
          <p className="text-xs text-content-secondary">Reminder Sent</p>
          <p className="text-sm font-medium text-content-primary">{vehicle.reminder_sent_at ? new Date(vehicle.reminder_sent_at).toLocaleString() : 'Never'}</p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-content-primary mb-3">Documents</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DocCard label="RC" status={vehicle.rc_status} expiry={vehicle.rc_expiry_date} />
          <DocCard label="Insurance" status={vehicle.insurance_status} expiry={vehicle.insurance_expiry_date} />
          <DocCard label="PUC" status={vehicle.puc_status} expiry={vehicle.puc_expiry_date} />
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-content-primary mb-3">Flagged Issues</h3>
        {vehicle.flagged_issues && vehicle.flagged_issues.length > 0 ? (
          <ul className="space-y-2">
            {vehicle.flagged_issues.map((issue, i) => (
              <li key={i} className="p-3 bg-surface-negative border border-negative-400 rounded text-sm text-content-negative">{issue}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-content-secondary">No issues flagged by drivers.</p>
        )}
      </div>
    </div>
  );
}
