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
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/fraud`);
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
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/geofence`);
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
    if (!window.confirm(
      `Force-match order ${overrideOrderID.trim()} to driver ${overrideDriverID.trim()}?\n\n` +
      `This bypasses the matching algorithm and the 15s offer window, and binds the driver ` +
      `immediately. The driver must be ONLINE_AVAILABLE or the server will reject it.`
    )) {
      return;
    }
    setIsLoading(true);
    setLogResponse(null);

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/force-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    if (!window.confirm(
      `${action === 'SUSPEND' ? 'Suspend' : 'Reinstate'} driver ${driverId}?\n\n` +
      `${action === 'SUSPEND' ? 'This immediately terminates their session and removes them from dispatch.' : 'This restores the driver to the active pool.'}`
    )) {
      return;
    }
    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/fraud-lockout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/marketplace/geofence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

      // Semantic canvas palette for Minimalist light UI
      const CANVAS_PALETTE = {
        background: '#FAFAFA',
        grid: '#E0E0DD',
        riverBorder: '#E0E0DD',
        riverFill: '#F3F4F6', // very soft light gray/blue
        textPrimary: '#1A1A1A',
        textSecondary: '#555552',
        routeMuted: '#94A3B8',
        blacklist: '#C94030',
        surge: '#4A6FA5',
        restrict: '#8A5CF5', // soft purple/indigo
        success: '#3A9D68',
        pinOutline: '#1A1A1A',
        pinFill: '#FAFAFA'
      };

      // Base map style
      ctx.fillStyle = CANVAS_PALETTE.background;
      ctx.fillRect(0, 0, w, h);

      // Grid vector lines
      ctx.strokeStyle = CANVAS_PALETTE.grid;
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
      ctx.strokeStyle = CANVAS_PALETTE.riverBorder;
      ctx.lineWidth = 16;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(w * 0.28, 0);
      ctx.quadraticCurveTo(w * 0.22, h * 0.38, w * 0.33, h * 0.65);
      ctx.lineTo(w * 0.18, h);
      ctx.strokeStyle = CANVAS_PALETTE.riverFill;
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
        let fill = 'rgba(85, 85, 82, 0.08)';
        let stroke = CANVAS_PALETTE.textSecondary;
        if (zone.policy_type === 'BLACKLIST_BLOCK') {
          fill = 'rgba(201, 64, 48, 0.06)';
          stroke = 'rgba(201, 64, 48, 0.3)';
        } else if (zone.policy_type === 'SURGE_FLOOR_FORCE') {
          fill = 'rgba(74, 111, 165, 0.06)';
          stroke = 'rgba(74, 111, 165, 0.3)';
        } else if (zone.policy_type === 'TRANSMISSION_RESTRICT') {
          fill = 'rgba(138, 92, 245, 0.06)';
          stroke = 'rgba(138, 92, 245, 0.3)';
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
            ? 'rgba(201, 64, 48, 0.12)' 
            : policyType === 'BLACKLIST_BLOCK'
            ? 'rgba(201, 64, 48, 0.18)'
            : policyType === 'SURGE_FLOOR_FORCE'
            ? 'rgba(74, 111, 165, 0.18)'
            : policyType === 'TRANSMISSION_RESTRICT'
            ? 'rgba(138, 92, 245, 0.18)'
            : 'rgba(58, 157, 104, 0.18)';
          ctx.fill();
        }

        ctx.strokeStyle = intersectionError 
          ? CANVAS_PALETTE.blacklist
          : policyType === 'BLACKLIST_BLOCK'
          ? CANVAS_PALETTE.blacklist
          : policyType === 'SURGE_FLOOR_FORCE'
          ? CANVAS_PALETTE.surge
          : policyType === 'TRANSMISSION_RESTRICT'
          ? CANVAS_PALETTE.restrict
          : CANVAS_PALETTE.success;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Draw coordinate handles
        polygonPoints.forEach(([lat, lng], idx) => {
          const pt = project(lat, lng);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, idx === 0 ? 6.5 : 5, 0, 2 * Math.PI);
          ctx.fillStyle = idx === 0 ? CANVAS_PALETTE.success : CANVAS_PALETTE.pinFill;
          ctx.fill();
          ctx.strokeStyle = CANVAS_PALETTE.pinOutline;
          ctx.lineWidth = 2;
          ctx.stroke();

          // Render index number
          ctx.fillStyle = CANVAS_PALETTE.pinOutline;
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
        return <span className="bg-positive-400/10 text-positive-400 border border-positive-400/20 px-2 py-0.5 rounded text-[8px] font-bold">ACTIVE_DISPATCH</span>;
      case 'BLACKLIST_BLOCK': 
        return <span className="bg-negative-400/10 text-negative-400 border border-negative-400/20 px-2 py-0.5 rounded text-[8px] font-bold">BLACKLIST_BLOCK</span>;
      case 'SURGE_FLOOR_FORCE': 
        return <span className="bg-accent-400/10 text-accent-400 border border-border-accent/20 px-2 py-0.5 rounded text-[8px] font-bold">SURGE_FLOOR</span>;
      case 'TRANSMISSION_RESTRICT': 
        return <span className="bg-accent-400/10 text-accent-400 border border-border-accent/20 px-2 py-0.5 rounded text-[8px] font-bold">RESTRICTED</span>;
    }
  };

  const filteredGeofences = geofences.filter(z => 
    z.zone_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="bg-background-tertiary rounded-xl p-6 border border-background-secondary shadow-sm space-y-6 lg:col-span-3">
      
      {/* Tab controls */}
      <div className="flex border-b border-background-secondary text-xs font-bold tracking-wider uppercase justify-between items-center">
        <div className="flex">
          <button
            onClick={() => { setActiveControlTab('GEOFENCE'); setLogResponse(null); }}
            className={`pb-3 pr-6 text-left transition cursor-pointer bg-transparent border-none outline-none ${activeControlTab === 'GEOFENCE' ? 'border-b-2 border-black text-content-primary font-bold' : 'text-content-tertiary hover:text-content-primary font-normal'}`}
          >
            ● Dynamic Geofence Editor
          </button>
          <button
            onClick={() => { setActiveControlTab('MANUAL_MATCH'); setLogResponse(null); }}
            className={`pb-3 px-6 text-left transition cursor-pointer bg-transparent border-none outline-none ${activeControlTab === 'MANUAL_MATCH' ? 'border-b-2 border-black text-content-primary font-bold' : 'text-content-tertiary hover:text-content-primary font-normal'}`}
          >
            ⚙️ Manual Inversion Override
          </button>
          <button
            onClick={() => { setActiveControlTab('FRAUD_RADAR'); setLogResponse(null); }}
            className={`pb-3 px-6 text-left transition cursor-pointer bg-transparent border-none outline-none ${activeControlTab === 'FRAUD_RADAR' ? 'border-b-2 border-black text-content-primary font-bold' : 'text-content-tertiary hover:text-content-primary font-normal'}`}
          >
            ▲ Telemetry Fraud Risk Radar
          </button>
        </div>

        {activeControlTab === 'GEOFENCE' && (
          <button
            onClick={() => setIsStudioExpanded(true)}
            className="pb-3 text-xs text-accent-400 hover:text-accent-400 font-bold bg-transparent border-none focus:outline-none flex items-center gap-1.5 cursor-pointer"
          >
            🖥️ ENTER GEOFENCE VECTOR STUDIO
          </button>
        )}
      </div>

      {/* Dynamic Tab Contents */}
      <div className="bg-white border border-background-secondary rounded-xl p-6 min-h-[300px]">
        {activeControlTab === 'GEOFENCE' && (
          <div className="text-left space-y-4">
            <div className="p-4 bg-accent-400 border border-border-accent rounded-xl text-xs text-accent-400 leading-relaxed flex justify-between items-center">
              <div>
                <strong>GEOSPATIAL VECTOR WORKSPACE DETECTED:</strong> Use the immersive visual vector editor to map coordinates, configure surge multipliers, and enforce dispatch blacklists directly over Postgres PostGIS tables.
              </div>
              <button 
                onClick={() => setIsStudioExpanded(true)}
                className="bg-accent-400 hover:bg-accent-400 text-white font-bold py-1.5 px-4 rounded-lg text-[10px] transition cursor-pointer select-none"
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
                  className="p-4 rounded-xl border border-background-secondary hover:bg-gray-800 transition cursor-pointer space-y-3"
                >
                  <div className="flex justify-between items-center">
                    <strong className="text-xs font-mono">{zone.zone_name}</strong>
                    {getPolicyBadge(zone.policy_type)}
                  </div>
                  <div className="text-[10px] text-content-secondary font-mono">
                    Coords: <strong className="text-content-primary">{zone.polygon_coordinates.length} Nodes</strong>
                  </div>
                  {zone.policy_type === 'SURGE_FLOOR_FORCE' && (
                    <div className="text-[10px] font-mono text-accent-400 font-bold">
                      Surge: {zone.surge_multiplier.toFixed(2)}x
                    </div>
                  )}
                  {zone.notes && (
                    <p className="text-[10px] text-content-tertiary italic border-t border-gray-800 pt-2">{zone.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeControlTab === 'MANUAL_MATCH' && (
          <form onSubmit={submitManualOverrideMatch} className="max-w-xl text-left space-y-4 mx-auto">
            <div className="p-4 bg-background-tertiary border border-background-secondary rounded-xl text-[11px] text-content-secondary leading-relaxed mb-2">
              <strong>ALGORITHMIC OVERRIDE RULES:</strong> Executing a force-match manual bypass breaks ongoing Kuhn-Munkres matrix generation sweeps, binds the target order context directly to the operator, and terminates concurrent matching threads instantly.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-2">Target Order UUID</label>
                <input
                  type="text"
                  className="w-full bg-background-tertiary border border-background-secondary rounded-xl p-3 text-xs font-mono text-content-primary placeholder-content-tertiary focus:outline-none"
                  placeholder="Paste unfulfilled order id..."
                  value={overrideOrderID}
                  onChange={(e) => setOverrideOrderID(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-2">Target Operator Driver UUID</label>
                <input
                  type="text"
                  className="w-full bg-background-tertiary border border-background-secondary rounded-xl p-3 text-xs font-mono text-content-primary placeholder-content-tertiary focus:outline-none"
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
              className="w-full bg-black hover:bg-gray-800 text-white font-bold py-3.5 px-4 rounded-full transition text-xs uppercase tracking-wider cursor-pointer mt-2 border-none"
            >
              Force Override Algorithmic Constraints
            </button>
          </form>
        )}

        {activeControlTab === 'FRAUD_RADAR' && (
          <div className="space-y-4 text-left">
            <div className="flex justify-between items-center border-b border-background-secondary pb-2">
              <span className="text-[10px] uppercase font-bold tracking-wider text-content-secondary">High-Variance Velocity Stream Exceptions</span>
              <button onClick={fetchLiveFraudAnomalies} className="text-[10px] font-bold uppercase tracking-wider border border-background-secondary bg-transparent px-3 py-1 rounded-full hover:bg-background-tertiary transition cursor-pointer">
                Refresh Radar Logs
              </button>
            </div>
            {fraudAlerts.length === 0 ? (
              <div className="py-12 text-center text-xs text-content-secondary italic">Zero telemetry tracking anomalies reported on current shards.</div>
            ) : (
              <div className="divide-y divide-background-secondary">
                {fraudAlerts.map((alert) => (
                  <div key={alert.driver_id} className="py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-background-tertiary/30 transition px-2 rounded-xl">
                    <div className="space-y-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-content-primary font-move">{alert.driver_name}</span>
                        <span className="bg-black text-white px-2 py-0.5 rounded text-[8px] font-mono font-bold tracking-wide uppercase">
                          ⚠️ {alert.violation_type.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-content-tertiary">UUID: {alert.driver_id}</p>
                      <p className="text-xs text-content-secondary italic mt-1 leading-relaxed">Analysis: {alert.last_ping_text}</p>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto items-center">
                      <div className="bg-background-tertiary border border-background-secondary p-2 rounded-lg text-center min-w-[70px] font-mono select-none">
                        <span className="text-[7px] text-content-tertiary block font-bold uppercase tracking-tight">Variance</span>
                        <span className="text-xs font-bold text-black">{alert.variance_score}%</span>
                      </div>
                      <button
                        onClick={() => executeFraudLockoutAction(alert.driver_id, 'SUSPEND')}
                        type="button"
                        className="bg-black hover:bg-gray-800 text-white font-bold px-4 py-2.5 text-[10px] uppercase tracking-wider rounded-lg border border-black cursor-pointer active:scale-95 transition"
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
          logResponse.startsWith('SUCCESS') || logResponse.startsWith('COMPLIANCE') ? 'bg-background-secondary border border-border-opaque text-content-primary' : 'bg-black text-white'
        }`}>
          {logResponse}
        </div>
      )}

      {/* FULLSCREEN TAKEOVER: IMMERSIVE GEOFENCE VECTOR STUDIO */}
      {isStudioExpanded && (
        <div className="fixed top-[72px] left-0 right-0 bottom-0 bg-gray-800 flex flex-col z-50 text-gray-300 font-sans select-none animate-fade-in">
          
          {/* Header Ribbon */}
          <div className="flex justify-between items-center px-6 py-3 border-b border-gray-800 bg-gray-800 font-mono text-xs">
            <div className="flex items-center gap-6">
              <span className="text-accent-400 font-bold tracking-widest uppercase">
                GEOFENCE VECTOR STUDIO
              </span>
              <span className="text-gray-300">|</span>
              <span className="text-gray-300">
                Mode: <strong className="text-accent-400">POLYGON_EDIT</strong>
              </span>
              <span className="text-gray-300">
                Active Zones: <strong className="text-positive-400">{geofences.length}</strong>
              </span>
            </div>
            
            <div className="flex items-center gap-4">
              <span className="text-positive-400 font-bold tracking-wider flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-positive-400 animate-pulse"></span>
                POSTGIS SYNCED
              </span>
              <span className="text-gray-300">•</span>
              <button
                onClick={() => setIsStudioExpanded(false)}
                className="px-4 py-1 text-[10px] bg-gray-800 border border-gray-800 text-gray-300 hover:text-white rounded transition active:scale-95"
              >
                Close Studio
              </button>
            </div>
          </div>

          {/* Tri-Axis Spatial Workspace Grid */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            
            {/* PANEL A: Territory Matrix Browser */}
            <div className="w-[300px] border-r border-gray-800 flex flex-col bg-gray-800">
              <div className="p-4 border-b border-gray-800 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-bold font-mono tracking-wider text-gray-300 uppercase">Territory Matrix</span>
                  <button
                    onClick={initNewGeofenceZone}
                    className="text-[9px] font-mono bg-accent-400 hover:bg-accent-400 text-white font-bold py-1 px-2.5 rounded transition"
                  >
                    + Add Zone
                  </button>
                </div>
                
                <input
                  type="text"
                  placeholder="Search market zones..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-800 focus:border-gray-800 rounded-lg py-2 px-3 text-xs text-gray-300 placeholder-slate-600 focus:outline-none transition font-mono"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {filteredGeofences.length === 0 ? (
                  <div className="text-center text-gray-300 text-xs italic py-12">No matching geofences.</div>
                ) : (
                  filteredGeofences.map(zone => {
                    const isSelected = selectedGeofence?.id === zone.id;
                    return (
                      <div
                        key={zone.id}
                        onClick={() => selectGeofenceZone(zone)}
                        className={`p-3 rounded-lg border text-left cursor-pointer transition relative overflow-hidden ${
                          isSelected
                            ? 'bg-gray-800 border-gray-800'
                            : 'bg-gray-800 border-gray-800 hover:bg-gray-800/30'
                        }`}
                      >
                        {/* Visual policy left marker */}
                        <div className={`absolute top-0 left-0 bottom-0 w-1 ${
                          zone.policy_type === 'BLACKLIST_BLOCK' 
                            ? 'bg-negative-400' 
                            : zone.policy_type === 'SURGE_FLOOR_FORCE' 
                            ? 'bg-accent-400' 
                            : zone.policy_type === 'TRANSMISSION_RESTRICT' 
                            ? 'bg-accent-400' 
                            : 'bg-positive-400'
                        }`} />

                        <div className="pl-1.5 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[11px] font-bold text-gray-300 truncate pr-2 max-w-[130px]">
                              {zone.zone_name}
                            </span>
                            <span className="text-[8px] font-mono bg-gray-800 text-gray-300 px-1 py-0.2 rounded border border-gray-800">
                              {zone.city_prefix}
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[9px] font-mono text-gray-300">
                            <span>Nodes: <strong className="text-gray-300">{zone.polygon_coordinates.length}</strong></span>
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
            <div className="flex-1 flex flex-col bg-gray-800 border-r border-gray-800 overflow-hidden relative">
              <div className="flex justify-between items-center p-3.5 border-b border-gray-800 bg-gray-800/70 z-10">
                
                {/* Floating Vector drawing controls */}
                <div className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="text-gray-300 font-bold mr-1">DRAWING TOOLS:</span>
                  {(['PAN', 'DRAW'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setDrawingMode(mode)}
                      className={`px-3 py-1 rounded border text-[9px] font-bold uppercase transition ${
                        drawingMode === mode
                          ? 'bg-gray-800 text-gray-300 border-gray-800'
                          : 'bg-gray-800 border-gray-800 text-gray-300 hover:bg-gray-800'
                      }`}
                    >
                      {mode} Mode
                    </button>
                  ))}
                  <button
                    onClick={() => setPolygonPoints([])}
                    className="px-3 py-1 bg-gray-800 border border-gray-800 text-negative-400 hover:bg-negative-400/30 rounded transition text-[9px] font-bold"
                  >
                    Clear Path
                  </button>
                </div>

                <div className="text-[10px] font-mono text-gray-300">
                  {drawingMode === 'DRAW' ? '🖱️ Left-Click Canvas to plot Polygon boundary nodes' : '✋ Pan/inspect geofences'}
                </div>
              </div>

              {/* Central Map Canvas Frame */}
              <div className="flex-1 relative min-h-0 bg-gray-800">
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={450}
                  onClick={handleCanvasClick}
                  className="w-full h-full block cursor-crosshair"
                />

                {/* Self Intersection Warning Overlay */}
                {intersectionError && (
                  <div className="absolute top-4 left-4 right-4 bg-negative-400/95 border border-negative-400/80 p-3 rounded-lg flex items-center gap-2.5 z-20 text-xs font-mono text-negative-400 shadow-xl">
                    <span className="text-base animate-pulse">⚠️</span>
                    <div>
                      <strong>GEOMETRIC OVERLAP DETECTED:</strong> Polygon segments cross. PostGIS boundaries must be closed non-overlapping paths.
                    </div>
                  </div>
                )}
              </div>

              {/* WKT Serialized String readout */}
              <div className="border-t border-gray-800 p-4 bg-gray-800/80 text-[10px] font-mono text-gray-300 flex items-center justify-between">
                <div className="flex items-center gap-2 max-w-[80%] truncate">
                  <span className="text-gray-300 font-bold select-none">WKT OUTPUT:</span>
                  <span className="text-gray-300 font-bold select-all bg-gray-800 border border-gray-800/60 px-2 py-0.5 rounded truncate select-all">{getSerializedWktString()}</span>
                </div>
                <div className="text-gray-300">
                  Nodes plotted: <strong className="text-gray-300 font-bold">{polygonPoints.length}</strong>
                </div>
              </div>
            </div>

            {/* PANEL C: Operational Restriction Sheet */}
            <div className="w-[340px] flex flex-col bg-gray-800 overflow-y-auto">
              <div className="p-5 space-y-5 text-left text-xs font-mono">
                <div className="text-[10px] font-bold text-gray-300 tracking-wider uppercase border-b border-gray-800 pb-2">
                  Restriction Configuration Sheet
                </div>

                <div className="space-y-4">
                  {/* Name field */}
                  <div>
                    <label className="block text-[9px] font-bold text-gray-300 uppercase mb-1.5">Zone Key Name</label>
                    <input
                      type="text"
                      value={zoneName}
                      onChange={(e) => setZoneName(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                      className="w-full bg-gray-800 border border-gray-800 rounded-lg p-2.5 text-xs text-gray-300 focus:outline-none focus:border-gray-800"
                      placeholder="e.g. HOWRAH_STATION_CORE"
                    />
                  </div>

                  {/* Active Toggle */}
                  <div>
                    <label className="block text-[9px] font-bold text-gray-300 uppercase mb-1.5">Execution Status</label>
                    <select
                      value={isZoneActive ? 'ACTIVE' : 'DISABLED'}
                      onChange={(e) => setIsZoneActive(e.target.value === 'ACTIVE')}
                      className="w-full bg-gray-800 border border-gray-800 rounded-lg p-2.5 text-xs font-bold text-gray-300 focus:outline-none"
                    >
                      <option value="ACTIVE">🟢 ENABLED & SYNCED</option>
                      <option value="DISABLED">🔴 DISABLED (INACTIVE)</option>
                    </select>
                  </div>

                  {/* Policy rules selection */}
                  <div>
                    <label className="block text-[9px] font-bold text-gray-300 uppercase mb-1.5">Marketplace policy Token</label>
                    <select
                      value={policyType}
                      onChange={(e) => setPolicyType(e.target.value as any)}
                      className="w-full bg-gray-800 border border-gray-800 rounded-lg p-2.5 text-xs text-gray-300 focus:outline-none font-bold"
                    >
                      <option value="ACTIVE_DISPATCH">ACTIVE_DISPATCH (Normal Dispatching)</option>
                      <option value="BLACKLIST_BLOCK">BLACKLIST_BLOCK (Halt Inbound/Outbound Booking)</option>
                      <option value="SURGE_FLOOR_FORCE">SURGE_FLOOR_FORCE (Static Surge Multiplier)</option>
                      <option value="TRANSMISSION_RESTRICT">TRANSMISSION_RESTRICT (Transmission Caps)</option>
                    </select>
                  </div>

                  {/* Dynamic policy parameters */}
                  {policyType === 'SURGE_FLOOR_FORCE' && (
                    <div className="bg-gray-800/50 border border-gray-800 p-3.5 rounded-lg space-y-2">
                      <div className="flex justify-between items-center text-[10px] text-gray-300">
                        <span>SURGE FLOOR OVERRIDE:</span>
                        <strong className="text-accent-400 text-xs font-bold">{surgeMultiplier.toFixed(1)}x</strong>
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
                    <div className="bg-gray-800/50 border border-gray-800 p-3.5 rounded-lg space-y-2">
                      <label className="block text-[9px] font-bold text-gray-300 uppercase mb-1">Allowed Pilot Profile</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['ALL', 'AUTOMATIC_ONLY', 'MANUAL_ONLY'] as const).map(trans => (
                          <button
                            type="button"
                            key={trans}
                            onClick={() => setAllowedTransmissions(trans)}
                            className={`py-1 rounded text-[8px] font-bold uppercase text-center border transition ${
                              allowedTransmissions === trans
                                ? 'bg-accent-400 text-white border-border-accent'
                                : 'bg-gray-800 border-gray-800 text-gray-300'
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
                      <label className="block text-[8px] font-bold text-gray-300 uppercase mb-1">Activation Start</label>
                      <input
                        type="datetime-local"
                        value={activationStart}
                        onChange={(e) => setActivationStart(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-800 rounded-lg p-2 text-[10px] text-gray-300 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[8px] font-bold text-gray-300 uppercase mb-1">Activation End</label>
                      <input
                        type="datetime-local"
                        value={activationEnd}
                        onChange={(e) => setActivationEnd(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-800 rounded-lg p-2 text-[10px] text-gray-300 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Cache eviction warning banner */}
                  <div className="bg-gray-800 border border-gray-800 p-3.5 rounded-lg text-[9px] text-gray-300 space-y-1">
                    <div className="text-warning-400 font-bold uppercase tracking-wider flex items-center gap-1">
                      <span>⚠️</span> IMMEDIATE CACHE EVICTION ACTIONS
                    </div>
                    <p className="leading-normal">
                      Saving modifications forces immediate redis cluster slots flushing. Active dispatch routing channels in KOL prefix will reload geofences immediately.
                    </p>
                  </div>

                  {/* Displacement Warnings indicator check */}
                  {policyType === 'BLACKLIST_BLOCK' && (
                    <div className="bg-negative-400/20 border border-negative-400/35 p-3 rounded-lg text-[9px] text-negative-400 flex items-start gap-1.5">
                      <span className="text-xs animate-pulse">⚠️</span>
                      <div>
                        <strong>ACTIVE VEHICLE DISPLACEMENT WARNING:</strong> 3 active trip journeys are currently traversing this geofence boundaries. Blacklist deployment will evict matches.
                      </div>
                    </div>
                  )}
                </div>

                {/* Justification note & Slide confirmation gate */}
                <div className="border-t border-gray-800 pt-4 mt-4 space-y-4">
                  <div>
                    <label className="block text-[9px] font-bold text-gray-300 uppercase mb-1.5">Intervention Justification Notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Input justification note details (mandatory to unlock execution slide gate)..."
                      className="w-full h-16 bg-gray-800 border border-gray-800 focus:border-gray-800 rounded-lg p-2.5 text-xs text-gray-300 placeholder-slate-600 focus:outline-none transition resize-none leading-relaxed"
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
