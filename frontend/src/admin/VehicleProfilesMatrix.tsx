import React, { useState, useEffect } from 'react';
import { API_GATEWAY_BASE_URL } from '../config';

export interface CustomerVehicleProfile {
  id: string;
  owner_name: string;
  owner_phone: string;
  vehicle_make_model: string;
  license_plate: string;
  transmission_requirement: 'MANUAL' | 'AUTOMATIC';
  asset_tier: 'HATCHBACK' | 'PREMIUM_SUV' | 'ULTRA_LUXURY';
  verification_status: 'VERIFIED' | 'PENDING_INSURANCE' | 'FLAGGED';
  escrow_balance_paise: number;
  city_prefix: string;
  updated_at: string;
}

export const VehicleProfilesMatrix: React.FC = () => {
  const [profiles, setProfiles] = useState<CustomerVehicleProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<CustomerVehicleProfile | null>(null);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'SUCCESS' | 'ERROR'; text: string } | null>(null);

  useEffect(() => {
    fetchCustomerVehicleProfiles();
  }, []);

  const fetchCustomerVehicleProfiles = async () => {
    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/customers/vehicles`);

      if (response.ok) {
        const data = await response.json();
        setProfiles(data.profiles || []);
      } else {
        // High-fidelity fallback mocks representing primary consumer profiles across Kolkata operating grids
        setProfiles([
          {
            id: 'cust-9012-x78',
            owner_name: 'Soumitra Chatterjee',
            owner_phone: '+91 98303 88776',
            vehicle_make_model: 'BMW M3 Competition',
            license_plate: 'WB-02-AF-9988',
            transmission_requirement: 'MANUAL',
            asset_tier: 'ULTRA_LUXURY',
            verification_status: 'VERIFIED',
            escrow_balance_paise: 750000, // ₹7,500.00
            city_prefix: 'KOL',
            updated_at: new Date().toISOString(),
          },
          {
            id: 'cust-3451-p22',
            owner_name: 'Priyanka Banerjee',
            owner_phone: '+91 98314 22334',
            vehicle_make_model: 'Tata Nexon EV',
            license_plate: 'WB-06-K-4411',
            transmission_requirement: 'AUTOMATIC',
            asset_tier: 'PREMIUM_SUV',
            verification_status: 'PENDING_INSURANCE',
            escrow_balance_paise: 220000, // ₹2,200.00
            city_prefix: 'KOL',
            updated_at: new Date(Date.now() - 43200000).toISOString(),
          }
        ]);
      }
    } catch (err) {
      console.error('Failed reading demand asset profiles matrix from gateway:', err);
    }
  };

  const handleUpdateTransmission = (type: 'MANUAL' | 'AUTOMATIC') => {
    if (!selectedProfile) return;
    setSelectedProfile({ ...selectedProfile, transmission_requirement: type });
  };

  const handleUpdateAssetTier = (tier: 'HATCHBACK' | 'PREMIUM_SUV' | 'ULTRA_LUXURY') => {
    if (!selectedProfile) return;
    setSelectedProfile({ ...selectedProfile, asset_tier: tier });
  };

  const commitAssetProfileChanges = async () => {
    if (!selectedProfile) return;
    setIsUpdating(true);
    setStatusMessage(null);

    try {
      const response = await fetch(`${API_GATEWAY_BASE_URL}/api/v1/admin/customers/vehicles/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          profile_id: selectedProfile.id,
          transmission_requirement: selectedProfile.transmission_requirement,
          asset_tier: selectedProfile.asset_tier,
          verification_status: selectedProfile.verification_status,
        })
      });

      if (response.ok) {
        setStatusMessage({
          type: 'SUCCESS',
          text: `Asset parameters for ${selectedProfile.owner_name} committed cleanly to core cluster channels.`
        });
        setProfiles(profiles.map(p => p.id === selectedProfile.id ? selectedProfile : p));
      } else {
        setStatusMessage({ type: 'ERROR', text: 'Mutation rejected by validation engine restrictions.' });
      }
    } catch {
      setStatusMessage({ type: 'ERROR', text: 'Cluster network timeout exception.' });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="bg-canvas-softer rounded-xl p-6 border border-canvas-soft shadow-sm space-y-6 lg:col-span-3">
      <div>
        <h2 className="text-lg font-bold text-ink font-move">Car Owner Asset & Profile Management</h2>
        <p className="text-xs text-body">Govern transmission validation controls, escrow ledgers, and vehicle tier classifications</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Subsection: Relational Customer Registration Feed */}
        <div className="lg:col-span-1 space-y-3 max-h-[400px] overflow-y-auto pr-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-mute">Verified Vehicle Owners ({profiles.length})</div>
          {profiles.map((profile) => (
            <div
              key={profile.id}
              onClick={() => setSelectedProfile(profile)}
              className={`p-4 rounded-xl border transition text-left cursor-pointer ${
                selectedProfile?.id === profile.id
                  ? 'bg-black border-black text-white'
                  : 'bg-white border-canvas-soft hover:bg-canvas-softer text-ink'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="text-xs font-bold font-move">{profile.owner_name}</span>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  selectedProfile?.id === profile.id ? 'bg-white/20 text-white' : 'bg-canvas-soft text-ink'
                }`}>
                  {profile.transmission_requirement}
                </span>
              </div>
              <div className={`text-[11px] mt-1 font-medium ${selectedProfile?.id === profile.id ? 'text-white/80' : 'text-ink'}`}>
                {profile.vehicle_make_model}
              </div>
              <div className={`text-[9px] font-mono mt-1 ${selectedProfile?.id === profile.id ? 'text-white/60' : 'text-mute'}`}>
                Plate: {profile.license_plate}
              </div>
            </div>
          ))}
        </div>

        {/* Right Subsection: Detailed Structural Asset Configuration Plane */}
        <div className="lg:col-span-2 bg-white border border-canvas-soft rounded-xl p-6 flex flex-col justify-between min-h-[400px]">
          {selectedProfile ? (
            <div className="space-y-6 flex-grow flex flex-col justify-between text-left">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Account Ledger & Asset Identity Identity Blocks */}
                <div className="space-y-4">
                  <div className="border-b border-canvas-soft pb-3">
                    <div className="text-[10px] uppercase font-bold text-mute tracking-wider">Demand Profile context</div>
                    <div className="text-base font-bold text-ink font-move mt-1">{selectedProfile.owner_name}</div>
                    <div className="text-xs text-body font-mono mt-0.5">{selectedProfile.owner_phone}</div>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div><span className="font-bold text-body">Vehicle Asset:</span> <span className="text-ink font-medium">{selectedProfile.vehicle_make_model}</span></div>
                    <div><span className="font-bold text-body">License Registry:</span> <span className="font-mono text-ink bg-canvas-softer px-1.5 py-0.5 rounded border border-canvas-soft/60">{selectedProfile.license_plate}</span></div>
                    
                    {/* Embedded Escrow Tracking Sub-Panel Matrix */}
                    <div className="pt-3 border-t border-canvas-soft/60 mt-3">
                      <span className="block text-[10px] uppercase font-bold text-mute tracking-wider mb-1">Prepaid Account Escrow Ledger</span>
                      <span className="text-sm font-mono font-bold text-ink">
                        ₹{(selectedProfile.escrow_balance_paise / 100).toFixed(2)} INR
                      </span>
                    </div>
                  </div>
                </div>

                {/* Algorithmic Dispatched Routing Transmission Constraint Switches */}
                <div className="space-y-5">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-mute tracking-wider mb-2">Transmission Failsafe Constraint</div>
                    <div className="flex gap-2">
                      {(['MANUAL', 'AUTOMATIC'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => handleUpdateTransmission(type)}
                          className={`flex-1 py-2 px-3 text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg border transition ${
                            selectedProfile.transmission_requirement === type
                              ? 'bg-black border-black text-white'
                              : 'bg-white border-canvas-soft hover:bg-canvas-softer text-ink'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase font-bold text-mute tracking-wider mb-2">Marketplace Asset Pricing Tier</div>
                    <div className="flex flex-col gap-2">
                      {(['HATCHBACK', 'PREMIUM_SUV', 'ULTRA_LUXURY'] as const).map((tier) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => handleUpdateAssetTier(tier)}
                          className={`w-full text-left py-2 px-3 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition flex justify-between items-center ${
                            selectedProfile.asset_tier === tier
                              ? 'bg-black border-black text-white'
                              : 'bg-white border-canvas-soft hover:bg-canvas-softer text-ink'
                          }`}
                        >
                          <span>{tier.replace('_', ' ')}</span>
                          <span className={`text-[9px] font-mono font-medium opacity-80`}>
                            {tier === 'ULTRA_LUXURY' ? '1.8x Base Rate' : tier === 'PREMIUM_SUV' ? '1.3x Base Rate' : '1.0x Base Rate'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Compliance Selection Layer */}
              <div className="border-t border-canvas-soft pt-4 mt-4">
                <div className="text-[10px] uppercase font-bold text-mute tracking-wider mb-3">Vehicle Documentation & Insurance Verification Status</div>
                <div className="flex gap-2">
                  {(['VERIFIED', 'PENDING_INSURANCE', 'FLAGGED'] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setSelectedProfile({ ...selectedProfile, verification_status: status })}
                      className={`flex-1 py-2 px-3 text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg border transition ${
                        selectedProfile.verification_status === status
                          ? 'bg-black border-black text-white'
                          : 'bg-white border-canvas-soft hover:bg-canvas-softer text-ink'
                      }`}
                    >
                      {status === 'VERIFIED' ? '✓ VERIFIED' : status === 'FLAGGED' ? '▲ FLAGGED' : '● PENDING INS'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Configuration Commitment Action Panel */}
              <div className="border-t border-canvas-soft pt-4 mt-6">
                <button
                  onClick={commitAssetProfileChanges}
                  disabled={isUpdating}
                  type="button"
                  className="w-full bg-black hover:bg-black-elevated text-white font-bold py-3.5 px-4 rounded-full transition text-xs uppercase tracking-wider disabled:opacity-40 cursor-pointer active:scale-95"
                >
                  {isUpdating ? 'Synchronizing Cluster Matrices...' : 'Commit Asset Configurations'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-grow flex flex-col items-center justify-center text-body italic text-xs">
              Select an active vehicle owner profile to adjust structural demand-side constraints.
            </div>
          )}

          {statusMessage && (
            <div className={`mt-4 p-3.5 rounded-xl text-[10px] font-mono font-bold uppercase tracking-wider ${
              statusMessage.type === 'SUCCESS' ? 'bg-canvas-soft border border-surface-pressed text-ink' : 'bg-black text-white'
            }`}>
              {statusMessage.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
