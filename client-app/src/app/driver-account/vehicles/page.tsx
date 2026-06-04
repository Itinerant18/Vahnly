'use client';

import React, { useState } from 'react';

export default function DriverVehiclesPage() {
  const [vehicles, setVehicles] = useState([
    { id: 'veh-1', make: 'Audi', model: 'A6 Luxury Sedan', plate: 'WB-02-AK-9988', transmission: 'AUTOMATIC', rc: 'Verified', insurance: 'Expires in 12 days', puc: 'Expires in 45 days' },
    { id: 'veh-2', make: 'Maruti Suzuki', model: 'Swift Dzire Core', plate: 'KA-03-MD-4561', transmission: 'MANUAL', rc: 'Verified', insurance: 'Verified (Expires 2027)', puc: 'Expired' }
  ]);

  const handleAddVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    const make = prompt('Enter vehicle make (e.g. Toyota):');
    const model = prompt('Enter vehicle model (e.g. Fortuner):');
    const plate = prompt('Enter license plate number:');
    const trans = prompt('Enter transmission (MANUAL/AUTOMATIC):') || 'AUTOMATIC';

    if (!make || !model || !plate) return;

    const newVeh = {
      id: `veh-${Date.now()}`,
      make,
      model,
      plate,
      transmission: trans.toUpperCase(),
      rc: 'Pending Admin Review',
      insurance: 'Awaiting Document Upload',
      puc: 'Awaiting Document Upload'
    };

    setVehicles((prev) => [...prev, newVeh]);
    alert(`Vehicle "${make} ${model}" registered. Submit RC/Insurance in profile to verify.`);
  };

  const handleRemoveVehicle = (id: string) => {
    if (confirm('Are you sure you want to remove this vehicle asset record?')) {
      setVehicles((prev) => prev.filter((v) => v.id !== id));
    }
  };

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
      <div className="space-y-2">
        {vehicles.some(v => v.insurance.includes('days') || v.puc.includes('Expired')) && (
          <div className="bg-amber-950/20 border border-amber-900 rounded-2xl p-4 text-xs font-sans text-amber-400 space-y-1">
            <span className="block font-bold">⚠️ CRITICAL DOCUMENT EXPIRY WARN</span>
            <p className="text-[10px] text-amber-200/70 leading-normal">
              Some documents are nearing expiration or have expired. Update insurance/pollution details to prevent matching dispatcher lockout.
            </p>
          </div>
        )}
      </div>

      {/* List */}
      <div className="space-y-4">
        {vehicles.map((v) => (
          <div key={v.id} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h4 className="text-sm font-bold text-white font-sans">{v.make} {v.model}</h4>
                <div className="flex gap-2 mt-1.5 font-mono text-[9px]">
                  <span className="bg-zinc-900 text-white px-2 py-0.5 rounded border border-zinc-800 font-bold uppercase">{v.plate}</span>
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

            {/* Document expirations checklist */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-zinc-900 pt-3 text-[10px] font-mono text-zinc-400">
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Registration Certificate (RC)</span>
                <span className="text-white block mt-0.5">{v.rc}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Vehicle Insurance</span>
                <span className={`block mt-0.5 ${v.insurance.includes('days') ? 'text-amber-500' : 'text-white'}`}>{v.insurance}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Pollution Cert (PUC)</span>
                <span className={`block mt-0.5 ${v.puc === 'Expired' ? 'text-red-500' : 'text-white'}`}>{v.puc}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
