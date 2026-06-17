import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_GATEWAY_BASE_URL } from '../../config';
import { AdminBadge } from '../../components/ds/AdminBadge';
import { formatPaise } from '../lib/money';
import { profileToVehicle, type Vehicle, type VehicleDoc, type CustomerVehicleProfile } from './VehiclesList';

const docVariant = (status: string): 'positive' | 'warning' | 'negative' | 'neutral' => {
  if (status === 'VERIFIED') return 'positive';
  if (status === 'EXPIRING_SOON') return 'warning';
  if (status === 'EXPIRED') return 'negative';
  return 'neutral';
};

function DocCard({ label, doc }: { label: string; doc: VehicleDoc }) {
  return (
    <div className="p-4 bg-white border border-border-opaque rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-content-primary">{label}</p>
        <AdminBadge label={doc.status.replace('_', ' ').toLowerCase()} variant={docVariant(doc.status)} dot />
      </div>
      <p className="text-xs text-content-secondary">Expires {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString() : '—'}</p>
      {doc.image_url ? (
        <a href={doc.image_url} target="_blank" rel="noreferrer" className="block group">
          <img
            src={doc.image_url}
            alt={`${label} document`}
            loading="lazy"
            onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
            className="w-full h-28 object-cover rounded border border-border-opaque bg-background-secondary group-hover:opacity-90 transition-opacity"
          />
          <span className="mt-1 block text-[10px] text-content-accent group-hover:underline">View document</span>
        </a>
      ) : (
        <div className="w-full h-28 rounded border border-dashed border-border-opaque bg-background-secondary flex items-center justify-center text-[10px] text-content-tertiary">
          No document on file
        </div>
      )}
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
      const role = localStorage.getItem('admin_role') || 'ADMIN';
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/customers/vehicles`, {
        headers: { 'X-Admin-Role': role },
      });
      if (!res.ok) throw new Error('failed');
      const data: { profiles?: CustomerVehicleProfile[] } = await res.json();
      const match = (data.profiles || []).find((p) => p.id === id || p.license_plate === id);
      if (!match) { setNotFound(true); return; }
      setVehicle(profileToVehicle(match));
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
            to={`/riders/${vehicle.owner_id}`}
            className="text-sm font-medium text-content-accent hover:underline"
          >
            {vehicle.owner_name}
          </Link>
          <p className="text-xs text-content-tertiary mt-0.5">{vehicle.owner_type}</p>
        </div>
        <div className="p-4 bg-background-secondary rounded-lg">
          <p className="text-xs text-content-secondary">Escrow Balance</p>
          <p className="text-lg font-bold text-content-primary font-mono">{formatPaise(vehicle.escrow_balance_paise, 2)}</p>
        </div>
        <div className="p-4 bg-background-secondary rounded-lg">
          <p className="text-xs text-content-secondary">Last Serviced</p>
          <p className="text-sm font-medium text-content-primary">{vehicle.last_serviced ? new Date(vehicle.last_serviced).toLocaleDateString() : '—'}</p>
        </div>
        <div className="p-4 bg-background-secondary rounded-lg">
          <p className="text-xs text-content-secondary">Verification</p>
          <div className="mt-1"><AdminBadge label={vehicle.verification_status.replace('_', ' ').toLowerCase()} variant={docVariant(vehicle.verification_status)} /></div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-content-primary mb-3">Documents</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DocCard label="RC" doc={vehicle.rc} />
          <DocCard label="Insurance" doc={vehicle.insurance} />
          <DocCard label="PUC" doc={vehicle.puc} />
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
