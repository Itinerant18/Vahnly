'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

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
  rcExpiry: string;
  insuranceExpiry: string;
  pucExpiry: string;
}

export default function RiderGaragePage() {
  const t = useTranslations('accountGarage');
  const baseDate = new Date('2026-06-04');

  const [vehicles, setVehicles] = useState<CarItem[]>([
    { 
      id: 'c-1', 
      make: 'Audi', 
      model: 'A6 Sedan', 
      year: '2022', 
      type: 'Premium', 
      transmission: 'AUTOMATIC', 
      fuel: 'Petrol', 
      plate: 'WB-02-AK-9988', 
      color: 'White', 
      isDefault: true, 
      rcExpiry: '2031-12-04', 
      insuranceExpiry: '2026-06-18', // 14 days remaining (amber)
      pucExpiry: '2027-10-15' // valid
    },
    { 
      id: 'c-2', 
      make: 'Maruti Suzuki', 
      model: 'Swift Dzire', 
      year: '2020', 
      type: 'Sedan', 
      transmission: 'MANUAL', 
      fuel: 'Diesel', 
      plate: 'KA-03-MD-4561', 
      color: 'Silver', 
      isDefault: false, 
      rcExpiry: '2030-05-10', 
      insuranceExpiry: '2026-05-15', // expired (red)
      pucExpiry: '2026-06-25' // 21 days remaining (amber)
    }
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
    rcExpiry: '2031-01-01',
    insuranceExpiry: '2027-01-01',
    pucExpiry: '2026-12-01',
    isDefault: false
  });

  useEffect(() => {
    const saved = localStorage.getItem('rider_garage_cars');
    if (saved) {
      try {
        setVehicles(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse vehicles from localStorage', e);
      }
    }
  }, []);

  const getDocStatus = (expiryDateStr: string) => {
    const expiry = new Date(expiryDateStr);
    const diffTime = expiry.getTime() - baseDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 0) {
      return { label: t('docExpired'), color: 'text-red-500', isCritical: true };
    } else if (diffDays <= 30) {
      return { label: t('docExpiresIn', { days: diffDays }), color: 'text-amber-500 animate-pulse', isWarning: true };
    } else {
      return { label: t('docVerified', { expiry: expiryDateStr }), color: 'text-emerald-400', isValid: true };
    }
  };

  const handleAddCar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCar.make || !newCar.model || !newCar.plate) {
      alert(t('alertMissingFields'));
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
      plate: newCar.plate.toUpperCase(),
      color: newCar.color || t('colorUnspecified'),
      isDefault: newCar.isDefault,
      rcExpiry: newCar.rcExpiry,
      insuranceExpiry: newCar.insuranceExpiry,
      pucExpiry: newCar.pucExpiry
    };

    let updatedVehicles = [...vehicles];
    if (newCar.isDefault) {
      updatedVehicles = updatedVehicles.map((v) => ({ ...v, isDefault: false }));
    }
    updatedVehicles.push(created);

    setVehicles(updatedVehicles);
    localStorage.setItem('rider_garage_cars', JSON.stringify(updatedVehicles));
    
    setShowAddForm(false);
    setNewCar({ 
      make: '', 
      model: '', 
      year: '2023', 
      type: 'Sedan', 
      transmission: 'AUTOMATIC', 
      fuel: 'Petrol', 
      plate: '', 
      color: '', 
      rcExpiry: '2031-01-01',
      insuranceExpiry: '2027-01-01',
      pucExpiry: '2026-12-01',
      isDefault: false 
    });
    alert(t('alertRegistered'));
  };

  const handleSetDefault = (id: string) => {
    const updated = vehicles.map((v) => ({ ...v, isDefault: v.id === id }));
    setVehicles(updated);
    localStorage.setItem('rider_garage_cars', JSON.stringify(updated));
    alert(t('alertDefaultUpdated'));
  };

  const handleRemoveCar = (id: string, plate: string) => {
    // Destructive Mutator Action Gate: type plate string to confirm
    const confirmation = prompt(
      t('removePrompt', { plate })
    );
    if (!confirmation) return;
    if (confirmation.trim().toUpperCase() !== plate.toUpperCase()) {
      alert(t('alertPlateMismatch'));
      return;
    }

    const updated = vehicles.filter((v) => v.id !== id);
    setVehicles(updated);
    localStorage.setItem('rider_garage_cars', JSON.stringify(updated));
    alert(t('alertDeleted'));
  };

  const handleTriggerReupload = (vehicleId: string, docType: 'rc' | 'insurance' | 'puc') => {
    const newDate = prompt(t('reuploadPrompt', { docType: docType.toUpperCase() }));
    if (!newDate) return;

    // Simple verification
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      alert(t('alertInvalidDate'));
      return;
    }

    const updated = vehicles.map((v) => {
      if (v.id === vehicleId) {
        return {
          ...v,
          [`${docType}Expiry`]: newDate
        };
      }
      return v;
    });

    setVehicles(updated);
    localStorage.setItem('rider_garage_cars', JSON.stringify(updated));
    alert(t('alertDocUpdated', { docType: docType.toUpperCase() }));
  };

  return (
    <div className="space-y-6 text-left">
      {/* Header */}
      <div className="flex justify-between items-center pb-4 border-b border-zinc-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white font-move">{t('title')}</h2>
          <p className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider mt-0.5">{t('subtitle')}</p>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-white hover:bg-zinc-200 text-black text-[10px] font-mono font-bold uppercase px-4 py-2 rounded-full cursor-pointer"
        >
          {showAddForm ? t('closeForm') : t('addVehicle')}
        </button>
      </div>

      {/* Warnings & Alerts */}
      <div className="space-y-2">
        {vehicles.some(v => {
          const rc = getDocStatus(v.rcExpiry);
          const ins = getDocStatus(v.insuranceExpiry);
          const puc = getDocStatus(v.pucExpiry);
          return rc.isCritical || rc.isWarning || ins.isCritical || ins.isWarning || puc.isCritical || puc.isWarning;
        }) && (
          <div className="bg-amber-950/20 border border-amber-900 rounded-2xl p-4 text-xs text-amber-400 space-y-1">
            <span className="block font-bold">{t('alertBannerTitle')}</span>
            <p className="text-[10px] text-amber-200/70 leading-relaxed font-sans">
              {t('alertBannerBody')}
            </p>
          </div>
        )}
      </div>

      {/* Add vehicle form */}
      {showAddForm && (
        <form onSubmit={handleAddCar} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 animate-fadeIn font-mono text-xs">
          <h4 className="text-xs font-bold text-white uppercase border-b border-zinc-900 pb-2">{t('registerNewVehicle')}</h4>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('make')}</label>
              <input
                type="text"
                value={newCar.make}
                onChange={(e) => setNewCar({ ...newCar, make: e.target.value })}
                placeholder={t('makePlaceholder')}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('model')}</label>
              <input
                type="text"
                value={newCar.model}
                onChange={(e) => setNewCar({ ...newCar, model: e.target.value })}
                placeholder={t('modelPlaceholder')}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('licensePlate')}</label>
              <input
                type="text"
                value={newCar.plate}
                onChange={(e) => setNewCar({ ...newCar, plate: e.target.value })}
                placeholder={t('licensePlatePlaceholder')}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white uppercase focus:outline-none"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('type')}</label>
              <select
                value={newCar.type}
                onChange={(e) => setNewCar({ ...newCar, type: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-zinc-350 focus:outline-none"
              >
                <option>Hatchback</option>
                <option>Sedan</option>
                <option>SUV</option>
                <option>Premium</option>
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('transmission')}</label>
              <select
                value={newCar.transmission}
                onChange={(e) => setNewCar({ ...newCar, transmission: e.target.value as any })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-zinc-350 focus:outline-none"
              >
                <option>AUTOMATIC</option>
                <option>MANUAL</option>
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('fuelType')}</label>
              <select
                value={newCar.fuel}
                onChange={(e) => setNewCar({ ...newCar, fuel: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-zinc-350 focus:outline-none"
              >
                <option>Petrol</option>
                <option>Diesel</option>
                <option>EV</option>
                <option>CNG</option>
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('color')}</label>
              <input
                type="text"
                value={newCar.color}
                onChange={(e) => setNewCar({ ...newCar, color: e.target.value })}
                placeholder={t('colorPlaceholder')}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-zinc-900 pt-3">
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('rcExpiryDate')}</label>
              <input
                type="date"
                value={newCar.rcExpiry}
                onChange={(e) => setNewCar({ ...newCar, rcExpiry: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('insuranceExpiry')}</label>
              <input
                type="date"
                value={newCar.insuranceExpiry}
                onChange={(e) => setNewCar({ ...newCar, insuranceExpiry: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('pucExpiry')}</label>
              <input
                type="date"
                value={newCar.pucExpiry}
                onChange={(e) => setNewCar({ ...newCar, pucExpiry: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2 text-white focus:outline-none"
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
            <label htmlFor="set-default" className="cursor-pointer">{t('setAsDefault')}</label>
          </div>

          <button
            type="submit"
            className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl font-sans font-bold uppercase transition"
          >
            {t('submitRegistration')}
          </button>
        </form>
      )}

      {/* List */}
      <div className="space-y-4">
        {vehicles.map((v) => {
          const rcStatus = getDocStatus(v.rcExpiry);
          const insStatus = getDocStatus(v.insuranceExpiry);
          const pucStatus = getDocStatus(v.pucExpiry);

          return (
            <div key={v.id} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl space-y-4">
              <div className="flex justify-between items-start gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-white font-sans">{v.make} {v.model}</h4>
                    {v.isDefault && (
                      <span className="bg-emerald-950/20 text-emerald-400 border border-emerald-900 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider animate-pulse">
                        {t('defaultVehicleBadge')}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex gap-2 mt-1.5 font-mono text-[9px]">
                    <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850 font-bold uppercase">{v.plate}</span>
                    <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850 font-bold uppercase">{v.transmission}</span>
                    <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850 font-bold uppercase">{v.type}</span>
                    <span className="bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-850 font-bold uppercase">{v.fuel}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 font-mono text-[8px] uppercase tracking-wider font-bold">
                  {!v.isDefault && (
                    <button
                      onClick={() => handleSetDefault(v.id)}
                      className="text-zinc-400 hover:text-white cursor-pointer transition"
                    >
                      {t('setDefault')}
                    </button>
                  )}
                  <button
                    onClick={() => handleRemoveCar(v.id, v.plate)}
                    className="text-red-500 hover:text-red-400 cursor-pointer transition"
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>

              {/* Document stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-zinc-900 pt-3 text-[10px] font-mono text-zinc-400">
                <div className="space-y-1">
                  <span className="text-zinc-600 block text-[8px] uppercase font-bold">{t('docRcLabel')}</span>
                  <span className={`block font-bold ${rcStatus.color}`}>{rcStatus.label}</span>
                  {(rcStatus.isCritical || rcStatus.isWarning) && (
                    <button 
                      onClick={() => handleTriggerReupload(v.id, 'rc')}
                      className="text-[8px] text-zinc-500 hover:text-white underline uppercase block"
                    >
                      Re-upload
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-zinc-600 block text-[8px] uppercase font-bold">{t('docInsuranceLabel')}</span>
                  <span className={`block font-bold ${insStatus.color}`}>{insStatus.label}</span>
                  {(insStatus.isCritical || insStatus.isWarning) && (
                    <button 
                      onClick={() => handleTriggerReupload(v.id, 'insurance')}
                      className="text-[8px] text-zinc-500 hover:text-white underline uppercase block"
                    >
                      Re-upload
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  <span className="text-zinc-600 block text-[8px] uppercase font-bold">{t('docPucLabel')}</span>
                  <span className={`block font-bold ${pucStatus.color}`}>{pucStatus.label}</span>
                  {(pucStatus.isCritical || pucStatus.isWarning) && (
                    <button 
                      onClick={() => handleTriggerReupload(v.id, 'puc')}
                      className="text-[8px] text-zinc-500 hover:text-white underline uppercase block"
                    >
                      Re-upload
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
