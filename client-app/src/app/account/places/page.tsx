'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function RiderPlacesPage() {
  const t = useTranslations('accountPlaces');
  const [places, setPlaces] = useState([
    { id: '1', label: '🏠 Home Location', address: 'Cyberdyne Systems HQ, Alipore Grid, Kolkata' },
    { id: '2', label: '🏢 Work Office', address: 'Salt Lake Sector V Tech Hub, Kolkata' }
  ]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('🌟 Custom');
  const [newAddress, setNewAddress] = useState('');

  const handleAddPlace = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.trim()) return;

    setPlaces((prev) => [
      ...prev,
      { id: `${Date.now()}`, label: newLabel, address: newAddress }
    ]);
    setNewAddress('');
    setShowAddForm(false);
    alert(t('addressSaved'));
  };

  const handleRemovePlace = (id: string) => {
    if (confirm(t('confirmDelete'))) {
      setPlaces((prev) => prev.filter((p) => p.id !== id));
    }
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
          {showAddForm ? t('closeForm') : t('addPlace')}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <form onSubmit={handleAddPlace} className="bg-zinc-950 border border-zinc-900 rounded-2xl p-5 space-y-4 animate-fadeIn font-mono text-xs">
          <h4 className="text-xs font-bold text-white uppercase border-b border-zinc-900 pb-2">{t('addFavoriteLocation')}</h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('labelTag')}</label>
              <select
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-zinc-350"
              >
                <option>{t('optionHome')}</option>
                <option>{t('optionWork')}</option>
                <option>{t('optionFavorite')}</option>
                <option>{t('optionMall')}</option>
                <option>{t('optionAirport')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[8px] text-zinc-500 uppercase mb-1">{t('addressDetails')}</label>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder={t('addressPlaceholder')}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-white"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full bg-white hover:bg-zinc-200 text-black py-3 rounded-xl font-sans font-bold uppercase transition"
          >
            {t('saveFavoriteAddress')}
          </button>
        </form>
      )}

      {/* List */}
      <div className="space-y-3">
        {places.map((p) => (
          <div key={p.id} className="bg-zinc-950 border border-zinc-900 p-5 rounded-2xl flex justify-between items-center text-xs font-mono">
            <div>
              <span className="text-white block font-sans font-bold">{p.label}</span>
              <span className="text-zinc-550 text-[10px] block mt-1">{p.address}</span>
            </div>
            <button
              onClick={() => handleRemovePlace(p.id)}
              className="text-red-500 hover:text-red-400 font-mono text-[8px] uppercase tracking-wider cursor-pointer shrink-0"
            >
              {t('delete')}
            </button>
          </div>
        ))}
      </div>

    </div>
  );
}
