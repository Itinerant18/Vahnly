import React, { useState, useEffect, useRef } from 'react';
import { API_GATEWAY_BASE_URL, WS_GATEWAY_BASE_URL } from '../../config';
import { SlideToConfirm } from './SlideToConfirm';

interface StalledTripIncident {
  order_id: string;
  driver_id: string;
  driver_name: string;
  customer_name: string;
  vehicle_make_model: string;
  license_plate: string;
  last_known_status: 'EN_ROUTE' | 'ON_TRIP';
  seconds_since_last_ping: number;
  city_prefix: string;
  incident_type: 'SOS' | 'FRAUD' | 'SILENCE';
  incident_status: 'UNASSIGNED' | 'INVESTIGATING' | 'RESOLVED';
  assigned_agent_id: string;
  bearing_delta: number;
  calculated_speed: number;
  is_mock_provider: boolean;
  battery_level: number;
  latitude: number;
  longitude: number;
}

export const IncidentRecoveryTerminal: React.FC = () => {
  const [incidents, setIncidents] = useState<StalledTripIncident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<StalledTripIncident | null>(null);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [terminalLog, setTerminalLog] = useState<string | null>(null);
  
  // Sidebar UI Filters
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'SOS' | 'FRAUD' | 'SILENCE'>('ALL');
  
  // Global SOS Modal Takeover
  const [takeoverIncident, setTakeoverIncident] = useState<StalledTripIncident | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    fetchStalledTelemetryIncidents();
    const pollingInterval = setInterval(fetchStalledTelemetryIncidents, 8000);
    return () => clearInterval(pollingInterval);
  }, []);

  // Web Audio warning beep play handler
  const playWarningBeep = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // High pitch alert beep
      
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) {
      console.warn("Blocked AudioContext autoplay check:", e);
    }
  };

  // Trigger warning sound beep periodically while takeover SOS is active
  useEffect(() => {
    if (!takeoverIncident) return;
    
    playWarningBeep();
    const beepInterval = setInterval(playWarningBeep, 1500);
    return () => clearInterval(beepInterval);
  }, [takeoverIncident]);

  // Connect WebSocket to live gateway stream
  useEffect(() => {
    let ws: WebSocket | null = null;
    const token = localStorage.getItem('admin_jwt_token') ?? '';
    
    const connectWS = () => {
      try {
        const wsUrl = `${WS_GATEWAY_BASE_URL}/api/v1/dispatch/stream?order_id=global-sos&city_prefix=KOL&jwt=${encodeURIComponent(token)}`;
        ws = new WebSocket(wsUrl);
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && (data.incident_type === 'SOS' || data.incident_type === 'FRAUD' || data.incident_type === 'SILENCE')) {
              const incidentPayload: StalledTripIncident = {
                order_id: data.order_id ?? `ord-${Math.random().toString(36).substr(2, 9)}`,
                driver_id: data.driver_id ?? 'unknown-driver',
                driver_name: data.driver_name ?? 'Live Streaming Driver',
                customer_name: data.customer_name ?? 'Platform Customer',
                vehicle_make_model: data.vehicle_make_model ?? 'Standard EV Hatchback',
                license_plate: data.license_plate ?? 'WB-01-MOCK-99',
                last_known_status: data.last_known_status ?? 'ON_TRIP',
                seconds_since_last_ping: data.seconds_since_last_ping ?? 1,
                city_prefix: data.city_prefix ?? 'KOL',
                incident_type: data.incident_type,
                incident_status: data.incident_status ?? 'UNASSIGNED',
                assigned_agent_id: data.assigned_agent_id ?? '',
                bearing_delta: data.bearing_delta ?? 0,
                calculated_speed: data.calculated_speed ?? 0,
                is_mock_provider: !!data.is_mock_provider,
                battery_level: data.battery_level ?? 100,
                latitude: data.latitude ?? 22.5726,
                longitude: data.longitude ?? 88.3639,
              };

              setIncidents(prev => {
                if (prev.some(i => i.order_id === incidentPayload.order_id)) {
                  return prev.map(i => i.order_id === incidentPayload.order_id ? incidentPayload : i);
                }
                return [incidentPayload, ...prev];
              });

              if (incidentPayload.incident_type === 'SOS' && incidentPayload.incident_status === 'UNASSIGNED') {
                setTakeoverIncident(incidentPayload);
              }
            }
          } catch (e) {
            // Drop binary / routing frames silently
          }
        };

        ws.onclose = () => {
          setTimeout(connectWS, 6000);
        };
      } catch (err) {
        console.warn('Incident WebSocket connect failed, retrying in 6s:', err);
      }
    };

    connectWS();
    return () => {
      if (ws) ws.close();
    };
  }, []);

  // Monitor unassigned SOS alarms inside the active incident queue
  useEffect(() => {
    const unassignedSOS = incidents.find(i => i.incident_type === 'SOS' && i.incident_status === 'UNASSIGNED');
    if (unassignedSOS) {
      if (!takeoverIncident || takeoverIncident.order_id !== unassignedSOS.order_id) {
        setTakeoverIncident(unassignedSOS);
      }
    } else {
      setTakeoverIncident(null);
    }
  }, [incidents]);

  const fetchStalledTelemetryIncidents = async () => {
    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/trips/stalled`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        const loadedIncidents: StalledTripIncident[] = data.incidents || [];
        setIncidents(loadedIncidents);
        
        // Sync selected incident if it's currently loaded
        if (selectedIncident) {
          const updated = loadedIncidents.find(i => i.order_id === selectedIncident.order_id);
          if (updated) {
            setSelectedIncident(updated);
          }
        }
      } else {
        // High fidelity fallback seeding for local offline testing
        setIncidents([
          {
            order_id: 'ord-9011-cb72',
            driver_id: 'drv-4451-aa89',
            driver_name: 'Manish Malhotra',
            customer_name: 'Sourav Ganguly',
            vehicle_make_model: 'Audi A6 Premium',
            license_plate: 'WB-02-AL-0011',
            last_known_status: 'ON_TRIP',
            seconds_since_last_ping: 58,
            city_prefix: 'KOL',
            incident_type: 'SILENCE',
            incident_status: 'UNASSIGNED',
            assigned_agent_id: '',
            bearing_delta: 4.5,
            calculated_speed: 22.4,
            is_mock_provider: false,
            battery_level: 68.0,
            latitude: 22.5726,
            longitude: 88.3639,
          },
          {
            order_id: 'ord-8831-bb01',
            driver_id: 'drv-9902-aa11',
            driver_name: 'Amit Mishra',
            customer_name: 'Priyanka Sen',
            vehicle_make_model: 'Swift Dzire',
            license_plate: 'WB-04-BC-1234',
            last_known_status: 'ON_TRIP',
            seconds_since_last_ping: 2,
            city_prefix: 'KOL',
            incident_type: 'SOS',
            incident_status: 'UNASSIGNED',
            assigned_agent_id: '',
            bearing_delta: 12.8,
            calculated_speed: 45.0,
            is_mock_provider: false,
            battery_level: 82.0,
            latitude: 22.5832,
            longitude: 88.3678,
          },
          {
            order_id: 'ord-7711-ac90',
            driver_id: 'drv-7711-22aa',
            driver_name: 'Debashis Roy',
            customer_name: 'Ayan Mukherji',
            vehicle_make_model: 'Hyundai i20',
            license_plate: 'WB-06-DF-5678',
            last_known_status: 'ON_TRIP',
            seconds_since_last_ping: 12,
            city_prefix: 'KOL',
            incident_type: 'FRAUD',
            incident_status: 'UNASSIGNED',
            assigned_agent_id: '',
            bearing_delta: 0.0,
            calculated_speed: 240.0,
            is_mock_provider: true,
            battery_level: 50.0,
            latitude: 22.5901,
            longitude: 88.3512,
          },
        ]);
      }
    } catch (err) {
      console.error('Failed syncing stalled incident vectors:', err);
    }
  };

  const executeClaimIncident = async (orderId: string) => {
    setIsMutating(true);
    setTerminalLog(null);

    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/trips/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          order_id: orderId,
          agent_id: 'agent-support-lead-01',
        }),
      });

      if (response.ok) {
        setTerminalLog(`SUCCESS: Acknowledged active SOS exception. Status updated to INVESTIGATING.`);
        setIncidents(prev => 
          prev.map(i => i.order_id === orderId ? { ...i, incident_status: 'INVESTIGATING', assigned_agent_id: 'agent-support-lead-01' } : i)
        );
        if (takeoverIncident && takeoverIncident.order_id === orderId) {
          setTakeoverIncident(null);
        }
        // Force highlight the claimed incident
        const claimed = incidents.find(i => i.order_id === orderId);
        if (claimed) {
          setSelectedIncident({ ...claimed, incident_status: 'INVESTIGATING', assigned_agent_id: 'agent-support-lead-01' });
        }
      } else {
        setTerminalLog('ERROR: Claim request rejected by access gateway.');
      }
    } catch {
      setTerminalLog('ERROR: Claim gateway timeout.');
    } finally {
      setIsMutating(false);
    }
  };

  const dispatchRecoveryAction = async (action: 'FORCE_REMATCH' | 'FORCE_ABORT') => {
    if (!selectedIncident) return;
    setIsMutating(true);
    setTerminalLog(null);

    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/trips/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          order_id: selectedIncident.order_id,
          driver_id: selectedIncident.driver_id,
          recovery_action: action,
          incident_notes: notes || 'Administrative intervention executed via Emergency Terminal Override.',
        }),
      });

      if (response.ok) {
        setTerminalLog(`SUCCESS: Incident resolved. Action [${action}] committed. Driver evicted.`);
        setIncidents(incidents.map(i => i.order_id === selectedIncident.order_id ? { ...i, incident_status: 'RESOLVED' } : i));
        setSelectedIncident(null);
        setNotes('');
      } else {
        setTerminalLog('ERROR: Recovery override rejected by backend limits.');
      }
    } catch {
      setTerminalLog('ERROR: Service response timeout.');
    } finally {
      setIsMutating(false);
    }
  };

  // Sandbox testing trigger
  const triggerSandboxSOSAlert = () => {
    const sandboxId = `ord-sandbox-${Math.floor(Math.random() * 9000 + 1000)}`;
    const sandboxIncident: StalledTripIncident = {
      order_id: sandboxId,
      driver_id: `drv-sandbox-${Math.floor(Math.random() * 9000 + 1000)}`,
      driver_name: 'Rajesh Kumar (Sandbox)',
      customer_name: 'Vikram Seth',
      vehicle_make_model: 'Tata Nexon EV',
      license_plate: 'WB-02-EE-9988',
      last_known_status: 'ON_TRIP',
      seconds_since_last_ping: 1,
      city_prefix: 'KOL',
      incident_type: 'SOS',
      incident_status: 'UNASSIGNED',
      assigned_agent_id: '',
      bearing_delta: 24.5,
      calculated_speed: 65.2,
      is_mock_provider: false,
      battery_level: 94.0,
      latitude: 22.5695,
      longitude: 88.3610,
    };
    setIncidents(prev => [sandboxIncident, ...prev]);
  };

  // Stark base map canvas renderer loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrameId: number;

    const renderMap = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Dark minimalist slate base map background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Grid vector lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      const gridSize = 35;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      if (selectedIncident) {
        const { latitude, longitude, incident_type } = selectedIncident;
        
        // Projection matrices targeting central coordinate sets
        const projectCoord = (lat: number, lng: number) => {
          const zoomScale = 32000; // Stark telemetry zoom bounds
          const centerX = w / 2;
          const centerY = h / 2;
          return {
            x: centerX + (lng - longitude) * zoomScale,
            y: centerY - (lat - latitude) * zoomScale
          };
        };

        const vehiclePos = projectCoord(latitude, longitude);

        // Draw H3 Shaded Hexagon Area
        const hexSize = 50;
        ctx.beginPath();
        for (let side = 0; side < 6; side++) {
          const angle = (side * Math.PI) / 3;
          const hexX = vehiclePos.x + hexSize * Math.cos(angle);
          const hexY = vehiclePos.y + hexSize * Math.sin(angle);
          if (side === 0) ctx.moveTo(hexX, hexY);
          else ctx.lineTo(hexX, hexY);
        }
        ctx.closePath();
        
        ctx.fillStyle = incident_type === 'SOS' 
          ? 'rgba(239, 68, 68, 0.16)' 
          : incident_type === 'FRAUD' 
          ? 'rgba(245, 158, 11, 0.16)' 
          : 'rgba(59, 130, 246, 0.16)';
        ctx.fill();

        ctx.strokeStyle = incident_type === 'SOS' 
          ? 'rgba(239, 68, 68, 0.6)' 
          : incident_type === 'FRAUD' 
          ? 'rgba(245, 158, 11, 0.6)' 
          : 'rgba(59, 130, 246, 0.6)';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Draw Route Path (Dotted contraction line)
        const latDelta = incident_type === 'FRAUD' ? 0.006 : 0.002;
        const mockRouteNodes = [
          { lat: latitude - latDelta, lng: longitude - 0.003 },
          { lat: latitude - latDelta * 0.5, lng: longitude - 0.0015 },
          { lat: latitude, lng: longitude },
          { lat: latitude + latDelta * 0.5, lng: longitude + 0.0015 },
          { lat: latitude + latDelta, lng: longitude + 0.003 }
        ];

        ctx.beginPath();
        mockRouteNodes.forEach((node, idx) => {
          const pt = projectCoord(node.lat, node.lng);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.strokeStyle = '#475569'; // Muted dark slate
        ctx.lineWidth = 3;
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw GPS Breadcrumbs Line (Solid route)
        ctx.beginPath();
        mockRouteNodes.slice(0, 3).forEach((node, idx) => {
          const pt = projectCoord(node.lat, node.lng);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.strokeStyle = incident_type === 'SOS' ? '#f43f5e' : incident_type === 'FRAUD' ? '#fbbf24' : '#3b82f6';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Pulsing warning wave animation around vehicle
        const pulseRatio = ((Date.now() % 1400) / 1400) * 38;
        ctx.beginPath();
        ctx.arc(vehiclePos.x, vehiclePos.y, pulseRatio, 0, 2 * Math.PI);
        ctx.strokeStyle = incident_type === 'SOS' ? 'rgba(244, 63, 94, 0.5)' : 'rgba(251, 191, 36, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw vehicle center indicator pins
        ctx.beginPath();
        ctx.arc(vehiclePos.x, vehiclePos.y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#020617';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(vehiclePos.x, vehiclePos.y, 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = incident_type === 'SOS' ? '#f43f5e' : incident_type === 'FRAUD' ? '#fbbf24' : '#3b82f6';
        ctx.fill();

        // Draw Map UI Legends overlay
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(w - 150, 15, 135, 75);
        ctx.strokeStyle = '#334155';
        ctx.strokeRect(w - 150, 15, 135, 75);

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 9px monospace';
        ctx.fillText("MAP GRAPHIC INDEX", w - 142, 28);
        
        ctx.fillStyle = '#94a3b8';
        ctx.font = '8px monospace';
        
        // Dotted Legend
        ctx.beginPath(); ctx.moveTo(w - 142, 42); ctx.lineTo(w - 122, 42); ctx.strokeStyle = '#475569'; ctx.setLineDash([2,2]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillText("Contract Route (Dot)", w - 117, 45);

        // Solid Trail Legend
        ctx.beginPath(); ctx.moveTo(w - 142, 54); ctx.lineTo(w - 122, 54); ctx.strokeStyle = '#f43f5e'; ctx.stroke();
        ctx.fillText("Vehicle Trail (Solid)", w - 117, 57);

        // Shaded H3 Legend
        ctx.fillStyle = 'rgba(239, 68, 68, 0.35)'; ctx.fillRect(w - 142, 64, 20, 8);
        ctx.fillStyle = '#94a3b8';
        ctx.fillText("Active H3 Area", w - 117, 70);
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText("STARK MINIMALIST BASE MAP CANVAS LAYER", w / 2, h / 2 - 10);
        ctx.fillText("SELECT AN INCIDENT CARD TO DEPLOY VECTOR GEOMETRY", w / 2, h / 2 + 10);
      }

      animFrameId = requestAnimationFrame(renderMap);
    };

    renderMap();
    return () => cancelAnimationFrame(animFrameId);
  }, [selectedIncident]);

  const filteredIncidents = incidents.filter(inc => {
    if (inc.incident_status === 'RESOLVED') return false;
    if (activeFilter === 'ALL') return true;
    return inc.incident_type === activeFilter;
  });

  const getIncidentTypeLabel = (type: 'SOS' | 'FRAUD' | 'SILENCE') => {
    switch (type) {
      case 'SOS': return 'Active SOS Panic';
      case 'FRAUD': return 'Telemetry Fraud';
      case 'SILENCE': return 'Stream Silence';
    }
  };

  const getIncidentBadgeColor = (type: 'SOS' | 'FRAUD' | 'SILENCE') => {
    switch (type) {
      case 'SOS': return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'FRAUD': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'SILENCE': return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
    }
  };

  const activeSOSCount = incidents.filter(i => i.incident_type === 'SOS' && i.incident_status === 'UNASSIGNED').length;
  const activeFraudCount = incidents.filter(i => i.incident_type === 'FRAUD' && i.incident_status === 'UNASSIGNED').length;
  const activeSilenceCount = incidents.filter(i => i.incident_type === 'SILENCE' && i.incident_status === 'UNASSIGNED').length;

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] w-full text-slate-100 bg-slate-950 font-sans relative overflow-hidden select-none">
      
      {/* Dynamic Ribbon Control Header */}
      <div className="flex justify-between items-center px-6 py-3 border-b border-slate-900 bg-slate-950 text-xs font-mono">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-rose-500 font-bold tracking-wider animate-pulse">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </span>
            CRITICAL INTERVENTION COMMAND CENTER
          </span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            Active SOS: <strong className="text-rose-500">{activeSOSCount}</strong>
          </span>
          <span className="text-slate-400">
            Telemetry Alerts: <strong className="text-amber-500">{activeFraudCount + activeSilenceCount}</strong>
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={triggerSandboxSOSAlert}
            className="px-3 py-1 text-[10px] bg-slate-900 border border-slate-800 text-slate-300 hover:text-white rounded hover:bg-slate-800 transition active:scale-95"
          >
            Trigger Sandbox SOS
          </button>
          <span className="text-slate-700 font-bold select-none">•</span>
          <span className="text-emerald-500 font-bold tracking-wider flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            GATEWAY LINK ACTIVE
          </span>
        </div>
      </div>

      {/* Main Grid Pane Configuration */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        
        {/* ZONE A: Sidebar Feed (1/3 viewport width) */}
        <div className="w-[340px] border-r border-slate-900 flex flex-col bg-slate-950 select-none">
          <div className="p-4 border-b border-slate-900">
            <span className="text-[10px] font-bold tracking-wider font-mono text-slate-500 uppercase">Exceptions Ingestion Feed</span>
            
            {/* Filter buttons matrix */}
            <div className="grid grid-cols-4 gap-1.5 mt-3 text-[10px] font-mono font-bold">
              {(['ALL', 'SOS', 'FRAUD', 'SILENCE'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setActiveFilter(filter)}
                  className={`py-1 rounded border text-center transition ${
                    activeFilter === filter
                      ? 'bg-slate-100 text-slate-950 border-slate-100'
                      : 'bg-slate-900/50 text-slate-400 border-slate-800 hover:bg-slate-900'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {filteredIncidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 border border-dashed border-slate-900 rounded-lg text-slate-500 text-xs italic p-4 text-center">
                All telemetry feeds stable. No unresolved exceptions matching active filters.
              </div>
            ) : (
              filteredIncidents.map((incident) => {
                const isSelected = selectedIncident?.order_id === incident.order_id;
                return (
                  <div
                    key={incident.order_id}
                    onClick={() => { setSelectedIncident(incident); setTerminalLog(null); }}
                    className={`relative p-4 rounded-lg border cursor-pointer transition text-left overflow-hidden ${
                      isSelected
                        ? 'bg-slate-900 border-slate-700 shadow-lg'
                        : 'bg-slate-950 border-slate-900 hover:bg-slate-900/30'
                    }`}
                  >
                    {/* Visual left edge warning strip */}
                    <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${
                      incident.incident_type === 'SOS' 
                        ? 'bg-rose-500 animate-pulse' 
                        : incident.incident_type === 'FRAUD' 
                        ? 'bg-amber-500' 
                        : 'bg-sky-500'
                    }`} />

                    <div className="pl-2.5">
                      <div className="flex justify-between items-start">
                        <span className="text-xs font-bold text-slate-200">{incident.driver_name}</span>
                        <span className="text-[9px] font-mono bg-slate-900 text-slate-400 border border-slate-800 px-1.5 py-0.5 rounded">
                          {incident.city_prefix}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className={`text-[9px] font-bold font-mono border px-1.5 py-0.5 rounded ${getIncidentBadgeColor(incident.incident_type)}`}>
                          {getIncidentTypeLabel(incident.incident_type).toUpperCase()}
                        </span>
                        
                        {incident.incident_status === 'INVESTIGATING' ? (
                          <span className="text-[8px] font-bold font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-1.5 py-0.5 rounded animate-pulse">
                            INVESTIGATING
                          </span>
                        ) : (
                          <span className="text-[8px] font-bold font-mono bg-slate-900 text-rose-500 border border-slate-800 px-1.5 py-0.5 rounded animate-pulse">
                            UNASSIGNED
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-3 text-[10px] font-mono text-slate-500 border-t border-slate-900/60 pt-2">
                        <div>
                          Ping: <strong className="text-slate-400">{incident.seconds_since_last_ping}s ago</strong>
                        </div>
                        <div>
                          Plate: <strong className="text-slate-400">{incident.license_plate}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Dynamic Right Split Pane (Zone B & C Combined) */}
        <div className="flex-1 flex flex-col bg-slate-950 overflow-hidden">
          
          {/* ZONE B: Stark Minimalist Map Viewport (Canvas mapping) */}
          <div className="flex-1 min-h-[300px] border-b border-slate-900 relative">
            <canvas 
              ref={canvasRef} 
              width={700}
              height={450}
              className="w-full h-full block"
            />
            {selectedIncident && (
              <div className="absolute top-4 left-4 bg-slate-950/90 border border-slate-800 px-3.5 py-2.5 rounded-lg text-xs font-mono space-y-1 z-10 text-left shadow-lg">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Telemetry Vectors</div>
                <div>Status: <span className="text-slate-200">{selectedIncident.last_known_status}</span></div>
                <div>Lat: <span className="text-slate-200">{selectedIncident.latitude.toFixed(6)}</span></div>
                <div>Lng: <span className="text-slate-200">{selectedIncident.longitude.toFixed(6)}</span></div>
              </div>
            )}
          </div>

          {/* ZONE C: Telemetry Health Grid & Intervention Auditing Panel */}
          <div className="h-[280px] bg-slate-950 p-6 flex flex-col justify-between overflow-y-auto">
            {selectedIncident ? (
              <div className="flex-1 flex flex-col justify-between text-left space-y-4">
                <div className="grid grid-cols-3 gap-6">
                  
                  {/* Telemetry Health Grid Readout */}
                  <div className="col-span-1 space-y-3.5 border-r border-slate-900 pr-4">
                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">Telemetry Health Metrics</div>
                    
                    <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                      <div className="bg-slate-900/40 border border-slate-900 p-2.5 rounded-md">
                        <div className="text-[9px] text-slate-500 font-bold">CALCULATED SPEED</div>
                        <div className={`text-sm font-bold mt-1 ${selectedIncident.calculated_speed > 100 ? 'text-amber-500 animate-pulse' : 'text-slate-200'}`}>
                          {selectedIncident.calculated_speed.toFixed(1)} km/h
                        </div>
                      </div>
                      
                      <div className="bg-slate-900/40 border border-slate-900 p-2.5 rounded-md">
                        <div className="text-[9px] text-slate-500 font-bold">BEARING DELTA</div>
                        <div className="text-sm font-bold text-slate-200 mt-1">
                          {selectedIncident.bearing_delta.toFixed(1)}°
                        </div>
                      </div>

                      <div className="bg-slate-900/40 border border-slate-900 p-2.5 rounded-md">
                        <div className="text-[9px] text-slate-500 font-bold">DEVICE BATTERY</div>
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <div className="w-full bg-slate-800 rounded-full h-1.5">
                            <div 
                              className={`h-1.5 rounded-full ${selectedIncident.battery_level < 30 ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                              style={{ width: `${selectedIncident.battery_level}%` }}
                            />
                          </div>
                          <span className="text-[9px] text-slate-300 font-bold">{selectedIncident.battery_level}%</span>
                        </div>
                      </div>

                      <div className="bg-slate-900/40 border border-slate-900 p-2.5 rounded-md">
                        <div className="text-[9px] text-slate-500 font-bold">MOCK PROVIDER</div>
                        <div className="mt-1">
                          {selectedIncident.is_mock_provider ? (
                            <span className="text-[9px] font-bold text-rose-400 bg-rose-950/40 border border-rose-900 px-1.5 py-0.5 rounded animate-pulse">
                              MOCKING DETECTED
                            </span>
                          ) : (
                            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-900 px-1.5 py-0.5 rounded">
                              GENUINE GPS
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Operational Claim controls */}
                  <div className="col-span-1 border-r border-slate-900 pr-4 flex flex-col justify-between">
                    <div>
                      <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">Claim Ownership Status</div>
                      <div className="mt-4 text-xs font-mono">
                        {selectedIncident.incident_status === 'UNASSIGNED' ? (
                          <div className="space-y-3">
                            <div className="text-rose-400 font-bold flex items-center gap-1.5 animate-pulse">
                              <span>⚠️</span> ALERT REQUIRES COMMAND TAKEOVER
                            </div>
                            <button
                              onClick={() => executeClaimIncident(selectedIncident.order_id)}
                              disabled={isMutating}
                              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 rounded-lg transition active:scale-95 text-xs font-mono uppercase tracking-wider"
                            >
                              CLAIM INCIDENT MUTEX
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="text-indigo-400 font-bold flex items-center gap-1.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                              INVESTIGATION IN PROGRESS
                            </div>
                            <div className="bg-slate-900 border border-slate-900 p-3 rounded-lg text-slate-300">
                              Agent: <strong className="text-white font-mono">{selectedIncident.assigned_agent_id}</strong>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {terminalLog && (
                      <div className={`p-2 rounded text-[9px] font-mono font-bold uppercase tracking-wider text-center ${
                        terminalLog.startsWith('SUCCESS') ? 'bg-emerald-950/20 text-emerald-400 border border-emerald-900/30' : 'bg-rose-950/20 text-rose-400 border border-rose-900/30'
                      }`}>
                        {terminalLog}
                      </div>
                    )}
                  </div>

                  {/* Actions & Justification note inputs */}
                  <div className="col-span-1 flex flex-col justify-between h-full">
                    <div className="space-y-2">
                      <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider font-mono">Intervention Logs Justification</div>
                      <textarea
                        disabled={isMutating}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="State audit reasons before dispatching destructive database resets..."
                        className="w-full h-20 bg-slate-950 border border-slate-800 focus:border-slate-700 rounded-lg p-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none transition resize-none font-mono"
                      />
                    </div>

                    <div className="space-y-2 mt-2">
                      <SlideToConfirm
                        key={`abort-${selectedIncident.order_id}`}
                        label="Slide to Force-Cancel Trip"
                        confirmedLabel="Trip Terminated — Committing"
                        tone="destructive"
                        disabled={isMutating || selectedIncident.incident_status === 'UNASSIGNED'}
                        onConfirm={() => dispatchRecoveryAction('FORCE_ABORT')}
                      />
                      <SlideToConfirm
                        key={`rematch-${selectedIncident.order_id}`}
                        label="Slide to Evict & Re-match"
                        confirmedLabel="Evicting Driver — Re-matching"
                        tone="neutral"
                        disabled={isMutating || selectedIncident.incident_status === 'UNASSIGNED'}
                        onConfirm={() => dispatchRecoveryAction('FORCE_REMATCH')}
                      />
                    </div>
                  </div>

                </div>
              </div>
            ) : (
              <div className="flex-grow flex flex-col items-center justify-center text-slate-500 italic text-xs font-mono">
                SELECT A STRANDED TELEMETRY STREAM FROM THE INGESTION FEED QUEUE TO EVALUATE RECOVERY ACTIONS.
              </div>
            )}
          </div>

        </div>

      </div>

      {/* Global SOS Takeover Modal Layer */}
      {takeoverIncident && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex items-center justify-center z-50 p-6 animate-fade-in select-none">
          <div className="w-[500px] bg-slate-900 border-2 border-rose-600 rounded-xl overflow-hidden shadow-2xl animate-scale-up text-left">
            
            <div className="bg-rose-950/60 border-b border-rose-900/50 p-4 flex items-center gap-3">
              <span className="relative flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-rose-500"></span>
              </span>
              <span className="text-sm font-bold tracking-widest font-mono text-rose-500">
                CRITICAL SOS PANIC ALARM DETECTED
              </span>
            </div>

            <div className="p-6 space-y-4 font-mono text-xs text-slate-300">
              <p className="text-slate-400">
                An unassigned passenger/driver panic event trigger is currently routing. Automatic matches are suspended for this order id. Immediate manual intervention is required.
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-slate-500">ORDER ID:</span>
                  <span className="text-white font-bold select-all">{takeoverIncident.order_id}</span>
                  
                  <span className="text-slate-500">DRIVER NAME:</span>
                  <span className="text-white font-bold">{takeoverIncident.driver_name}</span>

                  <span className="text-slate-500">CUSTOMER:</span>
                  <span className="text-white font-bold">{takeoverIncident.customer_name}</span>

                  <span className="text-slate-500">VEHICLE PLATE:</span>
                  <span className="text-white font-bold">{takeoverIncident.license_plate}</span>

                  <span className="text-slate-500">CITY SHARD:</span>
                  <span className="text-white font-bold">{takeoverIncident.city_prefix}</span>
                </div>
              </div>

              <div className="border-t border-slate-800 pt-4 space-y-3">
                <button
                  onClick={() => executeClaimIncident(takeoverIncident.order_id)}
                  disabled={isMutating}
                  className="w-full bg-rose-600 hover:bg-rose-700 border border-rose-500/20 text-white font-bold py-3 rounded-lg text-xs uppercase tracking-widest transition duration-150 cursor-pointer active:scale-98 select-none"
                >
                  {isMutating ? 'ACQUIRING COMMAND LOCK...' : 'ACKNOWLEDGE & CLAIM INCIDENT'}
                </button>
                
                <button
                  onClick={() => setTakeoverIncident(null)}
                  className="w-full bg-slate-950 hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-white py-2 rounded-lg text-[10px] uppercase tracking-wider transition duration-150 cursor-pointer select-none"
                >
                  Bypass Notification (Acknowledge Manually)
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
