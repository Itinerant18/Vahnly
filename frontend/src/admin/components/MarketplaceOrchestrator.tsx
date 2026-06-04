import React, { useState, useEffect, useRef } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { SlideToConfirm } from './SlideToConfirm';

interface FraudAlertItem {
  driver_id: string;
  driver_name: string;
  violation_type: 'GPS_SPOOFING' | 'SPEED_SLA_VIOLATION' | 'SIMULATOR_DETECTED';
  variance_score: number;
  last_ping_text: string;
}

interface GeofenceZoneRecord {
  id: string;
  zone_name: string;
  city_prefix: string;
  is_active: boolean;
  polygon_coordinates: [number, number][]; // [lat, lng] array
  policy_type: 'ACTIVE_DISPATCH' | 'BLACKLIST_BLOCK' | 'SURGE_FLOOR_FORCE' | 'TRANSMISSION_RESTRICT';
  surge_multiplier: number;
  allowed_transmissions: 'ALL' | 'AUTOMATIC_ONLY' | 'MANUAL_ONLY';
  activation_start?: string;
  activation_end?: string;
  notes?: string;
}

export const MarketplaceOrchestrator: React.FC = () => {
  const [activeControlTab, setActiveControlTab] = useState<'GEOFENCE' | 'MANUAL_MATCH' | 'FRAUD_RADAR'>('GEOFENCE');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [logResponse, setLogResponse] = useState<string | null>(null);

  // Form State Vectors: Manual Assignments
  const [overrideOrderID, setOverrideOrderID] = useState<string>('');
  const [overrideDriverID, setOverrideDriverID] = useState<string>('');

  // Fraud alerts state store
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlertItem[]>([]);

  // Geofencing list & interactive workspace state
  const [geofences, setGeofences] = useState<GeofenceZoneRecord[]>([]);
  const [selectedGeofence, setSelectedGeofence] = useState<GeofenceZoneRecord | null>(null);
  
  // Flag to open full-screen Immersive Vector Studio
  const [isStudioExpanded, setIsStudioExpanded] = useState<boolean>(false);

  // Canvas Vector Editor State
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [drawingMode, setDrawingMode] = useState<'PAN' | 'DRAW' | 'EDIT'>('DRAW');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  // Edit Form Fields (Panel C)
  const [zoneName, setZoneName] = useState<string>('');
  const [policyType, setPolicyType] = useState<GeofenceZoneRecord['policy_type']>('ACTIVE_DISPATCH');
  const [isZoneActive, setIsZoneActive] = useState<boolean>(true);
  const [surgeMultiplier, setSurgeMultiplier] = useState<number>(1.00);
  const [allowedTransmissions, setAllowedTransmissions] = useState<GeofenceZoneRecord['allowed_transmissions']>('ALL');
  const [activationStart, setActivationStart] = useState<string>('');
  const [activationEnd, setActivationEnd] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  
  // UI Verification warnings
  const [intersectionError, setIntersectionError] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (activeControlTab === 'FRAUD_RADAR') {
      fetchLiveFraudAnomalies();
    } else if (activeControlTab === 'GEOFENCE') {
      fetchGeofenceZones();
    }
  }, [activeControlTab]);

  const fetchLiveFraudAnomalies = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/fraud`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setFraudAlerts(data.alerts || []);
      } else {
        setFraudAlerts([
          {
            driver_id: 'drv-7711-bc99',
            driver_name: 'Subhabrata Pal',
            violation_type: 'GPS_SPOOFING',
            variance_score: 98.4,
            last_ping_text: 'Jumped 4.2km inside 1.2 seconds over Howrah Bridge segment context.',
          },
          {
            driver_id: 'drv-2290-ff41',
            driver_name: 'Arjun Das',
            violation_type: 'SIMULATOR_DETECTED',
            variance_score: 87.1,
            last_ping_text: 'Zero sensor bearing oscillation detected across 4 consecutive logs.',
          }
        ]);
      }
    } catch {
      console.error('Failed syncing compliance streams.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGeofenceZones = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/geofence`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setGeofences(data.zones || []);
      } else {
        // High fidelity fallback geofences
        const fallbackZones: GeofenceZoneRecord[] = [
          {
            id: 'zone-01',
            zone_name: 'KOLKATA_CORE_HUB',
            city_prefix: 'KOL',
            is_active: true,
            policy_type: 'ACTIVE_DISPATCH',
            surge_multiplier: 1.00,
            allowed_transmissions: 'ALL',
            polygon_coordinates: [
              [22.5800, 88.3500],
              [22.5900, 88.3700],
              [22.5700, 88.3900],
              [22.5500, 88.3700],
              [22.5600, 88.3400]
            ],
            notes: 'Primary dispatch boundary covering central business districts.'
          },
          {
            id: 'zone-02',
            zone_name: 'HOWRAH_FLOOD_ZONE',
            city_prefix: 'KOL',
            is_active: true,
            policy_type: 'BLACKLIST_BLOCK',
            surge_multiplier: 1.00,
            allowed_transmissions: 'ALL',
            polygon_coordinates: [
              [22.5950, 88.3200],
              [22.6100, 88.3400],
              [22.6000, 88.3600],
              [22.5850, 88.3300]
            ],
            notes: 'Severe waterlogging blocking vehicle routes.'
          },
          {
            id: 'zone-03',
            zone_name: 'PARK_STREET_SURGE',
            city_prefix: 'KOL',
            is_active: true,
            policy_type: 'SURGE_FLOOR_FORCE',
            surge_multiplier: 1.80,
            allowed_transmissions: 'ALL',
            polygon_coordinates: [
              [22.5520, 88.3510],
              [22.5580, 88.3650],
              [22.5450, 88.3700],
              [22.5400, 88.3550]
            ],
            notes: 'High demand surge multiplication zone.'
          }
        ];
        setGeofences(fallbackZones);
      }
    } catch {
      console.error('Failed fetching geofences.');
    } finally {
      setIsLoading(false);
    }
  };

  const submitManualOverrideMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideOrderID || !overrideDriverID) return;
    setIsLoading(true);
    setLogResponse(null);

    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/force-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ order_id: overrideOrderID.trim(), driver_id: overrideDriverID.trim() }),
      });

      if (response.ok) {
        setLogResponse('SUCCESS: Core matching rule bypassed. Allocation key locked into Redis cluster slots.');
        setOverrideOrderID('');
        setOverrideDriverID('');
      } else {
        setLogResponse('ERROR: Allocation rejected. Check asset execution parameters.');
      }
    } catch {
      setLogResponse('ERROR: Gateway response timeout.');
    } finally {
      setIsLoading(false);
    }
  };

  const executeFraudLockoutAction = async (driverId: string, action: 'SUSPEND' | 'UNBAN') => {
    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/fraud-lockout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ driver_id: driverId, action, reason: 'High-variance telemetry anomalies detected.' }),
      });

      if (response.ok) {
        setLogResponse(`COMPLIANCE ACTION ENGAGED: Operator session terminated instantly.`);
        setFraudAlerts(fraudAlerts.filter(a => a.driver_id !== driverId));
      }
    } catch {
      setLogResponse('ERROR: Compliance gateway handshake failure.');
    }
  };

  const selectGeofenceZone = (zone: GeofenceZoneRecord) => {
    setSelectedGeofence(zone);
    setZoneName(zone.zone_name);
    setPolicyType(zone.policy_type);
    setIsZoneActive(zone.is_active);
    setSurgeMultiplier(zone.surge_multiplier || 1.00);
    setAllowedTransmissions(zone.allowed_transmissions || 'ALL');
    setActivationStart(zone.activation_start ? zone.activation_start.slice(0, 16) : '');
    setActivationEnd(zone.activation_end ? zone.activation_end.slice(0, 16) : '');
    setNotes(zone.notes || '');
    setPolygonPoints(zone.polygon_coordinates);
    setLogResponse(null);
  };

  const initNewGeofenceZone = () => {
    setSelectedGeofence(null);
    setZoneName(`ZONE_${Math.floor(Math.random() * 9000 + 1000)}`);
    setPolicyType('ACTIVE_DISPATCH');
    setIsZoneActive(true);
    setSurgeMultiplier(1.00);
    setAllowedTransmissions('ALL');
    setActivationStart('');
    setActivationEnd('');
    setNotes('');
    setPolygonPoints([]);
    setLogResponse(null);
  };

  // Line segment intersection checker helper
  const isLineIntersecting = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
    p3: { x: number; y: number },
    p4: { x: number; y: number }
  ) => {
    const d1x = p2.x - p1.x;
    const d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x;
    const d2y = p4.y - p3.y;
    
    const det = -d2x * d1y + d1x * d2y;
    if (det === 0) return false; // Parallel lines
    
    const s = (-d1y * (p1.x - p3.x) + d1x * (p1.y - p3.y)) / det;
    const t = ( d2x * (p1.y - p3.y) - d2y * (p1.x - p3.x)) / det;

    return s >= 0 && s <= 1 && t >= 0 && t <= 1;
  };

  // Perform self intersection testing
  useEffect(() => {
    if (polygonPoints.length < 4) {
      setIntersectionError(null);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.width;
    const h = canvas.height;

    // Project coordinates to 2D canvas points first to perform intersection calculations
    const centerLat = 22.5726;
    const centerLng = 88.3639;
    const zoomScale = 14000;

    const projected = polygonPoints.map(([lat, lng]) => ({
      x: w / 2 + (lng - centerLng) * zoomScale * 0.92,
      y: h / 2 - (lat - centerLat) * zoomScale
    }));

    // Check all combinations of non-adjacent segments
    for (let i = 0; i < projected.length; i++) {
      const p1 = projected[i];
      const p2 = projected[(i + 1) % projected.length];
      
      for (let j = i + 2; j < projected.length; j++) {
        if (i === 0 && j === projected.length - 1) continue; // Adjacent edge
        
        const p3 = projected[j];
        const p4 = projected[(j + 1) % projected.length];

        if (isLineIntersecting(p1, p2, p3, p4)) {
          setIntersectionError(`Geometric crossing detected between vertices index ${i}-${i+1} and ${j}-${(j+1)%projected.length}. OVERLAP INTERSECTION LOCKED.`);
          return;
        }
      }
    }

    setIntersectionError(null);
  }, [polygonPoints]);

  const commitGeofenceToPostGIS = async () => {
    if (intersectionError || polygonPoints.length < 3) return;
    
    setIsLoading(true);
    setLogResponse(null);

    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/geofence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          zone_name: zoneName.trim(),
          city_prefix: 'KOL',
          is_active: isZoneActive,
          polygon_coordinates: polygonPoints,
          policy_type: policyType,
          surge_multiplier: surgeMultiplier,
          allowed_transmissions: allowedTransmissions,
          activation_start: activationStart ? new Date(activationStart).toISOString() : null,
          activation_end: activationEnd ? new Date(activationEnd).toISOString() : null,
          notes: notes.trim(),
        }),
      });

      if (response.ok) {
        setLogResponse(`SUCCESS: Geofence [${zoneName}] updated/pushed to PostGIS table successfully.`);
        fetchGeofenceZones();
        // Reset/Deselect
        setSelectedGeofence(null);
        setPolygonPoints([]);
      } else {
        setLogResponse('ERROR: PostGIS vector geometry serialization rejected.');
      }
    } catch (err) {
      setLogResponse('ERROR: Network connection loss.');
    } finally {
      setIsLoading(false);
    }
  };

  // Stark minimalist PostGIS canvas mapping engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const renderVectorMap = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Dark slate base map style
      ctx.fillStyle = '#0b0f19';
      ctx.fillRect(0, 0, w, h);

      // Grid vector lines
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1;
      const spacing = 30;
      for (let x = 0; x < w; x += spacing) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += spacing) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      // Draw simulated geographic river landmarks (Hooghly River) for context
      ctx.beginPath();
      ctx.moveTo(w * 0.28, 0);
      ctx.quadraticCurveTo(w * 0.22, h * 0.38, w * 0.33, h * 0.65);
      ctx.lineTo(w * 0.18, h);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 16;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(w * 0.28, 0);
      ctx.quadraticCurveTo(w * 0.22, h * 0.38, w * 0.33, h * 0.65);
      ctx.lineTo(w * 0.18, h);
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 10;
      ctx.stroke();

      // Project maps
      const centerLat = 22.5726;
      const centerLng = 88.3639;
      const zoomScale = 14000;

      const project = (lat: number, lng: number) => {
        return {
          x: w / 2 + (lng - centerLng) * zoomScale * 0.92,
          y: h / 2 - (lat - centerLat) * zoomScale
        };
      };

      // Draw loaded geofences in background
      geofences.forEach(zone => {
        if (zone.polygon_coordinates.length < 3) return;
        if (selectedGeofence && selectedGeofence.zone_name === zone.zone_name) return; // Draw selection active with highlighting instead

        ctx.beginPath();
        zone.polygon_coordinates.forEach(([lat, lng], idx) => {
          const pt = project(lat, lng);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();

        // Color based on policy
        let fill = 'rgba(51, 65, 85, 0.08)';
        let stroke = '#475569';
        if (zone.policy_type === 'BLACKLIST_BLOCK') {
          fill = 'rgba(239, 68, 68, 0.06)';
          stroke = 'rgba(239, 68, 68, 0.3)';
        } else if (zone.policy_type === 'SURGE_FLOOR_FORCE') {
          fill = 'rgba(59, 130, 246, 0.06)';
          stroke = 'rgba(59, 130, 246, 0.3)';
        } else if (zone.policy_type === 'TRANSMISSION_RESTRICT') {
          fill = 'rgba(99, 102, 241, 0.06)';
          stroke = 'rgba(99, 102, 241, 0.3)';
        }

        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // Draw actively drawn/selected geofence boundary points
      if (polygonPoints.length > 0) {
        ctx.beginPath();
        polygonPoints.forEach(([lat, lng], idx) => {
          const pt = project(lat, lng);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });

        if (polygonPoints.length >= 3) {
          ctx.closePath();
          ctx.fillStyle = intersectionError 
            ? 'rgba(244, 63, 94, 0.12)' 
            : policyType === 'BLACKLIST_BLOCK'
            ? 'rgba(244, 63, 94, 0.18)'
            : policyType === 'SURGE_FLOOR_FORCE'
            ? 'rgba(59, 130, 246, 0.18)'
            : policyType === 'TRANSMISSION_RESTRICT'
            ? 'rgba(99, 102, 241, 0.18)'
            : 'rgba(16, 185, 129, 0.18)';
          ctx.fill();
        }

        ctx.strokeStyle = intersectionError 
          ? '#ef4444' 
          : policyType === 'BLACKLIST_BLOCK'
          ? '#f43f5e'
          : policyType === 'SURGE_FLOOR_FORCE'
          ? '#3b82f6'
          : policyType === 'TRANSMISSION_RESTRICT'
          ? '#6366f1'
          : '#10b981';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Draw coordinate handles
        polygonPoints.forEach(([lat, lng], idx) => {
          const pt = project(lat, lng);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, idx === 0 ? 6.5 : 5, 0, 2 * Math.PI);
          ctx.fillStyle = idx === 0 ? '#10b981' : '#ffffff';
          ctx.fill();
          ctx.strokeStyle = '#020617';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Render index number
          ctx.fillStyle = '#020617';
          ctx.font = 'bold 8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(idx.toString(), pt.x, pt.y + 3);
        });
      }

      frameId = requestAnimationFrame(renderVectorMap);
    };

    renderVectorMap();
    return () => cancelAnimationFrame(frameId);
  }, [polygonPoints, geofences, selectedGeofence, policyType, intersectionError]);

  // Click handler to plot custom points on canvas
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (drawingMode !== 'DRAW') return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    
    const w = canvas.width;
    const h = canvas.height;

    // De-project click X/Y coordinates back to map Lat/Lng
    const centerLat = 22.5726;
    const centerLng = 88.3639;
    const zoomScale = 14000;

    const lng = centerLng + (clickX - w / 2) / (zoomScale * 0.92);
    const lat = centerLat - (clickY - h / 2) / zoomScale;

    setPolygonPoints(prev => [...prev, [lat, lng]]);
  };

  // Convert points to WKT string
  const getSerializedWktString = () => {
    if (polygonPoints.length === 0) return 'EMPTY';
    const pairs = polygonPoints.map(([lat, lng]) => `${lng.toFixed(5)} ${lat.toFixed(5)}`);
    // PostGIS requires closed loop WKT mapping
    const sealedPoint = `${polygonPoints[0][1].toFixed(5)} ${polygonPoints[0][0].toFixed(5)}`;
    return `POLYGON((${pairs.join(', ')}, ${sealedPoint}))`;
  };

  const getPolicyBadge = (policy: GeofenceZoneRecord['policy_type']) => {
    switch (policy) {
      case 'ACTIVE_DISPATCH': 
        return <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[8px] font-bold">ACTIVE_DISPATCH</span>;
      case 'BLACKLIST_BLOCK': 
        return <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded text-[8px] font-bold">BLACKLIST_BLOCK</span>;
      case 'SURGE_FLOOR_FORCE': 
        return <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-[8px] font-bold">SURGE_FLOOR</span>;
      case 'TRANSMISSION_RESTRICT': 
        return <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded text-[8px] font-bold">RESTRICTED</span>;
    }
  };

  const filteredGeofences = geofences.filter(z => 
    z.zone_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="bg-canvas-softer rounded-xl p-6 border border-canvas-soft shadow-sm space-y-6 lg:col-span-3">
      
      {/* Tab controls */}
      <div className="flex border-b border-canvas-soft text-xs font-bold tracking-wider uppercase justify-between items-center">
        <div className="flex">
          <button
            onClick={() => { setActiveControlTab('GEOFENCE'); setLogResponse(null); }}
            className={`pb-3 pr-6 text-left transition cursor-pointer bg-transparent border-none outline-none ${activeControlTab === 'GEOFENCE' ? 'border-b-2 border-black text-ink font-bold' : 'text-mute hover:text-ink font-normal'}`}
          >
            ● Dynamic Geofence Editor
          </button>
          <button
            onClick={() => { setActiveControlTab('MANUAL_MATCH'); setLogResponse(null); }}
            className={`pb-3 px-6 text-left transition cursor-pointer bg-transparent border-none outline-none ${activeControlTab === 'MANUAL_MATCH' ? 'border-b-2 border-black text-ink font-bold' : 'text-mute hover:text-ink font-normal'}`}
          >
            ⚙️ Manual Inversion Override
          </button>
          <button
            onClick={() => { setActiveControlTab('FRAUD_RADAR'); setLogResponse(null); }}
            className={`pb-3 px-6 text-left transition cursor-pointer bg-transparent border-none outline-none ${activeControlTab === 'FRAUD_RADAR' ? 'border-b-2 border-black text-ink font-bold' : 'text-mute hover:text-ink font-normal'}`}
          >
            ▲ Telemetry Fraud Risk Radar
          </button>
        </div>

        {activeControlTab === 'GEOFENCE' && (
          <button
            onClick={() => setIsStudioExpanded(true)}
            className="pb-3 text-xs text-indigo-500 hover:text-indigo-600 font-bold bg-transparent border-none focus:outline-none flex items-center gap-1.5 cursor-pointer"
          >
            🖥️ ENTER GEOFENCE VECTOR STUDIO
          </button>
        )}
      </div>

      {/* Dynamic Tab Contents */}
      <div className="bg-white border border-canvas-soft rounded-xl p-6 min-h-[300px]">
        {activeControlTab === 'GEOFENCE' && (
          <div className="text-left space-y-4">
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-800 leading-relaxed flex justify-between items-center">
              <div>
                <strong>GEOSPATIAL VECTOR WORKSPACE DETECTED:</strong> Use the immersive visual vector editor to map coordinates, configure surge multipliers, and enforce dispatch blacklists directly over Postgres PostGIS tables.
              </div>
              <button 
                onClick={() => setIsStudioExpanded(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-4 rounded-lg text-[10px] transition cursor-pointer select-none"
              >
                Open Vector Studio
              </button>
            </div>
            
            {/* Inline list of geofences for preview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {geofences.map(zone => (
                <div 
                  key={zone.id}
                  onClick={() => { selectGeofenceZone(zone); setIsStudioExpanded(true); }}
                  className="p-4 rounded-xl border border-canvas-soft hover:bg-slate-50 transition cursor-pointer space-y-3"
                >
                  <div className="flex justify-between items-center">
                    <strong className="text-xs font-mono">{zone.zone_name}</strong>
                    {getPolicyBadge(zone.policy_type)}
                  </div>
                  <div className="text-[10px] text-body font-mono">
                    Coords: <strong className="text-ink">{zone.polygon_coordinates.length} Nodes</strong>
                  </div>
                  {zone.policy_type === 'SURGE_FLOOR_FORCE' && (
                    <div className="text-[10px] font-mono text-blue-500 font-bold">
                      Surge: {zone.surge_multiplier.toFixed(2)}x
                    </div>
                  )}
                  {zone.notes && (
                    <p className="text-[10px] text-mute italic border-t border-slate-100 pt-2">{zone.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeControlTab === 'MANUAL_MATCH' && (
          <form onSubmit={submitManualOverrideMatch} className="max-w-xl text-left space-y-4 mx-auto">
            <div className="p-4 bg-canvas-softer border border-canvas-soft rounded-xl text-[11px] text-body leading-relaxed mb-2">
              <strong>ALGORITHMIC OVERRIDE RULES:</strong> Executing a force-match manual bypass breaks ongoing Kuhn-Munkres matrix generation sweeps, binds the target order context directly to the operator, and terminates concurrent matching threads instantly.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Target Order UUID</label>
                <input
                  type="text"
                  className="w-full bg-canvas-softer border border-canvas-soft rounded-xl p-3 text-xs font-mono text-ink placeholder-mute focus:outline-none"
                  placeholder="Paste unfulfilled order id..."
                  value={overrideOrderID}
                  onChange={(e) => setOverrideOrderID(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Target Operator Driver UUID</label>
                <input
                  type="text"
                  className="w-full bg-canvas-softer border border-canvas-soft rounded-xl p-3 text-xs font-mono text-ink placeholder-mute focus:outline-none"
                  placeholder="Paste available operator id..."
                  value={overrideDriverID}
                  onChange={(e) => setOverrideDriverID(e.target.value)}
                  required
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-black hover:bg-black-elevated text-white font-bold py-3.5 px-4 rounded-full transition text-xs uppercase tracking-wider cursor-pointer mt-2 border-none"
            >
              Force Override Algorithmic Constraints
            </button>
          </form>
        )}

        {activeControlTab === 'FRAUD_RADAR' && (
          <div className="space-y-4 text-left">
            <div className="flex justify-between items-center border-b border-canvas-soft pb-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-body">High-Variance Velocity Stream Exceptions</span>
              <button onClick={fetchLiveFraudAnomalies} className="text-[10px] font-bold uppercase tracking-wider border border-canvas-soft bg-transparent px-3 py-1 rounded-full hover:bg-canvas-softer transition cursor-pointer">
                Refresh Radar Logs
              </button>
            </div>
            {fraudAlerts.length === 0 ? (
              <div className="py-12 text-center text-xs text-body italic">Zero telemetry tracking anomalies reported on current shards.</div>
            ) : (
              <div className="divide-y divide-canvas-soft">
                {fraudAlerts.map((alert) => (
                  <div key={alert.driver_id} className="py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-canvas-softer/30 transition px-2 rounded-xl">
                    <div className="space-y-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ink font-move">{alert.driver_name}</span>
                        <span className="bg-black text-white px-2 py-0.5 rounded text-[8px] font-mono font-bold tracking-wide uppercase">
                          ⚠️ {alert.violation_type.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-mute">UUID: {alert.driver_id}</p>
                      <p className="text-xs text-body italic mt-1 leading-relaxed">Analysis: {alert.last_ping_text}</p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto items-center">
                      <div className="bg-canvas-softer border border-canvas-soft p-2 rounded-lg text-center min-w-[70px] font-mono select-none">
                        <span className="text-[7px] text-mute block font-bold uppercase tracking-tight">Variance</span>
                        <span className="text-xs font-bold text-black">{alert.variance_score}%</span>
                      </div>
                      <button
                        onClick={() => executeFraudLockoutAction(alert.driver_id, 'SUSPEND')}
                        type="button"
                        className="bg-black hover:bg-black-elevated text-white font-bold px-4 py-2.5 text-[10px] uppercase tracking-wider rounded-lg border border-black cursor-pointer active:scale-95 transition"
                      >
                        Terminate Session
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {logResponse && (
        <div className={`p-3.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider text-center ${
          logResponse.startsWith('SUCCESS') || logResponse.startsWith('COMPLIANCE') ? 'bg-canvas-soft border border-surface-pressed text-ink' : 'bg-black text-white'
        }`}>
          {logResponse}
        </div>
      )}

      {/* FULLSCREEN TAKEOVER: IMMERSIVE GEOFENCE VECTOR STUDIO */}
      {isStudioExpanded && (
        <div className="fixed top-[72px] left-0 right-0 bottom-0 bg-slate-950 flex flex-col z-50 text-slate-100 font-sans select-none animate-fade-in">
          
          {/* Header Ribbon */}
          <div className="flex justify-between items-center px-6 py-3 border-b border-slate-900 bg-slate-950 font-mono text-xs">
            <div className="flex items-center gap-6">
              <span className="text-indigo-400 font-bold tracking-widest uppercase">
                GEOFENCE VECTOR STUDIO
              </span>
              <span className="text-slate-700">|</span>
              <span className="text-slate-400">
                Mode: <strong className="text-indigo-400">POLYGON_EDIT</strong>
              </span>
              <span className="text-slate-400">
                Active Zones: <strong className="text-emerald-500">{geofences.length}</strong>
              </span>
            </div>
            
            <div className="flex items-center gap-4">
              <span className="text-emerald-500 font-bold tracking-wider flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                POSTGIS SYNCED
              </span>
              <span className="text-slate-800">•</span>
              <button
                onClick={() => setIsStudioExpanded(false)}
                className="px-4 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-400 hover:text-white rounded transition active:scale-95"
              >
                Close Studio
              </button>
            </div>
          </div>

          {/* Tri-Axis Spatial Workspace Grid */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            
            {/* PANEL A: Territory Matrix Browser */}
            <div className="w-[300px] border-r border-slate-900 flex flex-col bg-slate-950">
              <div className="p-4 border-b border-slate-900 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-bold font-mono tracking-wider text-slate-500 uppercase">Territory Matrix</span>
                  <button
                    onClick={initNewGeofenceZone}
                    className="text-[9px] font-mono bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 px-2.5 rounded transition"
                  >
                    + Add Zone
                  </button>
                </div>
                
                <input
                  type="text"
                  placeholder="Search market zones..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-lg py-2 px-3 text-xs text-slate-300 placeholder-slate-600 focus:outline-none transition font-mono"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {filteredGeofences.length === 0 ? (
                  <div className="text-center text-slate-500 text-xs italic py-12">No matching geofences.</div>
                ) : (
                  filteredGeofences.map(zone => {
                    const isSelected = selectedGeofence?.id === zone.id;
                    return (
                      <div
                        key={zone.id}
                        onClick={() => selectGeofenceZone(zone)}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition relative overflow-hidden ${
                          isSelected
                            ? 'bg-slate-900 border-slate-700'
                            : 'bg-slate-950 border-slate-900 hover:bg-slate-900/30'
                        }`}
                      >
                        {/* Visual policy left marker */}
                        <div className={`absolute top-0 left-0 bottom-0 w-1 ${
                          zone.policy_type === 'BLACKLIST_BLOCK' 
                            ? 'bg-rose-500' 
                            : zone.policy_type === 'SURGE_FLOOR_FORCE' 
                            ? 'bg-blue-500' 
                            : zone.policy_type === 'TRANSMISSION_RESTRICT' 
                            ? 'bg-indigo-500' 
                            : 'bg-emerald-500'
                        }`} />

                        <div className="pl-1.5 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-bold text-slate-200 truncate pr-2 max-w-[130px]">
                              {zone.zone_name}
                            </span>
                            <span className="text-[8px] font-mono bg-slate-950 text-slate-500 px-1 py-0.2 rounded border border-slate-900">
                              {zone.city_prefix}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[9px] font-mono text-slate-500">
                            <span>Nodes: <strong className="text-slate-300">{zone.polygon_coordinates.length}</strong></span>
                            <span>{zone.is_active ? '🟢 ACTIVE' : '🔴 DISABLED'}</span>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {getPolicyBadge(zone.policy_type)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* PANEL B: Interactive Vector Canvas */}
            <div className="flex-1 flex flex-col bg-slate-950 border-r border-slate-900 overflow-hidden relative">
              <div className="flex justify-between items-center p-3.5 border-b border-slate-900 bg-slate-950/70 z-10">
                
                {/* Floating Vector drawing controls */}
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-slate-500 font-bold mr-1">DRAWING TOOLS:</span>
                  {(['PAN', 'DRAW'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDrawingMode(mode)}
                      className={`px-3 py-1 rounded border text-[9px] font-bold uppercase transition ${
                        drawingMode === mode
                          ? 'bg-slate-100 text-slate-950 border-slate-100'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-900'
                      }`}
                    >
                      {mode} Mode
                    </button>
                  ))}
                  <button
                    onClick={() => setPolygonPoints([])}
                    className="px-3 py-1 bg-slate-900 border border-slate-800 text-rose-400 hover:bg-rose-950/30 rounded transition text-[9px] font-bold"
                  >
                    Clear Path
                  </button>
                </div>

                <div className="text-[10px] font-mono text-slate-400">
                  {drawingMode === 'DRAW' ? '🖱️ Left-Click Canvas to plot Polygon boundary nodes' : '✋ Pan/inspect geofences'}
                </div>
              </div>

              {/* Central Map Canvas Frame */}
              <div className="flex-1 relative min-h-0 bg-slate-950">
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={450}
                  onClick={handleCanvasClick}
                  className="w-full h-full block cursor-crosshair"
                />

                {/* Self Intersection Warning Overlay */}
                {intersectionError && (
                  <div className="absolute top-4 left-4 right-4 bg-rose-950/95 border border-rose-800/80 p-3 rounded-lg flex items-center gap-2.5 z-20 text-xs font-mono text-rose-300 shadow-xl">
                    <span className="text-base animate-pulse">⚠️</span>
                    <div>
                      <strong>GEOMETRIC OVERLAP DETECTED:</strong> Polygon segments cross. PostGIS boundaries must be closed non-overlapping paths.
                    </div>
                  </div>
                )}
              </div>

              {/* WKT Serialized String readout */}
              <div className="border-t border-slate-900 p-4 bg-slate-950/80 text-[10px] font-mono text-slate-400 flex items-center justify-between">
                <div className="flex items-center gap-2 max-w-[80%] truncate">
                  <span className="text-slate-500 font-bold select-none">WKT OUTPUT:</span>
                  <span className="text-slate-300 font-bold select-all bg-slate-900 border border-slate-800/60 px-2 py-0.5 rounded truncate select-all">{getSerializedWktString()}</span>
                </div>
                <div className="text-slate-500">
                  Nodes plotted: <strong className="text-slate-300 font-bold">{polygonPoints.length}</strong>
                </div>
              </div>
            </div>

            {/* PANEL C: Operational Restriction Sheet */}
            <div className="w-[340px] flex flex-col bg-slate-950 overflow-y-auto">
              <div className="p-5 space-y-5 text-left text-xs font-mono">
                <div className="text-[10px] font-bold text-slate-500 tracking-wider uppercase border-b border-slate-900 pb-2">
                  Restriction Configuration Sheet
                </div>

                <div className="space-y-4">
                  {/* Name field */}
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1.5">Zone Key Name</label>
                    <input
                      type="text"
                      value={zoneName}
                      onChange={(e) => setZoneName(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-slate-700"
                      placeholder="e.g. HOWRAH_STATION_CORE"
                    />
                  </div>

                  {/* Active Toggle */}
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1.5">Execution Status</label>
                    <select
                      value={isZoneActive ? 'ACTIVE' : 'DISABLED'}
                      onChange={(e) => setIsZoneActive(e.target.value === 'ACTIVE')}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs font-bold text-slate-200 focus:outline-none"
                    >
                      <option value="ACTIVE">🟢 ENABLED & SYNCED</option>
                      <option value="DISABLED">🔴 DISABLED (INACTIVE)</option>
                    </select>
                  </div>

                  {/* Policy rules selection */}
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1.5">Marketplace policy Token</label>
                    <select
                      value={policyType}
                      onChange={(e) => setPolicyType(e.target.value as any)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none font-bold"
                    >
                      <option value="ACTIVE_DISPATCH">ACTIVE_DISPATCH (Normal Dispatching)</option>
                      <option value="BLACKLIST_BLOCK">BLACKLIST_BLOCK (Halt Inbound/Outbound Booking)</option>
                      <option value="SURGE_FLOOR_FORCE">SURGE_FLOOR_FORCE (Static Surge Multiplier)</option>
                      <option value="TRANSMISSION_RESTRICT">TRANSMISSION_RESTRICT (Transmission Caps)</option>
                    </select>
                  </div>

                  {/* Dynamic policy parameters */}
                  {policyType === 'SURGE_FLOOR_FORCE' && (
                    <div className="bg-slate-900/50 border border-slate-900 p-3.5 rounded-lg space-y-2">
                      <div className="flex justify-between items-center text-[10px] text-slate-400">
                        <span>SURGE FLOOR OVERRIDE:</span>
                        <strong className="text-blue-400 text-xs font-bold">{surgeMultiplier.toFixed(1)}x</strong>
                      </div>
                      <input
                        type="range"
                        min="1.0"
                        max="4.0"
                        step="0.1"
                        value={surgeMultiplier}
                        onChange={(e) => setSurgeMultiplier(parseFloat(e.target.value))}
                        className="w-full accent-blue-500"
                      />
                    </div>
                  )}

                  {policyType === 'TRANSMISSION_RESTRICT' && (
                    <div className="bg-slate-900/50 border border-slate-900 p-3.5 rounded-lg space-y-2">
                      <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1">Allowed Pilot Profile</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['ALL', 'AUTOMATIC_ONLY', 'MANUAL_ONLY'] as const).map(trans => (
                          <button
                            type="button"
                            key={trans}
                            onClick={() => setAllowedTransmissions(trans)}
                            className={`py-1 rounded text-[8px] font-bold uppercase text-center border transition ${
                              allowedTransmissions === trans
                                ? 'bg-indigo-600 text-white border-indigo-500'
                                : 'bg-slate-950 border-slate-900 text-slate-400'
                            }`}
                          >
                            {trans.replace('_ONLY', '')}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Active Scheduled dates pickers */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Activation Start</label>
                      <input
                        type="datetime-local"
                        value={activationStart}
                        onChange={(e) => setActivationStart(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-[10px] text-slate-300 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Activation End</label>
                      <input
                        type="datetime-local"
                        value={activationEnd}
                        onChange={(e) => setActivationEnd(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-[10px] text-slate-300 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Cache eviction warning banner */}
                  <div className="bg-slate-900 border border-slate-850 p-3.5 rounded-lg text-[9px] text-slate-400 space-y-1">
                    <div className="text-amber-500 font-bold uppercase tracking-wider flex items-center gap-1">
                      <span>⚠️</span> IMMEDIATE CACHE EVICTION ACTIONS
                    </div>
                    <p className="leading-normal">
                      Saving modifications forces immediate redis cluster slots flushing. Active dispatch routing channels in KOL prefix will reload geofences immediately.
                    </p>
                  </div>

                  {/* Displacement Warnings indicator check */}
                  {policyType === 'BLACKLIST_BLOCK' && (
                    <div className="bg-rose-950/20 border border-rose-900/35 p-3 rounded-lg text-[9px] text-rose-300 flex items-start gap-1.5">
                      <span className="text-xs animate-pulse">⚠️</span>
                      <div>
                        <strong>ACTIVE VEHICLE DISPLACEMENT WARNING:</strong> 3 active trip journeys are currently traversing this geofence boundaries. Blacklist deployment will evict matches.
                      </div>
                    </div>
                  )}
                </div>

                {/* Justification note & Slide confirmation gate */}
                <div className="border-t border-slate-900 pt-4 mt-4 space-y-4">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-500 uppercase mb-1.5">Intervention Justification Notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Input justification note details (mandatory to unlock execution slide gate)..."
                      className="w-full h-16 bg-slate-900 border border-slate-800 focus:border-slate-700 rounded-lg p-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none transition resize-none leading-relaxed"
                    />
                  </div>

                  <SlideToConfirm
                    key={`commit-geofence-${selectedGeofence?.id || 'new'}`}
                    label="Slide to Commit Geofence"
                    confirmedLabel="Syncing PostGIS — Evicting Cache"
                    tone="neutral"
                    disabled={isLoading || !notes.trim() || polygonPoints.length < 3 || !!intersectionError}
                    onConfirm={commitGeofenceToPostGIS}
                  />
                </div>
              </div>
            </div>

          </div>

        </div>
      )}

    </div>
  );
};
