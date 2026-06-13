import React, { useState, useEffect, useRef } from 'react';
import { API_GATEWAY_BASE_URL, ANALYTICS_SSE_BASE_URL } from '../config';
import { DriverVerificationQueue } from './DriverVerificationQueue';
import { FleetDrillDownDrawer } from './FleetDrillDownDrawer';
import { VehicleProfilesMatrix } from './VehicleProfilesMatrix';

import { ActiveTripRadar } from './ActiveTripRadar';
import { SurgeControlValve } from './components/SurgeControlValve';
import { IncidentRecoveryTerminal } from './components/IncidentRecoveryTerminal';
import { LedgerReconciliation } from './components/LedgerReconciliation';
import { MarketplaceOrchestrator } from './components/MarketplaceOrchestrator';
import { VirtualizedLedgerTable } from './components/VirtualizedLedgerTable';


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
  const [_isBalanced, setIsBalanced] = useState<boolean>(true);
  const [activeSOSAlerts, setActiveSOSAlerts] = useState<any[]>([]);

  const lastCenteredSosIdRef = useRef<string | null>(null);
  const sosMarkersRef = useRef<google.maps.Marker[]>([]);
  const sosCirclesRef = useRef<google.maps.Circle[]>([]);

  const adminRole = localStorage.getItem('admin_role') ?? 'ADMIN';
  // Post-cookie-migration the JWT is no longer in localStorage; effects gate on the session
  // (admin_role, set by /session) instead of a token. Requests authenticate via the cookie.
  const isAuthed = !!localStorage.getItem('admin_role');

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const activePolygonsRef = useRef<google.maps.Polygon[]>([]);
  // Buffers the latest heatmap frame between throttled flushes — see SSE effect.
  const pendingHeatmapRef = useRef<Record<string, number> | null>(null);
  const [isMapSdkLoaded, setIsMapSdkLoaded] = useState<boolean>(false);
  const [fleetKpis, setFleetKpis] = useState<{ online: number; total: number; trips: number; revenue: number } | null>(null);
  // Live-heatmap connection health. When the SSE drops, the map keeps its last frame —
  // surface that explicitly so an operator never mistakes stale supply density for live.
  const [heatmapLive, setHeatmapLive] = useState<boolean>(true);

  const [bottomTab, setBottomTab] = useState<'orders' | 'drivers' | 'vehicles' | 'incidents' | 'ledger' | 'orchestrator'>('orders');

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
    if (!isAuthed) return;

    let eventSource: EventSource | null = null;
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    if (adminRole === 'SUPER_ADMIN' || adminRole === 'FLEET_MANAGER') {
      eventSource = new EventSource(`${ANALYTICS_SSE_BASE_URL}/api/v1/analytics/heatmap`);

      eventSource.onopen = () => setHeatmapLive(true);

      // Stream packets only update a ref; the map repaints on a fixed cadence so
      // a high-frequency feed cannot thrash polygon re-rendering or the DOM.
      eventSource.onmessage = (event: MessageEvent) => {
        setHeatmapLive(true);
        try {
          const payload = JSON.parse(event.data as string);
          if (payload.cell_data) {
            pendingHeatmapRef.current = payload.cell_data;
          }
        } catch (err) {
          console.error('Failed processing heatmap stream packet:', err);
        }
      };

      // EventSource auto-reconnects, but until it does the rendered density is stale.
      eventSource.onerror = () => setHeatmapLive(false);

      flushTimer = setInterval(() => {
        if (pendingHeatmapRef.current) {
          setSpatialHeatmap(pendingHeatmapRef.current);
          pendingHeatmapRef.current = null;
        }
      }, 2500);
    }

    if (adminRole === 'SUPER_ADMIN' || adminRole === 'FINANCIAL_AUDITOR') {
      fetchLedgerLogs();
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (flushTimer) {
        clearInterval(flushTimer);
      }
    };
  }, [adminRole]);

  useEffect(() => {
    if (adminRole === 'FINANCIAL_AUDITOR') return;
    if (!isMapSdkLoaded || !mapContainerRef.current || mapInstanceRef.current || !isAuthed) return;
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
  }, [isMapSdkLoaded]);

  // Poll active SOS alerts every 5 seconds
  useEffect(() => {
    if (!isAuthed) return;

    const fetchActiveSOS = async () => {
      try {
        const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/safety/sos?status=ACTIVE`);
        if (response.ok) {
          const data = await response.json();
          setActiveSOSAlerts(data || []);
        }
      } catch (err) {
        console.error('Failed fetching active SOS alerts:', err);
      }
    };

    fetchActiveSOS();
    const interval = setInterval(fetchActiveSOS, 5000);
    return () => clearInterval(interval);
  }, []);

  // Live fleet KPIs for the sidebar (previously hardcoded literals).
  useEffect(() => {
    if (!isAuthed) return;
    let active = true;
    const loadKpis = () => {
      fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/dashboard/kpis?range=today`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && active) {
            setFleetKpis({
              online: d.online_drivers ?? 0,
              total: d.total_drivers ?? 0,
              trips: d.total_trips ?? 0,
              revenue: d.gross_revenue ?? 0,
            });
          }
        })
        .catch(() => {});
    };
    loadKpis();
    const interval = setInterval(loadKpis, 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAuthed]);

  // Manage map markers & pulsing circles for active SOS alerts
  useEffect(() => {
    // Clean up existing markers and circles
    sosMarkersRef.current.forEach((m) => m.setMap(null));
    sosMarkersRef.current = [];
    sosCirclesRef.current.forEach((c) => c.setMap(null));
    sosCirclesRef.current = [];

    if (!mapInstanceRef.current || typeof google === 'undefined' || !google?.maps) return;

    if (activeSOSAlerts.length === 0) {
      lastCenteredSosIdRef.current = null;
      return;
    }

    // Center and zoom on first active SOS, only if it is a new/different alert
    const firstSos = activeSOSAlerts[0];
    if (firstSos && firstSos.latitude != null && firstSos.longitude != null) {
      if (lastCenteredSosIdRef.current !== firstSos.id) {
        mapInstanceRef.current.setCenter({ lat: firstSos.latitude, lng: firstSos.longitude });
        mapInstanceRef.current.setZoom(15);
        lastCenteredSosIdRef.current = firstSos.id;
      }
    } else {
      lastCenteredSosIdRef.current = null;
    }

    const markers: google.maps.Marker[] = [];
    const circles: google.maps.Circle[] = [];

    activeSOSAlerts.forEach((sos) => {
      if (sos.latitude == null || sos.longitude == null) return;
      const pos = { lat: sos.latitude, lng: sos.longitude };

      const marker = new google.maps.Marker({
        position: pos,
        map: mapInstanceRef.current!,
        title: `SOS Alert ${sos.id}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#FF0000',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          scale: 10,
        },
      });
      markers.push(marker);

      const circle = new google.maps.Circle({
        center: pos,
        map: mapInstanceRef.current!,
        strokeColor: '#FF0000',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#FF0000',
        fillOpacity: 0.35,
        radius: 100,
      });
      circles.push(circle);
    });

    sosMarkersRef.current = markers;
    sosCirclesRef.current = circles;

    let radiusDirection = 1;
    const pulseInterval = setInterval(() => {
      circles.forEach((circle) => {
        const currentRadius = circle.getRadius();
        let newRadius = currentRadius + radiusDirection * 15;
        if (newRadius > 400) {
          radiusDirection = -1;
          newRadius = 400;
        } else if (newRadius < 100) {
          radiusDirection = 1;
          newRadius = 100;
        }
        circle.setRadius(newRadius);
      });
    }, 100);

    return () => {
      clearInterval(pulseInterval);
      markers.forEach((m) => m.setMap(null));
      circles.forEach((c) => c.setMap(null));
    };
  }, [activeSOSAlerts, isMapSdkLoaded]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (typeof google === 'undefined' || !google?.maps) return;

    activePolygonsRef.current.forEach((poly) => poly.setMap(null));
    activePolygonsRef.current = [];

    // Override heatmap layer if active SOS alerts are present
    if (activeSOSAlerts.length > 0) return;

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
  }, [spatialHeatmap, activeSOSAlerts.length]);

  const fetchLedgerLogs = async (): Promise<void> => {
    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/ledger`);

      if (response.status === 401 || response.status === 403) return;

      const data = await response.json();
      setLedgerEntries(data.entries || []);
      setIsBalanced(Boolean(data.is_auditable_balanced));
    } catch (err) {
      console.error('Failed fetching ledger data logs:', err);
    }
  };

  const isSuperAdmin = adminRole === 'SUPER_ADMIN';
  const canFleet = isSuperAdmin || 
                   adminRole === 'OPERATIONS_MANAGER' || 
                   adminRole === 'FLEET_MANAGER' || 
                   adminRole === 'CITY_MANAGER';
  const canIncident = isSuperAdmin || 
                      adminRole === 'OPERATIONS_MANAGER' || 
                      adminRole === 'COMPLIANCE' || 
                      adminRole === 'CUSTOMER_SUPPORT' ||
                      adminRole === 'SUPPORT_LEAD';
  const canAudit = isSuperAdmin || 
                   adminRole === 'FINANCE' || 
                   adminRole === 'AUDITOR' ||
                   adminRole === 'FINANCIAL_AUDITOR';


  const tabs: { key: typeof bottomTab; label: string; allowed: boolean }[] = [
    { key: 'orders', label: 'Active orders', allowed: canFleet },
    { key: 'drivers', label: 'Driver queue', allowed: canFleet },
    { key: 'vehicles', label: 'Vehicles', allowed: canFleet },
    { key: 'incidents', label: 'Incidents', allowed: canIncident },
    { key: 'orchestrator', label: 'Marketplace controls', allowed: canFleet },
    { key: 'ledger', label: 'Ledger', allowed: canAudit },

  ];
  const visibleTabs = tabs.filter((t) => t.allowed);
  const activeTab = visibleTabs.some((t) => t.key === bottomTab) ? bottomTab : visibleTabs[0]?.key;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* MAIN */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT SIDEBAR */}
        <aside className="w-[300px] bg-background-secondary border-r border-border-opaque overflow-y-auto flex-shrink-0">
          <div className="p-6 space-y-4">
            {canFleet && (
              <>
                <div className="grid grid-cols-1 gap-3">
                  <div className="card">
                    <div className="text-label-small text-content-secondary uppercase tracking-wider mb-1">Fleet online</div>
                    <div className="text-heading-xl font-mono text-content-primary">{fleetKpis ? `${fleetKpis.online} / ${fleetKpis.total}` : '—'}</div>
                    <div className="font-mono text-mono-small text-content-tertiary mt-1">
                      {fleetKpis && fleetKpis.total > 0 ? `${Math.round((fleetKpis.online / fleetKpis.total) * 100)}% utilization` : '—'}
                    </div>
                  </div>
                  <div className="card">
                    <div className="text-label-small text-content-secondary uppercase tracking-wider mb-1">Orders today</div>
                    <div className="text-heading-xl font-mono text-content-primary">{fleetKpis ? fleetKpis.trips.toLocaleString('en-IN') : '—'}</div>
                    <div className="font-mono text-mono-small text-content-tertiary mt-1">Today</div>
                  </div>
                  <div className="card">
                    <div className="text-label-small text-content-secondary uppercase tracking-wider mb-1">Revenue today</div>
                    <div className="text-heading-xl font-mono text-content-primary">{fleetKpis ? `₹${fleetKpis.revenue.toLocaleString('en-IN')}` : '—'}</div>
                    <div className="font-mono text-mono-small text-content-tertiary mt-1">Today</div>
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
              <div className="card">
                <p className="text-paragraph-medium text-content-secondary">Fleet controls unavailable for this role.</p>
              </div>
            )}
          </div>
        </aside>

        {/* MAP */}
        <main className="flex-1 relative bg-background-secondary overflow-hidden">
          {canFleet && !heatmapLive && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-surface-warning border border-warning-400 px-3 py-1.5 rounded-sm text-label-small text-content-warning uppercase tracking-wider shadow-elevation-2 flex items-center gap-1.5">
              <span className="animate-pulse">●</span>
              Live heatmap disconnected — supply density may be stale
            </div>
          )}
          {canFleet ? (
            <div ref={mapContainerRef} className="w-full h-full">
              {!isMapSdkLoaded && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-paragraph-small text-content-tertiary">Loading spatial map…</p>
                </div>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-paragraph-small text-content-tertiary">Map view restricted to fleet operations roles.</p>
            </div>
          )}
        </main>

        {/* RIGHT DRAWER */}
        {canFleet && (
          <aside className="w-[340px] bg-background-primary border-l border-border-opaque overflow-y-auto flex-shrink-0">
            {selectedCellToken ? (
              <FleetDrillDownDrawer
                cellToken={selectedCellToken}
                onClose={() => setSelectedCellToken(null)}
              />
            ) : (
              <div className="p-8 text-center">
                <p className="text-paragraph-small text-content-tertiary">Select a hex cell on the map to inspect local fleet density.</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* BOTTOM PANEL */}
      <section className="h-[280px] bg-background-primary border-t border-border-opaque flex flex-col flex-shrink-0">
        <div className="flex border-b border-border-opaque px-2">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setBottomTab(tab.key)}
              className={`px-5 py-4 text-label-medium transition-base cursor-pointer ${
                activeTab === tab.key
                  ? 'text-content-primary border-b-2 border-interactive-primary'
                  : 'text-content-secondary hover:text-content-primary'
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
          {activeTab === 'orchestrator' && canFleet && (
            <div className="p-4"><MarketplaceOrchestrator /></div>
          )}
          {activeTab === 'ledger' && canAudit && (
            <div className="p-4 space-y-4">
              <LedgerReconciliation />
              <VirtualizedLedgerTable rows={ledgerEntries} height={220} />
            </div>
          )}

        </div>
      </section>
    </div>
  );
};
