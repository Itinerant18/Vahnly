import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../../config';
import { OdometerVerificationPanel } from './OdometerVerificationPanel';

interface DiscrepancyRecord {
  order_id: string;
  city_prefix: string;
  discrepancy_paise: number;
  entry_count: number;
}

export const LedgerReconciliation: React.FC = () => {
  const [discrepancies, setDiscrepancies] = useState<DiscrepancyRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<DiscrepancyRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Correction form states
  const [accountType, setAccountType] = useState<string>('PLATFORM_COMMISSION');
  const [entryType, setEntryType] = useState<'DEBIT' | 'CREDIT'>('CREDIT');
  const [adjustmentPaise, setAdjustmentPaise] = useState<number>(0);
  const [reason, setReason] = useState<string>('');
  const [auditLog, setAuditLog] = useState<string | null>(null);

  // Odometer audit gate: a flagged mileage variance must be signed off before the
  // ledger correction for that order can be committed.
  const [odoState, setOdoState] = useState<{ isFlagged: boolean; acknowledged: boolean }>({ isFlagged: false, acknowledged: false });
  const odoBlocks = odoState.isFlagged && !odoState.acknowledged;

  useEffect(() => {
    fetchLedgerDiscrepancies();
  }, []);

  const fetchLedgerDiscrepancies = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/ledger/discrepancies`);

      if (response.ok) {
        const data = await response.json();
        setDiscrepancies(data.discrepancies || []);
      } else if (import.meta.env.DEV) {
        // Dev-only sample: simulates a partial ledger write from a checkout failure.
        // Production must never inject a fake financial discrepancy as a real task.
        setDiscrepancies([
          {
            order_id: 'ord-3312-aa59-ff11',
            city_prefix: 'KOL',
            discrepancy_paise: 4500, // +₹45.00 positive variance
            entry_count: 3,
          },
        ]);
      } else {
        setDiscrepancies([]);
      }
    } catch (err) {
      console.error('Failed syncing financial balance sheet states:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectRecord = (rec: DiscrepancyRecord) => {
    setSelectedRecord(rec);
    setAuditLog(null);
    setOdoState({ isFlagged: false, acknowledged: false });
    // Autofill the absolute offset needed to balance the sequence
    setAdjustmentPaise(Math.abs(rec.discrepancy_paise));
    setEntryType(rec.discrepancy_paise > 0 ? 'CREDIT' : 'DEBIT');
  };

  const executeManualCorrectionEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecord || adjustmentPaise <= 0) return;
    if (!window.confirm(
      `Post ${entryType} of ₹${(adjustmentPaise / 100).toFixed(2)} to ${accountType} for order ${selectedRecord.order_id}?\n\n` +
      `This writes a money-moving entry to the immutable financial ledger.`
    )) {
      return;
    }
    setIsLoading(true);
    setAuditLog(null);

    try {
      const adminEmail = localStorage.getItem('admin_email') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/ledger/reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Email': adminEmail,
        },
        body: JSON.stringify({
          order_id: selectedRecord.order_id,
          city_prefix: selectedRecord.city_prefix,
          account_type: accountType,
          entry_type: entryType,
          amount_paise: adjustmentPaise,
          description: reason || 'Manual audit correction log offset transaction.',
        }),
      });

      if (response.status === 201) {
        setAuditLog('SUCCESS: Corrective adjustment posted. Transaction stream fully balanced.');
        setDiscrepancies(discrepancies.filter((d) => d.order_id !== selectedRecord.order_id));
        setSelectedRecord(null);
        setReason('');
      } else {
        setAuditLog('ERROR: Corrective insertion failed compliance gate conditions.');
      }
    } catch {
      setAuditLog('ERROR: Internal cluster gateway connection drop.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-background-tertiary rounded-xl p-6 border border-background-secondary space-y-6">
      <div>
        <h2 className="text-lg font-bold text-content-primary">Ledger reconciliation &amp; discrepancy explorer</h2>
        <p className="text-xs text-content-secondary">Isolates sharded order sequences where double-entry balances diverge from zero</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feed panel */}
        <div className="lg:col-span-1 space-y-3 max-h-[380px] overflow-y-auto pr-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-content-tertiary">Imbalance exceptions ({discrepancies.length})</div>
          {isLoading && discrepancies.length === 0 ? (
            <div className="py-12 text-center text-xs font-mono text-content-tertiary">Executing cluster audit...</div>
          ) : discrepancies.length === 0 ? (
            <div className="p-4 bg-background-primary border border-background-secondary rounded-xl text-center text-xs text-content-secondary">
              Absolute balance verified across all matching log pools. Zero leaks.
            </div>
          ) : (
            discrepancies.map((rec) => (
              <div
                key={rec.order_id}
                onClick={() => handleSelectRecord(rec)}
                className={`p-4 rounded-xl border transition text-left cursor-pointer relative overflow-hidden ${
                  selectedRecord?.order_id === rec.order_id
                    ? 'bg-content-primary border-content-primary text-gray-0'
                    : 'bg-background-primary border-background-secondary hover:bg-background-tertiary text-content-primary'
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className="text-xs font-mono font-bold">ID: {rec.order_id.slice(0, 13)}...</span>
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    selectedRecord?.order_id === rec.order_id
                      ? 'bg-gray-0 text-content-primary'
                      : 'bg-background-secondary text-status-negative'
                  }`}>
                    Δ ₹{(Math.abs(rec.discrepancy_paise) / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center mt-2 text-[10px] opacity-80">
                  <span>Hub: {rec.city_prefix}</span>
                  <span>Entries: {rec.entry_count} logs</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Balancing interface */}
        <div className="lg:col-span-2 bg-background-primary border border-background-secondary rounded-xl p-6 flex flex-col justify-between min-h-[380px]">
          {selectedRecord ? (
            <form onSubmit={executeManualCorrectionEntry} className="space-y-4 text-left flex-grow flex flex-col justify-between">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                {/* Exception summary */}
                <div className="space-y-3">
                  <div className="border-b border-background-secondary pb-2">
                    <span className="text-[10px] uppercase font-bold text-content-tertiary tracking-wider">Audit investigation target</span>
                    <div className="text-xs font-mono font-bold text-content-primary mt-1 select-all">{selectedRecord.order_id}</div>
                  </div>
                  <div className="text-[11px] space-y-1.5 text-content-secondary">
                    <div><span className="font-bold">Variance direction:</span> {selectedRecord.discrepancy_paise > 0 ? 'Positive debit excess' : 'Negative credit excess'}</div>
                    <div><span className="font-bold">Required balancing move:</span> <span className="font-mono text-content-primary font-bold">{selectedRecord.discrepancy_paise > 0 ? 'Post credit entry' : 'Post debit entry'}</span></div>
                    <div><span className="font-bold">Precise absolute error:</span> <span className="font-mono text-content-primary bg-background-tertiary border border-background-secondary px-1 rounded text-[10px]">{Math.abs(selectedRecord.discrepancy_paise)} Paise</span></div>
                  </div>
                </div>

                {/* Adjustment inputs */}
                <div className="space-y-3 bg-background-tertiary p-4 rounded-xl border border-background-secondary">
                  <div>
                    <label className="block text-[9px] uppercase tracking-wider font-bold text-content-tertiary mb-1">Target slice category</label>
                    <select
                      className="w-full bg-background-primary border border-background-secondary rounded-md p-2 text-xs font-bold text-content-primary focus:outline-none focus:border-content-primary cursor-pointer"
                      value={accountType}
                      onChange={(e) => setAccountType(e.target.value)}
                    >
                      <option value="PLATFORM_COMMISSION">Platform commission margin</option>
                      <option value="DRIVER_PAYOUT">Driver direct pay ledger</option>
                      <option value="CUSTOMER_ESCROW">Customer wallet accounts</option>
                      <option value="TAX_ESCROW">Regional tax reserve</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-content-tertiary mb-1">Entry vector</label>
                      <select
                        className="w-full bg-background-primary border border-background-secondary rounded-md p-2 text-xs font-bold text-content-primary focus:outline-none focus:border-content-primary cursor-pointer"
                        value={entryType}
                        onChange={(e) => setEntryType(e.target.value as 'DEBIT' | 'CREDIT')}
                      >
                        <option value="DEBIT">DEBIT (+)</option>
                        <option value="CREDIT">CREDIT (-)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider font-bold text-content-tertiary mb-1">Value (Paise)</label>
                      <input
                        type="number"
                        className="w-full bg-background-primary border border-background-secondary rounded-md p-2 text-xs font-mono font-bold text-content-primary focus:outline-none focus:border-content-primary"
                        value={adjustmentPaise}
                        onChange={(e) => setAdjustmentPaise(parseInt(e.target.value, 10) || 0)}
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Justification */}
              <div className="pt-2">
                <label className="block text-[10px] uppercase tracking-wider font-bold text-content-secondary mb-1.5">Adjustment audit narrative</label>
                <input
                  type="text"
                  className="w-full bg-background-tertiary border border-background-secondary focus:border-content-primary rounded-md p-2.5 text-xs text-content-primary focus:outline-none transition"
                  placeholder="e.g. Offset manual credit adjustment for payment gateway webhook signature delay mismatch."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </div>

              {/* Odometer / mileage audit for this trip — gates the ledger commit. */}
              <OdometerVerificationPanel
                key={selectedRecord.order_id}
                orderId={selectedRecord.order_id}
                onAuditState={setOdoState}
              />

              <div className="border-t border-background-secondary pt-4 mt-2">
                <button
                  type="submit"
                  disabled={isLoading || adjustmentPaise <= 0 || odoBlocks}
                  className="w-full bg-content-primary hover:bg-gray-800 disabled:opacity-40 text-gray-0 font-medium py-3 px-4 rounded-pill transition text-xs uppercase tracking-wider cursor-pointer active:scale-95 select-none"
                >
                  Commit balancing log entry
                </button>
                {odoBlocks && (
                  <p className="mt-2 text-[10px] text-status-negative font-medium text-center">
                    Mileage variance flagged — inspect the odometer photos and sign off above before committing.
                  </p>
                )}
              </div>
            </form>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center text-content-secondary text-xs text-center px-6">
              Select an isolated variance entry from the feed to review transaction splits and execute balancing operations.
            </div>
          )}

          {auditLog && (
            <div className={`mt-4 p-3 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider text-center ${
              auditLog.startsWith('SUCCESS') ? 'bg-background-secondary border border-border-opaque text-status-online' : 'bg-background-secondary border border-border-opaque text-status-negative'
            }`}>
              {auditLog}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
