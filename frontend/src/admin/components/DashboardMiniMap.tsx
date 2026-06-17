import React from 'react';
import { MapContainer, TileLayer, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { LiveDriver } from '../hooks/useDashboardData';

// Default map center (Kolkata) — matches the Control Room map.
const DEFAULT_CENTER: [number, number] = [22.5726, 88.3639];

// Map a driver status to its pin fill, mirroring the live-map legend
// (green=online, blue=on-trip, yellow=idle, gray=offline).
function statusColor(status: string): string {
  const s = status.toUpperCase();
  if (s.includes('TRIP') || s.includes('EN_ROUTE') || s.includes('BUSY')) return 'var(--accent-400)';
  if (s.includes('AVAILABLE') || s === 'ONLINE' || s === 'ACTIVE') return 'var(--positive-400)';
  if (s.includes('IDLE')) return 'var(--warning-400)';
  return 'var(--content-tertiary)';
}

/**
 * Lazy-loaded mini-map for the dashboard. Renders driver dots from the live
 * driver pool; only drivers with coordinates are plotted. Default export so it
 * can be dynamically imported via React.lazy.
 */
const DashboardMiniMap: React.FC<{ drivers: LiveDriver[] }> = ({ drivers }) => {
  const located = drivers.filter((d) => d.lat != null && d.lng != null);

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={11}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      attributionControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
    >
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {located.map((d) => (
        <CircleMarker
          key={d.driverId}
          center={[d.lat as number, d.lng as number]}
          radius={5}
          pathOptions={{
            color: statusColor(d.status),
            fillColor: statusColor(d.status),
            fillOpacity: 0.9,
            weight: 1,
          }}
        />
      ))}
    </MapContainer>
  );
};

export default DashboardMiniMap;
