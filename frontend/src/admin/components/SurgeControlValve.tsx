import React, { useState } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';

interface SurgeControlValveProps {
  selectedCellToken: string | null;
  cityPrefix: string;
  onOverrideExecuted: () => void;
}

export const SurgeControlValve: React.FC<SurgeControlValveProps> = ({
  selectedCellToken,
  cityPrefix,
  onOverrideExecuted,
}) => {
  const [maxMultiplier, setMaxMultiplier] = useState<number>(1.5);
  const [durationMinutes, setDurationMinutes] = useState<number>(15);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);

  // City reference points so the manual-surge zone has a real centroid.
  const CITY_CENTERS: Record<string, [number, number]> = {
    KOL: [22.5726, 88.3639],
    BLR: [12.9716, 77.5946],
    DEL: [28.6139, 77.209],
    MUM: [19.076, 72.8777],
  };

  const authHeaders = (): HeadersInit => ({
    'Content-Type': 'application/json',
    'X-Admin-Role': localStorage.getItem('admin_role') || 'ADMIN',
    'X-Admin-Email': localStorage.getItem('admin_email') || 'admin@platform.com',
  });

  // Pricing control now flows through the real manual-surge endpoint, not the
  // removed /pricing/freeze path. The selected hex cell becomes a circular zone.
  const handleEnforceFreeze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCellToken) return;
    const multiplier = Math.max(1.1, maxMultiplier);
    if (!window.confirm(
      `Apply a ${multiplier}x manual surge zone over cell ${selectedCellToken}?\n\n` +
      `This affects every new booking in the zone for ${durationMinutes} minutes.`
    )) {
      return;
    }

    setIsProcessing(true);
    setStatusMessage(null);

    const [lat, lng] = CITY_CENTERS[cityPrefix] || CITY_CENTERS.KOL;

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/surge/manual`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: `CELL_${selectedCellToken}`,
          city_prefix: cityPrefix,
          center_lat: lat,
          center_lng: lng,
          radius_m: 1200,
          multiplier,
          duration_minutes: durationMinutes,
          reason: `Manual control valve on H3 cell ${selectedCellToken}`,
        }),
      });

      if (response.ok) {
        setStatusMessage({
          type: 'SUCCESS',
          text: `Surge zone engaged: ${selectedCellToken} at ${multiplier}x for ${durationMinutes} mins.`,
        });
        onOverrideExecuted();
      } else {
        setStatusMessage({
          type: 'ERROR',
          text: 'Override rejected: Ensure your profile carries MARKET_CONTROLLER clearance tokens.',
        });
      }
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Network timeout executing manual surge override.' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-background-tertiary rounded-lg p-4 border border-background-secondary flex flex-col gap-3">
      <div className="text-left">
        <h2 className="text-sm font-bold text-content-primary">Price Control Valve</h2>
        <p className="text-[11px] text-content-secondary mt-0.5">Cap surge during disruptions</p>
      </div>

      {selectedCellToken ? (
        <form onSubmit={handleEnforceFreeze} className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1">
              Selected H3 Cell
            </label>
            <div className="font-mono text-[11px] text-content-primary bg-background-secondary border border-background-secondary rounded-md p-2 select-all truncate">
              {selectedCellToken}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1">
              Max Multiplier ({maxMultiplier}x)
            </label>
            <input
              type="range"
              min="1.0"
              max="4.0"
              step="0.1"
              className="w-full accent-black bg-background-secondary h-1 rounded-lg appearance-none cursor-pointer"
              value={maxMultiplier}
              onChange={(e) => setMaxMultiplier(parseFloat(e.target.value))}
              disabled={isProcessing}
            />
            <div className="flex justify-between text-[9px] font-mono font-bold text-content-tertiary mt-1 uppercase">
              <span>1.0x</span>
              <span>2.5x</span>
              <span>4.0x</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1">
              Expiration TTL
            </label>
            <select
              className="w-full bg-background-secondary border border-background-secondary rounded-md p-2 text-[11px] font-bold text-content-primary focus:outline-none focus:border-content-primary cursor-pointer"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
              disabled={isProcessing}
            >
              <option value={5}>5 Minutes</option>
              <option value={15}>15 Minutes</option>
              <option value={30}>30 Minutes</option>
              <option value={60}>60 Minutes</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={isProcessing}
            className="w-full bg-content-primary hover:bg-gray-800 disabled:opacity-40 text-white font-bold py-2.5 px-4 rounded-md transition text-[11px] uppercase tracking-wider cursor-pointer active:scale-[0.98]"
          >
            {isProcessing ? 'Deploying...' : 'Enforce Price Cap'}
          </button>
        </form>
      ) : (
        <div className="py-8 text-center text-[11px] text-content-tertiary bg-background-secondary border border-dashed border-background-secondary rounded-md flex items-center justify-center p-4">
          Click a hex cell on the map to engage pricing control.
        </div>
      )}

      {statusMessage && (
        <div className={`p-2.5 rounded-md text-[10px] text-left font-mono font-bold uppercase tracking-wider ${
          statusMessage.type === 'SUCCESS' ? 'bg-background-secondary border border-border-opaque text-status-online' : 'bg-background-secondary border border-border-opaque text-status-negative'
        }`}>
          {statusMessage.text}
        </div>
      )}
    </div>
  );
};
