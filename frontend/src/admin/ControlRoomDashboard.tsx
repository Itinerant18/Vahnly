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

  useEffect(() => {
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
  }, []);

  const fetchLedgerLogs = async (): Promise<void> => {
    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/ledger`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('admin_jwt_token') ?? ''}` },
      });
      const data = await response.json();
      setLedgerEntries(data.entries || []);
      setIsBalanced(Boolean(data.is_auditable_balanced));
    } catch (err) {
      console.error('Failed fetching ledger data logs:', err);
    }
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

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-8 font-sans">
      <header className="mb-8 border-b border-slate-800 pb-4 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-emerald-400">DRIVERS-for-U</h1>
          <p className="text-slate-400 text-sm">Centralized Operations Control Room Panel (Region: KOL)</p>
        </div>
        <div
          className={`px-4 py-2 rounded-full font-mono text-xs font-bold ${
            isBalanced
              ? 'bg-emerald-950 text-emerald-400 border border-emerald-500'
              : 'bg-rose-950 text-rose-400 border border-rose-500'
          }`}
        >
          {isBalanced ? '● ALL LEDGER BALANCE SHEET AUDITS STABLE' : '▲ ATTENTION: LEDGER IMBALANCE DETECTED'}
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Col 1: Real-Time Spatial Density Stream Map View */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="animate-ping w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
            Live Regional H3 Cell Supply Heatmap
          </h2>
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
            {Object.keys(spatialHeatmap).length === 0 ? (
              <p className="text-slate-500 italic text-sm">Awaiting live coordinate streams from fleet grid...</p>
            ) : (
              Object.entries(spatialHeatmap).map(([cellIndex, densityCount]) => (
                <div
                  key={cellIndex}
                  className="flex justify-between items-center bg-slate-900 p-3 rounded-lg border border-slate-800 font-mono text-sm"
                >
                  <span className="text-slate-400">
                    Hex Cell: <span className="text-emerald-400 font-bold">{cellIndex}</span>
                  </span>
                  <span className="bg-emerald-950 text-emerald-400 px-3 py-1 rounded font-bold">
                    {densityCount} Drivers Active
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Col 2: High-Priority Manual Override Management Control Engine */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl">
          <h2 className="text-xl font-bold mb-4 text-amber-400">Driver State Super-Override Portal</h2>
          <form onSubmit={executeManualDriverOverride} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider font-bold text-slate-400 mb-2">Target Driver UUID</label>
              <input
                type="text"
                className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500"
                placeholder="e.g. a0eebc99-9c0b-4ef8-..."
                value={targetDriverID}
                onChange={(e) => setTargetDriverID(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider font-bold text-slate-400 mb-2">Target System State Promotion</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-sm font-bold text-slate-100 focus:outline-none focus:border-amber-500"
                value={overrideState}
                onChange={(e) => setOverrideState(e.target.value)}
              >
                <option value="ONLINE_AVAILABLE">ONLINE_AVAILABLE (Force Release to Pool)</option>
                <option value="OFFLINE">OFFLINE (Force Disconnect Device)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider font-bold text-slate-400 mb-2">Administrative Justification Reason</label>
              <input
                type="text"
                className="w-full bg-slate-900 border border-slate-700 rounded p-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                placeholder="Driver app lockup reset request"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-2.5 px-4 rounded transition text-sm uppercase tracking-wider"
            >
              Execute State Override
            </button>
          </form>
          {actionMessage && (
            <div
              className={`mt-4 p-3 rounded text-xs font-mono font-bold ${
                actionMessage.startsWith('SUCCESS')
                  ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-800'
                  : 'bg-rose-950/50 text-rose-400 border border-rose-800'
              }`}
            >
              {actionMessage}
            </div>
          )}
        </div>

        {/* Col 3: Double-Entry Financial Splits Audit Panel */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 shadow-xl lg:col-span-3">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Immutable Financial Ledger Splits Auditor</h2>
            <button
              onClick={fetchLedgerLogs}
              className="bg-slate-700 hover:bg-slate-600 text-xs font-bold py-1 px-3 rounded tracking-wider uppercase transition"
            >
              Refresh Audit Table
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm font-mono border-collapse">
              <thead>
                <tr className="bg-slate-900 text-slate-400 uppercase text-xs border-b border-slate-700">
                  <th className="p-3">Order Transaction ID</th>
                  <th className="p-3">Metropolitan Prefix</th>
                  <th className="p-3">Split Category Account Type</th>
                  <th className="p-3">Entry Option</th>
                  <th className="p-3 text-right">Value (INR Paise)</th>
                  <th className="p-3">Audit Log Trace Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate-500 italic">
                      Zero completed transaction logs found on system storage maps.
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-900/50 transition">
                      <td className="p-3 text-slate-300">{entry.order_id.slice(0, 18)}...</td>
                      <td className="p-3">
                        <span className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded text-xs">{entry.city_prefix}</span>
                      </td>
                      <td className="p-3 font-bold text-slate-400">{entry.account_type}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${
                            entry.entry_type === 'DEBIT' ? 'bg-rose-950 text-rose-400' : 'bg-emerald-950 text-emerald-400'
                          }`}
                        >
                          {entry.entry_type}
                        </span>
                      </td>
                      <td className={`p-3 text-right font-bold ${entry.entry_type === 'DEBIT' ? 'text-rose-400' : 'text-emerald-400'}`}>
                        ₹{(entry.amount_paise / 100).toFixed(2)}
                      </td>
                      <td className="p-3 text-slate-400 text-xs italic">{entry.description}</td>
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
