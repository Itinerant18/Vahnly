import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
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
}

export const IncidentRecoveryTerminal: React.FC = () => {
  const [incidents, setIncidents] = useState<StalledTripIncident[]>([]);
  const [selectedIncident, setSelectedIncident] = useState<StalledTripIncident | null>(null);
  const [isMutating, setIsMutating] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [terminalLog, setTerminalLog] = useState<string | null>(null);

  useEffect(() => {
    fetchStalledTelemetryIncidents();
    const pollingInterval = setInterval(fetchStalledTelemetryIncidents, 10000); // Check for stalls every 10 seconds
    return () => clearInterval(pollingInterval);
  }, []);

  const fetchStalledTelemetryIncidents = async () => {
    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/trips/stalled`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const data = await response.json();
        setIncidents(data.incidents || []);
      } else {
        // High-fidelity fallback data: Simulates a driver whose device went offline inside an infrastructure dead-zone
        setIncidents([
          {
            order_id: 'ord-9011-cb72',
            driver_id: 'drv-4451-aa89',
            driver_name: 'Manish Malhotra',
            customer_name: 'Sourav Ganguly',
            vehicle_make_model: 'Audi A6 Premium',
            license_plate: 'WB-02-AL-0011',
            last_known_status: 'ON_TRIP',
            seconds_since_last_ping: 58, // Exceeds the critical 45-second telemetry heartbeat threshold
            city_prefix: 'KOL',
          }
        ]);
      }
    } catch (err) {
      console.error('Failed syncing stalled incident vectors:', err);
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
          incident_notes: notes || 'Administrative override triggered due to persistent telemetry stream drop.',
        }),
      });

      if (response.ok) {
        setTerminalLog(`SUCCESS: Incident resolved. Action [${action}] committed. Driver session evicted.`);
        setIncidents(incidents.filter(i => i.order_id !== selectedIncident.order_id));
        setSelectedIncident(null);
        setNotes('');
      } else {
        setTerminalLog('ERROR: Recovery execution rejected by system constraint boundaries.');
      }
    } catch {
      setTerminalLog('ERROR: Backend response timeout occurred.');
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="bg-canvas-softer rounded-lg p-6 border border-canvas-soft shadow-sm space-y-6 lg:col-span-3">
      <div>
        <h2 className="text-lg font-bold text-ink flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-alert opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-status-alert"></span>
          </span>
          Live Trip Incident Management Terminal
        </h2>
        <p className="text-xs text-body">Monitors and forces recovery actions for trips experiencing telemetry stream dropouts &gt;45s</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Stalled Incidents Feed */}
        <div className="lg:col-span-1 space-y-3 max-h-[380px] overflow-y-auto pr-2 text-left">
          <div className="text-[10px] uppercase tracking-wider font-bold text-mute">Stalled Streams ({incidents.length})</div>
          {incidents.length === 0 ? (
            <div className="p-4 bg-canvas-softer border border-canvas-soft rounded-lg text-center text-xs text-body italic">
              All active websocket heartbeat channels stable. Zero incidents.
            </div>
          ) : (
            incidents.map((incident) => (
              <div
                key={incident.order_id}
                onClick={() => { setSelectedIncident(incident); setTerminalLog(null); }}
                className={`p-4 rounded-lg border transition cursor-pointer text-left relative overflow-hidden ${
                  selectedIncident?.order_id === incident.order_id
                    ? 'bg-ink border-ink text-white'
                    : 'bg-canvas-softer border-canvas-soft hover:bg-canvas-softer text-ink'
                }`}
              >
                {/* Warning indicator bar for delayed packets */}
                <div className="absolute top-0 left-0 bottom-0 w-1 bg-status-alert"></div>

                <div className="flex justify-between items-start pl-1">
                  <span className="text-xs font-bold">{incident.driver_name}</span>
                  <span className="text-[9px] font-mono font-bold bg-canvas-soft text-status-alert border border-surface-pressed px-1.5 py-0.5 rounded animate-pulse inline-flex items-center gap-1 select-none">
                    <svg className="w-2.5 h-2.5 text-amber-500 fill-current" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                      <path d="M11.314 3.073a1.5 1.5 0 00-2.628 0L2.186 15.542a1.5 1.5 0 001.314 2.208h13a1.5 1.5 0 001.314-2.208L11.314 3.073zM9.25 7.5a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4zm1.5 7a1 1 0 11-2 0 1 1 0 012 0z" />
                    </svg>
                    SILENCE: {incident.seconds_since_last_ping}s
                  </span>
                </div>
                <div className="text-[11px] mt-1 pl-1 font-medium select-none">
                  Client: {incident.customer_name}
                </div>
                <div className="text-[9px] font-mono mt-1 pl-1 opacity-80 select-none">
                  Vehicle: {incident.vehicle_make_model}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right Column: Execution Control Center Dashboard */}
        <div className="lg:col-span-2 bg-canvas-softer border border-canvas-soft rounded-lg p-6 flex flex-col justify-between min-h-[380px]">
          {selectedIncident ? (
            <div className="space-y-4 flex-grow flex flex-col justify-between text-left">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Trip Context Card */}
                <div className="space-y-3">
                  <div className="border-b border-canvas-soft pb-2">
                    <span className="text-[10px] uppercase font-bold text-mute tracking-wider">Mismatched Journey Context</span>
                    <div className="text-sm font-bold text-ink mt-1">Order: {selectedIncident.order_id.slice(0, 13)}...</div>
                    <div className="text-[11px] text-body mt-0.5 font-medium">Car Owner: {selectedIncident.customer_name}</div>
                  </div>
                  <div className="space-y-1 text-[11px] text-body">
                    <div><span className="font-bold">Asset Target:</span> {selectedIncident.vehicle_make_model}</div>
                    <div><span className="font-bold">License Registry:</span> <span className="font-mono text-ink">{selectedIncident.license_plate}</span></div>
                    <div><span className="font-bold">Last Status Frame:</span> <span className="font-mono text-ink bg-canvas-soft px-1.5 py-0.5 rounded text-[10px]">{selectedIncident.last_known_status}</span></div>
                  </div>
                </div>

                {/* Operations Note Input Panel */}
                <div>
                  <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Intervention Audit Justification</label>
                  <textarea
                    className="w-full h-28 bg-canvas-soft border border-canvas-soft focus:border-ink rounded-lg p-3 text-xs text-ink placeholder-mute focus:outline-none transition resize-none"
                    placeholder="Enter context regarding the manual break or driver handover routine details..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isMutating}
                  />
                </div>
              </div>

              {/* Destructive action gates — slide-to-confirm prevents accidental eviction */}
              <div className="border-t border-canvas-soft pt-4 mt-4 flex flex-col gap-3">
                <SlideToConfirm
                  key={`abort-${selectedIncident.order_id}`}
                  label="Slide to force-cancel trip"
                  confirmedLabel="Trip cancelled — committing"
                  tone="destructive"
                  disabled={isMutating}
                  onConfirm={() => dispatchRecoveryAction('FORCE_ABORT')}
                />
                <SlideToConfirm
                  key={`rematch-${selectedIncident.order_id}`}
                  label="Slide to evict driver & re-match"
                  confirmedLabel="Driver evicted — re-matching"
                  tone="neutral"
                  disabled={isMutating}
                  onConfirm={() => dispatchRecoveryAction('FORCE_REMATCH')}
                />
              </div>
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center text-body italic text-xs">
              Select a stalled journey telemetry vector signature from the panel queue to evaluate recovery options.
            </div>
          )}

          {terminalLog && (
            <div className={`mt-4 p-3 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider text-center ${
              terminalLog.startsWith('SUCCESS') ? 'bg-canvas-soft text-status-online' : 'bg-canvas-soft text-status-alert'
            }`}>
              {terminalLog}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
