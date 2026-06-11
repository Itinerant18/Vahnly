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

  const handleEnforceFreeze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCellToken) return;
    if (!window.confirm(
      `Freeze pricing for zone ${selectedCellToken}?\n\n` +
      `This overrides live surge for the zone and affects every rider fare estimate ` +
      `there until the freeze is lifted.`
    )) {
      return;
    }

    setIsProcessing(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/pricing/freeze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          city_prefix: cityPrefix,
          h3_cell: selectedCellToken,
          max_multiplier: maxMultiplier,
          duration_minutes: durationMinutes,
        }),
      });

      if (response.ok) {
        setStatusMessage({
          type: 'SUCCESS',
          text: `Deflation engaged: ${selectedCellToken} capped at ${maxMultiplier}x for ${durationMinutes} mins.`,
        });
        onOverrideExecuted();
      } else {
        setStatusMessage({
          type: 'ERROR',
          text: 'Override rejected: Ensure your profile carries MARKET_CONTROLLER clearance tokens.',
        });
      }
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Network timeout executing emergency database override.' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-canvas-softer rounded-lg p-4 border border-canvas-soft flex flex-col gap-3">
      <div className="text-left">
        <h2 className="text-sm font-bold text-ink">Price Control Valve</h2>
        <p className="text-[11px] text-body mt-0.5">Cap surge during disruptions</p>
      </div>

      {selectedCellToken ? (
        <form onSubmit={handleEnforceFreeze} className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">
              Selected H3 Cell
            </label>
            <div className="font-mono text-[11px] text-ink bg-canvas-soft border border-canvas-soft rounded-md p-2 select-all truncate">
              {selectedCellToken}
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">
              Max Multiplier ({maxMultiplier}x)
            </label>
            <input
              type="range"
              min="1.0"
              max="4.0"
              step="0.1"
              className="w-full accent-black bg-canvas-soft h-1 rounded-lg appearance-none cursor-pointer"
              value={maxMultiplier}
              onChange={(e) => setMaxMultiplier(parseFloat(e.target.value))}
              disabled={isProcessing}
            />
            <div className="flex justify-between text-[9px] font-mono font-bold text-mute mt-1 uppercase">
              <span>1.0x</span>
              <span>2.5x</span>
              <span>4.0x</span>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider font-bold text-body mb-1">
              Expiration TTL
            </label>
            <select
              className="w-full bg-canvas-soft border border-canvas-soft rounded-md p-2 text-[11px] font-bold text-ink focus:outline-none focus:border-ink cursor-pointer"
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
            className="w-full bg-ink hover:bg-black-elevated disabled:opacity-40 text-white font-bold py-2.5 px-4 rounded-md transition text-[11px] uppercase tracking-wider cursor-pointer active:scale-[0.98]"
          >
            {isProcessing ? 'Deploying...' : 'Enforce Price Cap'}
          </button>
        </form>
      ) : (
        <div className="py-8 text-center text-[11px] text-mute bg-canvas-soft border border-dashed border-canvas-soft rounded-md flex items-center justify-center p-4">
          Click a hex cell on the map to engage pricing control.
        </div>
      )}

      {statusMessage && (
        <div className={`p-2.5 rounded-md text-[10px] text-left font-mono font-bold uppercase tracking-wider ${
          statusMessage.type === 'SUCCESS' ? 'bg-canvas-soft border border-surface-pressed text-status-online' : 'bg-canvas-soft border border-surface-pressed text-status-alert'
        }`}>
          {statusMessage.text}
        </div>
      )}
    </div>
  );
};
