import React, { useState, useEffect, useRef } from 'react';
import { API_GATEWAY_BASE_URL, ANALYTICS_SSE_BASE_URL } from '../config';
import { DriverVerificationQueue } from './DriverVerificationQueue';
import { FleetDrillDownDrawer } from './FleetDrillDownDrawer';
import { VehicleProfilesMatrix } from './VehicleProfilesMatrix';
import { AdminAuthGateway } from './components/AdminAuthGateway';
import { ActiveTripRadar } from './ActiveTripRadar';
import { SurgeControlValve } from './components/SurgeControlValve';
import { IncidentRecoveryTerminal } from './components/IncidentRecoveryTerminal';
import { LedgerReconciliation } from './components/LedgerReconciliation';

interface LedgerEntry {
  id: number;
  order_id: string;
  city_prefix: string;
  account_type: string;
  entry_type: string;
  amount_paise: number;
  description: string;
  created_at: string;
}

function generateH3HexagonVertices(centerLat: number, centerLng: number, radiusMeters: number = 750) {
  const coordinates: google.maps.LatLngLiteral[] = [];
  const earthRadius = 6378137;

  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);

    const deltaLat = (dy / earthRadius) * (180 / Math.PI);
    const deltaLng = (dx / (earthRadius * Math.cos((centerLat * Math.PI) / 180))) * (180 / Math.PI);

    coordinates.push({
      lat: centerLat + deltaLat,
      lng: centerLng + deltaLng,
    });
  }
  return coordinates;
}

function getH3CellCenterGeometry(cellIndex: string): { lat: number; lng: number } {
  let hash = 0;
  for (let i = 0; i < cellIndex.length; i++) {
    hash = cellIndex.charCodeAt(i) + ((hash << 5) - hash);
  }
  const latOffset = ((hash % 100) / 2500) - 0.02;
  const lngOffset = (((hash >> 4) % 100) / 2500) - 0.02;

  return {
    lat: 22.5726 + latOffset,
    lng: 88.3639 + lngOffset,
  };
}

export const ControlRoomDashboard: React.FC = () => {
  const [spatialHeatmap, setSpatialHeatmap] = useState<Record<string, number>>({});
  const [selectedCellToken, setSelectedCellToken] = useState<string | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [isBalanced, setIsBalanced] = useState<boolean>(true);

  const [adminToken, setAdminToken] = useState<string>(localStorage.getItem('admin_jwt_token') ?? '');
  const [adminRole, setAdminRole] = useState<string>(localStorage.getItem('admin_role') ?? 'ADMIN');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const activePolygonsRef = useRef<google.maps.Polygon[]>([]);
  const [isMapSdkLoaded, setIsMapSdkLoaded] = useState<boolean>(false);

  const [bottomTab, setBottomTab] = useState<'orders' | 'drivers' | 'vehicles' | 'incidents' | 'ledger'>('orders');

  useEffect(() => {
    if (window.google?.maps) {
      setIsMapSdkLoaded(true);
      return;
    }

    const mapApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || 'YOUR_GOOGLE_MAPS_API_KEY';
    const scriptUrl = `https://maps.googleapis.com/maps/api/js?key=${mapApiKey}&libraries=geometry`;

    const existingScript = document.querySelector(`script[src^="https://maps.googleapis.com/maps/api/js"]`);
    if (existingScript) {
      setIsMapSdkLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.defer = true;
    script.onload = () => setIsMapSdkLoaded(true);
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!adminToken) return;

    let eventSource: EventSource | null = null;
    if (adminRole === 'SUPER_ADMIN' || adminRole === 'FLEET_MANAGER') {
      eventSource = new EventSource(`${ANALYTICS_SSE_BASE_URL}/api/v1/analytics/heatmap`);

      eventSource.onmessage = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data as string);
          if (payload.cell_data) {
            setSpatialHeatmap(payload.cell_data);
          }
        } catch (err) {
          console.error('Failed processing heatmap stream packet:', err);
        }
      };
    }

    if (adminRole === 'SUPER_ADMIN' || adminRole === 'FINANCIAL_AUDITOR') {
      fetchLedgerLogs();
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [adminToken, adminRole]);

  useEffect(() => {
    if (adminRole === 'FINANCIAL_AUDITOR') return;
    if (!isMapSdkLoaded || !mapContainerRef.current || mapInstanceRef.current || !adminToken) return;
    if (typeof google === 'undefined' || !google?.maps) return;

    // Minimalist light map — black/white/grayscale only, no accent leakage
    const minimalMapStyles: google.maps.MapTypeStyle[] = [
      { featureType: 'all', elementType: 'labels.text.fill', stylers: [{ color: '#7c7c7c' }] },
      { featureType: 'all', elementType: 'labels.text.stroke', stylers: [{ visibility: 'off' }] },
      { featureType: 'landscape', elementType: 'all', stylers: [{ color: '#f5f5f5' }] },
      { featureType: 'road', elementType: 'all', stylers: [{ color: '#ffffff' }] },
      { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
      { featureType: 'water', elementType: 'all', stylers: [{ color: '#e9e9e9' }] },
    ];

    mapInstanceRef.current = new google.maps.Map(mapContainerRef.current, {
      center: { lat: 22.5726, lng: 88.3639 },
      zoom: 13,
      styles: minimalMapStyles,
      disableDefaultUI: true,
      zoomControl: true,
    });
  }, [isMapSdkLoaded, adminToken]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (typeof google === 'undefined' || !google?.maps) return;

    activePolygonsRef.current.forEach((poly) => poly.setMap(null));
    activePolygonsRef.current = [];

    Object.entries(spatialHeatmap).forEach(([cellIndex, driverCount]) => {
      const center = getH3CellCenterGeometry(cellIndex);
      const hexPaths = generateH3HexagonVertices(center.lat, center.lng);

      const maxSupplyWeightBoundary = 15;
      const adaptiveOpacity = Math.min(0.85, 0.15 + driverCount / maxSupplyWeightBoundary);

      const hexPolygon = new google.maps.Polygon({
        paths: hexPaths,
        strokeColor: '#000000',
        strokeOpacity: 0.4,
        strokeWeight: 1.5,
        fillColor: '#000000',
        fillOpacity: adaptiveOpacity,
        map: mapInstanceRef.current,
      });

      hexPolygon.addListener('click', () => {
        setSelectedCellToken(cellIndex);
      });

      activePolygonsRef.current.push(hexPolygon);
    });
  }, [spatialHeatmap]);

  const fetchLedgerLogs = async (): Promise<void> => {
    const token = localStorage.getItem('admin_jwt_token');
    if (!token) {
      handleLogout();
      return;
    }

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/ledger`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401 || response.status === 403) {
        handleLogout();
        return;
      }

      const data = await response.json();
      setLedgerEntries(data.entries || []);
      setIsBalanced(Boolean(data.is_auditable_balanced));
    } catch (err) {
      console.error('Failed fetching ledger data logs:', err);
    }
  };

  const handleLoginSuccess = (token: string) => {
    setAdminToken(token);
    setAdminRole(localStorage.getItem('admin_role') ?? 'ADMIN');
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_jwt_token');
    localStorage.removeItem('admin_role');
    if (mapInstanceRef.current) {
      mapInstanceRef.current = null;
    }
    setAdminToken('');
    setAdminRole('');
  };

  if (!adminToken) {
    return <AdminAuthGateway onAuthSuccess={handleLoginSuccess} />;
  }

  const canFleet = adminRole === 'SUPER_ADMIN' || adminRole === 'FLEET_MANAGER';
  const canIncident = adminRole === 'SUPER_ADMIN' || adminRole === 'SUPPORT_LEAD';
  const canAudit = adminRole === 'SUPER_ADMIN' || adminRole === 'FINANCIAL_AUDITOR';

  const tabs: { key: typeof bottomTab; label: string; allowed: boolean }[] = [
    { key: 'orders', label: 'Active orders', allowed: canFleet },
    { key: 'drivers', label: 'Driver queue', allowed: canFleet },
    { key: 'vehicles', label: 'Vehicles', allowed: canFleet },
    { key: 'incidents', label: 'Incidents', allowed: canIncident },
    { key: 'ledger', label: 'Ledger', allowed: canAudit },
  ];
  const visibleTabs = tabs.filter((t) => t.allowed);
  const activeTab = visibleTabs.some((t) => t.key === bottomTab) ? bottomTab : visibleTabs[0]?.key;

  return (
    <div className="h-screen bg-canvas text-ink flex flex-col font-sans selection:bg-black selection:text-white overflow-hidden">

      {/* HEADER */}
      <header className="h-[72px] bg-canvas border-b border-canvas-soft px-8 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tight text-ink">drivers-for-u</h1>
          <span className="text-xs font-medium text-body bg-canvas-soft px-3 py-1 rounded-pill">KOL</span>
        </div>

        <div className="flex items-center gap-2 text-sm font-medium text-body">
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-status-online" />
            {canAudit && !canFleet ? 'Ledger access' : '47 of 60 drivers online'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {canAudit && (
            <span className={`px-4 py-2 rounded-pill text-xs font-medium ${
              isBalanced ? 'bg-canvas-soft text-ink' : 'bg-ink text-on-dark'
            }`}>
              {isBalanced ? 'Ledger balanced' : 'Ledger imbalance'}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="text-sm font-medium py-2 px-5 rounded-pill bg-ink hover:bg-black-elevated text-on-dark transition active:scale-[0.98]"
          >
            Lock terminal
          </button>
        </div>
      </header>

      {/* MAIN */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT SIDEBAR */}
        <aside className="w-[300px] bg-canvas-softer border-r border-canvas-soft overflow-y-auto flex-shrink-0">
          <div className="p-6 space-y-4">
            {canFleet && (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <div className="bg-canvas rounded-xl border border-canvas-soft p-5">
                    <div className="text-xs font-medium text-body mb-1">Fleet online</div>
                    <div className="text-2xl font-bold text-ink">47 / 60</div>
                    <div className="text-xs text-mute mt-1 font-mono">78% utilization</div>
                  </div>
                  <div className="bg-canvas rounded-xl border border-canvas-soft p-5">
                    <div className="text-xs font-medium text-body mb-1">Orders today</div>
                    <div className="text-2xl font-bold text-ink">312</div>
                    <div className="text-xs text-mute mt-1 font-mono">+12 this hour</div>
                  </div>
                  <div className="bg-canvas rounded-xl border border-canvas-soft p-5">
                    <div className="text-xs font-medium text-body mb-1">Revenue today</div>
                    <div className="text-2xl font-bold text-ink">$4,240</div>
                    <div className="text-xs text-mute mt-1 font-mono">+$340 vs 2pm</div>
                  </div>
                </div>

                <SurgeControlValve
                  selectedCellToken={selectedCellToken}
                  cityPrefix="KOL"
                  onOverrideExecuted={() => setSelectedCellToken(null)}
                />
              </>
            )}

            {!canFleet && (
              <div className="bg-canvas rounded-xl border border-canvas-soft p-5 text-sm text-body">
                Fleet controls unavailable for this role.
              </div>
            )}
          </div>
        </aside>

        {/* MAP */}
        <main className="flex-1 relative bg-canvas-soft overflow-hidden">
          {canFleet ? (
            <div ref={mapContainerRef} className="w-full h-full">
              {!isMapSdkLoaded && (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-mute">
                  Loading spatial map...
                </div>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-mute">
              Map view restricted to fleet operations roles.
            </div>
          )}
        </main>

        {/* RIGHT DRAWER */}
        {canFleet && (
          <aside className="w-[340px] bg-canvas border-l border-canvas-soft overflow-y-auto flex-shrink-0">
            {selectedCellToken ? (
              <FleetDrillDownDrawer
                cellToken={selectedCellToken}
                onClose={() => setSelectedCellToken(null)}
              />
            ) : (
              <div className="p-8 text-center text-sm text-mute">
                Select a hex cell on the map to inspect local fleet density.
              </div>
            )}
          </aside>
        )}
      </div>

      {/* BOTTOM PANEL */}
      <section className="h-[280px] bg-canvas border-t border-canvas-soft flex flex-col flex-shrink-0">
        <div className="flex border-b border-canvas-soft px-2">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setBottomTab(tab.key)}
              className={`px-5 py-4 text-sm font-medium transition ${
                activeTab === tab.key
                  ? 'text-ink border-b-2 border-ink'
                  : 'text-body hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'orders' && canFleet && <ActiveTripRadar />}
          {activeTab === 'drivers' && canFleet && (
            <div className="p-4"><DriverVerificationQueue /></div>
          )}
          {activeTab === 'vehicles' && canFleet && (
            <div className="p-4"><VehicleProfilesMatrix /></div>
          )}
          {activeTab === 'incidents' && canIncident && (
            <div className="p-4"><IncidentRecoveryTerminal /></div>
          )}
          {activeTab === 'ledger' && canAudit && (
            <div className="p-4 space-y-4 overflow-x-auto">
              <LedgerReconciliation />
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-mute uppercase text-[10px] font-medium border-b border-canvas-soft tracking-wider">
                    <th className="p-3">Order ID</th>
                    <th className="p-3">Region</th>
                    <th className="p-3">Account</th>
                    <th className="p-3">Type</th>
                    <th className="p-3 text-right">Amount</th>
                    <th className="p-3">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-canvas-soft">
                  {ledgerEntries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-body">
                        No completed transactions on record.
                      </td>
                    </tr>
                  ) : (
                    ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-canvas-softer transition">
                        <td className="p-3 font-mono text-xs text-body">{entry.order_id.slice(0, 16)}...</td>
                        <td className="p-3">
                          <span className="bg-canvas-soft px-2 py-0.5 rounded-pill text-xs font-medium">{entry.city_prefix}</span>
                        </td>
                        <td className="p-3 text-body">{entry.account_type}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-pill text-[10px] font-medium ${
                            entry.entry_type === 'DEBIT' ? 'bg-ink text-on-dark' : 'bg-canvas-soft text-ink'
                          }`}>
                            {entry.entry_type}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono font-medium">₹{(entry.amount_paise / 100).toFixed(2)}</td>
                        <td className="p-3 text-body text-xs">{entry.description}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
