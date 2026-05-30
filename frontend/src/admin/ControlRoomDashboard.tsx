import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL, ANALYTICS_SSE_BASE_URL } from '../config';

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

export const ControlRoomDashboard: React.FC = () => {
  const [spatialHeatmap, setSpatialHeatmap] = useState<Record<string, number>>({});
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [isBalanced, setIsBalanced] = useState<boolean>(true);
  const [targetDriverID, setTargetDriverID] = useState<string>('');
  const [overrideState, setOverrideState] = useState<string>('ONLINE_AVAILABLE');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [actionMessage, setActionMessage] = useState<string>('');

  const [adminToken, setAdminToken] = useState<string>(localStorage.getItem('admin_jwt_token') ?? '');
  const [authInput, setAuthInput] = useState<string>('');
  const [isAuthError, setIsAuthError] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');

  useEffect(() => {
    if (!adminToken) {
      setIsAuthError(true);
      return;
    }

    // Milestone 19 high-velocity Server-Sent Events stream.
    const eventSource = new EventSource(`${ANALYTICS_SSE_BASE_URL}/api/v1/analytics/heatmap`);

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

    fetchLedgerLogs();

    return () => {
      eventSource.close();
    };
  }, [adminToken]);

  const fetchLedgerLogs = async (): Promise<void> => {
    const token = localStorage.getItem('admin_jwt_token');
    if (!token) {
      setIsAuthError(true);
      return;
    }

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/ledger`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.status === 401 || response.status === 403) {
        setIsAuthError(true);
        setAuthError('Authentication rejected: Please provide a valid ADMIN access token.');
        return;
      }

      const data = await response.json();
      setLedgerEntries(data.entries || []);
      setIsBalanced(Boolean(data.is_auditable_balanced));
      setIsAuthError(false);
      setAuthError('');
    } catch (err) {
      console.error('Failed fetching ledger data logs:', err);
    }
  };

  const handleAuthenticate = (e: React.FormEvent) => {
    e.preventDefault();
    const token = authInput.trim();
    if (!token) return;

    localStorage.setItem('admin_jwt_token', token);
    setAdminToken(token);
    setIsAuthError(false);
    setAuthError('');
    setTimeout(() => {
      fetchLedgerLogs();
    }, 100);
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_jwt_token');
    setAdminToken('');
    setAuthInput('');
    setIsAuthError(true);
    setAuthError('');
  };

  const executeManualDriverOverride = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!targetDriverID) return;

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/override`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('admin_jwt_token') ?? ''}`,
        },
        body: JSON.stringify({
          driver_id: targetDriverID,
          target_state: overrideState,
          reason: overrideReason,
        }),
      });

      if (response.ok) {
        setActionMessage(`SUCCESS: Driver ${targetDriverID.slice(0, 8)} forced to ${overrideState}`);
        setTargetDriverID('');
        setOverrideReason('');
      } else {
        setActionMessage('ERROR: Override action failed validation gates.');
      }
    } catch {
      setActionMessage('ERROR: Communication timeout error.');
    }
  };

  if (isAuthError || !adminToken) {
    return (
      <div className="min-h-screen bg-white text-ink flex items-center justify-center p-6 font-sans selection:bg-black selection:text-white">
        <div className="w-full max-w-md bg-canvas-softer rounded-xl p-8 border border-canvas-soft shadow-sm relative overflow-hidden">
          
          <div className="text-center mb-8 relative">
            <h1 className="text-3xl font-bold tracking-tight text-ink font-move">
              drivers-for-u
            </h1>
            <p className="text-body text-xs mt-2 font-medium">Operations Dashboard Security Gateway</p>
          </div>

          <form onSubmit={handleAuthenticate} className="space-y-6 relative">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-3">
                Administrative Access Token
              </label>
              <textarea
                className="w-full h-24 bg-white border border-canvas-soft focus:border-ink rounded-xl p-3 text-xs font-mono text-ink placeholder-mute focus:outline-none focus:ring-1 focus:ring-ink transition resize-none"
                placeholder="Paste your signed ADMIN JWT access token here..."
                value={authInput}
                onChange={(e) => setAuthInput(e.target.value)}
                required
              />
            </div>

            {authError && (
              <div className="p-3 bg-black text-white rounded-xl text-[10px] font-bold uppercase tracking-wider text-center">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-black hover:bg-black-elevated text-white font-bold py-3.5 px-4 rounded-full transition text-xs uppercase tracking-wider active:scale-[0.98] cursor-pointer"
            >
              Unlock Control Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-ink p-6 md:p-12 font-sans selection:bg-black selection:text-white">
      <header className="mb-8 border-b border-canvas-soft pb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink font-move">drivers-for-u</h1>
          <p className="text-body text-xs mt-0.5">Centralized operations control room panel (region: kol)</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={`px-4 py-2 rounded-full font-mono text-[10px] font-bold tracking-wider uppercase ${
              isBalanced
                ? 'bg-canvas-soft border border-surface-pressed text-ink'
                : 'bg-black border border-black text-white'
            }`}
          >
            {isBalanced ? '● ledger balance sheet stable' : '▲ ledger imbalance detected'}
          </div>
          <button
            onClick={handleLogout}
            className="bg-white hover:bg-canvas-softer text-[10px] font-bold py-2.5 px-5 rounded-full border border-canvas-soft text-ink uppercase tracking-wider transition active:scale-95 cursor-pointer"
          >
            Lock Terminal
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Col 1: Real-Time Spatial Density Stream Map View */}
        <div className="bg-canvas-softer rounded-xl p-6 border border-canvas-soft shadow-sm flex flex-col justify-between min-h-[450px]">
          <div>
            <h2 className="text-lg font-bold mb-4 text-ink font-move flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-black opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-black"></span>
              </span>
              Live H3 cell supply density
            </h2>
            <div className="space-y-3 max-h-[340px] overflow-y-auto pr-2">
              {Object.keys(spatialHeatmap).length === 0 ? (
                <p className="text-body italic text-xs leading-relaxed">Awaiting live coordinate streams from fleet grid...</p>
              ) : (
                Object.entries(spatialHeatmap).map(([cellIndex, densityCount]) => (
                  <div
                    key={cellIndex}
                    className="flex justify-between items-center bg-white p-3.5 rounded-xl border border-canvas-soft font-mono text-xs text-ink"
                  >
                    <span>
                      Hex: <span className="font-bold">{cellIndex}</span>
                    </span>
                    <span className="bg-black text-white px-2.5 py-1 rounded-full text-[10px] font-bold select-none">
                      {densityCount} drivers
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="text-[10px] text-mute font-bold uppercase tracking-wider pt-4 border-t border-canvas-soft/40">
            stream feed active (kol)
          </div>
        </div>

        {/* Col 2: High-Priority Manual Override Management Control Engine */}
        <div className="bg-canvas-softer rounded-xl p-6 border border-canvas-soft shadow-sm flex flex-col justify-between min-h-[450px]">
          <div>
            <h2 className="text-lg font-bold mb-4 text-ink font-move">Driver state override</h2>
            <form onSubmit={executeManualDriverOverride} className="space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Target Driver UUID</label>
                <input
                  type="text"
                  className="w-full bg-white border border-canvas-soft rounded-xl p-3 text-xs font-mono text-ink placeholder-mute focus:outline-none focus:border-ink"
                  placeholder="e.g. a0eebc99-9c0b-4ef8-..."
                  value={targetDriverID}
                  onChange={(e) => setTargetDriverID(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">State promotion</label>
                <select
                  className="w-full bg-white border border-canvas-soft rounded-xl p-3 text-xs font-bold text-ink focus:outline-none focus:border-ink cursor-pointer"
                  value={overrideState}
                  onChange={(e) => setOverrideState(e.target.value)}
                >
                  <option value="ONLINE_AVAILABLE">ONLINE_AVAILABLE (Release to pool)</option>
                  <option value="OFFLINE">OFFLINE (Disconnect device)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-2">Justification reason</label>
                <input
                  type="text"
                  className="w-full bg-white border border-canvas-soft rounded-xl p-3 text-xs text-ink placeholder-mute focus:outline-none focus:border-ink"
                  placeholder="Driver app state reset"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full bg-black hover:bg-black-elevated text-white font-bold py-3 px-4 rounded-full transition text-xs uppercase tracking-wider cursor-pointer"
              >
                Execute state override
              </button>
            </form>
          </div>
          {actionMessage && (
            <div
              className={`mt-4 p-3.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider ${
                actionMessage.startsWith('SUCCESS')
                  ? 'bg-canvas-soft border border-surface-pressed text-ink'
                  : 'bg-black border border-black text-white'
              }`}
            >
              {actionMessage}
            </div>
          )}
        </div>

        {/* Col 3: Double-Entry Financial Splits Audit Panel */}
        <div className="bg-canvas-softer rounded-xl p-6 border border-canvas-soft shadow-sm lg:col-span-3 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-lg font-bold text-ink font-move">Financial ledger splits auditor</h2>
              <p className="text-xs text-body">Immutable verification matrices for regional transactions</p>
            </div>
            <button
              onClick={fetchLedgerLogs}
              className="bg-white hover:bg-canvas-softer text-[10px] font-bold py-2 px-5 rounded-full border border-canvas-soft text-ink uppercase tracking-wider transition duration-200 cursor-pointer"
            >
              Refresh Table
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-canvas-soft bg-white">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead>
                <tr className="bg-canvas-softer text-mute uppercase text-[9px] font-bold border-b border-canvas-soft">
                  <th className="p-4">Transaction ID</th>
                  <th className="p-4">Region</th>
                  <th className="p-4">Split account category</th>
                  <th className="p-4">Entry type</th>
                  <th className="p-4 text-right">Value (INR Paise)</th>
                  <th className="p-4">Trace audit log</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-canvas-soft text-ink">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-body italic leading-relaxed">
                      Zero completed transaction logs found on regional systems.
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-canvas-softer/50 transition">
                      <td className="p-4 text-body">{entry.order_id.slice(0, 18)}...</td>
                      <td className="p-4">
                        <span className="bg-canvas-soft border border-surface-pressed text-ink px-2 py-0.5 rounded text-[10px] font-bold select-none">{entry.city_prefix}</span>
                      </td>
                      <td className="p-4 font-bold text-body">{entry.account_type}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                            entry.entry_type === 'DEBIT' ? 'bg-black text-white' : 'bg-canvas-soft border border-surface-pressed text-ink'
                          }`}
                        >
                          {entry.entry_type}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold">
                        ₹{(entry.amount_paise / 100).toFixed(2)}
                      </td>
                      <td className="p-4 text-body text-xs italic">{entry.description}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};
