import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../config';

export interface DriverComplianceProfile {
  id: string;
  name: string;
  phone: string;
  license_number: string;
  city_prefix: string;
  has_manual_certification: boolean;
  has_automatic_certification: boolean;
  is_luxury_qualified: boolean;
  background_check_status: 'PENDING' | 'CLEARED' | 'FLAGGED';
  current_state: 'PENDING_VERIFICATION' | 'OFFLINE' | 'ONLINE_AVAILABLE';
  applied_at: string;
}

export const DriverVerificationQueue: React.FC = () => {
  const [applicants, setApplicants] = useState<DriverComplianceProfile[]>([]);
  const [selectedDriver, setSelectedDriver] = useState<DriverComplianceProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ status: 'SUCCESS' | 'ERROR'; text: string } | null>(null);

  // Load pending applicants into workspace view boundary
  useEffect(() => {
    fetchPendingApplicants();
  }, []);

  const fetchPendingApplicants = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setApplicants(data.drivers || []);
      } else {
        // Fallback placeholder data matching core platform database definitions for offline testing
        setApplicants([
          {
            id: 'drv-8932-a9b',
            name: 'Rohan Sharma',
            phone: '+91 98300 12345',
            license_number: 'WB-01-2024-00987',
            city_prefix: 'KOL',
            has_manual_certification: true,
            has_automatic_certification: true,
            is_luxury_qualified: false,
            background_check_status: 'PENDING',
            current_state: 'PENDING_VERIFICATION',
            applied_at: new Date().toISOString(),
          },
          {
            id: 'drv-4122-f89',
            name: 'Ananya Chatterjee',
            phone: '+91 98311 54321',
            license_number: 'WB-02-2023-11245',
            city_prefix: 'KOL',
            has_manual_certification: false,
            has_automatic_certification: true,
            is_luxury_qualified: true,
            background_check_status: 'CLEARED',
            current_state: 'PENDING_VERIFICATION',
            applied_at: new Date(Date.now() - 86400000).toISOString(),
          }
        ]);
      }
    } catch (err) {
      console.error('Failed communicating with verification gateway endpoints:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleCapability = (field: 'has_manual_certification' | 'has_automatic_certification' | 'is_luxury_qualified') => {
    if (!selectedDriver) return;
    setSelectedDriver({
      ...selectedDriver,
      [field]: !selectedDriver[field]
    });
  };

  const handleUpdateBackgroundStatus = (status: 'PENDING' | 'CLEARED' | 'FLAGGED') => {
    if (!selectedDriver) return;
    setSelectedDriver({
      ...selectedDriver,
      background_check_status: status
    });
  };

  const submitVerificationDecision = async (approve: boolean) => {
    if (!selectedDriver) return;
    setIsLoading(true);
    setMessage(null);

    try {
      const token = localStorage.getItem('admin_jwt_token') ?? '';
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/drivers/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          driver_id: selectedDriver.id,
          approve: approve,
          has_manual_certification: selectedDriver.has_manual_certification,
          has_automatic_certification: selectedDriver.has_automatic_certification,
          is_luxury_qualified: selectedDriver.is_luxury_qualified,
          background_check_status: selectedDriver.background_check_status
        })
      });

      if (response.ok) {
        setMessage({
          status: 'SUCCESS',
          text: `Driver ${selectedDriver.name} successfully ${approve ? 'APPROVED and released to OFFLINE pool' : 'REJECTED'}`
        });
        // Remove processed driver record from active local state array
        setApplicants(applicants.filter(a => a.id !== selectedDriver.id));
        setSelectedDriver(null);
      } else {
        setMessage({ status: 'ERROR', text: 'Verification update rejected by system compliance gates.' });
      }
    } catch {
      setMessage({ status: 'ERROR', text: 'Gateway communication timeout occurred.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-canvas-softer rounded-lg p-6 border border-canvas-soft shadow-sm space-y-6 lg:col-span-3">
      <div>
        <h2 className="text-lg font-bold text-ink">Driver Compliance & Onboarding Queue</h2>
        <p className="text-xs text-body">Certify vehicle handling capabilities and run background check clearances</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Driver Applicants List Selection Grid */}
        <div className="lg:col-span-1 space-y-3 max-h-[400px] overflow-y-auto pr-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-mute">
            Pending Review ({applicants.length})
          </div>
          {applicants.length === 0 ? (
            <div className="p-4 bg-canvas-softer border border-canvas-soft rounded-lg text-center text-xs text-body italic">
              Verification queue cleared. Zero pending applications.
            </div>
          ) : (
            applicants.map((driver) => (
              <div
                key={driver.id}
                onClick={() => setSelectedDriver(driver)}
                className={`p-4 rounded-lg border transition cursor-pointer text-left ${
                  selectedDriver?.id === driver.id
                    ? 'bg-canvas-soft border-l-2 border-ink text-ink'
                    : 'bg-canvas-softer border-canvas-soft hover:bg-canvas-softer text-ink'
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className="text-xs font-bold">{driver.name}</span>
                  <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    selectedDriver?.id === driver.id ? 'bg-canvas-soft text-ink' : 'bg-canvas-soft text-ink'
                  }`}>
                    {driver.city_prefix}
                  </span>
                </div>
                <div className={`text-[10px] mt-1 ${selectedDriver?.id === driver.id ? 'text-body' : 'text-body'}`}>
                  Lic: {driver.license_number}
                </div>
                <div className="mt-2 flex gap-1.5 flex-wrap">
                  {driver.background_check_status === 'CLEARED' && (
                    <span className="bg-canvas-soft text-status-online rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide">
                      ✓ Background Pass
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right Column: Interactive Document & Certification Review Dashboard */}
        <div className="lg:col-span-2 bg-canvas-softer border border-canvas-soft rounded-lg p-6 flex flex-col justify-between min-h-[400px]">
          {selectedDriver ? (
            <div className="space-y-6 flex-grow flex flex-col justify-between text-left">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Profile Identity Meta Cards */}
                <div className="space-y-4">
                  <div className="border-b border-canvas-soft pb-3">
                    <div className="text-[10px] uppercase font-bold text-mute tracking-wider">Applicant Identity</div>
                    <div className="text-base font-bold text-ink mt-1">{selectedDriver.name}</div>
                    <div className="text-xs text-body font-mono mt-0.5">{selectedDriver.phone}</div>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div><span className="font-bold text-body">License ID:</span> <span className="font-mono text-ink">{selectedDriver.license_number}</span></div>
                    <div><span className="font-bold text-body">Registered Hub:</span> <span className="font-mono text-ink">{selectedDriver.city_prefix} Shard</span></div>
                    <div><span className="font-bold text-body">Submission:</span> <span className="text-ink">{new Date(selectedDriver.applied_at).toLocaleDateString()}</span></div>
                  </div>
                </div>

                {/* Capability Modification Control Plane */}
                <div className="space-y-4 bg-canvas-softer p-4 rounded-lg border border-canvas-soft">
                  <div className="text-[10px] uppercase font-bold text-mute tracking-wider mb-2">Transmission Asset Certifications</div>
                  
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-black h-4 w-4 rounded border-canvas-soft focus:ring-0"
                        checked={selectedDriver.has_manual_certification}
                        onChange={() => handleToggleCapability('has_manual_certification')}
                      />
                      <div className="text-xs">
                        <span className="font-bold block text-ink">Manual Transmission (MT)</span>
                        <span className="text-[10px] text-body block">Certified to handle manual gearboxes & clutches</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-black h-4 w-4 rounded border-canvas-soft focus:ring-0"
                        checked={selectedDriver.has_automatic_certification}
                        onChange={() => handleToggleCapability('has_automatic_certification')}
                      />
                      <div className="text-xs">
                        <span className="font-bold block text-ink">Automatic Transmission (AT/EV)</span>
                        <span className="text-[10px] text-body block">Certified for torque converters, CVTs, and Electric platforms</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-3 select-none cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-black h-4 w-4 rounded border-canvas-soft focus:ring-0"
                        checked={selectedDriver.is_luxury_qualified}
                        onChange={() => handleToggleCapability('is_luxury_qualified')}
                      />
                      <div className="text-xs">
                        <span className="font-bold block text-ink">Premium Asset Tier Qualification</span>
                        <span className="text-[10px] text-body block">Vetted for high-end luxury sports cars, imports, and hypercars</span>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Background Verification Selector Block */}
              <div className="border-t border-canvas-soft pt-4 mt-4">
                <div className="text-[10px] uppercase font-bold text-mute tracking-wider mb-3">Third-Party Background Investigation Clearance</div>
                <div className="flex gap-2">
                  {(['PENDING', 'CLEARED', 'FLAGGED'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => handleUpdateBackgroundStatus(status)}
                      className={`flex-1 py-2 px-3 text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg border transition ${
                        selectedDriver.background_check_status === status
                          ? 'bg-black border-black text-white'
                          : 'bg-white border-canvas-soft hover:bg-canvas-softer text-ink'
                      }`}
                    >
                      {status === 'CLEARED' ? '✓ CLEARED' : status === 'FLAGGED' ? '▲ FLAGGED' : '● PENDING'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Trigger Buttons Container */}
              <div className="border-t border-canvas-soft pt-4 mt-6 flex gap-3">
                <button
                  onClick={() => submitVerificationDecision(false)}
                  disabled={isLoading}
                  className="flex-1 bg-white hover:bg-canvas-softer text-ink border border-canvas-soft font-bold py-3 px-4 rounded-full transition text-xs uppercase tracking-wider cursor-pointer disabled:opacity-40"
                >
                  Reject Applicant
                </button>
                <button
                  onClick={() => submitVerificationDecision(true)}
                  disabled={isLoading || selectedDriver.background_check_status !== 'CLEARED'}
                  className="flex-1 bg-black hover:bg-black-elevated text-white font-bold py-3 px-4 rounded-full transition text-xs uppercase tracking-wider cursor-pointer disabled:opacity-40 select-none"
                  title={selectedDriver.background_check_status !== 'CLEARED' ? 'Requires Background Clearance First' : ''}
                >
                  Approve & Activate Driver
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center text-body italic text-xs">
              Select an applicant profile from the queue sidebar to begin compliance auditing.
            </div>
          )}

          {message && (
            <div className={`mt-4 p-3.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider ${
              message.status === 'SUCCESS' ? 'bg-canvas-soft border border-surface-pressed text-ink' : 'bg-black text-white'
            }`}>
              {message.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
