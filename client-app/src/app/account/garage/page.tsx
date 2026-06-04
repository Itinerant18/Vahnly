'use client';

import React, { useState } from 'react';

interface CarItem {
  id: string;
  make: string;
  model: string;
  year: string;
  type: string;
  transmission: 'MANUAL' | 'AUTOMATIC';
  fuel: string;
  plate: string;
  color: string;
  isDefault: boolean;
  insurance: string;
  rc: string;
  puc: string;
}

export default function RiderGaragePage() {
  const [vehicles, setVehicles] = useState<CarItem[]>([
    { id: 'c-1', make: 'Audi', model: 'A6 Sedan', year: '2022', type: 'Premium', transmission: 'AUTOMATIC', fuel: 'Petrol', plate: 'WB-02-AK-9988', color: 'White', isDefault: true, insurance: 'Verified (Expires 2027)', rc: 'Verified', puc: 'Expires in 45 days' },
    { id: 'c-2', make: 'Maruti Suzuki', model: 'Swift Dzire', year: '2020', type: 'Sedan', transmission: 'MANUAL', fuel: 'Diesel', plate: 'KA-03-MD-4561', color: 'Silver', isDefault: false, insurance: 'Expires in 12 days', rc: 'Verified', puc: 'Expired' }
  ]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCar, setNewCar] = useState({
    make: '',
    model: '',
    year: '2023',
    type: 'Sedan',
    transmission: 'AUTOMATIC' as 'AUTOMATIC' | 'MANUAL',
    fuel: 'Petrol',
    plate: '',
    color: '',
    insuranceExpiry: '',
    isDefault: false
  });

  const handleAddCar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCar.make || !newCar.model || !newCar.plate) {
      alert('Provide make, model and license plate details.');
      return;
    }

    const created: CarItem = {
      id: `c-${Date.now()}`,
      make: newCar.make,
      model: newCar.model,
      year: newCar.year,
      type: newCar.type,
      transmission: newCar.transmission,
      fuel: newCar.fuel,
      plate: newCar.plate,
      color: newCar.color,
      isDefault: newCar.isDefault,
      insurance: newCar.insuranceExpiry ? `Expires: ${newCar.insuranceExpiry}` : 'Awaiting upload',
      rc: 'Awaiting review',
      puc: 'Awaiting upload'
    };

    if (newCar.isDefault) {
      setVehicles((prev) => prev.map((v) => ({ ...v, isDefault: false })));
    }

    const updatedVehicles = [...vehicles, created];
    setVehicles(updatedVehicles);
    localStorage.setItem('rider_garage_cars', JSON.stringify(updatedVehicles));
    
    setShowAddForm(false);
    setNewCar({ make: '', model: '', year: '2023', type: 'Sedan', transmission: 'AUTOMATIC', fuel: 'Petrol', plate: '', color: '', insuranceExpiry: '', isDefault: false });
    alert('Vehicle asset registered successfully in your platform garage.');
  };

  const handleSetDefault = (id: string) => {
    const updated = vehicles.map((v) => ({ ...v, isDefault: v.id === id }));
    setVehicles(updated);
    localStorage.setItem('rider_garage_cars', JSON.stringify(updated));
    alert('Default vehicle profile updated.');
  };

  const handleRemoveCar = (id: string) => {
    if (confirm('Are you sure you want to delete this vehicle asset from your garage?')) {
      const updated = vehicles.filter((v) => v.id !== id);
      setVehicles(updated);
      localStorage.setItem('rider_garage_cars', JSON.stringify(updated));
    }
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">My Garage</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">Manage personal vehicles and verify documents checks</p>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-white hover:bg-zinc-200 text-black text-[10px] font-mono font-bold uppercase px-4 py-2 rounded-full cursor-pointer"
        >
          {showAddForm ? 'Close Form' : 'Add Vehicle'}
        </button>
      </div>

      {/* Warnings & Alerts */}
      <div className="space-y-2">
        {vehicles.some(v => v.insurance.includes('days') || v.puc === 'Expired') && (
          <div className="bg-amber-950/20 border border-amber-900 rounded-2xl p-4 text-xs text-amber-400 space-y-1">
            <span className="block font-bold">⚠️ VEHICLE REGISTRATION EXPIRED DOCUMENTS</span>
            <p className="text-[10px] text-amber-200/70 leading-relaxed font-sans">
              Some documents are nearing expiration. Upload current insurance policies or PUC updates to verify matching calculations safely.
            </p>
          </div>
        )}
      </div>

      {/* Add vehicle form */}
      {showAddForm && (
        <form onSubmit={handleAddCar} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 animate-fadeIn font-mono text-xs">
          <h4 className="text-xs font-bold text-white uppercase border-b border-zinc-900 pb-2">Register New Vehicle</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Make</label>
              <input
                type="text"
                value={newCar.make}
                onChange={(e) => setNewCar({ ...newCar, make: e.target.value })}
                placeholder="e.g. Maruti Suzuki"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Model</label>
              <input
                type="text"
                value={newCar.model}
                onChange={(e) => setNewCar({ ...newCar, model: e.target.value })}
                placeholder="e.g. Swift"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white"
                required
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">License Plate</label>
              <input
                type="text"
                value={newCar.plate}
                onChange={(e) => setNewCar({ ...newCar, plate: e.target.value })}
                placeholder="WB-02-AK-1234"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white uppercase"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Type</label>
              <select
                value={newCar.type}
                onChange={(e) => setNewCar({ ...newCar, type: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-zinc-350"
              >
                <option>Hatchback</option>
                <option>Sedan</option>
                <option>SUV</option>
                <option>Premium</option>
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Transmission</label>
              <select
                value={newCar.transmission}
                onChange={(e) => setNewCar({ ...newCar, transmission: e.target.value as any })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-zinc-350"
              >
                <option>AUTOMATIC</option>
                <option>MANUAL</option>
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Fuel Type</label>
              <select
                value={newCar.fuel}
                onChange={(e) => setNewCar({ ...newCar, fuel: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-zinc-350"
              >
                <option>Petrol</option>
                <option>Diesel</option>
                <option>EV</option>
                <option>CNG</option>
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">Color</label>
              <input
                type="text"
                value={newCar.color}
                onChange={(e) => setNewCar({ ...newCar, color: e.target.value })}
                placeholder="White"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="set-default"
              checked={newCar.isDefault}
              onChange={(e) => setNewCar({ ...newCar, isDefault: e.target.checked })}
              className="cursor-pointer"
            />
            <label htmlFor="set-default" className="cursor-pointer">Set as default vehicle filter</label>
          </div>

          <button
            type="submit"
            className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl font-sans font-bold uppercase transition"
          >
            Submit Vehicle Registration
          </button>
        </form>
      )}

      {/* List */}
      <div className="space-y-4">
        {vehicles.map((v) => (
          <div key={v.id} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white font-sans">{v.make} {v.model}</h4>
                  {v.isDefault && (
                    <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider">
                      ★ DEFAULT
                    </span>
                  )}
                </div>
                
                <div className="flex gap-2 mt-1.5 font-mono text-[9px]">
                  <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850 font-bold uppercase">{v.plate}</span>
                  <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850 font-bold uppercase">{v.transmission}</span>
                  <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850 font-bold uppercase">{v.type}</span>
                </div>
              </div>

              <div className="flex items-center gap-3 font-mono text-[8px] uppercase tracking-wider font-bold">
                {!v.isDefault && (
                  <button
                    onClick={() => handleSetDefault(v.id)}
                    className="text-zinc-400 hover:text-white cursor-pointer"
                  >
                    Set Default
                  </button>
                )}
                <button
                  onClick={() => handleRemoveCar(v.id)}
                  className="text-red-500 hover:text-red-400 cursor-pointer"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Document stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-zinc-900 pt-3 text-[10px] font-mono text-zinc-400">
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">RC verification status</span>
                <span className="text-white block mt-0.5">{v.rc}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Insurance Policies</span>
                <span className={`block mt-0.5 ${v.insurance.includes('days') ? 'text-amber-500' : 'text-white'}`}>{v.insurance}</span>
              </div>
              <div>
                <span className="text-zinc-600 block text-[8px] uppercase font-bold">Pollution check (PUC)</span>
                <span className={`block mt-0.5 ${v.puc === 'Expired' ? 'text-red-500' : 'text-white'}`}>{v.puc}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
