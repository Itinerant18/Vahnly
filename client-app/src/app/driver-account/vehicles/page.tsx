'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { getDriverVehicles, addDriverVehicle, deleteDriverVehicle, DriverVehicle } from '@/api/client';

function humanize(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DriverVehiclesPage() {
  const { token } = useAuthStore();
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [loading, setLoading] = useState(true);

  const loadVehicles = useCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await getDriverVehicles(token);
      setVehicles(res.vehicles);
    } catch (err) {
      console.warn('Failed to load vehicles:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  const handleAddVehicle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      alert('Please sign in.');
      return;
    }
    const make = prompt('Vehicle make (e.g. Toyota):')?.trim();
    const model = prompt('Vehicle model (e.g. Fortuner):')?.trim();
    const plate = prompt('License plate:')?.trim();
    if (!make || !model || !plate) return;
    const transmission = (prompt('Transmission (MANUAL/AUTOMATIC):') || 'AUTOMATIC').toUpperCase();
    try {
      await addDriverVehicle(token, { make, model, license_plate: plate, transmission });
      await loadVehicles();
    } catch (err: any) {
      alert(err?.message || 'Failed to add vehicle.');
    }
  };

  const handleRemoveVehicle = async (id: string) => {
    if (!token) return;
    if (!confirm('Remove this vehicle record?')) return;
    try {
      await deleteDriverVehicle(token, id);
      await loadVehicles();
    } catch (err: any) {
      alert(err?.message || 'Failed to remove vehicle.');
    }
  };

  const hasExpiryWarning = vehicles.some(
    (v) => v.insurance_status !== 'VERIFIED' || v.puc_status !== 'VERIFIED',
  );

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">Vehicle Management</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage personal or fleet vehicles assigned to your partner account</p>
        </div>

        <button
          onClick={handleAddVehicle}
          className="bg-white hover:bg-zinc-200 text-black text-[10px] font-mono font-bold uppercase px-4 py-2 rounded-full cursor-pointer"
        >
          Add Vehicle
        </button>
      </div>

      {/* Warnings & Alerts */}
      {hasExpiryWarning && (
        <div className="bg-amber-950/20 border border-amber-900 rounded-2xl p-4 text-xs font-sans text-amber-400 space-y-1">
          <span className="block font-bold">⚠️ DOCUMENT VERIFICATION PENDING</span>
          <p className="text-[10px] text-amber-200/70 leading-normal">
            Some vehicle documents are not yet verified. Submit RC/insurance/pollution details to prevent dispatcher lockout.
          </p>
        </div>
      )}

      {/* List */}
      <div className="space-y-4">
        {loading && <p className="text-[10px] font-mono text-zinc-600">Loading vehicles…</p>}
        {!loading && vehicles.length === 0 && (
          <p className="text-[10px] font-mono text-zinc-600">No vehicles registered. Use “Add Vehicle” to register one.</p>
        )}
        {vehicles.map((v) => (
          <div key={v.id} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h4 className="text-sm font-bold text-white font-sans">{v.make} {v.model}</h4>
                <div className="flex gap-2 mt-1.5 font-mono text-[9px]">
                  <span className="bg-zinc-900 text-white px-2 py-0.5 rounded border border-zinc-800 font-bold uppercase">{v.license_plate}</span>
                  <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-800 font-bold uppercase">{v.transmission}</span>
                </div>
              </div>

              <button
                onClick={() => handleRemoveVehicle(v.id)}
                className="text-red-500 hover:text-red-400 font-mono text-[8px] uppercase tracking-wider cursor-pointer"
              >
                Delete Record
              </button>
            </div>

            {/* Document status checklist */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-zinc-900 pt-3 text-[10px] font-mono text-zinc-400">
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Registration Certificate (RC)</span>
                <span className="text-white block mt-0.5">{humanize(v.rc_status)}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Vehicle Insurance</span>
                <span className={`block mt-0.5 ${v.insurance_status !== 'VERIFIED' ? 'text-amber-500' : 'text-white'}`}>{humanize(v.insurance_status)}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Pollution Cert (PUC)</span>
                <span className={`block mt-0.5 ${v.puc_status !== 'VERIFIED' ? 'text-amber-500' : 'text-white'}`}>{humanize(v.puc_status)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
