import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polygon, Circle, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { API_GATEWAY_BASE_URL } from '../../config';

type LatLng = [number, number];

interface SurgeZone {
  id: string;
  name: string;
  city_prefix: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  polygon?: LatLng[];
  multiplier: number;
  reason: string;
  created_by: string;
  expires_at: string;
}

interface HistoryBucket { hour: string; avg_surge: number; samples: number; }

const CITY_CENTERS: Record<string, LatLng> = {
  KOL: [22.5726, 88.3639],
  BLR: [12.9716, 77.5946],
};

// Each map click adds a vertex to the polygon being drawn.
function PolygonDrawer({ onAddVertex }: { onAddVertex: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onAddVertex([e.latlng.lat, e.latlng.lng]) });
  return null;
}

const authHeaders = (): HeadersInit => ({
  'X-Admin-Role': localStorage.getItem('admin_role') || 'ADMIN',
  'X-Admin-Email': localStorage.getItem('admin_email') || 'admin@platform.com',
});

const centroid = (pts: LatLng[]): LatLng => {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
};

export const ManualSurge: React.FC = () => {
  const [city, setCity] = useState<string>('KOL');
  const [zones, setZones] = useState<SurgeZone[]>([]);
  const [history, setHistory] = useState<HistoryBucket[]>([]);
  const [draftPolygon, setDraftPolygon] = useState<LatLng[]>([]);
  const [form, setForm] = useState({ name: '', multiplier: '1.5', duration_minutes: 30, reason: '' });
  const [saving, setSaving] = useState(false);

  const loadZones = useCallback(async () => {
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/surge/manual?city=${city}`, { headers: authHeaders() });
      if (res.ok) setZones((await res.json()).zones || []);
    } catch (e) { console.error(e); }
  }, [city]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/surge/history?city=${city}`, { headers: authHeaders() });
      if (res.ok) setHistory((await res.json()).history || []);
    } catch (e) { console.error(e); }
  }, [city]);

  useEffect(() => { loadZones(); loadHistory(); }, [loadZones, loadHistory]);

  const handleCreate = async () => {
    if (draftPolygon.length < 3) { alert('Click the map to draw a zone with at least 3 points.'); return; }
    const mult = parseFloat(form.multiplier);
    if (isNaN(mult) || mult < 1.1 || mult > 5.0) { alert('Multiplier must be between 1.1× and 5.0×.'); return; }
    if (!form.name.trim()) { alert('Zone name is required.'); return; }
    // Execution rule 1: pricing changes require explicit confirmation.
    if (!window.confirm('This will affect all new bookings in the zone immediately. Are you sure?')) return;
    setSaving(true);
    const [clat, clng] = centroid(draftPolygon);
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/surge/manual`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, city_prefix: city, center_lat: clat, center_lng: clng,
          radius_m: 0, polygon: draftPolygon, multiplier: mult,
          duration_minutes: Number(form.duration_minutes), reason: form.reason,
        }),
      });
      if (res.ok) {
        setDraftPolygon([]);
        setForm({ name: '', multiplier: '1.5', duration_minutes: 30, reason: '' });
        loadZones();
      } else { alert(`Failed: ${await res.text()}`); }
    } catch (e) { alert('Network failure.'); } finally { setSaving(false); }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Deactivate this surge zone now?')) return;
    try {
      const res = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/surge/manual/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (res.ok) loadZones();
    } catch (e) { console.error(e); }
  };

  const maxSurge = Math.max(1.5, ...history.map((h) => h.avg_surge));

  return (
    <div className="w-full h-full overflow-y-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Manual Surge Zones</h1>
          <p className="text-xs text-mute mt-1">Click the map to draw a polygon zone (≥3 points), set the multiplier + duration, and activate.</p>
        </div>
        <select value={city} onChange={(e) => setCity(e.target.value)} className="h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink">
          <option value="KOL">KOL</option>
          <option value="BLR">BLR</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map */}
        <div className="lg:col-span-2 bg-canvas rounded-xl border border-canvas-soft overflow-hidden" style={{ height: 460 }}>
          <MapContainer center={CITY_CENTERS[city]} zoom={12} style={{ height: '100%', width: '100%' }}>
            <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <PolygonDrawer onAddVertex={(p) => setDraftPolygon((prev) => [...prev, p])} />
            {draftPolygon.length >= 2 && (
              <Polygon positions={draftPolygon} pathOptions={{ color: 'var(--accent-400)', fillColor: 'var(--accent-400)', fillOpacity: 0.25 }} />
            )}
            {zones.map((z) =>
              z.polygon && z.polygon.length >= 3 ? (
                <Polygon key={z.id} positions={z.polygon} pathOptions={{ color: 'var(--negative-400)', fillColor: 'var(--negative-400)', fillOpacity: 0.2 }} />
              ) : (
                <Circle key={z.id} center={[z.center_lat, z.center_lng]} radius={z.radius_m || 1000} pathOptions={{ color: 'var(--negative-400)', fillColor: 'var(--negative-400)', fillOpacity: 0.2 }} />
              )
            )}
          </MapContainer>
        </div>

        {/* Form */}
        <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-xs font-bold text-ink uppercase tracking-wider">New Zone</h2>
            <span className="text-[10px] font-mono text-mute">{draftPolygon.length} pts</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setDraftPolygon((p) => p.slice(0, -1))} disabled={!draftPolygon.length}
              className="flex-1 text-[10px] font-semibold bg-canvas-soft rounded-pill h-7 disabled:opacity-40">Undo point</button>
            <button onClick={() => setDraftPolygon([])} disabled={!draftPolygon.length}
              className="flex-1 text-[10px] font-semibold bg-canvas-soft rounded-pill h-7 disabled:opacity-40">Clear</button>
          </div>
          <input placeholder="Zone name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink" />
          <div>
            <label className="block text-[10px] uppercase text-mute font-semibold mb-1">Multiplier (1.1× – 5.0×)</label>
            <input type="number" min="1.1" max="5" step="0.1" value={form.multiplier} onChange={(e) => setForm({ ...form, multiplier: e.target.value })}
              className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink font-mono" />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-mute font-semibold mb-1">Duration</label>
            <select value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
              className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink">
              <option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 hour</option><option value={180}>3 hours</option>
            </select>
          </div>
          <input placeholder="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className="w-full h-9 rounded-pill bg-canvas-soft border border-canvas-soft px-3 text-xs text-ink" />
          <button onClick={handleCreate} disabled={saving || draftPolygon.length < 3}
            className="w-full bg-ink text-on-dark text-xs font-semibold rounded-pill h-9 hover:bg-black-elevated transition-colors disabled:opacity-40">
            {saving ? 'Activating…' : 'Activate Surge Zone'}
          </button>
        </div>
      </div>

      {/* Active zones table */}
      <div className="bg-canvas rounded-xl border border-canvas-soft overflow-hidden">
        <div className="p-4 border-b border-canvas-soft bg-canvas-softer"><span className="text-xs font-bold text-ink">Active Manual Zones</span></div>
        {zones.length === 0 ? (
          <div className="p-8 text-center text-xs text-mute">No active manual surge zones.</div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-canvas-soft text-[10px] uppercase text-mute">
              <th className="p-3">Zone</th><th className="p-3">Shape</th><th className="p-3">Multiplier</th><th className="p-3">Expires</th><th className="p-3">By</th><th className="p-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-canvas-soft">
              {zones.map((z) => (
                <tr key={z.id}>
                  <td className="p-3 font-semibold text-ink">{z.name}</td>
                  <td className="p-3 text-mute">{z.polygon && z.polygon.length >= 3 ? `polygon (${z.polygon.length}pt)` : 'circle'}</td>
                  <td className="p-3 font-mono text-ink">{z.multiplier.toFixed(1)}×</td>
                  <td className="p-3 font-mono text-body">{new Date(z.expires_at).toLocaleTimeString()}</td>
                  <td className="p-3 text-mute">{z.created_by}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => handleDeactivate(z.id)} className="text-status-alert text-[11px] font-semibold hover:underline">Deactivate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Surge history sparkline */}
      <div className="bg-canvas rounded-xl border border-canvas-soft p-5 space-y-3">
        <h2 className="text-xs font-bold text-ink uppercase tracking-wider">Surge History — last 24h ({city})</h2>
        {history.length === 0 ? (
          <p className="text-xs text-mute">No trip surge data in the last 24 hours.</p>
        ) : (
          <div className="flex items-end gap-0.5 h-24">
            {history.map((h) => (
              <div key={h.hour} title={`${h.hour}: ${h.avg_surge.toFixed(2)}× (${h.samples})`}
                className="flex-1 bg-uber-blue/70 rounded-t" style={{ height: `${(h.avg_surge / maxSurge) * 100}%`, minHeight: 2 }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
